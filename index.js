const express = require("express");
const mineflayer = require("mineflayer");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ================= BOT REGISTRY =================
// Instead of 3 separate variables, use a map.
// This makes adding/removing bots much easier and
// removes all the repeated if/else chains.

const BOT_CONFIGS = {
  Deadmau5:   { password: "676769" },
  Prince:     { password: "676769" },
  Wemmbu_Alt: { password: "676769" },
};

// bots["Deadmau5"] = { instance, status, reconnectTimer, afkInterval, shouldReconnect }
const bots = {};

// ================= LOGS =================
// Store plain objects instead of raw HTML strings.
// HTML is built on the client side — this keeps the
// server lean and lets the frontend re-render without
// a full page reload.

const MAX_LOGS = 400;
const logs = {
  Deadmau5:   [],
  Prince:     [],
  Wemmbu_Alt: [],
};

// ================= TIME =================

function timeNow() {
  return new Date().toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour12: false,
  });
}

// ================= LOG PUSH =================

function pushLog(botName, type, text) {
  // type: "server" | "chat" | "join" | "leave" | "error" | "system"
  if (!text || !text.trim()) return;

  const arr = logs[botName];
  if (!arr) return;

  arr.push({ t: timeNow(), type, text: text.trim() });

  if (arr.length > MAX_LOGS) arr.shift();
}

// ================= MC COLOR STRIP =================
// Strips §-codes completely for log storage.
// The client renders color using CSS classes based on
// the log entry "type", keeping things clean.
// If you want colored text, do the mapping client-side.

