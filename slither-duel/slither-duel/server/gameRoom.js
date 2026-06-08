// GameRoom.js — Server-side game simulation
// Physics inspired by slither.io: smooth turning with max angular velocity,
// boost on mouse1, grow by eating food/opponent segments, head-body collision = death

const TICK_RATE = 20; // ms per tick (50 ticks/s)
const MAP_SIZE = 3000;
const BORDER = 50;

// Snake physics
const BASE_SPEED = 3.5;
const BOOST_SPEED = 6.5;
const MAX_TURN = 0.065; // radians per tick (max angular velocity)
const INITIAL_LENGTH = 12;
const SEGMENT_SPACING = 9;
const HEAD_RADIUS = 10;

// Food
const FOOD_COUNT = 180;
const FOOD_VALUE = 1; // segments added per food
const BOOST_FOOD_DROP = 2; // food dropped per tick while boosting

// Score
const KILL_BONUS = 20;
const FOOD_SCORE = 1;
const BOOST_COST = 0.08; // minimum length to boost (segments)

const COUNTDOWN = 3; // seconds

class Snake {
  constructor(id, username, color, spawnX, spawnY, angle) {
    this.id = id;
    this.username = username;
    this.color = color;
    this.alive = true;
    this.angle = angle;
    this.targetAngle = angle;
    this.speed = BASE_SPEED;
    this.boosting = false;
    this.score = 0;
    this.kills = 0;

    // Build initial segments
    this.segments = [];
    for (let i = 0; i < INITIAL_LENGTH; i++) {
      this.segments.push({
        x: spawnX - Math.cos(angle) * i * SEGMENT_SPACING,
        y: spawnY - Math.sin(angle) * i * SEGMENT_SPACING
      });
    }
  }

  get head() { return this.segments[0]; }
  get length() { return this.segments.length; }

  setInput(mouseAngle, boosting) {
    this.targetAngle = mouseAngle;
    this.boosting = boosting && this.length > INITIAL_LENGTH + 4;
  }

  update() {
    if (!this.alive) return [];

    // Smooth turn: clamp angular delta to MAX_TURN
    let da = this.targetAngle - this.angle;
    // Normalize to [-PI, PI]
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    da = Math.max(-MAX_TURN, Math.min(MAX_TURN, da));
    this.angle += da;

    const spd = this.boosting ? BOOST_SPEED : BASE_SPEED;
    const newHead = {
      x: this.head.x + Math.cos(this.angle) * spd,
      y: this.head.y + Math.sin(this.angle) * spd
    };

    // Clamp to map bounds
    newHead.x = Math.max(BORDER, Math.min(MAP_SIZE - BORDER, newHead.x));
    newHead.y = Math.max(BORDER, Math.min(MAP_SIZE - BORDER, newHead.y));

    this.segments.unshift(newHead);

    // Drop food while boosting
    const droppedFood = [];
    if (this.boosting && this.length > INITIAL_LENGTH + 4) {
      // Remove tail segment, convert to food
      const tail = this.segments.pop();
      droppedFood.push({ x: tail.x, y: tail.y, value: 1, color: this.color });
      this.score = Math.max(0, this.score - 0.05);
    } else {
      this.segments.pop();
    }

    return droppedFood;
  }

  grow(amount = 1) {
    const tail = this.segments[this.segments.length - 1];
    for (let i = 0; i < amount; i++) {
      this.segments.push({ ...tail });
    }
    this.score += amount * FOOD_SCORE;
  }

  // Serialize for network (compact)
  serialize(full = false) {
    if (full) {
      return {
        id: this.id,
        username: this.username,
        color: this.color,
        alive: this.alive,
        score: Math.floor(this.score),
        kills: this.kills,
        length: this.length,
        angle: this.angle,
        segments: this.segments
      };
    }
    // Delta: just head + angle for smooth client interpolation
    return {
      id: this.id,
      alive: this.alive,
      score: Math.floor(this.score),
      length: this.length,
      angle: this.angle,
      head: this.head,
      segments: this.segments // send all for duel (only 2 players, bandwidth ok)
    };
  }
}

class GameRoom {
  constructor(code, onEmpty, db) {
    this.code = code;
    this.onEmpty = onEmpty;
    this.db = db;
    this.players = new Map(); // ws.id -> ws
    this.snakes = new Map(); // ws.id -> Snake
    this.food = new Map();   // id -> {x,y,value,color}
    this.state = 'waiting';  // waiting | countdown | playing | gameover
    this.readySet = new Set();
    this.rematchSet = new Set();
    this.tickInterval = null;
    this.countdownTimer = null;
    this.foodIdCounter = 0;
    this.winner = null;

    this._spawnInitialFood();
  }

  // ── Player management ──────────────────────────────────────────────────────

  addPlayer(ws) {
    this.players.set(ws.id, ws);
    ws.send(JSON.stringify({
      type: 'joined',
      code: this.code,
      playerCount: this.players.size,
      state: this.state,
      username: ws.playerData.username
    }));

    for (const [id, other] of this.players) {
      if (id !== ws.id && other.readyState === 1) {
        other.send(JSON.stringify({
          type: 'player_joined',
          username: ws.playerData.username,
          playerCount: this.players.size
        }));
      }
    }

    if (this.players.size === 2 && this.state === 'waiting') {
      this._startCountdown();
    }
  }

