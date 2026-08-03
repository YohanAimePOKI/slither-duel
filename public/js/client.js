'use strict';

/* ════════════════════════════════════════════════
   Constants (mirror server)
════════════════════════════════════════════════ */
const MAP_RADIUS = 900;
const SNAKE_R    = 9;
const ZOOM       = 0.72;

/* ════════════════════════════════════════════════
   Global state
════════════════════════════════════════════════ */
const G = {
  ws: null,
  username: null, token: null, guest: false,
  wins: 0, losses: 0,
  playerIdx: 0,
  roomCode: null, isPrivate: false, isHost: false,
  names: [], colors: [],
  gameData: null,
  countdown: null,
  gameOver: null,
  currentScreen: 'auth',
  mouse: { x: 0, y: 0 },
  boost: false,
  inputIv: null,
  rafId: null,
};

/* ════════════════════════════════════════════════
   Canvas
════════════════════════════════════════════════ */
const canvas = document.getElementById('game-canvas');
const ctx    = canvas.getContext('2d');

function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

/* ════════════════════════════════════════════════
   WebSocket
════════════════════════════════════════════════ */
function wsConnect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  G.ws = new WebSocket(`${proto}://${location.host}`);
  G.ws.onopen = () => {
    const tok = localStorage.getItem('sdt');
    if (tok) wsend({ type: 'resume', token: tok });
  };
  G.ws.onmessage = e => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    onMsg(m);
  };
  G.ws.onclose = () => setTimeout(wsConnect, 3000);
  G.ws.onerror = () => { try { G.ws.close(); } catch {} };
}

function wsend(data) {
  if (G.ws && G.ws.readyState === WebSocket.OPEN) G.ws.send(JSON.stringify(data));
}

/* ════════════════════════════════════════════════
   Message handler
════════════════════════════════════════════════ */
function onMsg(m) {
  switch (m.type) {

    case 'authed':
      G.username = m.username;
      G.token    = m.token;
      G.guest    = !!m.guest;
      G.wins     = m.wins   || 0;
      G.losses   = m.losses || 0;
      if (m.token) localStorage.setItem('sdt', m.token);
      setScreen('lobby');
      refreshLobby();
      break;

    case 'err':
      showAuthError(m.msg);
      break;

    case 'mm_queued':
      G.roomCode  = null;
      G.isPrivate = false;
      setScreen('waiting');
      renderWaiting('Recherche d\'un adversaire…', null, false, true);
      break;

    case 'mm_left':
      setScreen('lobby');
      break;

    case 'room_state':
      G.roomCode  = m.code;
      G.isPrivate = m.isPrivate;
      G.isHost    = (m.players[0] === G.username);
      setScreen('waiting');
      const showCode  = m.isPrivate;
      const showStart = G.isHost && m.isPrivate && m.players.length === 2;
      const showDots  = m.players.length < 2;
      renderWaiting(
        m.isPrivate ? 'Room privée' : 'Adversaire trouvé !',
        m.players, showStart, showDots, showCode
      );
      break;

    case 'room_left':
      G.roomCode = null;
      setScreen('lobby');
      break;

    case 'opponent_disconnected':
      stopGame();
      setScreen('lobby');
      showToast('L\'adversaire s\'est déconnecté.');
      break;

    case 'game_start':
      G.names     = m.names;
      G.colors    = m.colors;
      G.playerIdx = m.names.indexOf(G.username);
      if (G.playerIdx === -1) G.playerIdx = 0;
      G.gameData  = null;
      G.countdown = 3;
      G.gameOver  = null;
      setScreen('game');
      startInputLoop();
      startRenderLoop();
      break;

    case 'countdown':
      G.countdown = m.n;
      break;

    case 'state':
      G.gameData  = m;
      G.countdown = null;
      break;

    case 'game_over':
      G.gameOver = m;
      stopInputLoop();
      // Show flash on canvas for 2 s, then show over-screen
      setTimeout(() => {
        stopRenderLoop();
        setScreen('over');
        renderOverScreen(m);
      }, 2000);
      break;

    case 'ready_ack': {
      const el = document.getElementById('over-ready');
      if (el) el.textContent = m.username === G.username
        ? '✅ Tu es prêt !'
        : `⏳ ${m.username} est prêt — en attente de toi…`;
      break;
    }
  }
}

