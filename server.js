const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");

const DATA_FILE = path.join(__dirname, "data.json");
const SESSION_SECRET = process.env.SESSION_SECRET || "clickmania-secret-change-in-production";

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return {
      users: [],
      friends: [],
      races: [],
    };
  }
}

function saveData(data) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

const app = express();
app.use(express.json());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 },
  })
);

app.use(express.static(__dirname));

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Not signed in" });
  }
  next();
}

// ----- Auth -----
app.post("/api/auth/signup", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || username.length < 2 || password.length < 4) {
    return res.status(400).json({ error: "Username (2+ chars) and password (4+ chars) required" });
  }
  const data = loadData();
  const exists = data.users.some((u) => u.username.toLowerCase() === username.toLowerCase());
  if (exists) return res.status(400).json({ error: "Username taken" });

  const id = String(Date.now() + Math.random().toString(36).slice(2, 9));
  const hash = bcrypt.hashSync(password, 10);
  const user = { id, username: username.trim(), passwordHash: hash, coins: 0 };
  data.users.push(user);
  saveData(data);

  req.session.userId = user.id;
  req.session.username = user.username;
  return res.json({ user: { id: user.id, username: user.username, coins: user.coins } });
});

app.post("/api/auth/signin", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password required" });
  }
  const data = loadData();
  const user = data.users.find((u) => u.username.toLowerCase() === username.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  return res.json({ user: { id: user.id, username: user.username, coins: user.coins } });
});

app.get("/api/auth/me", (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Not signed in" });
  }
  const data = loadData();
  const user = data.users.find((u) => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: "User not found" });
  return res.json({ user: { id: user.id, username: user.username, coins: user.coins } });
});

app.post("/api/auth/signout", (req, res) => {
  req.session.destroy();
  return res.json({ ok: true });
});

// ----- Users search -----
app.get("/api/users", requireAuth, (req, res) => {
  const q = ((req.query.q || "").trim() || "").toLowerCase();
  const data = loadData();
  let list = data.users.filter((u) => u.id !== req.session.userId);
  if (q) list = list.filter((u) => u.username.toLowerCase().includes(q));
  const friends = (data.friends || []).filter(
    (f) => f.userId === req.session.userId || f.friendId === req.session.userId
  );
  const friendIds = new Set(friends.flatMap((f) => [f.userId, f.friendId]).filter((id) => id !== req.session.userId));

  return res.json({
    users: list.slice(0, 50).map((u) => ({
      id: u.id,
      username: u.username,
      coins: u.coins,
      isFriend: friendIds.has(u.id),
    })),
  });
});

// ----- Friends -----
app.get("/api/friends", requireAuth, (req, res) => {
  const data = loadData();
  const pairs = (data.friends || []).filter(
    (f) => f.userId === req.session.userId || f.friendId === req.session.userId
  );
  const friendIds = [...new Set(pairs.flatMap((f) => (f.userId === req.session.userId ? f.friendId : f.userId)))];
  const friends = friendIds
    .map((id) => data.users.find((u) => u.id === id))
    .filter(Boolean)
    .map((u) => ({ id: u.id, username: u.username, coins: u.coins }));

  return res.json({ friends });
});

app.post("/api/friends", requireAuth, (req, res) => {
  const { username } = req.body || {};
  if (!username || !username.trim()) return res.status(400).json({ error: "Username required" });

  const data = loadData();
  const other = data.users.find((u) => u.username.toLowerCase() === username.trim().toLowerCase());
  if (!other) return res.status(404).json({ error: "User not found" });
  if (other.id === req.session.userId) return res.status(400).json({ error: "Cannot friend yourself" });

  const exists = (data.friends || []).some(
    (f) =>
      (f.userId === req.session.userId && f.friendId === other.id) ||
      (f.friendId === req.session.userId && f.userId === other.id)
  );
  if (exists) return res.status(400).json({ error: "Already friends" });

  data.friends = data.friends || [];
  data.friends.push({ userId: req.session.userId, friendId: other.id });
  saveData(data);

  return res.json({ friend: { id: other.id, username: other.username, coins: other.coins } });
});

// ----- Sync coins (so server has latest for races) -----
app.post("/api/me/sync", requireAuth, (req, res) => {
  const { coins } = req.body || {};
  if (typeof coins !== "number" || coins < 0) return res.status(400).json({ error: "Invalid coins" });

  const data = loadData();
  const user = data.users.find((u) => u.id === req.session.userId);
  if (!user) return res.status(404).json({ error: "User not found" });
  user.coins = Math.floor(coins);
  saveData(data);

  return res.json({ coins: user.coins });
});

// ----- Races -----
app.get("/api/races", requireAuth, (req, res) => {
  const data = loadData();
  const races = (data.races || []).filter(
    (r) => r.hostId === req.session.userId || r.opponentId === req.session.userId
  );
  const users = data.users;
  const list = races.map((r) => {
    const host = users.find((u) => u.id === r.hostId);
    const opponent = users.find((u) => u.id === r.opponentId);
    const isHost = r.hostId === req.session.userId;
    const myClicks = isHost ? r.hostClicks : r.opponentClicks;
    const theirClicks = isHost ? r.opponentClicks : r.hostClicks;
    return {
      id: r.id,
      status: r.status,
      targetClicks: r.targetClicks,
      stakeCoins: r.stakeCoins,
      hostUsername: host ? host.username : "?",
      opponentUsername: opponent ? opponent.username : "?",
      hostClicks: r.hostClicks,
      opponentClicks: r.opponentClicks,
      winnerId: r.winnerId,
      myClicks,
      theirClicks,
      isHost,
    };
  });

  return res.json({ races: list });
});

