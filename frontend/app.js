const ws = new WebSocket("ws://localhost:3000")

const friendListEl = document.getElementById("friendList")
const messagesEl = document.getElementById("messages")
const chatHeaderEl = document.getElementById("chatHeader")
const messageInput = document.getElementById("messageInput")
const sendBtn = document.getElementById("sendBtn")
const friendRequestBtn = document.getElementById("friendRequestBtn")
const friendRequestModal = document.getElementById("friendRequestModal")
const closeModal = document.querySelector(".close")
const friendRequestList = document.getElementById("friendRequestList")

let friends = {}
let activeFriend = null
let friendRequests = []

friendListEl.innerHTML = `<li>Loading friends...</li>`

ws.onopen = () => {
  console.log("✅ Connected to backend")
}

ws.onmessage = (event) => {
  const data = JSON.parse(event.data)

  if (data.type === "friends") {
    console.log("📥 Received friend list from backend:", data.friends)
    friends = data.friends
    renderFriendList()
  }

  if (data.type === "friendRequests") {
    console.log("📥 Received friend requests:", data.requests)
    friendRequests = data.requests
    updateFriendRequestButton()
  }

  if (data.type === "message") {
    const { friendId, message } = data
    console.log(`💬 Message event from backend: ${friendId}`, message)
    if (friends[friendId]) {
      friends[friendId].messages.push(message)
    } else {
      friends[friendId] = { name: friendId, messages: [message] }
    }

    if (activeFriend === friendId) {
      renderMessages(friendId)
    }
    renderFriendList()
  }

  if (data.type === "error") {
    console.error("❌ Server error:", data.message)
    alert("Error: " + data.message)
  }
}

ws.onerror = (error) => {
  console.error("❌ WebSocket error:", error)
  friendListEl.innerHTML = `<li style="color: red;">Connection error</li>`
}

ws.onclose = () => {
  console.log("❌ Disconnected from backend")
  friendListEl.innerHTML = `<li style="color: red;">Disconnected</li>`
}

function renderFriendList() {
  friendListEl.innerHTML = ""
  if (Object.keys(friends).length === 0) {
    friendListEl.innerHTML = `<li>No friends loaded</li>`
    return
  }

  for (const id in friends) {
    const li = document.createElement("li")
    li.textContent = friends[id].name
    if (id === activeFriend) li.classList.add("active")
    li.onclick = () => {
      activeFriend = id
      chatHeaderEl.textContent = friends[id].name
      renderMessages(id)
      renderFriendList()
    }
    friendListEl.appendChild(li)
  }
}

function renderMessages(friendId) {
  messagesEl.innerHTML = ""
  ;(friends[friendId].messages || []).forEach((msg) => {
    const div = document.createElement("div")
    div.className = "message " + (msg.from === "me" ? "me" : "them")
    div.textContent = msg.text
    messagesEl.appendChild(div)
  })
  messagesEl.scrollTop = messagesEl.scrollHeight
}

messageInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    sendMessage()
  }
})

sendBtn.addEventListener("click", sendMessage)

function sendMessage() {
  if (!activeFriend) {
    alert("Please select a friend first")
    return
  }
  const text = messageInput.value.trim()
  if (text) {
    console.log(`➡️ Sending to ${activeFriend}: ${text}`)
    ws.send(JSON.stringify({ type: "send", to: activeFriend, text }))
    messageInput.value = ""
  }
}

friendRequestBtn.addEventListener("click", () => {
  friendRequestModal.style.display = "block"
  renderFriendRequests()
})

closeModal.addEventListener("click", () => {
  friendRequestModal.style.display = "none"
})

window.addEventListener("click", (event) => {
  if (event.target === friendRequestModal) {
    friendRequestModal.style.display = "none"
  }
})

function updateFriendRequestButton() {
  const count = friendRequests.length
  friendRequestBtn.textContent = count > 0 ? `+${count}` : "+"
  friendRequestBtn.style.background = count > 0 ? "#f44336" : "#5c9ded"
}

function renderFriendRequests() {
  if (friendRequests.length === 0) {
    friendRequestList.innerHTML = "<p>No pending friend requests</p>"
    return
  }

  friendRequestList.innerHTML = ""
  friendRequests.forEach((request) => {
    const div = document.createElement("div")
    div.className = "friend-request-item"

    div.innerHTML = `
      <span class="friend-request-name">${request.name}</span>
      <div class="friend-request-actions">
        <button class="accept-btn" onclick="handleFriendRequest('${request.steamId}', 'accept')">Accept</button>
        <button class="decline-btn" onclick="handleFriendRequest('${request.steamId}', 'decline')">Decline</button>
      </div>
    `

    friendRequestList.appendChild(div)
  })
}

function handleFriendRequest(steamId, action) {
  console.log(`${action === "accept" ? "✅" : "❌"} ${action}ing friend request from ${steamId}`)
  ws.send(
    JSON.stringify({
      type: "friendRequest",
      steamId: steamId,
      action: action,
    }),
  )

  friendRequests = friendRequests.filter((req) => req.steamId !== steamId)
  renderFriendRequests()
  updateFriendRequestButton()
}