  removePlayer(id) {
    const ws = this.players.get(id);
    this.players.delete(id);
    this.readySet.delete(id);
    this.rematchSet.delete(id);

    if (ws) {
      this.broadcast({
        type: 'player_left',
        username: ws.playerData?.username || '?',
        playerCount: this.players.size
      });
    }

    // If game was running and a player leaves → other wins
    if (this.state === 'playing') {
      const snake = this.snakes.get(id);
      if (snake) snake.alive = false;
      this._checkWinCondition();
    }

    if (this.players.size === 0) {
      this._stopTick();
      clearTimeout(this.countdownTimer);
      setTimeout(() => this.onEmpty(), 5000);
    }
  }

  isFull() { return this.players.size >= 2; }

  handleInput(id, msg) {
    if (this.state !== 'playing') return;
    const snake = this.snakes.get(id);
    if (!snake || !snake.alive) return;
    snake.setInput(msg.angle ?? snake.targetAngle, !!msg.boost);
  }

  setReady(id) {
    // Not used in auto-start, kept for potential future lobby
  }

  requestRematch(id) {
    this.rematchSet.add(id);
    this.broadcast({ type: 'rematch_vote', votes: this.rematchSet.size, needed: this.players.size });
    if (this.rematchSet.size >= this.players.size && this.players.size === 2) {
      this.rematchSet.clear();
      this._startCountdown();
    }
  }

  broadcastChat(username, text) {
    this.broadcast({ type: 'chat', username, text });
  }

  // ── Game flow ──────────────────────────────────────────────────────────────

  _startCountdown() {
    this.state = 'countdown';
    this.snakes.clear();
    this.food.clear();
    this.foodIdCounter = 0;
    this.winner = null;
    this._spawnInitialFood();
    this._spawnSnakes();

    let count = COUNTDOWN;
    const tick = () => {
      this.broadcast({ type: 'countdown', count });
      if (count === 0) {
        this._startGame();
      } else {
        count--;
        this.countdownTimer = setTimeout(tick, 1000);
      }
    };
    tick();
  }

  _spawnSnakes() {
    const entries = Array.from(this.players.entries());
    const positions = [
      { x: MAP_SIZE * 0.3, y: MAP_SIZE * 0.5, angle: 0 },
      { x: MAP_SIZE * 0.7, y: MAP_SIZE * 0.5, angle: Math.PI }
    ];
    entries.forEach(([id, ws], i) => {
      const pos = positions[i];
      const snake = new Snake(id, ws.playerData.username, ws.playerData.color, pos.x, pos.y, pos.angle);
      this.snakes.set(id, snake);
    });
  }

  _startGame() {
    this.state = 'playing';
    // Send full initial state
    const snakeArr = Array.from(this.snakes.values()).map(s => s.serialize(true));
    const foodArr = this._foodArray();
    this.broadcast({ type: 'game_start', snakes: snakeArr, food: foodArr, mapSize: MAP_SIZE });
    this._startTick();
  }

  _startTick() {
    this._stopTick();
    this.tickInterval = setInterval(() => this._tick(), TICK_RATE);
  }

  _stopTick() {
    if (this.tickInterval) { clearInterval(this.tickInterval); this.tickInterval = null; }
  }