app.post("/api/races", requireAuth, (req, res) => {
  const { opponentId, targetClicks, stakeCoins } = req.body || {};
  if (!opponentId || !targetClicks || !Number.isFinite(stakeCoins)) {
    return res.status(400).json({ error: "opponentId, targetClicks, and stakeCoins required" });
  }

  const target = Math.max(1, Math.floor(Number(targetClicks)));
  const stake = Math.max(0, Math.floor(Number(stakeCoins)));

  const data = loadData();
  const host = data.users.find((u) => u.id === req.session.userId);
  const opponent = data.users.find((u) => u.id === opponentId);
  if (!host || !opponent) return res.status(404).json({ error: "User not found" });
  if (opponentId === req.session.userId) return res.status(400).json({ error: "Cannot race yourself" });

  const areFriends = (data.friends || []).some(
    (f) =>
      (f.userId === req.session.userId && f.friendId === opponentId) ||
      (f.friendId === req.session.userId && f.userId === opponentId)
  );
  if (!areFriends) return res.status(400).json({ error: "Can only challenge friends" });

  if (host.coins < stake) return res.status(400).json({ error: "Not enough coins to stake" });

  const id = "r_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  data.races = data.races || [];
  data.races.push({
    id,
    hostId: req.session.userId,
    opponentId,
    targetClicks: target,
    stakeCoins: stake,
    hostClicks: 0,
    opponentClicks: 0,
    status: "pending",
    winnerId: null,
    createdAt: Date.now(),
  });
  saveData(data);

  return res.json({
    race: {
      id,
      status: "pending",
      targetClicks: target,
      stakeCoins: stake,
      opponentUsername: opponent.username,
    },
  });
});

app.post("/api/races/:id/accept", requireAuth, (req, res) => {
  const { id } = req.params;
  const data = loadData();
  const race = (data.races || []).find((r) => r.id === id);
  if (!race) return res.status(404).json({ error: "Race not found" });
  if (race.opponentId !== req.session.userId) return res.status(403).json({ error: "Not your invite" });
  if (race.status !== "pending") return res.status(400).json({ error: "Race already started or finished" });

  const opponent = data.users.find((u) => u.id === race.opponentId);
  if (opponent.coins < race.stakeCoins) return res.status(400).json({ error: "Not enough coins to stake" });

  race.status = "active";
  saveData(data);
  return res.json({ race: { id: race.id, status: "active" } });
});

app.get("/api/races/:id", requireAuth, (req, res) => {
  const { id } = req.params;
  const data = loadData();
  const race = (data.races || []).find((r) => r.id === id);
  if (!race) return res.status(404).json({ error: "Race not found" });
  if (race.hostId !== req.session.userId && race.opponentId !== req.session.userId) {
    return res.status(403).json({ error: "Not in this race" });
  }

  const host = data.users.find((u) => u.id === race.hostId);
  const opponent = data.users.find((u) => u.id === race.opponentId);
  const isHost = race.hostId === req.session.userId;

  return res.json({
    race: {
      id: race.id,
      status: race.status,
      targetClicks: race.targetClicks,
      stakeCoins: race.stakeCoins,
      hostUsername: host ? host.username : "?",
      opponentUsername: opponent ? opponent.username : "?",
      hostClicks: race.hostClicks,
      opponentClicks: race.opponentClicks,
      winnerId: race.winnerId,
      myClicks: isHost ? race.hostClicks : race.opponentClicks,
      theirClicks: isHost ? race.opponentClicks : race.hostClicks,
      isHost,
    },
  });
});

app.post("/api/races/:id/click", requireAuth, (req, res) => {
  const { id } = req.params;
  const data = loadData();
  const race = (data.races || []).find((r) => r.id === id);
  if (!race) return res.status(404).json({ error: "Race not found" });
  if (race.status !== "active") return res.status(400).json({ error: "Race not active" });

  const isHost = race.hostId === req.session.userId;
  if (isHost) race.hostClicks += 1;
  else race.opponentClicks += 1;

  const reached = race.hostClicks >= race.targetClicks || race.opponentClicks >= race.targetClicks;
  if (reached) {
    race.status = "finished";
    race.winnerId = race.hostClicks >= race.targetClicks ? race.hostId : race.opponentId;
    const winner = data.users.find((u) => u.id === race.winnerId);
    const loser = data.users.find((u) => u.id === (race.hostId === race.winnerId ? race.opponentId : race.hostId));
    if (winner) winner.coins += race.stakeCoins;
    if (loser) loser.coins = Math.max(0, loser.coins - race.stakeCoins);
  }

  saveData(data);

  const host = data.users.find((u) => u.id === race.hostId);
  const opponent = data.users.find((u) => u.id === race.opponentId);

  return res.json({
    race: {
      id: race.id,
      status: race.status,
      targetClicks: race.targetClicks,
      stakeCoins: race.stakeCoins,
      hostUsername: host ? host.username : "?",
      opponentUsername: opponent ? opponent.username : "?",
      hostClicks: race.hostClicks,
      opponentClicks: race.opponentClicks,
      winnerId: race.winnerId,
      myClicks: isHost ? race.hostClicks : race.opponentClicks,
      theirClicks: isHost ? race.opponentClicks : race.hostClicks,
      isHost,
    },
  });
});

app.get("/", (req, res) => res.redirect("/clicker.html"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Clickmania server at http://localhost:" + PORT));
