'use strict';

const express  = require('express');
const http     = require('http');
const WebSocket = require('ws');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const path     = require('path');

const app        = express();
const httpServer = http.createServer(app);
const wss        = new WebSocket.Server({ server: httpServer });

const PORT       = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'slither-duel-dev-secret-change-me';

// ═══════════════════════════════════════════════════
// In-memory storage
// ═══════════════════════════════════════════════════
const users    = new Map(); // lowercase → { displayName, hash, wins, losses }
const sessions = new Map(); // ws → { username, roomCode }
let   mmQueue  = [];        // [{ ws, username }]
const rooms    = new Map(); // code → Room

// ═══════════════════════════════════════════════════
// Game constants
// ═══════════════════════════════════════════════════
const MAP_RADIUS     = 900;
const SNAKE_R        = 9;
const SEG_DIST       = 9;
const BASE_SPEED     = 3;
const BOOST_SPEED    = 5.5;
const TURN_RATE      = 0.13;
const INITIAL_SEGS   = 20;
const FOOD_COUNT     = 45;
const TICK_MS        = 50;  // 20 tps
const SNAKE_COLORS   = ['#00e5ff', '#ff5050'];

// ═══════════════════════════════════════════════════
// Utils
// ═══════════════════════════════════════════════════
const send = (ws, data) => {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
};

const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

const genCode = () => {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => alpha[Math.random() * alpha.length | 0]).join('');
  } while (rooms.has(code));
  return code;
};

// ═══════════════════════════════════════════════════
// Room
// ═══════════════════════════════════════════════════
class Room {
  constructor(code, isPrivate) {
    this.code      = code;
    this.isPrivate = isPrivate;
    this.slots     = []; // [{ ws, username, ready }]
    this.game      = null;
  }

  get full() { return this.slots.length >= 2; }

  addPlayer(ws, username) {
    if (this.full) return false;
    this.slots.push({ ws, username, ready: false });
    const sess = sessions.get(ws);
    if (sess) sess.roomCode = this.code;
    return true;
  }

  removePlayer(ws) {
    this.slots = this.slots.filter(s => s.ws !== ws);
    const sess = sessions.get(ws);
    if (sess) sess.roomCode = null;
    if (this.game) { this.game.stop(); this.game = null; }
    if (this.slots.length === 0) { rooms.delete(this.code); return; }
    this.broadcast({ type: 'opponent_disconnected' });
  }

  broadcast(data) { this.slots.forEach(s => send(s.ws, data)); }

  startGame() {
    if (this.slots.length < 2) return;
    this.game = new Game(this);
    this.game.start();
  }
}

// ═══════════════════════════════════════════════════
// Game
// ═══════════════════════════════════════════════════
class Game {
  constructor(room) {
    this.room    = room;
    this.running = false;
    this.ticker  = null;
    this.food    = [];
    this.snakes  = [
      this.buildSnake(-380, 0, 0, room.slots[0].username, 0),
      this.buildSnake( 380, 0, Math.PI, room.slots[1].username, 1),
    ];
    this.spawnFood(FOOD_COUNT);
  }

  buildSnake(x, y, angle, name, idx) {
    const segs = [];
    for (let i = 0; i < INITIAL_SEGS; i++) {
      segs.push({
        x: x - Math.cos(angle) * i * SEG_DIST,
        y: y - Math.sin(angle) * i * SEG_DIST,
      });
    }
    return {
      segs, angle, target: angle,
      alive: true, boosting: false,
      fuel: INITIAL_SEGS * 8, growth: 0,
      name, idx, color: SNAKE_COLORS[idx],
    };
  }

