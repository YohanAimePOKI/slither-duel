// ═══════════════════════════════════════════════════════════════════
//  SLITHER DUEL — Client game.js
// ═══════════════════════════════════════════════════════════════════

const COLORS = ['#FF4757','#2ED573','#1E90FF','#FFA502','#FF6B81','#70A1FF','#ECCC68','#A29BFE','#00CEC9','#FD79A8'];
const MAP_SIZE = 3000;
const HEAD_RADIUS = 10;
const SEGMENT_SPACING = 9;

// ─── State ────────────────────────────────────────────────────────
let token = null, myUsername = null, isGuest = false;
let myColor = COLORS[0];
let ws = null;
let myId = null;
let roomCode = null;

// Game state
let snakes = {};       // id -> snake data
let foodMap = {};      // id -> food
let gameRunning = false;
let myMouseAngle = 0;
let boosting = false;
let camera = { x: 0, y: 0 };
let animFrame = null;

// Canvas
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const minimapCanvas = document.getElementById('minimap');
const mmCtx = minimapCanvas.getContext('2d');

// ─── Cursor ───────────────────────────────────────────────────────
const cursorEl = document.getElementById('cursor');
let mouseX = 0, mouseY = 0;
document.addEventListener('mousemove', e => {
  mouseX = e.clientX; mouseY = e.clientY;
  cursorEl.style.left = mouseX + 'px';
  cursorEl.style.top  = mouseY + 'px';
  if (gameRunning) updateMouseAngle();
});

// ─── Color pickers ────────────────────────────────────────────────
function buildColorPicker(containerId) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  COLORS.forEach((c, i) => {
    const s = document.createElement('div');
    s.className = 'color-swatch' + (i === 0 ? ' selected' : '');
    s.style.background = c;
    s.dataset.color = c;
    s.onclick = () => {
      el.querySelectorAll('.color-swatch').forEach(x => x.classList.remove('selected'));
      s.classList.add('selected');
      myColor = c;
    };
    el.appendChild(s);
  });
}
buildColorPicker('login-colors');
buildColorPicker('reg-colors');

// ─── Tab switching ────────────────────────────────────────────────
function switchTab(t) {
  document.getElementById('tab-login').style.display    = t === 'login'    ? '' : 'none';
  document.getElementById('tab-register').style.display = t === 'register' ? '' : 'none';
  document.querySelectorAll('.tab-btn').forEach((b, i) => b.classList.toggle('active', (i === 0) === (t === 'login')));
}

// ─── Auth ─────────────────────────────────────────────────────────
async function doLogin() {
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  if (!username || !password) { errEl.textContent = 'Fill all fields'; return; }
  try {
    const r = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username,password}) });
    const d = await r.json();
    if (!r.ok) { errEl.textContent = d.error || 'Error'; return; }
    saveSession(d.token, d.username, d.guest);
    showLobby();
  } catch { errEl.textContent = 'Connection failed'; }
}

async function doRegister() {
  const username = document.getElementById('reg-user').value.trim();
  const password = document.getElementById('reg-pass').value;
  const errEl = document.getElementById('reg-error');
  errEl.textContent = '';
  if (!username || !password) { errEl.textContent = 'Fill all fields'; return; }
  try {
    const r = await fetch('/api/register', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username,password}) });
    const d = await r.json();
    if (!r.ok) { errEl.textContent = d.error || 'Error'; return; }
    saveSession(d.token, d.username, d.guest);
    showLobby();
  } catch { errEl.textContent = 'Connection failed'; }
}

async function doGuest() {
  try {
    const username = 'Guest_' + Math.random().toString(36).substring(2,6).toUpperCase();
    const r = await fetch('/api/guest', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username}) });
    const d = await r.json();
    saveSession(d.token, d.username, true);
    showLobby();
  } catch { document.getElementById('login-error').textContent = 'Connection failed'; }
}