/* ════════════════════════════════════════════════
   Screen management
════════════════════════════════════════════════ */
function setScreen(name) {
  G.currentScreen = name;
  document.querySelectorAll('.screen').forEach(el => {
    el.classList.toggle('active', el.id === `s-${name}`);
  });
  if (name !== 'game') stopRenderLoop();
}

/* ════════════════════════════════════════════════
   Auth
════════════════════════════════════════════════ */
function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  if (el) el.textContent = msg;
}
function clearAuthError() {
  const el = document.getElementById('auth-error');
  if (el) el.textContent = '';
}

function doLogin() {
  clearAuthError();
  wsend({ type: 'login', username: document.getElementById('l-user').value.trim(), password: document.getElementById('l-pass').value });
}
function doSignup() {
  clearAuthError();
  wsend({ type: 'signup', username: document.getElementById('s-user').value.trim(), password: document.getElementById('s-pass').value });
}
function doGuest() {
  clearAuthError();
  wsend({ type: 'guest', name: document.getElementById('g-name').value.trim() });
}
function logout() {
  localStorage.removeItem('sdt');
  G.username = null; G.token = null;
  setScreen('auth');
}

/* ════════════════════════════════════════════════
   Lobby
════════════════════════════════════════════════ */
function refreshLobby() {
  const uEl = document.getElementById('lobby-user');
  const sEl = document.getElementById('lobby-stats');
  if (uEl) uEl.textContent = G.username;
  if (sEl) sEl.textContent = G.guest ? 'Invité' : `${G.wins} V  ·  ${G.losses} D`;
}
function joinMatchmaking() { wsend({ type: 'mm_join' }); }
function createRoom()      { wsend({ type: 'room_create' }); }

function showJoinPanel() {
  const p = document.getElementById('join-panel');
  if (p) p.style.display = 'flex';
}
function hideJoinPanel() {
  const p = document.getElementById('join-panel');
  if (p) p.style.display = 'none';
  const i = document.getElementById('code-input');
  if (i) i.value = '';
}
function joinRoom() {
  const code = (document.getElementById('code-input')?.value || '').trim().toUpperCase();
  if (code.length !== 4) { showToast('Code à 4 caractères !'); return; }
  wsend({ type: 'room_join', code });
}

/* ════════════════════════════════════════════════
   Waiting room
════════════════════════════════════════════════ */
function renderWaiting(title, players, showStart, showDots, showCode) {
  const t = document.getElementById('w-title');
  const c = document.getElementById('w-code');
  const d = document.getElementById('w-dots');
  const l = document.getElementById('w-players');
  const b = document.getElementById('w-start');

  if (t) t.textContent = title;
  if (c) c.textContent = showCode && G.roomCode ? G.roomCode : '';
  if (d) d.style.display = showDots ? 'flex' : 'none';
  if (l) l.innerHTML = players ? players.map(p => `<li>${p}</li>`).join('') : '';
  if (b) b.style.display = showStart ? 'block' : 'none';
}
function startGame() { wsend({ type: 'room_start' }); }
function leaveRoom() {
  if (G.isPrivate || !G.roomCode) {
    wsend({ type: 'room_leave' });
  } else {
    wsend({ type: 'mm_leave' });
    wsend({ type: 'room_leave' });
  }
  stopGame();
  setScreen('lobby');
}

/* ════════════════════════════════════════════════
   Game Over screen
════════════════════════════════════════════════ */
function renderOverScreen(m) {
  let title, sub;
  if (m.draw) {
    title = '🤝 Égalité !';
    sub   = 'Les deux serpents se sont éliminés simultanément.';
  } else if (m.winner === G.username) {
    title = '🏆 Victoire !';
    sub   = `Tu as éliminé ${G.names.find(n => n !== G.username)} !`;
    G.wins++;
  } else {
    title = '💀 Défaite';
    sub   = `${m.winner} a remporté le duel.`;
    G.losses++;
  }
  const tEl = document.getElementById('over-title');
  const sEl = document.getElementById('over-sub');
  const rEl = document.getElementById('over-ready');
  if (tEl) tEl.textContent = title;
  if (sEl) sEl.textContent = sub;
  if (rEl) rEl.textContent = '';
  refreshLobby();
}
function playAgain() {
  wsend({ type: 'play_again' });
  const el = document.getElementById('over-ready');
  if (el) el.textContent = '⏳ En attente de l\'adversaire…';
}