  spawnFood(n = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * (MAP_RADIUS - 80);
      this.food.push({
        x: Math.cos(a) * r,
        y: Math.sin(a) * r,
        h: Math.random() * 360 | 0,
      });
    }
  }

  input(idx, angle, boosting) {
    const s = this.snakes[idx];
    if (s && s.alive) { s.target = angle; s.boosting = boosting; }
  }

  start() {
    this.running = true;
    this.room.broadcast({
      type: 'game_start',
      names:  this.snakes.map(s => s.name),
      colors: SNAKE_COLORS,
    });

    let count = 3;
    this.room.broadcast({ type: 'countdown', n: count });
    const iv = setInterval(() => {
      if (!this.running) { clearInterval(iv); return; }
      count--;
      this.room.broadcast({ type: 'countdown', n: count });
      if (count <= 0) {
        clearInterval(iv);
        this.ticker = setInterval(() => this.tick(), TICK_MS);
      }
    }, 1000);
  }

  tick() {
    if (!this.running) return;

    for (const s of this.snakes) {
      if (!s.alive) continue;

      // Smooth turn
      let d = s.target - s.angle;
      while (d >  Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      s.angle += Math.sign(d) * Math.min(Math.abs(d), TURN_RATE);

      // Boost
      const maxFuel = s.segs.length * 8;
      let speed = BASE_SPEED;
      if (s.boosting && s.fuel > 0) {
        speed  = BOOST_SPEED;
        s.fuel = Math.max(0, s.fuel - 1);
        // Shed mass when boosting
        if (s.segs.length > INITIAL_SEGS + 5 && Math.random() < 0.4) {
          const tail = s.segs[s.segs.length - 1];
          this.food.push({ x: tail.x, y: tail.y, h: 50 });
          if (s.growth > 0) s.growth--; else s.segs.pop();
        }
      } else {
        s.fuel = Math.min(maxFuel, s.fuel + 0.5);
      }

      // Move head
      const nh = {
        x: s.segs[0].x + Math.cos(s.angle) * speed,
        y: s.segs[0].y + Math.sin(s.angle) * speed,
      };
      s.segs.unshift(nh);
      if (s.growth > 0) s.growth--; else s.segs.pop();

      // Wall
      if (nh.x * nh.x + nh.y * nh.y > MAP_RADIUS * MAP_RADIUS) {
        s.alive = false; continue;
      }

      // Eat food
      const eaten = [];
      for (let i = this.food.length - 1; i >= 0; i--) {
        if (dist2(nh, this.food[i]) < (SNAKE_R + 7) ** 2) eaten.push(i);
      }
      if (eaten.length) {
        eaten.forEach(i => this.food.splice(i, 1));
        s.growth += eaten.length * 4;
        s.fuel    = Math.min(s.segs.length * 8 + 30, s.fuel + eaten.length * 20);
        this.spawnFood(eaten.length);
      }
    }

    // Cross-collision
    const [s0, s1] = this.snakes;
    if (s0.alive && s1.alive) {
      const h0 = s0.segs[0], h1 = s1.segs[0];

      // Head vs head → bigger wins
      if (dist2(h0, h1) < (SNAKE_R * 2) ** 2) {
        if (s0.segs.length >= s1.segs.length) s1.alive = false;
        if (s1.segs.length >= s0.segs.length) s0.alive = false;
      }
      // h0 into s1 body
      if (s0.alive) {
        for (let i = 2; i < s1.segs.length; i++) {
          if (dist2(h0, s1.segs[i]) < (SNAKE_R * 1.9) ** 2) { s0.alive = false; break; }
        }
      }
      // h1 into s0 body
      if (s1.alive) {
        for (let i = 2; i < s0.segs.length; i++) {
          if (dist2(h1, s0.segs[i]) < (SNAKE_R * 1.9) ** 2) { s1.alive = false; break; }
        }
      }
    }

    if (!s0.alive || !s1.alive) { this.endGame(); return; }

    // Send compressed state
    this.room.broadcast({
      type: 'state',
      s: this.snakes.map(s => ({
        x:     s.segs.map(p => Math.round(p.x)),
        y:     s.segs.map(p => Math.round(p.y)),
        a:     +s.angle.toFixed(4),
        alive: s.alive,
        boost: s.boosting,
        fuel:  s.fuel | 0,
        mfuel: s.segs.length * 8,
        len:   s.segs.length,
        color: s.color,
        name:  s.name,
        idx:   s.idx,
      })),
      food: this.food,
    });
  }

  endGame() {
    this.running = false;
    if (this.ticker) clearInterval(this.ticker);

    const [s0, s1] = this.snakes;
    const draw     = !s0.alive && !s1.alive;
    const winner   = draw ? null : (s0.alive ? s0.name : s1.name);
    const loser    = draw ? null : (s0.alive ? s1.name : s0.name);

    // Record wins/losses
    if (winner) {
      const wu = users.get(winner.toLowerCase()); if (wu) wu.wins++;
      const lu = users.get(loser?.toLowerCase());  if (lu) lu.losses++;
    }

    this.room.broadcast({ type: 'game_over', winner, draw });
    this.room.game = null;
  }

  stop() {
    this.running = false;
    if (this.ticker) clearInterval(this.ticker);
  }
}

