import express from "express";
import { WebSocketServer } from "ws";
import SteamUser from "steam-user";
import fs from "fs";
import readline from "readline";

const app = express();
const PORT = 3000;

const client = new SteamUser();
let wsClients = [];
let friends = {};

const CREDENTIALS_FILE = "./steam-credentials.json";

function askQuestion(query, hideInput = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function getCredentials() {
  if (fs.existsSync(CREDENTIALS_FILE)) {
    console.log(`🔑 Loading credentials from ${CREDENTIALS_FILE}`);
    const creds = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, "utf-8"));
    return creds;
  } else {
    console.log("No saved credentials found, let's set them up!");
    const accountName = await askQuestion("Steam Username: ");
    const password = await askQuestion("Steam Password: ", true);

    const creds = { accountName, password };
    fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2));
    console.log(`✅ Credentials saved to ${CREDENTIALS_FILE}`);
    return creds;
  }
}

(async () => {
  const creds = await getCredentials();

  client.logOn(creds);

  client.on("loggedOn", () => {
    console.log("✅ Logged into Steam as " + client.steamID.getSteam3RenderedID());
    client.setPersona(SteamUser.EPersonaState.Online);

    const ids = Object.keys(client.myFriends);
    console.log(`📋 Found ${ids.length} total friends, requesting personas...`);
    if (ids.length > 0) {
      client.getPersonas(ids);
    }
  });

  client.on("friendsList", () => {
    console.log("📥 Received friendsList event from Steam");
    updateFriends();
  });

  client.on("user", (sid, user) => {
    const id = sid.getSteamID64();
    if (client.myFriends[id] === SteamUser.EFriendRelationship.Friend) {
      console.log(`👤 Persona update: ${user.player_name} (${id})`);
      friends[id] = friends[id] || { name: user.player_name || id, messages: [] };
      friends[id].name = user.player_name || id;
      broadcastFriends();
    }
  });

  client.on("friendMessage", (steamID, message) => {
    const id = steamID.getSteamID64();
    console.log(`💬 Message from ${id}: ${message}`);

    if (!friends[id]) {
      friends[id] = { name: id, messages: [] };
    }
    friends[id].messages.push({ from: id, text: message });

    broadcast({
      type: "message",
      friendId: id,
      message: { from: id, text: message }
    });
  });

  app.use(express.static("../frontend"));

  const server = app.listen(PORT, () => {
    console.log(`🌐 Backend running on http://localhost:${PORT}`);
  });

  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    console.log("🔌 WebSocket client connected");
    wsClients.push(ws);

    ws.send(JSON.stringify({ type: "friends", friends }));

    ws.on("close", () => {
      console.log("❌ WebSocket client disconnected");
      wsClients = wsClients.filter(c => c !== ws);
    });

    ws.on("message", (msg) => {
      try {
        const data = JSON.parse(msg);

        if (data.type === "send") {
          console.log(`➡️ Sending message to ${data.to}: ${data.text}`);
          client.chatMessage(data.to, data.text);

          if (!friends[data.to]) {
            friends[data.to] = { name: data.to, messages: [] };
          }
          const myMsg = { from: "me", text: data.text };
          friends[data.to].messages.push(myMsg);

          broadcast({
            type: "message",
            friendId: data.to,
            message: myMsg
          });
        }
      } catch (err) {
        console.error("⚠️ Bad WS message:", err);
      }
    });
  });
})();

function broadcast(data) {
  wsClients.forEach(ws => ws.send(JSON.stringify(data)));
}

function broadcastFriends() {
  console.log(`📡 Broadcasting friend list (${Object.keys(friends).length} friends)`);
  broadcast({ type: "friends", friends });
}

function updateFriends() {
  console.log("🔄 Updating friends cache from myFriends...");
  for (let id in client.myFriends) {
    if (client.myFriends[id] === SteamUser.EFriendRelationship.Friend) {
      const friendName = client.users[id]?.player_name || id;
      friends[id] = friends[id] || { name: friendName, messages: [] };
      friends[id].name = friendName;
      console.log(`   ✔️ Friend loaded: ${friends[id].name} (${id})`);
    }
  }
  broadcastFriends();
}