function saveSession(t, u, g) {
  token = t; myUsername = u; isGuest = g;
  localStorage.setItem('sdt', t);
  localStorage.setItem('sdu', u);
  localStorage.setItem('sdg', g ? '1' : '');
}

function doLogout() {
  token = null; myUsername = null; isGuest = false;
  localStorage.removeItem('sdt'); localStorage.removeItem('sdu'); localStorage.removeItem('sdg');
  disconnectWS();
  showScreen('screen-auth');
}

// Auto-login
(function tryAutoLogin() {
  const t = localStorage.getItem('sdt');
  const u = localStorage.getItem('sdu');
  const g = localStorage.getItem('sdg') === '1';
  if (t && u) { token = t; myUsername = u; isGuest = g; showLobby(); }
})();

// ─── Screens ──────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showLobby() {
  showScreen('screen-lobby');
  document.getElementById('lobby-username').textContent = myUsername + (isGuest ? ' (Guest)' : '');
  loadLeaderboard();
  document.getElementById('room-created-info').style.display = 'none';
  connectWS();
}

async function loadLeaderboard() {
  try {
    const r = await fetch('/api/leaderboard');
    const rows = await r.json();
    const el = document.getElementById('leaderboard-list');
    if (!rows.length) { el.innerHTML = '<div style="color:var(--text2);font-size:0.8rem">No players yet</div>'; return; }
    el.innerHTML = rows.map((row, i) => `
      <div class="leaderboard-row">
        <div class="lb-rank">${i+1}</div>
        <div class="lb-name">${esc(row.username)}</div>
        <div class="lb-wins">${row.wins}</div>
        <div class="lb-losses">${row.losses}</div>
      </div>`).join('');
  } catch {}
}

// ─── WebSocket ────────────────────────────────────────────────────
function connectWS() {
  if (ws && ws.readyState < 2) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.onopen = () => {
    document.getElementById('disconnect-notice').style.display = 'none';
    ws.send(JSON.stringify({ type: 'auth', token, color: myColor }));
  };

  ws.onmessage = (e) => {
    try { handleMsg(JSON.parse(e.data)); } catch {}
  };

  ws.onclose = () => {
    if (gameRunning || document.getElementById('screen-game').classList.contains('active')) {
      document.getElementById('disconnect-notice').style.display = 'block';
      setTimeout(connectWS, 2000);
    }
  };

  ws.onerror = () => ws.close();
}

function disconnectWS() {
  if (ws) { ws.close(); ws = null; }
}

