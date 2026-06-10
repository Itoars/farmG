const express = require("express");
const mineflayer = require("mineflayer");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ================= BOTS =================

let deadBot = null;
let princeBot = null;
let wemmbuBot = null;

// ================= LOGS =================

let deadLogs = [];
let princeLogs = [];
let wemmbuLogs = [];

// ================= TIME =================

function timeNow() {

  return new Date().toLocaleTimeString(
    "en-IN",
    {
      timeZone: "Asia/Kolkata",
      hour12: false
    }
  );

}

// ================= LOG PUSH =================

function pushLog(arr, html) {

  arr.push(html);

  if(arr.length > 400){

    arr.shift();

  }

}

// ================= MC COLORS =================

function mcColor(text) {

  if(!text) return "";

  text = text.replace(/\x1B\[[0-9;]*m/g, "");

  const colors = {

    "0":"#000000",
    "1":"#0000AA",
    "2":"#00AA00",
    "3":"#00AAAA",
    "4":"#AA0000",
    "5":"#AA00AA",
    "6":"#FFAA00",
    "7":"#AAAAAA",
    "8":"#555555",
    "9":"#5555FF",
    "a":"#55FF55",
    "b":"#55FFFF",
    "c":"#FF5555",
    "d":"#FF55FF",
    "e":"#FFFF55",
    "f":"#FFFFFF"

  };

  text = text.replace(
    /§([0-9a-f])/gi,
    (_, code) => {

      return `
      <span style="color:${
        colors[
          code.toLowerCase()
        ] || "#fff"
      }">
      `;

    }
  );

  return text + "</span>";

}

// ================= ADD LOG =================

function addLog(botName, msg) {

  if(!msg) return;

  msg = msg.trim();

  if(!msg.length) return;

  let sender = "SERVER";

  let finalMsg = msg;

  const normal =
  msg.match(/^<([^>]+)>\s(.+)/);

  if(normal){

    sender = normal[1];

    finalMsg = normal[2];

  }

  finalMsg = mcColor(finalMsg);

  const html = `

  <div class="line">

    <span class="time">
      [${timeNow()}]
    </span>

    <span class="sender">
      [${sender}]
    </span>

    <span class="msg">
      ${finalMsg}
    </span>

  </div>

  `;

  if(botName === "Deadmau5"){
    pushLog(deadLogs, html);
  }

  if(botName === "Prince"){
    pushLog(princeLogs, html);
  }

  if(botName === "Wemmbu_Alt"){
    pushLog(wemmbuLogs, html);
  }

}

// ================= ANTI AFK =================

function antiAfk(bot){

  setInterval(() => {

    try{

      if(!bot.entity) return;

      const yaw =
      Math.random() * Math.PI * 2;

      const pitch =
      (Math.random() - 0.5) * 0.5;

      bot.look(yaw, pitch, true);

      bot.setControlState("jump", true);

      setTimeout(() => {

        bot.setControlState(
          "jump",
          false
        );

      }, 300);

    }catch{}

  }, 30000);

}

// ================= CREATE BOT =================

function createBot(name, password){

  addLog(
    name,
    "§eConnecting..."
  );

  const bot = mineflayer.createBot({

    host:"karmasmp.ddns.net",

    port:25565,

    username:name

  });

  bot.online = false;

  bot.once("spawn", () => {

    bot.online = true;

    addLog(
      name,
      "§aConnected"
    );

    setTimeout(() => {

      bot.chat("/login " + password);

      addLog(
        name,
        "§eExecuted /login"
      );

    }, 3000);

    antiAfk(bot);

  });

  bot.on("messagestr", (msg) => {

    addLog(name, msg);

  });

;

  bot.on("playerJoined", (player) => {

    addLog(
      name,
      "§a" +
      player.username +
      " joined the game"
    );

  });

  bot.on("playerLeft", (player) => {

    addLog(
      name,
      "§c" +
      player.username +
      " left the game"
    );

  });

  bot.on("end", () => {

    bot.online = false;

    addLog(
      name,
      "§cDisconnected"
    );

    setTimeout(() => {

      addLog(
        name,
        "§6Reconnecting..."
      );

      if(
        name === "Deadmau5"
        && deadBot
      ){

        deadBot =
        createBot(
          "Deadmau5",
          "676769"
        );

      }

      if(
        name === "Prince"
        && princeBot
      ){

        princeBot =
        createBot(
          "Prince",
          "676769"
        );

      }

      if(
        name === "Wemmbu_Alt"
        && wemmbuBot
      ){

        wemmbuBot =
        createBot(
          "Wemmbu_Alt",
          "676769"
        );

      }

    }, 60000);

  });

  bot.on("error", (err) => {

    addLog(
      name,
      "§4ERROR: " + err.message
    );

  });

  return bot;

}

// ================= WEBSITE =================

app.get("/", (req, res) => {

res.send(`

<!DOCTYPE html>

<html>

<head>

<title>Karma Bot Manager</title>

<style>

body{

margin:0;

height:100vh;

display:flex;

font-family:Consolas;

color:white;

background:
radial-gradient(
circle at top left,
#1e293b,
#020617
);

overflow:hidden;

}

.left{
flex:1;
display:flex;
flex-direction:column;
padding:12px;
}

.tabs{
display:flex;
gap:10px;
margin-bottom:10px;
flex-wrap:wrap;
}

.tab{

padding:10px 16px;

background:#161b22;

border:none;

border-radius:12px;

color:white;

cursor:pointer;

transition:.25s;

}
.tab:hover{

transform:
translateY(-2px);

}

.active{

background:
linear-gradient(
135deg,
#3b82f6,
#8b5cf6
);

box-shadow:
0 0 18px #3b82f6;

}

.console{

flex:1;

background:
rgba(255,255,255,.04);

backdrop-filter:
blur(16px);

border:
1px solid rgba(255,255,255,.08);

border-radius:18px;

padding:12px;

overflow:auto;

font-size:14px;

box-shadow:
0 0 35px
rgba(59,130,246,.15);

transition:
opacity .2s ease;

}

.line{

display:grid;

grid-template-columns:
90px 140px 1fr;

gap:8px;

margin-bottom:4px;

align-items:start;

}

.time{
color:#666;
min-width:90px;
}

.sender{
color:#38bdf8;
min-width:140px;
font-weight:bold;
}

.msg{
flex:1;
}

.inputBar{
display:flex;
gap:10px;
margin-top:10px;
}

.input{
flex:1;
padding:12px;
background:#111;
border:1px solid #333;
border-radius:10px;
color:white;
}

.send{
width:120px;
border:none;
background:#2563eb;
color:white;
border-radius:10px;
cursor:pointer;
}

.right{
width:380px;
background:#111;
padding:12px;
overflow:auto;
border-left:1px solid #222;
}

.panel{

background:
rgba(255,255,255,.05);

backdrop-filter:
blur(16px);

border:
1px solid rgba(255,255,255,.08);

border-radius:18px;

padding:14px;

margin-bottom:12px;

box-shadow:
0 0 30px
rgba(59,130,246,.12);

}

.btns{
display:flex;
gap:10px;
margin-top:10px;
}

.small{

flex:1;

padding:12px;

border:none;

border-radius:12px;

cursor:pointer;

color:white;

font-weight:bold;

transition:.2s;

}
.small:hover{

transform:
translateY(-2px);

}

.green{
background:#16a34a;
}

.red{
background:#dc2626;
}

.player{
background:#0d1117;
padding:6px 10px;
border-radius:999px;
margin:4px;
display:inline-block;
font-size:12px;
}

</style>

</head>

<body>

<div class="left">

<div class="tabs">

<button id="Deadmau5Tab" class="tab active" onclick="switchBot('Deadmau5')">Deadmau5</button>

<button id="PrinceTab" class="tab" onclick="switchBot('Prince')">Prince</button>

<button id="Wemmbu_AltTab" class="tab" onclick="switchBot('Wemmbu_Alt')">Wemmbu_Alt</button>

</div>

<div class="console" id="console"></div>

<div class="inputBar">

<input
id="cmd"
class="input"
placeholder="Send message">

<button
class="send"
onclick="sendMsg()">
SEND
</button>

</div>

</div>

<div class="right">

<div class="panel">

<h2
id="activeName"
style="
margin-top:0;
font-size:28px;
letter-spacing:1px;
">
Deadmau5
</h2>

<div class="btns">

<button
class="small green"
onclick="startBot()">
START
</button>

<button
class="small red"
onclick="stopBot()">
STOP
</button>

</div>

</div>

</div>

<script>

let currentBot = "Deadmau5";

function switchBot(name){

currentBot = name;

document
.getElementById("activeName")
.innerText = name;

document.querySelectorAll(".tab")
.forEach(e=>e.classList.remove("active"));

document
.getElementById(name + "Tab")
.classList.add("active");

const consoleDiv =
document.getElementById("console");

consoleDiv.style.opacity = 0;

setTimeout(()=>{

refresh();

consoleDiv.style.opacity = 1;

},150);

}

async function refresh(){

const res =
await fetch("/data");

const data =
await res.json();

let bot;

if(currentBot === "Deadmau5"){

bot = data.dead;

}else if(currentBot === "Prince"){

bot = data.prince;

}else{

bot = data.wemmbu;

}

document
.getElementById("console")
.innerHTML =
bot.logs.join("");

const consoleDiv =
document.getElementById("console");

const nearBottom =
consoleDiv.scrollHeight -
consoleDiv.scrollTop -
consoleDiv.clientHeight
< 100;

if(nearBottom){

consoleDiv.scrollTop =
consoleDiv.scrollHeight;

}

}

async function sendMsg(){

const msg =
document.getElementById("cmd").value;

if(!msg) return;

await fetch("/send",{

method:"POST",

headers:{
"Content-Type":"application/json"
},

body:JSON.stringify({
bot:currentBot,
msg:msg
})

});

document
.getElementById("cmd")
.value = "";

}

async function startBot(){

await fetch("/start",{

method:"POST",

headers:{
"Content-Type":"application/json"
},

body:JSON.stringify({
bot:currentBot
})

});

}

async function stopBot(){

await fetch("/stop",{

method:"POST",

headers:{
"Content-Type":"application/json"
},

body:JSON.stringify({
bot:currentBot
})

});

}

document
.getElementById("cmd")
.addEventListener(
"keypress",
e=>{

if(e.key === "Enter"){

sendMsg();

}

});

setInterval(refresh, 1000);

refresh();

</script>

</body>

</html>

`);

});

// ================= DATA =================

app.get("/data", (req, res) => {

  res.json({

    dead:{
      logs:deadLogs
    },

    prince:{
      logs:princeLogs
    },

    wemmbu:{
      logs:wemmbuLogs
    }

  });

});

// ================= SEND =================

app.post("/send", (req, res) => {

  const botName = req.body.bot;
  const msg = req.body.msg;

  let bot = null;

  if(botName === "Deadmau5"){
    bot = deadBot;
  }

  if(botName === "Prince"){
    bot = princeBot;
  }

  if(botName === "Wemmbu_Alt"){
    bot = wemmbuBot;
  }

  if(!bot){
    return res.sendStatus(404);
  }

  try{

    bot.chat(msg.toString());

    addLog(
      botName,
      "§b[YOU] " + msg
    );

    res.sendStatus(200);

  }catch{

    res.sendStatus(500);

  }

});

// ================= START =================

app.post("/start", (req, res) => {

  const bot = req.body.bot;

  if(bot === "Deadmau5" && !deadBot){

    deadBot =
    createBot(
      "Deadmau5",
      "676769"
    );

  }

  if(bot === "Prince" && !princeBot){

    princeBot =
    createBot(
      "Prince",
      "676769"
    );

  }

  if(bot === "Wemmbu_Alt" && !wemmbuBot){

    wemmbuBot =
    createBot(
      "Wemmbu_Alt",
      "676769"
    );

  }

  res.sendStatus(200);

});

// ================= STOP =================

app.post("/stop", (req, res) => {

  const bot = req.body.bot;

  if(bot === "Deadmau5" && deadBot){

    deadBot.quit();

    deadBot = null;

  }

  if(bot === "Prince" && princeBot){

    princeBot.quit();

    princeBot = null;

  }

  if(bot === "Wemmbu_Alt" && wemmbuBot){

    wemmbuBot.quit();

    wemmbuBot = null;

  }

  res.sendStatus(200);

});

// ================= AUTO START =================

deadBot =
createBot(
  "Deadmau5",
  "676769"
);

princeBot =
createBot(
  "Prince",
  "676769"
);

wemmbuBot =
createBot(
  "Wemmbu_Alt",
  "676769"
);

// ================= SERVER =================

app.listen(
3000,
"0.0.0.0",
()=>{

console.log(
"Dashboard running"
);

});
