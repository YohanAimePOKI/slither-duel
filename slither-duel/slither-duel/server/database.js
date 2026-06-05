const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/slither.db');

// Ensure data dir exists
const fs = require('fs');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    kills INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

module.exports = {
  getUser: (username) => get('SELECT * FROM users WHERE username = ?', [username]),
  createUser: (username, hash) => run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, hash]),
  recordWin: (username) => run('UPDATE users SET wins = wins + 1 WHERE username = ?', [username]),
  recordLoss: (username) => run('UPDATE users SET losses = losses + 1 WHERE username = ?', [username]),
  recordKill: (username) => run('UPDATE users SET kills = kills + 1 WHERE username = ?', [username]),
  getLeaderboard: () => all('SELECT username, wins, losses, kills FROM users ORDER BY wins DESC, kills DESC LIMIT 20'),
};