function wsSend(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

// ─── Message handling ─────────────────────────────────────────────
function handleMsg(msg) {
  switch (msg.type) {

    case 'auth_ok':
      break;

    case 'joined':
      roomCode = msg.code;
      myId = null; // will be set from snake data
      showScreen('screen-game');
      resizeCanvas();
      showOverlay('overlay-waiting');
      document.getElementById('game-room-code').textContent = msg.code;
      document.getElementById('hud-room-code').textContent = msg.code;
      if (msg.playerCount === 2) hideOverlay('overlay-waiting');
      break;

    case 'player_joined':
      // Update lobby slot if visible
      if (msg.playerCount === 2) hideOverlay('overlay-waiting');
      // Update created-room slots
      if (document.getElementById('room-created-info').style.display !== 'none') {
        document.getElementById('slot-p2').classList.add('filled');
        document.getElementById('slot-p2').querySelector('.pname').textContent = msg.username;
        document.getElementById('slot-p2').querySelector('.pname').style.color = '';
      }
      break;

    case 'player_left':
      if (gameRunning) {
        addChatMsg('System', `${msg.username} left the game`, '#ff3366');
      }
      if (msg.playerCount < 2) showOverlay('overlay-waiting');
      break;

    case 'error':
      document.getElementById('join-error').textContent = msg.msg;
      break;

    case 'countdown':
      hideOverlay('overlay-gameover');
      hideOverlay('overlay-waiting');
      showOverlay('overlay-countdown');
      gameRunning = false;
      snakes = {}; foodMap = {};
      if (msg.count === 0) {
        const d = document.getElementById('countdown-display');
        d.className = 'go-text';
        d.textContent = 'GO!';
        setTimeout(() => hideOverlay('overlay-countdown'), 600);
      } else {
        const d = document.getElementById('countdown-display');
        d.className = 'countdown-num';
        d.textContent = msg.count;
      }
      break;

    case 'game_start':
      gameRunning = true;
      snakes = {};
      foodMap = {};
      msg.snakes.forEach(s => { snakes[s.id] = s; });
      msg.food.forEach(f => { foodMap[f.id] = f; });
      // Identify my snake
      for (const id in snakes) {
        if (snakes[id].username === myUsername) { myId = id; break; }
      }
      hideOverlay('overlay-countdown');
      hideOverlay('overlay-waiting');
      updateHUD();
      if (!animFrame) gameLoop();
      break;

    case 'tick':
      if (!gameRunning) return;
      // Update snakes
      msg.snakes.forEach(s => {
        if (snakes[s.id]) Object.assign(snakes[s.id], s);
        else snakes[s.id] = s;
      });
      // New food
      if (msg.newFood) msg.newFood.forEach(f => { foodMap[f.id] = f; });
      // Eaten food
      if (msg.eatenFood) msg.eatenFood.forEach(id => delete foodMap[id]);
      // Deaths
      if (msg.deaths) {
        msg.deaths.forEach(d => {
          if (snakes[d.id]) snakes[d.id].alive = false;
          // Kill feed
          if (d.killer && snakes[d.killer] && snakes[d.id]) {
            addKillFeed(snakes[d.killer].username, snakes[d.id].username);
          }
        });
      }
      updateHUD();
      break;

    case 'game_over':
      gameRunning = false;
      showGameOver(msg);
      break;

    case 'rematch_vote':
      document.getElementById('rematch-vote-text').textContent =
        `Rematch votes: ${msg.votes}/${msg.needed}`;
      break;

    case 'chat':
      addChatMsg(msg.username, msg.text, msg.username === myUsername ? '#00ff88' : '#70A1FF');
      break;
  }
}

// ─── Room actions ─────────────────────────────────────────────────
function wsReady(cb) {
  if (ws && ws.readyState === 1) { cb(); return; }
  // Re-connect and retry once open
  connectWS();
  const orig = ws.onopen;
  ws.onopen = (e) => {
    if (orig) orig.call(ws, e);
    cb();
  };
}

function createRoom() {
  document.getElementById('join-error').textContent = '';
  document.getElementById('room-created-info').style.display = 'block';
  document.getElementById('slot-p1-name').textContent = myUsername;
  document.getElementById('slot-p2').classList.remove('filled');
  document.getElementById('slot-p2').querySelector('.pname').textContent = 'Waiting...';
  document.getElementById('slot-p2').querySelector('.pname').style.color = 'var(--text2)';
  wsReady(() => wsSend({ type: 'create_room' }));
}

function joinRoom() {
  const code = document.getElementById('join-code-input').value.trim().toUpperCase();
  document.getElementById('join-error').textContent = '';
  if (code.length !== 4) { document.getElementById('join-error').textContent = 'Enter a 4-char code'; return; }
  wsReady(() => wsSend({ type: 'join_room', code }));
}

function requestRematch() {
  wsSend({ type: 'rematch' });
  document.getElementById('rematch-vote-text').textContent = 'Rematch request sent...';
}

function backToLobby() {
  gameRunning = false;
  cancelAnimationFrame(animFrame); animFrame = null;
  snakes = {}; foodMap = {};
  roomCode = null; myId = null;
  hideOverlay('overlay-gameover');
  hideOverlay('overlay-countdown');
  hideOverlay('overlay-waiting');
  // Don't disconnect; re-auth on existing connection or reconnect
  if (!ws || ws.readyState > 1) {
    connectWS();
  } else if (ws.readyState === 1) {
    // Re-send auth so server knows we're back in lobby
    ws.send(JSON.stringify({ type: 'auth', token, color: myColor }));
  }
  showLobby();
}

// ─── Overlays ─────────────────────────────────────────────────────
function showOverlay(id) { document.getElementById(id).classList.remove('hidden'); }
function hideOverlay(id) { document.getElementById(id).classList.add('hidden'); }

function showGameOver(msg) {
  const mySnake = snakes[myId];
  const oppSnake = Object.values(snakes).find(s => s.id !== myId);

  let title, sub, titleColor;
  if (!msg.winner) {
    title = 'DRAW'; sub = 'Both snakes died simultaneously'; titleColor = '#FFA502';
  } else if (msg.winner.username === myUsername) {
    title = 'VICTORY'; sub = 'You crushed your opponent!'; titleColor = '#00ff88';
  } else {
    title = 'DEFEAT'; sub = 'You were eliminated.'; titleColor = '#ff3366';
  }

  document.getElementById('go-title').textContent = title;
  document.getElementById('go-title').style.color = titleColor;
  document.getElementById('go-sub').textContent = sub;

  const scoresEl = document.getElementById('go-scores');
  scoresEl.innerHTML = msg.scores.map(s => {
    const isWinner = msg.winner && msg.winner.id === s.id;
    return `<div class="score-card ${isWinner ? 'winner' : ''}">
      <div class="sc-name" style="color:${snakes[s.id]?.color || '#fff'}">${esc(s.username)}</div>
      <div class="sc-val">${s.length}</div>
      <div class="sc-label">LENGTH</div>
      <div style="margin-top:8px; font-size:0.85rem; color:var(--text2)">Score: <b style="color:var(--accent2)">${s.score}</b></div>
      <div style="font-size:0.85rem; color:var(--text2)">Kills: <b style="color:var(--gold)">${s.kills}</b></div>
      ${isWinner ? '<div style="margin-top:8px; font-size:0.75rem; color:var(--gold); letter-spacing:2px;">★ WINNER ★</div>' : ''}
    </div>`;
  }).join('');

  document.getElementById('rematch-vote-text').textContent = '';
  showOverlay('overlay-gameover');
}

// ─── Input ────────────────────────────────────────────────────────
function updateMouseAngle() {
  if (!myId || !snakes[myId] || !snakes[myId].head) return;
  const snake = snakes[myId];
  const headScreenX = (snake.head.x - camera.x) * camera.scale + canvas.width / 2;
  const headScreenY = (snake.head.y - camera.y) * camera.scale + canvas.height / 2;
  myMouseAngle = Math.atan2(mouseY - headScreenY, mouseX - headScreenX);
  if (gameRunning) {
    wsSend({ type: 'input', angle: myMouseAngle, boost: boosting });
  }
}

document.addEventListener('mousedown', e => {
  if (e.button === 0) { boosting = true; if (gameRunning) wsSend({ type: 'input', angle: myMouseAngle, boost: true }); }
});
document.addEventListener('mouseup', e => {
  if (e.button === 0) { boosting = false; if (gameRunning) wsSend({ type: 'input', angle: myMouseAngle, boost: false }); }
});

// ─── Canvas resize ────────────────────────────────────────────────
function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ─── Camera ───────────────────────────────────────────────────────
camera.scale = 1.0;

function updateCamera() {
  if (!myId || !snakes[myId] || !snakes[myId].head) return;
  const target = snakes[myId].head;
  // Smooth follow
  camera.x += (target.x - camera.x) * 0.12;
  camera.y += (target.y - camera.y) * 0.12;
  // Dynamic zoom based on snake length
  const len = snakes[myId].length || 12;
  const targetScale = Math.max(0.55, Math.min(1.1, 14 / Math.sqrt(len)));
  camera.scale += (targetScale - camera.scale) * 0.05;
}

// ─── Game loop ────────────────────────────────────────────────────
function gameLoop() {
  animFrame = requestAnimationFrame(gameLoop);
  updateCamera();
  drawGame();
  drawMinimap();
}

// ─── Draw ─────────────────────────────────────────────────────────
function drawGame() {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = '#070b0f';
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(W / 2 - camera.x * camera.scale, H / 2 - camera.y * camera.scale);
  ctx.scale(camera.scale, camera.scale);

  // Grid
  drawGrid();

  // Border
  drawBorder();

  // Food
  drawFood();

  // Snakes (dead ones first, then alive)
  const snakeArr = Object.values(snakes);
  snakeArr.filter(s => !s.alive).forEach(drawSnake);
  snakeArr.filter(s => s.alive).forEach(drawSnake);

  ctx.restore();

  // Boost bar update
  if (myId && snakes[myId]) {
    const len = snakes[myId].length || 12;
    const pct = Math.min(100, Math.max(0, ((len - 12) / 80) * 100));
    document.getElementById('boost-bar').style.width = pct + '%';
    document.getElementById('boost-bar').style.background =
      boosting && len > 16 ? 'linear-gradient(90deg,#ff6b35,#ffa502)' : 'linear-gradient(90deg,#0099ff,#00ff88)';
  }
}

function drawGrid() {
  const gridSize = 60;
  ctx.strokeStyle = 'rgba(255,255,255,0.025)';
  ctx.lineWidth = 1;
  const startX = Math.floor(0 / gridSize) * gridSize;
  const startY = Math.floor(0 / gridSize) * gridSize;
  for (let x = startX; x <= MAP_SIZE; x += gridSize) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, MAP_SIZE); ctx.stroke();
  }
  for (let y = startY; y <= MAP_SIZE; y += gridSize) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(MAP_SIZE, y); ctx.stroke();
  }
}

