// In-memory database — no native modules, works on any Node version
const users = new Map();

module.exports = {
  getUser: (username) => Promise.resolve(users.get(username.toLowerCase()) || null),

  createUser: (username, hash) => {
    users.set(username.toLowerCase(), {
      username,
      password_hash: hash,
      wins: 0, losses: 0, kills: 0
    });
    return Promise.resolve();
  },

  recordWin: (username) => {
    const u = users.get(username.toLowerCase());
    if (u) u.wins++;
    return Promise.resolve();
  },

  recordLoss: (username) => {
    const u = users.get(username.toLowerCase());
    if (u) u.losses++;
    return Promise.resolve();
  },

  recordKill: (username) => {
    const u = users.get(username.toLowerCase());
    if (u) u.kills++;
    return Promise.resolve();
  },

  getLeaderboard: () => {
    const rows = Array.from(users.values())
      .sort((a, b) => b.wins - a.wins || b.kills - a.kills)
      .slice(0, 20)
      .map(({ username, wins, losses, kills }) => ({ username, wins, losses, kills }));
    return Promise.resolve(rows);
  }
};
