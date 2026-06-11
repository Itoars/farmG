const express = require("express");
const mineflayer = require("mineflayer");

const app = express();
app.use(express.json());

// ─────────────────────────────────────────
//  CONFIG
// ─────────────────────────────────────────

const SERVER_HOST = "karmasmp.ddns.net";
const SERVER_PORT = 25565;

const BOT_LIST = [
  { name: "Deadmau5",   password: "676769" },
  { name: "Prince",     password: "676769" },
  { name: "Wemmbu_Alt", password: "676769" },
];

// ─────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────

// bots["Deadmau5"] = { inst, status, logs[], reconnTimer, afkTimer, reconnDelay, reconnAt, gen }
const state = {};

for (const cfg of BOT_LIST) {
  state[cfg.name] = {
    inst:        null,
    status:      "stopped",   // stopped | connecting | online | offline | reconnecting
    logs:        [],
    reconnTimer: null,
    afkTimer:    null,
    reconnDelay: 60000,
    reconnAt:    null,
    gen:         0,           // generation counter — stale event guard
  };
}

// ─────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────

function ts() {
  return new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });
}

function addLog(name, type, text) {
  if (!text || !text.trim()) return;
  const s = state[name];
  if (!s) return;
  s.logs.push({ t: ts(), type, text: text.trim() });
  if (s.logs.length > 300) s.logs.shift();
}