function drawBorder() {
  const B = 50;
  // Danger zone
  ctx.strokeStyle = 'rgba(255,51,102,0.4)';
  ctx.lineWidth = 3;
  ctx.strokeRect(B, B, MAP_SIZE - B * 2, MAP_SIZE - B * 2);

  // Glow effect
  ctx.shadowColor = '#ff3366';
  ctx.shadowBlur = 15;
  ctx.strokeStyle = 'rgba(255,51,102,0.6)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(B, B, MAP_SIZE - B * 2, MAP_SIZE - B * 2);
  ctx.shadowBlur = 0;
}

function drawFood(f) {
  for (const id in foodMap) {
    const f = foodMap[id];
    const r = f.value > 1 ? 6 : 4.5;
    ctx.save();
    ctx.shadowColor = f.color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
    ctx.fillStyle = f.color;
    ctx.fill();
    // Inner highlight
    ctx.beginPath();
    ctx.arc(f.x - r * 0.3, f.y - r * 0.3, r * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fill();
    ctx.restore();
  }
}

function drawSnake(snake) {
  if (!snake.segments || snake.segments.length < 2) return;
  const isMe = snake.id === myId;
  const alpha = snake.alive ? 1 : 0.25;
  const color = snake.color || '#00ff88';
  const segs = snake.segments;
  const len = segs.length;

  // Body segments (tail to head)
  for (let i = len - 1; i >= 1; i--) {
    const t = i / len;
    const radius = Math.max(4, HEAD_RADIUS * (0.55 + 0.45 * (1 - t * 0.3)));
    const seg = segs[i];
    const prev = segs[i - 1];

    ctx.save();
    ctx.globalAlpha = alpha * (snake.alive ? 1 : 1);

    // Outline
    ctx.beginPath();
    ctx.arc(seg.x, seg.y, radius + 1.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fill();

    // Body segment gradient
    const grad = ctx.createRadialGradient(seg.x - radius * 0.3, seg.y - radius * 0.3, 0, seg.x, seg.y, radius);
    grad.addColorStop(0, lightenColor(color, 40));
    grad.addColorStop(1, color);
    ctx.beginPath();
    ctx.arc(seg.x, seg.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.restore();
  }

  // Head
  const head = segs[0];
  const headR = HEAD_RADIUS;

  ctx.save();
  ctx.globalAlpha = alpha;

  if (snake.alive && isMe) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 20;
  }

  // Head outline
  ctx.beginPath();
  ctx.arc(head.x, head.y, headR + 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fill();

  // Head fill
  const hgrad = ctx.createRadialGradient(head.x - headR * 0.3, head.y - headR * 0.3, 0, head.x, head.y, headR);
  hgrad.addColorStop(0, lightenColor(color, 60));
  hgrad.addColorStop(0.6, color);
  hgrad.addColorStop(1, darkenColor(color, 20));
  ctx.beginPath();
  ctx.arc(head.x, head.y, headR, 0, Math.PI * 2);
  ctx.fillStyle = hgrad;
  ctx.fill();

  ctx.shadowBlur = 0;

  // Eyes
  if (snake.alive) {
    const angle = snake.angle || 0;
    const eyeOffset = headR * 0.5;
    const perpX = -Math.sin(angle), perpY = Math.cos(angle);
    const fwdX = Math.cos(angle) * headR * 0.35, fwdY = Math.sin(angle) * headR * 0.35;

    [[1, -1], [1, 1]].forEach(([fa, pa]) => {
      const ex = head.x + fwdX * fa + perpX * eyeOffset * pa;
      const ey = head.y + fwdY * fa + perpY * eyeOffset * pa;
      // White
      ctx.beginPath();
      ctx.arc(ex, ey, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      // Pupil
      ctx.beginPath();
      ctx.arc(ex + Math.cos(angle) * 1, ey + Math.sin(angle) * 1, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = '#000';
      ctx.fill();
    });
  }

  ctx.restore();

  // Boost particle trail
  if (snake.alive && snake.id === myId && boosting && snake.length > 16) {
    drawBoostTrail(segs[Math.min(4, segs.length - 1)], color);
  }

  // Name tag
  if (snake.alive) {
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.font = `bold ${11 / camera.scale + 2}px Rajdhani`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillText(snake.username, head.x, head.y - headR - 6);
    ctx.fillStyle = isMe ? '#00ff88' : '#ff6b81';
    ctx.fillText(snake.username, head.x, head.y - headR - 7);
    ctx.restore();
  }
}

function drawBoostTrail(pos, color) {
  for (let i = 0; i < 3; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * 6;
    ctx.save();
    ctx.globalAlpha = Math.random() * 0.5;
    ctx.beginPath();
    ctx.arc(pos.x + Math.cos(angle) * r, pos.y + Math.sin(angle) * r, Math.random() * 3 + 1, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }
}

// ─── Minimap ──────────────────────────────────────────────────────
function drawMinimap() {
  const mw = minimapCanvas.width, mh = minimapCanvas.height;
  const scale = mw / MAP_SIZE;

  mmCtx.clearRect(0, 0, mw, mh);
  mmCtx.fillStyle = 'rgba(7,11,15,0.9)';
  mmCtx.fillRect(0, 0, mw, mh);

  // Border
  mmCtx.strokeStyle = 'rgba(255,51,102,0.4)';
  mmCtx.lineWidth = 1;
  mmCtx.strokeRect(50 * scale, 50 * scale, (MAP_SIZE - 100) * scale, (MAP_SIZE - 100) * scale);

  // Food dots
  mmCtx.fillStyle = 'rgba(255,255,255,0.15)';
  for (const id in foodMap) {
    const f = foodMap[id];
    mmCtx.fillRect(f.x * scale - 0.5, f.y * scale - 0.5, 1, 1);
  }

  // Snakes on minimap
  for (const id in snakes) {
    const s = snakes[id];
    if (!s.alive || !s.head) continue;
    const isMe = id === myId;
    mmCtx.beginPath();
    mmCtx.arc(s.head.x * scale, s.head.y * scale, isMe ? 3 : 2.5, 0, Math.PI * 2);
    mmCtx.fillStyle = s.color || '#fff';
    if (isMe) { mmCtx.shadowColor = s.color; mmCtx.shadowBlur = 6; }
    mmCtx.fill();
    mmCtx.shadowBlur = 0;
  }

  // Camera viewport rect
  if (camera.scale) {
    const vw = (canvas.width / camera.scale) * scale;
    const vh = (canvas.height / camera.scale) * scale;
    mmCtx.strokeStyle = 'rgba(255,255,255,0.2)';
    mmCtx.lineWidth = 0.5;
    mmCtx.strokeRect(
      (camera.x - canvas.width / (2 * camera.scale)) * scale,
      (camera.y - canvas.height / (2 * camera.scale)) * scale,
      vw, vh
    );
  }
}

// ─── HUD update ───────────────────────────────────────────────────
function updateHUD() {
  if (!myId) return;
  const me = snakes[myId];
  const opp = Object.values(snakes).find(s => s.id !== myId);

  if (me) {
    document.getElementById('hud-me-name').textContent = me.username;
    document.getElementById('hud-me-name').style.color = me.color || 'var(--accent)';
    document.getElementById('hud-me-len').textContent = me.length || 0;
    document.getElementById('hud-me-kills').textContent = me.kills || 0;
    document.getElementById('hud-me-score').textContent = me.score || 0;
  }

  if (opp) {
    document.getElementById('hud-opp-name').textContent = opp.username;
    document.getElementById('hud-opp-name').style.color = opp.color || 'var(--danger)';
    document.getElementById('hud-opp-len').textContent = opp.length || 0;
    document.getElementById('hud-opp-kills').textContent = opp.kills || 0;
    document.getElementById('hud-opp-score').textContent = opp.score || 0;
  }
}

// ─── Kill feed ────────────────────────────────────────────────────
function addKillFeed(killer, victim) {
  const el = document.getElementById('killfeed');
  const entry = document.createElement('div');
  entry.className = 'kill-entry';
  entry.innerHTML = `<b style="color:var(--accent)">${esc(killer)}</b><span class="separator">✕</span><b style="color:var(--danger)">${esc(victim)}</b>`;
  el.appendChild(entry);
  setTimeout(() => entry.remove(), 3100);
}

// ─── Chat ─────────────────────────────────────────────────────────
function addChatMsg(username, text, color = '#c8d8e8') {
  const el = document.getElementById('chat-messages');
  const msg = document.createElement('div');
  msg.className = 'chat-msg';
  msg.innerHTML = `<span class="cn" style="color:${color}">${esc(username)}:</span> ${esc(text)}`;
  el.appendChild(msg);
  // Keep max 5 messages
  while (el.children.length > 5) el.removeChild(el.firstChild);
}

function chatKeyDown(e) {
  if (e.key === 'Enter') {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (text) { wsSend({ type: 'chat', text }); input.value = ''; }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────
function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function lightenColor(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, (n >> 16) + amt);
  const g = Math.min(255, ((n >> 8) & 0xff) + amt);
  const b = Math.min(255, (n & 0xff) + amt);
  return `rgb(${r},${g},${b})`;
}

function darkenColor(hex, amt) {
  return lightenColor(hex, -amt);
}

// ─── Keyboard shortcuts ───────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('screen-auth').classList.contains('active')) {
    const tab = document.getElementById('tab-login').style.display !== 'none' ? 'login' : 'register';
    tab === 'login' ? doLogin() : doRegister();
  }
  if (e.key === 'Enter' && document.getElementById('screen-lobby').classList.contains('active')) {
    const code = document.getElementById('join-code-input').value.trim();
    if (code) joinRoom();
  }
  // Escape to blur chat
  if (e.key === 'Escape') document.getElementById('chat-input').blur();
  // T to focus chat
  if (e.key === 't' && gameRunning && document.activeElement !== document.getElementById('chat-input')) {
    e.preventDefault();
    document.getElementById('chat-input').focus();
  }
});