function stripMcColors(text) {
  if (!text) return "";
  // Strip ANSI escape codes
  text = text.replace(/\x1B\[[0-9;]*m/g, "");
  // Strip Minecraft §-color codes
  text = text.replace(/§[0-9a-fk-or]/gi, "");
  return text;
}

// ================= PARSE CHAT LINE =================

function parseChatLine(botName, rawMsg) {
  if (!rawMsg) return;

  const msg = stripMcColors(rawMsg).trim();
  if (!msg) return;

  // Detect <Player> message format
  const chatMatch = msg.match(/^<([^>]+)>\s(.+)/);
  if (chatMatch) {
    pushLog(botName, "chat", `<${chatMatch[1]}> ${chatMatch[2]}`);
    return;
  }

  // Detect error lines
  if (msg.startsWith("ERROR:")) {
    pushLog(botName, "error", msg);
    return;
  }

  pushLog(botName, "server", msg);
}

// ================= ANTI AFK =================
// FIX: Return the interval ID so it can be cleared
// on disconnect, preventing a memory leak where the
// old interval keeps firing after the bot is gone.

function startAntiAfk(bot) {
  return setInterval(() => {
    try {
      if (!bot || !bot.entity) return;

      const yaw = Math.random() * Math.PI * 2;
      const pitch = (Math.random() - 0.5) * 0.5;
      bot.look(yaw, pitch, true);

      bot.setControlState("jump", true);
      setTimeout(() => {
        try { bot.setControlState("jump", false); } catch {}
      }, 300);
    } catch {}
  }, 30000);
}

// ================= BOT STATUS HELPERS =================

function setStatus(botName, status) {
  // status: "online" | "offline" | "reconnecting" | "connecting" | "stopped"
  if (!bots[botName]) bots[botName] = {};
  bots[botName].status = status;
}

function getStatus(botName) {
  return bots[botName]?.status ?? "stopped";
}

// ================= CREATE BOT =================
// FIX: Accept a "state" object so the reconnect loop
// can check shouldReconnect before spawning a new bot.
// This means clicking STOP truly stops reconnecting.

function createBot(name) {
  const config = BOT_CONFIGS[name];
  if (!config) return null;

  // Clean up any lingering timer
  if (bots[name]?.reconnectTimer) {
    clearTimeout(bots[name].reconnectTimer);
  }

  // Initialise state if needed
  if (!bots[name]) bots[name] = {};
  bots[name].shouldReconnect = true;
  bots[name].reconnectDelay = 60000; // starts at 60s, backs off

  setStatus(name, "connecting");
  pushLog(name, "system", "Connecting...");

  const instance = mineflayer.createBot({
    host: "karmasmp.ddns.net",
    port: 25565,
    username: name,
    // Prevent mineflayer from throwing unhandled rejections
    // on connection failure by disabling its internal retry:
    hideErrors: false,
  });

  bots[name].instance = instance;

  // ---- SPAWN ----
  instance.once("spawn", () => {
    setStatus(name, "online");
    bots[name].reconnectDelay = 60000; // reset backoff on success
    pushLog(name, "system", "Connected");

    setTimeout(() => {
      try {
        instance.chat("/login " + config.password);
        pushLog(name, "system", "Executed /login");
      } catch {}
    }, 3000);

    // Start anti-AFK and store the interval ID
    bots[name].afkInterval = startAntiAfk(instance);
  });

  // ---- CHAT ----
  instance.on("messagestr", (msg) => {
    parseChatLine(name, msg);
  });

  // ---- PLAYER JOIN/LEAVE ----
  instance.on("playerJoined", (player) => {
    pushLog(name, "join", `${player.username} joined the game`);
  });

  instance.on("playerLeft", (player) => {
    pushLog(name, "leave", `${player.username} left the game`);
  });

  // ---- DISCONNECT ----
  instance.on("end", (reason) => {
    setStatus(name, "offline");
    pushLog(name, "system", `Disconnected${reason ? ": " + reason : ""}`);

    // FIX: Clear anti-AFK interval to prevent memory leak
    if (bots[name]?.afkInterval) {
      clearInterval(bots[name].afkInterval);
      bots[name].afkInterval = null;
    }

    // FIX: Only reconnect if the user hasn't clicked STOP
    if (!bots[name]?.shouldReconnect) {
      pushLog(name, "system", "Stopped. Not reconnecting.");
      return;
    }

    const delay = bots[name].reconnectDelay ?? 60000;

    // FIX: Exponential backoff — 60s, 120s, 240s, capped at 300s
    bots[name].reconnectDelay = Math.min(delay * 2, 300000);

    setStatus(name, "reconnecting");
    pushLog(name, "system", `Reconnecting in ${delay / 1000}s...`);

    bots[name].reconnectTimer = setTimeout(() => {
      if (bots[name]?.shouldReconnect) {
        createBot(name);
      }
    }, delay);
  });

  // ---- ERROR ----
  instance.on("error", (err) => {
    // Don't log ECONNRESET separately — it always triggers "end" too,
    // which avoids duplicate error+disconnect messages in the console.
    if (err.code === "ECONNRESET" || err.code === "ECONNREFUSED") return;
    pushLog(name, "error", "ERROR: " + err.message);
  });

  return instance;
}

// ================= STOP BOT =================
// Extracted into a helper so both the /stop route
// and internal cleanup use the same logic.

function stopBot(name) {
  const state = bots[name];
  if (!state) return;

  // Prevent reconnect loop
  state.shouldReconnect = false;

  // Clear pending reconnect timer
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  // Clear anti-AFK interval
  if (state.afkInterval) {
    clearInterval(state.afkInterval);
    state.afkInterval = null;
  }

  // Disconnect the bot if it exists
  if (state.instance) {
    try { state.instance.quit(); } catch {}
    state.instance = null;
  }

  setStatus(name, "stopped");
  pushLog(name, "system", "Bot stopped.");
}

// ================= WEBSITE =================

app.get("/", (req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
<title>Karma Bot Manager</title>
<style>

*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  height: 100vh;
  display: flex;
  font-family: Consolas, monospace;
  color: white;
  background: radial-gradient(circle at top left, #1e293b, #020617);
  overflow: hidden;
}

/* ---- LEFT PANEL ---- */
.left {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 12px;
  min-width: 0;
}

.tabs {
  display: flex;
  gap: 10px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.tab {
  padding: 10px 16px;
  background: #161b22;
  border: none;
  border-radius: 12px;
  color: white;
  cursor: pointer;
  transition: .25s;
  display: flex;
  align-items: center;
  gap: 7px;
  font-family: Consolas, monospace;
  font-size: 14px;
}
.tab:hover { transform: translateY(-2px); }
.tab.active {
  background: linear-gradient(135deg, #3b82f6, #8b5cf6);
  box-shadow: 0 0 18px #3b82f6;
}

/* Status dot on tab */
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #555;
  flex-shrink: 0;
}
.dot.online    { background: #22c55e; box-shadow: 0 0 6px #22c55e; }
.dot.offline   { background: #ef4444; }
.dot.reconnecting { background: #f59e0b; box-shadow: 0 0 6px #f59e0b; }
.dot.connecting   { background: #38bdf8; box-shadow: 0 0 6px #38bdf8; }
.dot.stopped   { background: #555; }

/* ---- CONSOLE ---- */
.console {
  flex: 1;
  background: rgba(255,255,255,.04);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 18px;
  padding: 12px;
  overflow-y: auto;
  overflow-x: hidden;
  font-size: 13px;
  box-shadow: 0 0 35px rgba(59,130,246,.15);
  transition: opacity .2s ease;
  /* FIX: use content-visibility for better scroll performance */
  contain: layout style;
}

.line {
  display: grid;
  grid-template-columns: 80px 110px 1fr;
  gap: 8px;
  margin-bottom: 3px;
  line-height: 1.5;
}

.time   { color: #4b5563; }
.sender { font-weight: bold; }

/* Log type colours */
.type-system { color: #94a3b8; }
.type-chat   { color: #e2e8f0; }
.type-join   { color: #22c55e; }
.type-leave  { color: #f87171; }
.type-error  { color: #f87171; font-weight: bold; }
.type-server { color: #94a3b8; }

.sender-system { color: #4b5563; }
.sender-chat   { color: #38bdf8; }
.sender-join   { color: #22c55e; }
.sender-leave  { color: #f87171; }
.sender-error  { color: #f87171; }
.sender-server { color: #4b5563; }

/* ---- INPUT BAR ---- */
.inputBar {
  display: flex;
  gap: 10px;
  margin-top: 10px;
}

.input {
  flex: 1;
  padding: 12px;
  background: #111;
  border: 1px solid #333;
  border-radius: 10px;
  color: white;
  font-family: Consolas, monospace;
}
.input:focus { outline: none; border-color: #3b82f6; }

.send {
  width: 100px;
  border: none;
  background: #2563eb;
  color: white;
  border-radius: 10px;
  cursor: pointer;
  font-family: Consolas, monospace;
  font-weight: bold;
  transition: .2s;
}
.send:hover { background: #3b82f6; transform: translateY(-1px); }

/* ---- RIGHT PANEL ---- */
.right {
  width: 320px;
  background: #0d1117;
  padding: 12px;
  overflow: auto;
  border-left: 1px solid #1e293b;
}

.panel {
  background: rgba(255,255,255,.05);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 18px;
  padding: 16px;
  margin-bottom: 12px;
  box-shadow: 0 0 30px rgba(59,130,246,.12);
}

.panel h2 {
  margin: 0 0 4px 0;
  font-size: 24px;
  letter-spacing: 1px;
}

.statusLabel {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 999px;
  display: inline-block;
  margin-bottom: 12px;
  font-weight: bold;
  text-transform: uppercase;
}
.statusLabel.online      { background: #14532d; color: #22c55e; }
.statusLabel.offline     { background: #450a0a; color: #f87171; }
.statusLabel.reconnecting{ background: #451a03; color: #f59e0b; }
.statusLabel.connecting  { background: #0c2a3d; color: #38bdf8; }
.statusLabel.stopped     { background: #1e293b; color: #64748b; }

.btns {
  display: flex;
  gap: 10px;
}

.small {
  flex: 1;
  padding: 12px;
  border: none;
  border-radius: 12px;
  cursor: pointer;
  color: white;
  font-weight: bold;
  font-family: Consolas, monospace;
  transition: .2s;
}
.small:hover { transform: translateY(-2px); }
.green { background: #16a34a; }
.green:hover { background: #22c55e; }
.red   { background: #dc2626; }
.red:hover { background: #ef4444; }

/* Scrollbar styling */
.console::-webkit-scrollbar { width: 6px; }
.console::-webkit-scrollbar-track { background: transparent; }
.console::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 3px; }

</style>
</head>
<body>

<div class="left">

  <div class="tabs">
    <button id="DeadmauTab"   class="tab active" onclick="switchBot('Deadmau5')">
      <span class="dot" id="dot-Deadmau5"></span>Deadmau5
    </button>
    <button id="PrinceTab"    class="tab"        onclick="switchBot('Prince')">
      <span class="dot" id="dot-Prince"></span>Prince
    </button>
    <button id="Wemmbu_AltTab" class="tab"       onclick="switchBot('Wemmbu_Alt')">
      <span class="dot" id="dot-Wemmbu_Alt"></span>Wemmbu_Alt
    </button>
  </div>

  <div class="console" id="console"></div>

  <div class="inputBar">
    <input id="cmd" class="input" placeholder="Send message or /command">
    <button class="send" onclick="sendMsg()">SEND</button>
  </div>

</div>

<div class="right">
  <div class="panel">
    <h2 id="activeName">Deadmau5</h2>
    <span class="statusLabel stopped" id="statusLabel">Stopped</span>
    <div class="btns">
      <button class="small green" onclick="startBot()">START</button>
      <button class="small red"   onclick="stopBot()">STOP</button>
    </div>
  </div>
</div>

<script>

let currentBot = "Deadmau5";
// FIX: Track last log count to skip full re-render when nothing changed
let lastLogCount = {};

// ---- SENDER LABEL BY TYPE ----
const senderLabel = {
  system:      "SYSTEM",
  server:      "SERVER",
  chat:        null,   // extracted from message
  join:        "JOIN",
  leave:       "LEAVE",
  error:       "ERROR",
};

// ---- RENDER A LOG ENTRY TO HTML ----
function renderLine(entry) {
  let sender = senderLabel[entry.type] ?? "SERVER";
  let text    = entry.text;

  // For chat lines, extract <PlayerName> as the sender
  if (entry.type === "chat") {
    const m = text.match(/^<([^>]+)>\\s?(.+)/);
    if (m) { sender = m[1]; text = m[2]; }
  }

  return \`<div class="line">
    <span class="time">\${entry.t}</span>
    <span class="sender sender-\${entry.type}">\${escHtml(sender)}</span>
    <span class="msg type-\${entry.type}">\${escHtml(text)}</span>
  </div>\`;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;");
}

// ---- STATUS BADGE ----
function applyStatus(status) {
  const label = document.getElementById("statusLabel");
  const txt   = { online:"Online", offline:"Disconnected", reconnecting:"Reconnecting…", connecting:"Connecting…", stopped:"Stopped" };
  label.className = "statusLabel " + status;
  label.textContent = txt[status] ?? status;
}

// ---- REFRESH ----
async function refresh() {
  try {
    const res  = await fetch("/data");
    const data = await res.json();

    // Update all status dots
    for (const [name, info] of Object.entries(data)) {
      const dot = document.getElementById("dot-" + name);
      if (dot) {
        dot.className = "dot " + info.status;
      }
    }

    const info = data[currentBot];
    if (!info) return;

    applyStatus(info.status);

    const consoleDiv = document.getElementById("console");

    // FIX: Only re-render if log count changed
    if ((lastLogCount[currentBot] ?? -1) === info.logs.length) return;
    lastLogCount[currentBot] = info.logs.length;

    const nearBottom =
      consoleDiv.scrollHeight - consoleDiv.scrollTop - consoleDiv.clientHeight < 80;

    consoleDiv.innerHTML = info.logs.map(renderLine).join("");

    if (nearBottom) {
      consoleDiv.scrollTop = consoleDiv.scrollHeight;
    }
  } catch {}
}

// ---- SWITCH BOT ----
function switchBot(name) {
  currentBot = name;
  document.getElementById("activeName").textContent = name;
  document.querySelectorAll(".tab").forEach(e => e.classList.remove("active"));

  // Map name to tab ID
  const tabMap = { Deadmau5: "DeadmauTab", Prince: "PrinceTab", Wemmbu_Alt: "Wemmbu_AltTab" };
  document.getElementById(tabMap[name])?.classList.add("active");

  const consoleDiv = document.getElementById("console");
  consoleDiv.style.opacity = 0;
  lastLogCount[name] = -1; // force re-render
  setTimeout(() => {
    refresh();
    consoleDiv.style.opacity = 1;
  }, 150);
}

// ---- SEND ----
async function sendMsg() {
  const msg = document.getElementById("cmd").value.trim();
  if (!msg) return;

  await fetch("/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bot: currentBot, msg }),
  });

  document.getElementById("cmd").value = "";
}

// ---- START / STOP ----
async function startBot() {
  await fetch("/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bot: currentBot }),
  });
}

async function stopBot() {
  await fetch("/stop", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bot: currentBot }),
  });
}

// ---- ENTER KEY ----
document.getElementById("cmd").addEventListener("keypress", e => {
  if (e.key === "Enter") sendMsg();
});

// ---- POLL ----
setInterval(refresh, 1000);
refresh();

</script>
</body>
</html>`);
});

// ================= DATA =================
// FIX: Return structured log objects + status for all bots.
// The frontend builds the HTML — the server just sends data.

app.get("/data", (req, res) => {
  const out = {};
  for (const name of Object.keys(BOT_CONFIGS)) {
    out[name] = {
      status: getStatus(name),
      logs:   logs[name] ?? [],
    };
  }
  res.json(out);
});

// ================= SEND =================

app.post("/send", (req, res) => {
  const { bot: name, msg } = req.body;
  if (!name || !msg) return res.sendStatus(400);

  const instance = bots[name]?.instance;
  if (!instance || getStatus(name) !== "online") return res.sendStatus(404);

  try {
    instance.chat(msg.toString());
    pushLog(name, "chat", `<YOU> ${msg}`);
    res.sendStatus(200);
  } catch {
    res.sendStatus(500);
  }
});

// ================= START =================

app.post("/start", (req, res) => {
  const name = req.body.bot;
  if (!BOT_CONFIGS[name]) return res.sendStatus(400);

  const status = getStatus(name);

  // Don't double-start
  if (status === "online" || status === "connecting") {
    return res.sendStatus(200);
  }

  createBot(name);
  res.sendStatus(200);
});

// ================= STOP =================

app.post("/stop", (req, res) => {
  const name = req.body.bot;
  if (!BOT_CONFIGS[name]) return res.sendStatus(400);
  stopBot(name);
  res.sendStatus(200);
});

// ================= AUTO START =================

for (const name of Object.keys(BOT_CONFIGS)) {
  createBot(name);
}

// ================= SERVER =================

app.listen(3000, "0.0.0.0", () => {
  console.log("Dashboard running on port 3000");
});
