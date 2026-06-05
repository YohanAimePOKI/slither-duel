const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');
const GameRoom = require('./gameRoom');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const JWT_SECRET = process.env.JWT_SECRET || 'slither-duel-secret-2024';
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../client/public')));

// ─── AUTH ROUTES ─────────────────────────────────────────────────────────────

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  if (username.length < 3 || username.length > 20) return res.status(400).json({ error: 'Username must be 3-20 chars' });
  if (password.length < 4) return res.status(400).json({ error: 'Password too short' });

  try {
    const existing = await db.getUser(username);
    if (existing) return res.status(409).json({ error: 'Username taken' });
    const hash = await bcrypt.hash(password, 10);
    await db.createUser(username, hash);
    const token = jwt.sign({ username, guest: false }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, username, guest: false });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  try {
    const user = await db.getUser(username);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ username, guest: false }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, username, guest: false });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/guest', (req, res) => {
  const name = req.body.username || ('Guest_' + Math.random().toString(36).substring(2, 7).toUpperCase());
  const username = name.substring(0, 16);
  const token = jwt.sign({ username, guest: true, id: uuidv4() }, JWT_SECRET, { expiresIn: '2h' });
  res.json({ token, username, guest: true });
});

app.get('/api/leaderboard', async (req, res) => {
  try {
    const rows = await db.getLeaderboard();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── ROOM REGISTRY ────────────────────────────────────────────────────────────

const rooms = new Map(); // code -> GameRoom

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function cleanupRoom(code) {
  const room = rooms.get(code);
  if (room) {
    room.destroy();
    rooms.delete(code);
    console.log(`Room ${code} removed. Active rooms: ${rooms.size}`);
  }
}

// ─── WEBSOCKET ────────────────────────────────────────────────────────────────

wss.on('connection', (ws) => {
  ws.id = uuidv4();
  ws.alive = true;
  ws.roomCode = null;
  ws.playerData = null;

  ws.on('pong', () => { ws.alive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      case 'auth': {
        try {
          const payload = jwt.verify(msg.token, JWT_SECRET);
          ws.playerData = {
            username: payload.username,
            guest: payload.guest || false,
            color: msg.color || randomColor(),
            skin: msg.skin || 0
          };
          ws.send(JSON.stringify({ type: 'auth_ok', username: payload.username, guest: payload.guest }));
        } catch {
          ws.send(JSON.stringify({ type: 'error', msg: 'Invalid token' }));
          ws.close();
        }
        break;
      }

      case 'create_room': {
        if (!ws.playerData) return;
        const code = generateRoomCode();
        const room = new GameRoom(code, () => cleanupRoom(code), db);
        rooms.set(code, room);
        ws.roomCode = code;
        room.addPlayer(ws);
        console.log(`Room ${code} created by ${ws.playerData.username}`);
        break;
      }

      case 'join_room': {
        if (!ws.playerData) return;
        const code = (msg.code || '').toUpperCase().trim();
        const room = rooms.get(code);
        if (!room) {
          ws.send(JSON.stringify({ type: 'error', msg: 'Room not found' }));
          return;
        }
        if (room.isFull()) {
          ws.send(JSON.stringify({ type: 'error', msg: 'Room is full' }));
          return;
        }
        ws.roomCode = code;
        room.addPlayer(ws);
        break;
      }

      case 'input': {
        if (!ws.roomCode) return;
        const room = rooms.get(ws.roomCode);
        if (room) room.handleInput(ws.id, msg);
        break;
      }

      case 'ready': {
        if (!ws.roomCode) return;
        const room = rooms.get(ws.roomCode);
        if (room) room.setReady(ws.id);
        break;
      }

      case 'rematch': {
        if (!ws.roomCode) return;
        const room = rooms.get(ws.roomCode);
        if (room) room.requestRematch(ws.id);
        break;
      }

      case 'chat': {
        if (!ws.roomCode || !ws.playerData) return;
        const room = rooms.get(ws.roomCode);
        if (room) room.broadcastChat(ws.playerData.username, (msg.text || '').substring(0, 80));
        break;
      }
    }
  });

  ws.on('close', () => {
    if (ws.roomCode) {
      const room = rooms.get(ws.roomCode);
      if (room) room.removePlayer(ws.id);
    }
  });

  ws.on('error', () => ws.terminate());
});

// Heartbeat
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.alive) return ws.terminate();
    ws.alive = false;
    ws.ping();
  });
}, 30000);

function randomColor() {
  const colors = ['#FF4757','#2ED573','#1E90FF','#FFA502','#FF6B81','#70A1FF','#ECCC68','#A29BFE','#00CEC9','#FD79A8'];
  return colors[Math.floor(Math.random() * colors.length)];
}

server.listen(PORT, () => {
  console.log(`\n🐍 Slither Duel server running on http://localhost:${PORT}\n`);
});