/* ════════════════════════════════════════════════
   Input loop
════════════════════════════════════════════════ */
function startInputLoop() {
  stopInputLoop();
  G.inputIv = setInterval(() => {
    const angle = Math.atan2(G.mouse.y - canvas.height / 2, G.mouse.x - canvas.width / 2);
    wsend({ type: 'input', angle, boost: G.boost });
  }, 33);
}
function stopInputLoop() {
  if (G.inputIv) { clearInterval(G.inputIv); G.inputIv = null; }
}

/* ════════════════════════════════════════════════
   Render loop
════════════════════════════════════════════════ */
function startRenderLoop() {
  stopRenderLoop();
  const loop = () => {
    renderFrame();
    G.rafId = requestAnimationFrame(loop);
  };
  G.rafId = requestAnimationFrame(loop);
}
function stopRenderLoop() {
  if (G.rafId) { cancelAnimationFrame(G.rafId); G.rafId = null; }
}
function stopGame() { stopInputLoop(); stopRenderLoop(); }

/* ════════════════════════════════════════════════
   Main render
════════════════════════════════════════════════ */
function renderFrame() {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#080d1a';
  ctx.fillRect(0, 0, W, H);

  // Camera follows my snake head
  let camX = 0, camY = 0;
  if (G.gameData) {
    const me = G.gameData.s[G.playerIdx];
    if (me && me.x && me.x.length > 0) { camX = me.x[0]; camY = me.y[0]; }
  }

  ctx.save();
  ctx.translate(W / 2 - camX * ZOOM, H / 2 - camY * ZOOM);
  ctx.scale(ZOOM, ZOOM);

  drawWorld();
  if (G.gameData) {
    G.gameData.food.forEach(f => drawFood(f));
    G.gameData.s.forEach(s => { if (s.alive) drawSnake(s); });
  }

  ctx.restore();

  // HUD & overlays (screen-space)
  if (G.gameData && G.currentScreen === 'game') drawHUD();
  if (G.countdown !== null) drawCountdown();
  if (G.gameOver && G.currentScreen === 'game')  drawGameOverFlash();
}

