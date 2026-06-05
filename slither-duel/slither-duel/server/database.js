const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/slither.db');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);

db.exec(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  kills INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

module.exports = {
  getUser:      (username) => Promise.resolve(db.prepare('SELECT * FROM users WHERE username = ?').get(username)),
  createUser:   (username, hash) => Promise.resolve(db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash)),
  recordWin:    (username) => Promise.resolve(db.prepare('UPDATE users SET wins = wins + 1 WHERE username = ?').run(username)),
  recordLoss:   (username) => Promise.resolve(db.prepare('UPDATE users SET losses = losses + 1 WHERE username = ?').run(username)),
  recordKill:   (username) => Promise.resolve(db.prepare('UPDATE users SET kills = kills + 1 WHERE username = ?').run(username)),
  getLeaderboard: () => Promise.resolve(db.prepare('SELECT username, wins, losses, kills FROM users ORDER BY wins DESC, kills DESC LIMIT 20').all()),
};