// ═══════════════════════════════════════════════════
// WebSocket routing
// ═══════════════════════════════════════════════════
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  sessions.set(ws, { username: null, roomCode: null });

  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    route(ws, m);
  });
  ws.on('close', () => disconnect(ws));
  ws.on('error', () => { try { ws.close(); } catch {} });
});

// Keep-alive ping every 25 s
const heartbeat = setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) { ws.terminate(); return; }
    ws.isAlive = false;
    ws.ping();
  });
}, 25000);
wss.on('close', () => clearInterval(heartbeat));

function route(ws, m) {
  const sess = sessions.get(ws);
  if (!sess) return;

  switch (m.type) {

    // ── Auth ──────────────────────────────────────────
    case 'signup': {
      const u = (m.username || '').trim();
      const p = m.password || '';
      if (u.length < 3 || u.length > 16)
        return send(ws, { type: 'err', msg: 'Pseudo : 3 à 16 caractères.' });
      if (!/^[a-zA-Z0-9_\-]+$/.test(u))
        return send(ws, { type: 'err', msg: 'Pseudo : lettres, chiffres, _ ou - uniquement.' });
      if (p.length < 4)
        return send(ws, { type: 'err', msg: 'Mot de passe trop court (4 min).' });
      if (users.has(u.toLowerCase()))
        return send(ws, { type: 'err', msg: 'Pseudo déjà pris.' });
      const hash = bcrypt.hashSync(p, 10);
      users.set(u.toLowerCase(), { displayName: u, hash, wins: 0, losses: 0 });
      sess.username = u;
      const token = jwt.sign({ u }, JWT_SECRET, { expiresIn: '30d' });
      send(ws, { type: 'authed', username: u, token, wins: 0, losses: 0 });
      break;
    }

    case 'login': {
      const u   = (m.username || '').trim();
      const rec = users.get(u.toLowerCase());
      if (!rec || !bcrypt.compareSync(m.password || '', rec.hash))
        return send(ws, { type: 'err', msg: 'Identifiants incorrects.' });
      sess.username = rec.displayName;
      const token = jwt.sign({ u: rec.displayName }, JWT_SECRET, { expiresIn: '30d' });
      send(ws, { type: 'authed', username: rec.displayName, token, wins: rec.wins, losses: rec.losses });
      break;
    }

    case 'guest': {
      const name = (m.name || '').trim().slice(0, 16)
        || `Guest${Math.random() * 9000 + 1000 | 0}`;
      sess.username = name;
      send(ws, { type: 'authed', username: name, token: null, wins: 0, losses: 0, guest: true });
      break;
    }

    case 'resume': {
      try {
        const pl  = jwt.verify(m.token, JWT_SECRET);
        const rec = users.get(pl.u?.toLowerCase());
        const name = rec?.displayName || pl.u;
        sess.username = name;
        send(ws, { type: 'authed', username: name, token: m.token, wins: rec?.wins || 0, losses: rec?.losses || 0 });
      } catch {
        send(ws, { type: 'err', msg: 'Session expirée, reconnectez-vous.' });
      }
      break;
    }

    // ── Matchmaking ───────────────────────────────────
    case 'mm_join': {
      if (!sess.username || sess.roomCode) return;
      mmQueue = mmQueue.filter(e => e.ws !== ws);
      mmQueue.push({ ws, username: sess.username });
      send(ws, { type: 'mm_queued' });
      tryMatch();
      break;
    }

    case 'mm_leave': {
      mmQueue = mmQueue.filter(e => e.ws !== ws);
      send(ws, { type: 'mm_left' });
      break;
    }

    // ── Private rooms ──────────────────────────────────
    case 'room_create': {
      if (!sess.username) return send(ws, { type: 'err', msg: 'Non authentifié.' });
      if (sess.roomCode) return;
      const code = genCode();
      const room = new Room(code, true);
      rooms.set(code, room);
      room.addPlayer(ws, sess.username);
      send(ws, { type: 'room_state', code, players: [sess.username], isPrivate: true });
      break;
    }

    case 'room_join': {
      if (!sess.username) return send(ws, { type: 'err', msg: 'Non authentifié.' });
      if (sess.roomCode)  return send(ws, { type: 'err', msg: 'Déjà dans une room.' });
      const code = (m.code || '').toUpperCase();
      const room = rooms.get(code);
      if (!room)      return send(ws, { type: 'err', msg: `Room "${code}" introuvable.` });
      if (room.full)  return send(ws, { type: 'err', msg: 'Room déjà pleine.' });
      room.addPlayer(ws, sess.username);
      room.broadcast({ type: 'room_state', code, players: room.slots.map(s => s.username), isPrivate: true });
      break;
    }

    case 'room_leave': leaveRoom(ws); break;

    case 'room_start': {
      const room = rooms.get(sess.roomCode);
      if (!room || room.slots[0]?.ws !== ws) return;
      if (!room.full) return send(ws, { type: 'err', msg: 'Attends l\'adversaire.' });
      if (room.game)  return;
      room.startGame();
      break;
    }

    case 'play_again': {
      const room = rooms.get(sess.roomCode);
      if (!room || room.game) return;
      const slot = room.slots.find(s => s.ws === ws);
      if (!slot) return;
      slot.ready = true;
      room.broadcast({ type: 'ready_ack', username: sess.username });
      if (room.slots.length === 2 && room.slots.every(s => s.ready)) {
        room.slots.forEach(s => { s.ready = false; });
        room.startGame();
      }
      break;
    }

    // ── In-game input ──────────────────────────────────
    case 'input': {
      const room = rooms.get(sess.roomCode);
      if (!room?.game?.running) return;
      const idx = room.slots.findIndex(s => s.ws === ws);
      if (idx === -1) return;
      room.game.input(idx, m.angle, !!m.boost);
      break;
    }
  }
}

