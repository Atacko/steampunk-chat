import express from "express"
import { WebSocketServer } from "ws"
import SteamUser from "steam-user"
import fs from "fs"
import readline from "readline"

const app = express()
const PORT = 3000

const client = new SteamUser()
let wsClients = []
const friends = {}
const friendRequests = []

const CREDENTIALS_FILE = "./steam-credentials.json"

function askQuestion(query, hideInput = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    })

    rl.question(query, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

async function getCredentials() {
  if (fs.existsSync(CREDENTIALS_FILE)) {
    console.log(`🔑 Loading credentials from ${CREDENTIALS_FILE}`)
    const creds = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, "utf-8"))
    return creds
  } else {
    console.log("No saved credentials found, let's set them up!")
    const accountName = await askQuestion("Steam Username: ")
    const password = await askQuestion("Steam Password: ", true)

    const creds = { accountName, password }
    fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2))
    console.log(`✅ Credentials saved to ${CREDENTIALS_FILE}`)
    return creds
  }
}

;(async () => {
  const creds = await getCredentials()

  client.logOn(creds)

  client.on("loggedOn", () => {
    console.log("✅ Logged into Steam as " + client.steamID.getSteam3RenderedID())
    client.setPersona(SteamUser.EPersonaState.Online)
    client.gamesPlayed([])

    console.log("Steam client ready to receive messages")
    console.log("Persona set to Online, ready for chat")
    console.log("My Steam ID:", client.steamID.getSteamID64())

    const ids = Object.keys(client.myFriends)
    console.log(`📋 Found ${ids.length} total friends, requesting personas...`)
    if (ids.length > 0) {
      client.getPersonas(ids)
    }

    setInterval(() => {
      console.log("Connection check - Steam client connected:", client.steamID ? "YES" : "NO")
      console.log("Current persona state:", client.personaState)
      console.log("Total friends:", Object.keys(client.myFriends).length)
    }, 30000)
  })

  client.on("error", (err) => {
    console.error("❌ Steam client error:", err)
    console.error("Error details:", err.message, err.stack)
  })

  client.on("disconnected", (eresult, msg) => {
    console.log("🔌 Disconnected from Steam:", msg)
    console.log("Disconnect reason:", eresult, msg)
  })

  client.on("friendsList", () => {
    console.log("📥 Received friendsList event from Steam")
    console.log("Friends list updated, total friends:", Object.keys(client.myFriends).length)
    updateFriends()
  })

  client.on("user", (sid, user) => {
    const id = sid.getSteamID64()
    console.log("User event received for:", id, user.player_name)
    if (client.myFriends[id] === SteamUser.EFriendRelationship.Friend) {
      console.log(`👤 Persona update: ${user.player_name} (${id})`)
      friends[id] = friends[id] || { name: user.player_name || id, messages: [] }
      friends[id].name = user.player_name || id
      broadcastFriends()
    }
  })

  client.on("friendRelationship", (sid, relationship) => {
    const id = sid.getSteamID64()
    console.log("Friend relationship event:", id, relationship)

    if (relationship === SteamUser.EFriendRelationship.RequestRecipient) {
      console.log(`📨 Incoming friend request from ${id}`)

      client.getPersonas([id], (personas) => {
        const name = (personas && personas[id]?.player_name) || id

        if (!friendRequests.find((req) => req.steamId === id)) {
          friendRequests.push({ steamId: id, name: name })
          console.log(`✅ Added friend request from ${name} (${id})`)

          broadcast({ type: "friendRequests", requests: friendRequests })
        }
      })
    }

    if (relationship === SteamUser.EFriendRelationship.Friend) {
      console.log(`✅ Friend relationship established with ${id}`)

      const requestIndex = friendRequests.findIndex((req) => req.steamId === id)
      if (requestIndex !== -1) {
        friendRequests.splice(requestIndex, 1)
        broadcast({ type: "friendRequests", requests: friendRequests })
      }

      updateFriends()
    }

    if (relationship === SteamUser.EFriendRelationship.None) {
      console.log(`❌ Friend relationship ended with ${id}`)

      const requestIndex = friendRequests.findIndex((req) => req.steamId === id)
      if (requestIndex !== -1) {
        friendRequests.splice(requestIndex, 1)
        broadcast({ type: "friendRequests", requests: friendRequests })
      }

      delete friends[id]
      broadcastFriends()
    }
  })

  client.on("accountLimitations", (limited, communityBanned, locked, canInviteFriends) => {
    console.log("Account limitations:", { limited, communityBanned, locked, canInviteFriends })
  })

  client.on("webSession", (sessionID, cookies) => {
    console.log("Web session established")
  })

  client.on("friendMessage", (steamID, message) => {
    console.log("==================== FRIEND MESSAGE EVENT ====================")
    console.log("Event timestamp:", new Date().toISOString())
    console.log("Raw steamID object:", steamID)
    console.log("steamID type:", typeof steamID)
    console.log("steamID constructor:", steamID.constructor.name)

    const id = steamID.getSteamID64()
    console.log("Extracted SteamID64:", id)
    console.log("Message content:", JSON.stringify(message))
    console.log("Message type:", typeof message)
    console.log("Message length:", message ? message.length : "null/undefined")

    console.log("Friend exists in friends object:", !!friends[id])
    console.log("Friend exists in myFriends:", !!client.myFriends[id])
    console.log("Friend relationship:", client.myFriends[id])

    console.log(`💬 Incoming message from ${friends[id]?.name || id} (${id}): ${message}`)

    if (!friends[id]) {
      console.log(`⚠️ Received message from unknown friend ${id}, adding to friends list`)
      friends[id] = { name: id, messages: [] }
      client.getPersonas([id])
    }

    const messageObj = { from: "them", text: message, timestamp: Date.now() }
    friends[id].messages.push(messageObj)

    console.log(`Message added to friends[${id}].messages, total messages: ${friends[id].messages.length}`)
    console.log(`📡 Broadcasting message to ${wsClients.length} WebSocket clients`)
    console.log("============================================================")

    broadcast({
      type: "message",
      friendId: id,
      message: messageObj,
    })

    broadcastFriends()
  })

  client.on("friendOrChatMessage", (steamID, message, room) => {
    console.log("==================== FRIEND OR CHAT MESSAGE EVENT ====================")
    console.log("Event timestamp:", new Date().toISOString())
    console.log("Raw steamID object:", steamID)
    console.log("Message content:", JSON.stringify(message))
    console.log("Room/context:", room)

    const id = steamID.getSteamID64()
    console.log("Extracted SteamID64:", id)

    if (id === client.steamID.getSteamID64()) {
      console.log("Skipping own message echo")
      return
    }

    console.log(`💬 Incoming message via friendOrChatMessage from ${friends[id]?.name || id} (${id}): ${message}`)

    if (!friends[id]) {
      console.log(`⚠️ Received message from unknown friend ${id}, adding to friends list`)
      friends[id] = { name: id, messages: [] }
      client.getPersonas([id])
    }

    const messageObj = { from: "them", text: message, timestamp: Date.now() }
    friends[id].messages.push(messageObj)

    console.log(`Message added to friends[${id}].messages, total messages: ${friends[id].messages.length}`)
    console.log(`📡 Broadcasting message to ${wsClients.length} WebSocket clients`)
    console.log("============================================================")

    broadcast({
      type: "message",
      friendId: id,
      message: messageObj,
    })

    broadcastFriends()
  })

  client.on("chatInvite", (chatID, chatName, patronID) => {
    console.log(`Chat invite received from ${patronID} to ${chatName}`)
  })

  client.on("chatMessage", (chatID, chatterID, message) => {
    console.log(`Group chat message received: ${message}`)
  })

  client.on("newItems", (count) => {
    console.log(`New items event: ${count}`)
  })

  client.on("emailInfo", (address, validated) => {
    console.log(`Email info: ${address}, validated: ${validated}`)
  })

  const originalEmit = client.emit
  client.emit = function (event, ...args) {
    if (event !== "debug") {
      console.log(`Steam event emitted: ${event}`, args.length > 0 ? `(${args.length} args)` : "")
    }
    return originalEmit.apply(this, [event, ...args])
  }

  app.use(express.static("../frontend"))

  const server = app.listen(PORT, () => {
    console.log(`🌐 Backend running on http://localhost:${PORT}`)
    console.log(`🔗 Frontend available at http://localhost:${PORT}`)
  })

  const wss = new WebSocketServer({ server })

  wss.on("connection", (ws) => {
    console.log("🔌 WebSocket client connected")
    wsClients.push(ws)

    ws.send(JSON.stringify({ type: "friends", friends }))
    ws.send(JSON.stringify({ type: "friendRequests", requests: friendRequests }))

    ws.on("close", () => {
      console.log("❌ WebSocket client disconnected")
      wsClients = wsClients.filter((c) => c !== ws)
    })

    ws.on("message", (msg) => {
      try {
        const data = JSON.parse(msg)

        if (data.type === "send") {
          console.log(`➡️ Sending message to ${friends[data.to]?.name || data.to} (${data.to}): ${data.text}`)

          try {
            client.chatMessage(data.to, data.text)

            if (!friends[data.to]) {
              friends[data.to] = { name: data.to, messages: [] }
            }

            const myMsg = { from: "me", text: data.text, timestamp: Date.now() }
            friends[data.to].messages.push(myMsg)

            broadcast({
              type: "message",
              friendId: data.to,
              message: myMsg,
            })

            console.log("✅ Message sent successfully")
          } catch (sendError) {
            console.error("❌ Failed to send message:", sendError)
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Failed to send message: " + sendError.message,
              }),
            )
          }
        }

        if (data.type === "friendRequest") {
          const { steamId, action } = data
          console.log(`${action === "accept" ? "✅" : "❌"} ${action}ing friend request from ${steamId}`)

          try {
            if (action === "accept") {
              client.addFriend(steamId)
              console.log(`✅ Accepted friend request from ${steamId}`)
            } else if (action === "decline") {
              client.removeFriend(steamId)
              console.log(`❌ Declined friend request from ${steamId}`)
            }

            const requestIndex = friendRequests.findIndex((req) => req.steamId === steamId)
            if (requestIndex !== -1) {
              friendRequests.splice(requestIndex, 1)
              broadcast({ type: "friendRequests", requests: friendRequests })
            }
          } catch (error) {
            console.error(`❌ Failed to ${action} friend request:`, error)
            ws.send(
              JSON.stringify({
                type: "error",
                message: `Failed to ${action} friend request: ${error.message}`,
              }),
            )
          }
        }
      } catch (err) {
        console.error("⚠️ Bad WS message:", err)
      }
    })
  })
})()

function broadcast(data) {
  console.log(`📡 Broadcasting to ${wsClients.length} clients:`, data.type)
  wsClients.forEach((ws) => {
    try {
      ws.send(JSON.stringify(data))
    } catch (err) {
      console.error("❌ Failed to send to WebSocket client:", err)
    }
  })
}

function broadcastFriends() {
  console.log(`📡 Broadcasting friend list (${Object.keys(friends).length} friends)`)
  broadcast({ type: "friends", friends })
}

function updateFriends() {
  console.log("🔄 Updating friends cache from myFriends...")
  for (const id in client.myFriends) {
    if (client.myFriends[id] === SteamUser.EFriendRelationship.Friend) {
      const friendName = client.users[id]?.player_name || id
      friends[id] = friends[id] || { name: friendName, messages: [] }
      friends[id].name = friendName
      console.log(`   ✔️ Friend loaded: ${friends[id].name} (${id})`)
    }
  }
  broadcastFriends()
}