// Strip §-codes and ANSI from Minecraft messages
function strip(msg) {
  return (msg || "")
    .replace(/\x1B\[[0-9;]*m/g, "")
    .replace(/§[0-9a-fk-or]/gi, "")
    .trim();
}

function stopAfk(name) {
  if (state[name].afkTimer) {
    clearInterval(state[name].afkTimer);
    state[name].afkTimer = null;
  }
}

function startAfk(name, inst) {
  stopAfk(name);
  state[name].afkTimer = setInterval(() => {
    try {
      if (!inst.entity) return;
      inst.look(Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.5, true);
      inst.setControlState("jump", true);
      setTimeout(() => { try { inst.setControlState("jump", false); } catch {} }, 300);
    } catch {}
  }, 30000);
}

function cancelReconn(name) {
  if (state[name].reconnTimer) {
    clearTimeout(state[name].reconnTimer);
    state[name].reconnTimer = null;
  }
  state[name].reconnAt = null;
}

// ─────────────────────────────────────────
//  CREATE BOT
// ─────────────────────────────────────────

function createBot(name) {
  const cfg = BOT_LIST.find(b => b.name === name);
  if (!cfg) return;

  const s = state[name];

  // Kill any existing instance cleanly
  if (s.inst) {
    try { s.inst.quit(); } catch {}
    s.inst = null;
  }
  stopAfk(name);
  cancelReconn(name);

  // Bump generation — any event from a previous instance is ignored
  s.gen += 1;
  const myGen = s.gen;

  s.status = "connecting";
  addLog(name, "system", "Connecting...");

  const inst = mineflayer.createBot({
    host:      SERVER_HOST,
    port:      SERVER_PORT,
    username:  name,
    hideErrors: true,
  });

  s.inst = inst;

  // ── SPAWN ──────────────────────────────
  inst.once("spawn", () => {
    if (s.gen !== myGen) return;

    s.status = "online";
    s.reconnDelay = 60000; // reset backoff on successful connect
    addLog(name, "system", "Connected ✓");

    // Login after 2 s
    setTimeout(() => {
      if (s.gen !== myGen) return;
      try {
        inst.chat("/login " + cfg.password);
        addLog(name, "system", "Sent /login");
      } catch {}
    }, 2000);

    startAfk(name, inst);
  });

  // ── CHAT ───────────────────────────────
  inst.on("messagestr", (msg) => {
    if (s.gen !== myGen) return;
    const clean = strip(msg);
    if (!clean) return;

    // Determine log type
    const chatMatch = clean.match(/^<([^>]+)>\s?(.+)/);
    if (chatMatch) {
      addLog(name, "chat", clean);
    } else {
      addLog(name, "server", clean);
    }
  });

  // ── JOIN / LEAVE ───────────────────────
  inst.on("playerJoined", (p) => {
    if (s.gen !== myGen) return;
    addLog(name, "join", p.username + " joined");
  });

  inst.on("playerLeft", (p) => {
    if (s.gen !== myGen) return;
    addLog(name, "leave", p.username + " left");
  });

  // ── KICKED ─────────────────────────────
  inst.on("kicked", (reason) => {
    if (s.gen !== myGen) return;
    let msg = reason;
    try {
      const j = JSON.parse(reason);
      msg = j.text || j.translate || JSON.stringify(j);
    } catch {}
    msg = strip(msg).replace(/^"|"$/g, "");
    addLog(name, "error", "Kicked: " + msg);

    // Store kick reason for the "end" handler
    s._kickReason = msg.toLowerCase();
  });

  // ── ERROR ──────────────────────────────
  inst.on("error", (err) => {
    if (s.gen !== myGen) return;
    // ECONNRESET always triggers "end" too — skip to avoid double messages
    if (err.code === "ECONNRESET" || err.code === "ECONNREFUSED") return;
    addLog(name, "error", "Error: " + err.message);
  });

  // ── END (disconnect) ───────────────────
  inst.on("end", () => {
    if (s.gen !== myGen) return;

    stopAfk(name);
    s.status = "offline";
    addLog(name, "system", "Disconnected");

    // Don't reconnect if user clicked STOP
    if (s._stopped) {
      addLog(name, "system", "Not reconnecting (stopped).");
      s._kickReason = null;
      return;
    }

    // Pick delay based on kick reason
    const kick = s._kickReason || "";
    s._kickReason = null;

    let delay;

    if (kick.includes("throttl") || kick.includes("too many") || kick.includes("too fast")) {
      delay = 5 * 60 * 1000; // 5 min — server rate-limited us
      s.reconnDelay = 60000;  // reset backoff after waiting
      addLog(name, "system", "Throttled — waiting 5 min");
    } else if (kick.includes("same username") || kick.includes("already playing") || kick.includes("already logged")) {
      delay = 3 * 60 * 1000; // 3 min — old session still alive
      s.reconnDelay = 60000;
      addLog(name, "system", "Duplicate session — waiting 3 min");
    } else {
      delay = s.reconnDelay;
      s.reconnDelay = Math.min(s.reconnDelay * 2, 5 * 60 * 1000); // backoff, cap 5 min
    }

    // Add jitter (0–20 s) so bots never reconnect in a burst
    const jitter   = Math.floor(Math.random() * 20000);
    const total    = delay + jitter;
    const label    = total >= 60000
      ? `${Math.floor(total / 60000)}m ${Math.round((total % 60000) / 1000)}s`
      : `${Math.round(total / 1000)}s`;

    s.status   = "reconnecting";
    s.reconnAt = Date.now() + total;
    addLog(name, "system", `Reconnecting in ${label}...`);

    s.reconnTimer = setTimeout(() => {
      s.reconnAt = null;
      if (!s._stopped) createBot(name);
    }, total);
  });
}

// ─────────────────────────────────────────
//  STOP HELPER
// ─────────────────────────────────────────

function stopBot(name) {
  const s = state[name];
  if (!s) return;

  s._stopped = true;
  cancelReconn(name);
  stopAfk(name);
  s.gen += 1; // invalidate all in-flight events

  if (s.inst) {
    try { s.inst.quit(); } catch {}
    s.inst = null;
  }

  s.status      = "stopped";
  s.reconnDelay = 60000; // reset backoff for next manual start
  addLog(name, "system", "Bot stopped.");
}

// ─────────────────────────────────────────
//  ROUTES
// ─────────────────────────────────────────

// /data — polled every second by the frontend
app.get("/data", (req, res) => {
  const out = {};
  for (const b of BOT_LIST) {
    const s = state[b.name];
    out[b.name] = {
      status:    s.status,
      reconnAt:  s.reconnAt,
      logs:      s.logs,
    };
  }
  res.json(out);
});

// /send — chat message
app.post("/send", (req, res) => {
  const { bot, msg } = req.body;
  const s = state[bot];
  if (!s || !s.inst) return res.sendStatus(404);
  try {
    s.inst.chat(String(msg));
    addLog(bot, "chat", `<YOU> ${msg}`);
    res.sendStatus(200);
  } catch { res.sendStatus(500); }
});

// /start
app.post("/start", (req, res) => {
  const { bot } = req.body;
  const s = state[bot];
  if (!s) return res.sendStatus(400);
  if (s.status === "online" || s.status === "connecting") return res.sendStatus(200);
  s._stopped = false;
  createBot(bot);
  res.sendStatus(200);
});

// /stop
app.post("/stop", (req, res) => {
  const { bot } = req.body;
  if (!state[bot]) return res.sendStatus(400);
  stopBot(bot);
  res.sendStatus(200);
});

// ─────────────────────────────────────────
//  DASHBOARD HTML
// ─────────────────────────────────────────

app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Karma Bot Manager</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: Consolas, 'Courier New', monospace;
  background: radial-gradient(circle at 20% 20%, #1e293b 0%, #020617 100%);
  color: #e2e8f0;
  height: 100vh;
  display: flex;
  overflow: hidden;
}

/* ── LEFT ── */
.left {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 14px;
  min-width: 0;
  gap: 10px;
}

.tabs {
  display: flex;
  gap: 8px;
}

.tab {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 18px;
  background: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 10px;
  color: #94a3b8;
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  transition: all .2s;
}
.tab:hover { color: #fff; border-color: #334155; }
.tab.active {
  background: linear-gradient(135deg,#3b82f6,#8b5cf6);
  border-color: transparent;
  color: #fff;
  box-shadow: 0 0 20px rgba(59,130,246,.4);
}

.dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: #334155;
  flex-shrink: 0;
}
.dot.online      { background: #22c55e; box-shadow: 0 0 5px #22c55e; }
.dot.connecting  { background: #38bdf8; box-shadow: 0 0 5px #38bdf8; }
.dot.reconnecting{ background: #f59e0b; box-shadow: 0 0 5px #f59e0b; }
.dot.offline     { background: #ef4444; }
.dot.stopped     { background: #334155; }

.console {
  flex: 1;
  background: rgba(255,255,255,.03);
  border: 1px solid rgba(255,255,255,.07);
  border-radius: 14px;
  padding: 12px 14px;
  overflow-y: auto;
  font-size: 13px;
  line-height: 1.6;
  transition: opacity .15s;
}
.console::-webkit-scrollbar { width: 5px; }
.console::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 3px; }

.line {
  display: grid;
  grid-template-columns: 72px 80px 1fr;
  gap: 10px;
  padding: 1px 0;
}
.t  { color: #334155; font-size: 12px; }
.lbl{ font-weight: 700; }

.lbl-system { color: #475569; }
.lbl-server { color: #475569; }
.lbl-chat   { color: #38bdf8; }
.lbl-join   { color: #22c55e; }
.lbl-leave  { color: #f87171; }
.lbl-error  { color: #f87171; }

.msg-system { color: #64748b; }
.msg-server { color: #94a3b8; }
.msg-chat   { color: #e2e8f0; }
.msg-join   { color: #22c55e; }
.msg-leave  { color: #f87171; }
.msg-error  { color: #fca5a5; font-weight: 600; }

.bar {
  display: flex;
  gap: 8px;
}
.bar input {
  flex: 1;
  padding: 11px 14px;
  background: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 10px;
  color: #e2e8f0;
  font-family: inherit;
  font-size: 13px;
  outline: none;
  transition: border-color .2s;
}
.bar input:focus { border-color: #3b82f6; }
.bar button {
  padding: 11px 24px;
  background: #2563eb;
  border: none;
  border-radius: 10px;
  color: #fff;
  font-family: inherit;
  font-weight: 700;
  cursor: pointer;
  transition: background .2s;
}
.bar button:hover { background: #3b82f6; }

/* ── RIGHT ── */
.right {
  width: 280px;
  background: #080e1a;
  border-left: 1px solid #0f172a;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.panel {
  background: rgba(255,255,255,.04);
  border: 1px solid rgba(255,255,255,.07);
  border-radius: 14px;
  padding: 16px;
}

.panel h2 {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: .5px;
  margin-bottom: 8px;
}

.badge {
  display: inline-block;
  padding: 3px 12px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .5px;
  margin-bottom: 14px;
}
.badge.online       { background:#14532d; color:#22c55e; }
.badge.connecting   { background:#0c2a3d; color:#38bdf8; }
.badge.reconnecting { background:#451a03; color:#f59e0b; }
.badge.offline      { background:#450a0a; color:#f87171; }
.badge.stopped      { background:#1e293b; color:#475569; }

.btns { display: flex; gap: 8px; }
.btn {
  flex: 1;
  padding: 11px;
  border: none;
  border-radius: 10px;
  color: #fff;
  font-family: inherit;
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
  transition: all .2s;
}
.btn:hover { transform: translateY(-1px); filter: brightness(1.15); }
.btn-green { background: #16a34a; }
.btn-red   { background: #dc2626; }
</style>
</head>
<body>

<div class="left">
  <div class="tabs" id="tabs"></div>
  <div class="console" id="console"></div>
  <div class="bar">
    <input id="cmd" placeholder="Send message or /command" />
    <button onclick="sendMsg()">SEND</button>
  </div>
</div>

<div class="right">
  <div class="panel">
    <h2 id="botName">-</h2>
    <div class="badge stopped" id="badge">Stopped</div>
    <div class="btns">
      <button class="btn btn-green" onclick="startBot()">START</button>
      <button class="btn btn-red"   onclick="stopBotUI()">STOP</button>
    </div>
  </div>
</div>

<script>
const BOT_NAMES = ${JSON.stringify(BOT_LIST.map(b => b.name))};

let current      = BOT_NAMES[0];
let lastCount    = {};   // bot -> log count, used to skip pointless re-renders
let countdownTid = null;

// ── BUILD TABS ──────────────────────────────────────────
for (const name of BOT_NAMES) {
  const btn = document.createElement("button");
  btn.className  = "tab" + (name === current ? " active" : "");
  btn.id         = "tab-" + name;
  btn.innerHTML  = \`<span class="dot" id="dot-\${name}"></span>\${name}\`;
  btn.onclick    = () => switchBot(name);
  document.getElementById("tabs").appendChild(btn);
  lastCount[name] = -1;
}

// ── ESCAPE HTML ──────────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;");
}

// ── RENDER A SINGLE LOG LINE ─────────────────────────────
const LBL = { system:"SYS", server:"SERVER", chat:"CHAT", join:"JOIN", leave:"LEAVE", error:"ERROR" };

function renderLine(e) {
  const lbl = LBL[e.type] || "INFO";
  let   txt = esc(e.text);

  // For chat lines show <Player> as label
  if (e.type === "chat") {
    const m = e.text.match(/^<([^>]+)>\\s?(.+)/);
    if (m) {
      return \`<div class="line">
        <span class="t">\${e.t}</span>
        <span class="lbl lbl-chat">\${esc(m[1])}</span>
        <span class="msg-chat">\${esc(m[2])}</span>
      </div>\`;
    }
  }

  return \`<div class="line">
    <span class="t">\${e.t}</span>
    <span class="lbl lbl-\${e.type}">\${lbl}</span>
    <span class="msg-\${e.type}">\${txt}</span>
  </div>\`;
}

// ── STATUS BADGE + COUNTDOWN ─────────────────────────────
const BADGE_TEXT = {
  online:"Online", connecting:"Connecting…",
  reconnecting:"Reconnecting", offline:"Offline", stopped:"Stopped"
};

function updateBadge(status, reconnAt) {
  const el = document.getElementById("badge");
  el.className = "badge " + status;

  if (countdownTid) { clearInterval(countdownTid); countdownTid = null; }

  if (status === "reconnecting" && reconnAt) {
    const tick = () => {
      const s = Math.max(0, Math.round((reconnAt - Date.now()) / 1000));
      el.textContent = s >= 60
        ? \`In \${Math.floor(s/60)}m \${s%60}s\`
        : \`In \${s}s\`;
      if (s <= 0) { clearInterval(countdownTid); el.textContent = "Reconnecting…"; }
    };
    tick();
    countdownTid = setInterval(tick, 1000);
  } else {
    el.textContent = BADGE_TEXT[status] || status;
  }
}

// ── REFRESH (called every second) ───────────────────────
async function refresh() {
  let data;
  try {
    const r = await fetch("/data");
    data = await r.json();
  } catch { return; }

  // Update dots on all tabs
  for (const name of BOT_NAMES) {
    const dot = document.getElementById("dot-" + name);
    if (dot) dot.className = "dot " + (data[name]?.status || "stopped");
  }

  const info = data[current];
  if (!info) return;

  // Update sidebar badge
  document.getElementById("botName").textContent = current;
  updateBadge(info.status, info.reconnAt);

  // Only re-render console if log count changed
  const con = document.getElementById("console");
  if (lastCount[current] === info.logs.length) return;
  lastCount[current] = info.logs.length;

  const atBottom = con.scrollHeight - con.scrollTop - con.clientHeight < 80;
  con.innerHTML = info.logs.map(renderLine).join("");
  if (atBottom) con.scrollTop = con.scrollHeight;
}

// ── SWITCH BOT TAB ───────────────────────────────────────
function switchBot(name) {
  document.getElementById("tab-" + current)?.classList.remove("active");
  current = name;
  document.getElementById("tab-" + name)?.classList.add("active");
  lastCount[name] = -1;
  const con = document.getElementById("console");
  con.style.opacity = "0";
  setTimeout(() => { refresh(); con.style.opacity = "1"; }, 120);
}

// ── SEND ─────────────────────────────────────────────────
async function sendMsg() {
  const msg = document.getElementById("cmd").value.trim();
  if (!msg) return;
  document.getElementById("cmd").value = "";
  await fetch("/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bot: current, msg })
  });
}

// ── START / STOP ─────────────────────────────────────────
async function startBot() {
  await fetch("/start", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ bot: current })
  });
}
async function stopBotUI() {
  await fetch("/stop", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ bot: current })
  });
}

// ── ENTER KEY ────────────────────────────────────────────
document.getElementById("cmd").addEventListener("keypress", e => {
  if (e.key === "Enter") sendMsg();
});

// ── POLL ─────────────────────────────────────────────────
setInterval(refresh, 1000);
refresh();
</script>
</body>
</html>`);
});

// ─────────────────────────────────────────
//  AUTO START (staggered — 15 s apart)
// ─────────────────────────────────────────

BOT_LIST.forEach((cfg, i) => {
  const delay = i * 15000;
  if (delay === 0) {
    createBot(cfg.name);
  } else {
    addLog(cfg.name, "system", `Startup in ${i * 15}s...`);
    setTimeout(() => createBot(cfg.name), delay);
  }
});

// ─────────────────────────────────────────
//  SERVER
// ─────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Dashboard running on port ${PORT}`);
});