function tryMatch() {
  while (mmQueue.length >= 2) {
    const p1 = mmQueue.shift();
    const p2 = mmQueue.shift();
    if (p1.ws.readyState !== WebSocket.OPEN) { mmQueue.unshift(p2); continue; }
    if (p2.ws.readyState !== WebSocket.OPEN) { mmQueue.unshift(p1); continue; }
    const code = genCode();
    const room = new Room(code, false);
    rooms.set(code, room);
    room.addPlayer(p1.ws, p1.username);
    room.addPlayer(p2.ws, p2.username);
    room.broadcast({ type: 'room_state', code, players: room.slots.map(s => s.username), isPrivate: false });
    setTimeout(() => {
      if (rooms.has(code) && room.slots.length === 2 && !room.game) room.startGame();
    }, 1500);
  }
}

function leaveRoom(ws) {
  const sess = sessions.get(ws);
  if (!sess?.roomCode) return;
  const room = rooms.get(sess.roomCode);
  if (room) room.removePlayer(ws);
  send(ws, { type: 'room_left' });
}

function disconnect(ws) {
  mmQueue = mmQueue.filter(e => e.ws !== ws);
  leaveRoom(ws);
  sessions.delete(ws);
}

// ═══════════════════════════════════════════════════
// Static files + health check
// ═══════════════════════════════════════════════════
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_, res) => res.json({ status: 'ok', uptime: process.uptime() }));
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

httpServer.listen(PORT, () => {
  console.log(`🐍 Slither Duel → http://localhost:${PORT}`);
});
