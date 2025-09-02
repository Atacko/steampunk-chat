const ws = new WebSocket("ws://localhost:3000");

const friendListEl = document.getElementById("friendList");
const messagesEl = document.getElementById("messages");
const chatHeaderEl = document.getElementById("chatHeader");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");

let friends = {};
let activeFriend = null;

friendListEl.innerHTML = `<li>Loading friends...</li>`;

ws.onopen = () => {
  console.log("✅ Connected to backend");
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.type === "friends") {
    console.log("📥 Received friend list from backend:", data.friends);
    friends = data.friends;
    renderFriendList();
  }

  if (data.type === "message") {
    const { friendId, message } = data;
    console.log(`💬 Message event from backend: ${friendId}`, message);
    if (friends[friendId]) {
      friends[friendId].messages.push(message);
    } else {
      friends[friendId] = { name: friendId, messages: [message] };
    }

    if (activeFriend === friendId) {
      renderMessages(friendId);
    }
    renderFriendList();
  }
};

function renderFriendList() {
  friendListEl.innerHTML = "";
  if (Object.keys(friends).length === 0) {
    friendListEl.innerHTML = `<li>No friends loaded</li>`;
    return;
  }

  for (let id in friends) {
    const li = document.createElement("li");
    li.textContent = friends[id].name;
    if (id === activeFriend) li.classList.add("active");
    li.onclick = () => {
      activeFriend = id;
      chatHeaderEl.textContent = friends[id].name;
      renderMessages(id);
      renderFriendList();
    };
    friendListEl.appendChild(li);
  }
}

function renderMessages(friendId) {
  messagesEl.innerHTML = "";
  (friends[friendId].messages || []).forEach(msg => {
    const div = document.createElement("div");
    div.className = "message " + (msg.from === "me" ? "me" : "them");
    div.textContent = msg.text;
    messagesEl.appendChild(div);
  });
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

sendBtn.addEventListener("click", () => {
  if (!activeFriend) return;
  const text = messageInput.value.trim();
  if (text) {
    console.log(`➡️ Sending to ${activeFriend}: ${text}`);
    ws.send(JSON.stringify({ type: "send", to: activeFriend, text }));
    messageInput.value = "";
  }
});