/* ════════════════════════════════════════════════
   World
════════════════════════════════════════════════ */
function drawWorld() {
  // Subtle grid
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, MAP_RADIUS, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  const step = 80;
  for (let x = -MAP_RADIUS; x <= MAP_RADIUS; x += step) {
    ctx.beginPath(); ctx.moveTo(x, -MAP_RADIUS); ctx.lineTo(x, MAP_RADIUS); ctx.stroke();
  }
  for (let y = -MAP_RADIUS; y <= MAP_RADIUS; y += step) {
    ctx.beginPath(); ctx.moveTo(-MAP_RADIUS, y); ctx.lineTo(MAP_RADIUS, y); ctx.stroke();
  }
  ctx.restore();

  // Dark vignette outside map
  const vg = ctx.createRadialGradient(0, 0, MAP_RADIUS * 0.8, 0, 0, MAP_RADIUS + 300);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(4,6,18,0.95)');
  ctx.fillStyle = vg;
  ctx.beginPath();
  ctx.arc(0, 0, MAP_RADIUS + 400, 0, Math.PI * 2);
  ctx.fill();

  // Boundary ring
  ctx.save();
  ctx.strokeStyle = 'rgba(0,229,255,0.55)';
  ctx.lineWidth   = 4;
  ctx.shadowColor = '#00e5ff';
  ctx.shadowBlur  = 20;
  ctx.beginPath();
  ctx.arc(0, 0, MAP_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/* ════════════════════════════════════════════════
   Food
════════════════════════════════════════════════ */
function drawFood(f) {
  const col = `hsl(${f.h},90%,65%)`;
  ctx.save();
  ctx.fillStyle   = col;
  ctx.shadowColor = col;
  ctx.shadowBlur  = 9;
  ctx.beginPath();
  ctx.arc(f.x, f.y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/* ════════════════════════════════════════════════
   Snake
════════════════════════════════════════════════ */
function drawSmoothPath(x, y) {
  ctx.beginPath();
  ctx.moveTo(x[0], y[0]);
  for (let i = 1; i < x.length - 1; i++) {
    const mx = (x[i] + x[i + 1]) / 2;
    const my = (y[i] + y[i + 1]) / 2;
    ctx.quadraticCurveTo(x[i], y[i], mx, my);
  }
  if (x.length > 1) ctx.lineTo(x[x.length - 1], y[y.length - 1]);
}

function drawSnake(s) {
  const { x, y, a, color } = s;
  if (!x || x.length < 2) return;
  const isMe = s.idx === G.playerIdx;

  // Outer glow
  ctx.save();
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.lineWidth   = SNAKE_R * 2.6;
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur  = isMe ? 22 : 10;
  ctx.globalAlpha = 0.45;
  drawSmoothPath(x, y);
  ctx.stroke();
  ctx.restore();

  // Main body
  ctx.save();
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.lineWidth   = SNAKE_R * 2;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.93;
  drawSmoothPath(x, y);
  ctx.stroke();
  ctx.restore();

  // Dark inner stripe
  ctx.save();
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.lineWidth   = SNAKE_R * 0.85;
  ctx.strokeStyle = 'rgba(0,0,0,0.38)';
  drawSmoothPath(x, y);
  ctx.stroke();
  ctx.restore();

  // Head glow
  ctx.save();
  ctx.fillStyle   = color;
  ctx.shadowColor = color;
  ctx.shadowBlur  = isMe ? 28 : 14;
  ctx.beginPath();
  ctx.arc(x[0], y[0], SNAKE_R + 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Eyes
  const eyeOff = SNAKE_R * 0.68;
  const eyeR   = 2.7;
  for (const side of [-0.52, 0.52]) {
    const ex = x[0] + Math.cos(a + side) * eyeOff;
    const ey = y[0] + Math.sin(a + side) * eyeOff;
    ctx.save();
    ctx.fillStyle = '#fff'; ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(ex, ey, eyeR, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(ex + Math.cos(a) * 1.2, ey + Math.sin(a) * 1.2, eyeR * 0.52, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // Name tag
  ctx.save();
  const label = isMe ? `${s.name} ★` : s.name;
  ctx.font = `bold ${isMe ? 14 : 12}px 'Segoe UI', sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'bottom';
  const tw = ctx.measureText(label).width;
  const lx = x[0], ly = y[0] - SNAKE_R - 9;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath(); ctx.roundRect(lx - tw / 2 - 5, ly - 15, tw + 10, 17, 3); ctx.fill();
  ctx.fillStyle = isMe ? '#fff' : 'rgba(255,255,255,0.8)';
  ctx.fillText(label, lx, ly);
  ctx.restore();
}

/* ════════════════════════════════════════════════
   HUD
════════════════════════════════════════════════ */
function drawHUD() {
  const W = canvas.width, H = canvas.height;
  const me  = G.gameData?.s[G.playerIdx];
  const opp = G.gameData?.s[1 - G.playerIdx];
  if (!me) return;

  const bx = 20, bw = 200, bh = 13, by = H - 20 - bh;
  const pct = me.mfuel > 0 ? Math.min(1, me.fuel / me.mfuel) : 0;

  // Boost bar — me
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 6); ctx.fill();
  const bc = G.boost && pct > 0 ? '#ffe040' : (G.colors[G.playerIdx] || '#00e5ff');
  ctx.fillStyle   = bc;
  ctx.shadowColor = bc;
  ctx.shadowBlur  = G.boost ? 12 : 4;
  if (pct > 0) { ctx.beginPath(); ctx.roundRect(bx, by, bw * pct, bh, 6); ctx.fill(); }
  ctx.shadowBlur = 0;

  ctx.fillStyle    = 'rgba(255,255,255,0.85)';
  ctx.font         = '12px "Segoe UI", sans-serif';
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`⚡ Boost  ·  Taille : ${me.len}`, bx, by - 4);

  // Boost bar — opponent (top right)
  if (opp) {
    const ox = W - 20, ow = 180;
    const op = opp.mfuel > 0 ? Math.min(1, opp.fuel / opp.mfuel) : 0;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.roundRect(ox - ow, by, ow, bh, 6); ctx.fill();
    const oc = G.colors[1 - G.playerIdx] || '#ff5050';
    ctx.fillStyle = oc;
    if (op > 0) { ctx.beginPath(); ctx.roundRect(ox - ow, by, ow * op, bh, 6); ctx.fill(); }
    ctx.fillStyle    = 'rgba(255,255,255,0.7)';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${opp.name}  ·  ${opp.len}`, ox, by - 4);
  }

  // Mini control hint
  ctx.fillStyle    = 'rgba(255,255,255,0.25)';
  ctx.font         = '11px sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'bottom';
  const hint = ('ontouchstart' in window)
     ? 'Double tap = Boost'
     : 'Maintiens clic gauche · Espace = Boost';
   
   ctx.fillText(hint, W / 2, H - 6);
   }

/* ════════════════════════════════════════════════
   Countdown
════════════════════════════════════════════════ */
function drawCountdown() {
  const W = canvas.width, H = canvas.height;
  const n = G.countdown;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.58)';
  ctx.fillRect(0, 0, W, H);

  const isGo = n <= 0;
  const txt  = isGo ? 'GO !' : String(n);
  const sz   = isGo ? 88 : 140;
  const col  = isGo ? '#00e5ff' : '#ffc94d';

  ctx.font         = `900 ${sz}px 'Segoe UI', sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = col;
  ctx.shadowColor  = col;
  ctx.shadowBlur   = 45;
  ctx.fillText(txt, W / 2, H / 2);
  ctx.restore();
}

/* ════════════════════════════════════════════════
   Game Over flash (on canvas, before screen transition)
════════════════════════════════════════════════ */
function drawGameOverFlash() {
  const W = canvas.width, H = canvas.height;
  const m = G.gameOver;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.68)';
  ctx.fillRect(0, 0, W, H);

  let txt, col;
  if (m.draw)              { txt = 'Égalité 🤝'; col = '#ffffff'; }
  else if (m.winner === G.username) { txt = 'Victoire ! 🏆'; col = '#00e5ff'; }
  else                     { txt = 'Défaite 💀';  col = '#ff5050'; }

  ctx.font         = 'bold 64px "Segoe UI", sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = col;
  ctx.shadowColor  = col;
  ctx.shadowBlur   = 35;
  ctx.fillText(txt, W / 2, H / 2);
  ctx.restore();
}

/* ════════════════════════════════════════════════
   Toast
════════════════════════════════════════════════ */
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

/* ════════════════════════════════════════════════
   Input — Mouse
════════════════════════════════════════════════ */
canvas.addEventListener('mousemove', e => { G.mouse.x = e.clientX; G.mouse.y = e.clientY; });
canvas.addEventListener('mousedown', e => { if (e.button === 0) G.boost = true; });
canvas.addEventListener('mouseup',   e => { if (e.button === 0) G.boost = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());

window.addEventListener('keydown', e => {
  if (e.code === 'Space') { e.preventDefault(); G.boost = true; }
  if (e.code === 'Enter') {
    if (G.currentScreen === 'auth') {
      const active = document.querySelector('.tab.active')?.dataset.tab;
      if (active === 'login')  doLogin();
      else if (active === 'signup') doSignup();
      else if (active === 'guest')  doGuest();
    }
    if (G.currentScreen === 'lobby' && document.getElementById('join-panel').style.display !== 'none') {
      joinRoom();
    }
  }
});
window.addEventListener('keyup', e => { if (e.code === 'Space') G.boost = false; });

/* ════════════════════════════════════════════════
   Input — Touch (mobile)
════════════════════════════════════════════════ */
let lastTap = 0;

canvas.addEventListener('touchstart', e => {
  e.preventDefault();

  const t = e.touches[0];
  G.mouse.x = t.clientX;
  G.mouse.y = t.clientY;

  const now = Date.now();

  // Double tap = toggle boost
  if (now - lastTap < 300) {
    G.boost = !G.boost;
  }

  lastTap = now;

}, { passive: false });


canvas.addEventListener('touchmove', e => {
  e.preventDefault();

  const t = e.touches[0];
  G.mouse.x = t.clientX;
  G.mouse.y = t.clientY;

}, { passive: false });


canvas.addEventListener('touchend', e => {
  e.preventDefault();
}, { passive: false });

/* ════════════════════════════════════════════════
   Auth tabs
════════════════════════════════════════════════ */
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const panel = document.getElementById(`tp-${btn.dataset.tab}`);
    if (panel) panel.classList.add('active');
    clearAuthError();
  });
});

/* ════════════════════════════════════════════════
   Boot
════════════════════════════════════════════════ */
wsConnect();