  _tick() {
    if (this.state !== 'playing') return;

    const newFood = [];
    const deaths = [];

    // Update snakes
    for (const [id, snake] of this.snakes) {
      if (!snake.alive) continue;
      const dropped = snake.update();
      dropped.forEach(f => {
        const fid = this.foodIdCounter++;
        this.food.set(fid, { id: fid, ...f });
        newFood.push({ id: fid, ...f });
      });
    }

    // Collision detection
    const snakeArr = Array.from(this.snakes.values());
    for (const snake of snakeArr) {
      if (!snake.alive) continue;
      const hx = snake.head.x;
      const hy = snake.head.y;

      // Wall collision
      if (hx <= BORDER || hx >= MAP_SIZE - BORDER || hy <= BORDER || hy >= MAP_SIZE - BORDER) {
        deaths.push({ id: snake.id, reason: 'wall' });
        continue;
      }

      // Head vs other snake's body
      let died = false;
      for (const other of snakeArr) {
        if (other.id === snake.id || !other.alive) continue;
        // Check head vs head (mutual)
        const dx0 = hx - other.head.x, dy0 = hy - other.head.y;
        if (Math.sqrt(dx0 * dx0 + dy0 * dy0) < HEAD_RADIUS * 1.5) {
          // Smaller dies; if equal both die
          if (snake.length >= other.length) {
            deaths.push({ id: other.id, reason: 'head_collision', killer: snake.id });
          }
          if (other.length >= snake.length) {
            deaths.push({ id: snake.id, reason: 'head_collision', killer: other.id });
          }
          died = true;
          break;
        }
        // Check head vs body segments (skip first 5)
        for (let si = 5; si < other.segments.length; si++) {
          const seg = other.segments[si];
          const dx = hx - seg.x, dy = hy - seg.y;
          if (dx * dx + dy * dy < HEAD_RADIUS * HEAD_RADIUS) {
            deaths.push({ id: snake.id, reason: 'body_collision', killer: other.id });
            died = true;
            break;
          }
        }
        if (died) break;
      }
    }

    // Process deaths (deduplicate by id)
    const deadIds = new Set();
    for (const d of deaths) {
      if (deadIds.has(d.id)) continue;
      deadIds.add(d.id);
      const dead = this.snakes.get(d.id);
      if (!dead || !dead.alive) continue;
      dead.alive = false;

      // Drop food from body
      const bodyFood = [];
      for (let i = 0; i < dead.segments.length; i += 3) {
        const seg = dead.segments[i];
        const fid = this.foodIdCounter++;
        const fd = { id: fid, x: seg.x, y: seg.y, value: 2, color: dead.color };
        this.food.set(fid, fd);
        bodyFood.push(fd);
      }
      newFood.push(...bodyFood);

      // Credit killer
      if (d.killer) {
        const killer = this.snakes.get(d.killer);
        if (killer && killer.alive) {
          killer.kills++;
          killer.grow(KILL_BONUS);
          // Update DB stats
          if (!this.players.get(d.killer)?.playerData?.guest) {
            this.db.recordKill(killer.username).catch(() => {});
          }
        }
      }
    }

    // Food eating
    const eatenFood = [];
    for (const [id, snake] of this.snakes) {
      if (!snake.alive) continue;
      const hx = snake.head.x, hy = snake.head.y;
      for (const [fid, food] of this.food) {
        const dx = hx - food.x, dy = hy - food.y;
        if (dx * dx + dy * dy < (HEAD_RADIUS + 8) * (HEAD_RADIUS + 8)) {
          snake.grow(food.value);
          this.food.delete(fid);
          eatenFood.push(fid);
        }
      }
    }

    // Respawn food to maintain density
    const respawned = [];
    while (this.food.size < FOOD_COUNT) {
      const f = this._spawnFood();
      respawned.push(f);
    }

    // Build update packet
    const update = {
      type: 'tick',
      snakes: snakeArr.map(s => s.serialize()),
      newFood: [...newFood, ...respawned],
      eatenFood,
      deaths: Array.from(deadIds).map(id => ({
        id,
        reason: deaths.find(d => d.id === id)?.reason,
        killer: deaths.find(d => d.id === id)?.killer
      }))
    };

    this.broadcast(update);
    this._checkWinCondition();
  }

  _checkWinCondition() {
    if (this.state !== 'playing') return;
    const alive = Array.from(this.snakes.values()).filter(s => s.alive);
    const total = this.snakes.size;

    if (total < 2) return; // Game hasn't started properly

    if (alive.length === 0) {
      // Draw
      this._endGame(null);
    } else if (alive.length === 1 && total === 2) {
      this._endGame(alive[0].id);
    }
  }

  _endGame(winnerId) {
    this._stopTick();
    this.state = 'gameover';

    const winnerSnake = winnerId ? this.snakes.get(winnerId) : null;
    const loserSnake = winnerId
      ? Array.from(this.snakes.values()).find(s => s.id !== winnerId)
      : null;

    // Update DB
    if (winnerSnake && !this.players.get(winnerId)?.playerData?.guest) {
      this.db.recordWin(winnerSnake.username).catch(() => {});
    }
    if (loserSnake) {
      const loserWs = this.players.get(loserSnake.id);
      if (loserWs && !loserWs.playerData?.guest) {
        this.db.recordLoss(loserSnake.username).catch(() => {});
      }
    }

    const scores = Array.from(this.snakes.values()).map(s => ({
      id: s.id,
      username: s.username,
      score: Math.floor(s.score),
      kills: s.kills,
      length: s.length
    }));

    this.broadcast({
      type: 'game_over',
      winner: winnerSnake ? { id: winnerSnake.id, username: winnerSnake.username } : null,
      scores
    });
  }

  // ── Food helpers ───────────────────────────────────────────────────────────

  _spawnInitialFood() {
    for (let i = 0; i < FOOD_COUNT; i++) this._spawnFood();
  }

  _spawnFood() {
    const colors = ['#FF4757','#2ED573','#1E90FF','#FFA502','#FF6B81','#70A1FF','#ECCC68','#A29BFE','#00CEC9'];
    const fid = this.foodIdCounter++;
    const f = {
      id: fid,
      x: BORDER + Math.random() * (MAP_SIZE - BORDER * 2),
      y: BORDER + Math.random() * (MAP_SIZE - BORDER * 2),
      value: 1,
      color: colors[Math.floor(Math.random() * colors.length)]
    };
    this.food.set(fid, f);
    return f;
  }

  _foodArray() {
    return Array.from(this.food.values());
  }

  // ── Broadcast ──────────────────────────────────────────────────────────────

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const ws of this.players.values()) {
      if (ws.readyState === 1) ws.send(data);
    }
  }

  destroy() {
    this._stopTick();
    clearTimeout(this.countdownTimer);
  }
}

module.exports = GameRoom;
