/* ============================================================
   Three Kingdoms: Conquest — Backend Server
   Google sign-in + cross-device profiles + shared leaderboards
   Node 18+, Express, better-sqlite3
   ============================================================ */
'use strict';
const express = require('express');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { OAuth2Client } = require('google-auth-library');

// ---------- config (environment variables) ----------
const PORT = process.env.PORT || 8787;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';   // from Google Cloud Console
const ADMIN_KEY = process.env.ADMIN_KEY || '';                 // choose a long random string
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const DB_PATH = process.env.DB_PATH || './data.sqlite';
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';          // set to your game's domain in production

if (!GOOGLE_CLIENT_ID) console.warn('[warn] GOOGLE_CLIENT_ID not set — Google sign-in will be disabled.');
if (!ADMIN_KEY) console.warn('[warn] ADMIN_KEY not set — admin endpoints will reject all requests.');

// ---------- database ----------
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,            -- google sub
    name TEXT UNIQUE,
    email TEXT,
    profile TEXT NOT NULL,          -- full game profile JSON
    merit_life INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    best_streak INTEGER DEFAULT 0,
    rank TEXT DEFAULT '',
    updated_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS weekly (
    week TEXT, player_id TEXT, name TEXT, time INTEGER,
    PRIMARY KEY (week, player_id)
  );
  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY, value TEXT
  );
`);

// ---------- tiny JWT (HS256, no dependency) ----------
const b64u = (buf) => Buffer.from(buf).toString('base64url');
function signToken(payload, days = 30) {
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ ...payload, exp: Date.now() + days * 864e5 }));
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(header + '.' + body).digest('base64url');
  return `${header}.${body}.${sig}`;
}
function verifyToken(token) {
  try {
    const [h, b, sig] = token.split('.');
    const good = crypto.createHmac('sha256', JWT_SECRET).update(h + '.' + b).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
    const payload = JSON.parse(Buffer.from(b, 'base64url').toString());
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch (e) { return null; }
}

// ---------- app ----------
const app = express();
app.use(express.json({ limit: '256kb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

function auth(req, res, next) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  const payload = m && verifyToken(m[1]);
  if (!payload) return res.status(401).json({ error: 'unauthorized' });
  req.playerId = payload.sub;
  next();
}
function adminAuth(req, res, next) {
  if (!ADMIN_KEY || req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(401).json({ error: 'unauthorized' });
  next();
}
function weekKey() {
  const d = new Date(), j = new Date(d.getFullYear(), 0, 1);
  const w = Math.ceil((((d - j) / 864e5) + j.getDay() + 1) / 7);
  return d.getFullYear() + '-W' + String(w).padStart(2, '0');
}
function summarize(profileObj) {
  return {
    merit_life: profileObj.meritLife ?? profileObj.merit ?? 0,
    wins: profileObj.wins || 0,
    best_streak: profileObj.bestStreak || 0,
    rank: profileObj.rank || '',
  };
}
function defaultProfile(name) {
  return {
    name, merit: 0, meritLife: 0, wins: 0, losses: 0, streak: 0, bestStreak: 0,
    campaigns: { shu: { lvl: 1, stars: {} }, wei: { lvl: 1, stars: {} }, wu: { lvl: 1, stars: {} } },
    stars: {}, kingdom: 'shu', general: 'liubei', heroXp: {},
    upg: { recruit: 0, logi: 0, armory: 0, fort: 0 },
    settings: { music: true, sfx: true, track: 'auto', speed: 1 },
    lastDay: '', days: 0,
  };
}

// ---------- public config ----------
app.get('/api/config', (req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID });
});

// ---------- auth: verify a Google ID token, create/load player ----------
app.post('/api/auth/google', async (req, res) => {
  try {
    if (!googleClient) return res.status(500).json({ error: 'google not configured' });
    const { credential } = req.body || {};
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();               // verified server-side — cannot be spoofed
    const id = p.sub;
    let row = db.prepare('SELECT * FROM players WHERE id=?').get(id);
    if (!row) {
      // derive a unique commander name from the Google display name
      let base = (p.name || 'Commander').replace(/[^\w\- ]/g, '').slice(0, 14) || 'Commander';
      let name = base, n = 1;
      while (db.prepare('SELECT 1 FROM players WHERE name=?').get(name)) name = base + (++n);
      const prof = defaultProfile(name);
      db.prepare(`INSERT INTO players (id,name,email,profile,merit_life,wins,best_streak,rank,updated_at)
                  VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(id, name, p.email || '', JSON.stringify(prof), 0, 0, 0, '', Date.now());
      row = db.prepare('SELECT * FROM players WHERE id=?').get(id);
    }
    const token = signToken({ sub: id });
    res.json({ token, profile: JSON.parse(row.profile) });
  } catch (e) {
    res.status(401).json({ error: 'invalid google credential' });
  }
});

// ---------- profile sync ----------
app.get('/api/profile', auth, (req, res) => {
  const row = db.prepare('SELECT profile FROM players WHERE id=?').get(req.playerId);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json({ profile: JSON.parse(row.profile) });
});
app.put('/api/profile', auth, (req, res) => {
  const { profile } = req.body || {};
  if (!profile || typeof profile !== 'object') return res.status(400).json({ error: 'bad profile' });
  const row = db.prepare('SELECT name, profile FROM players WHERE id=?').get(req.playerId);
  if (!row) return res.status(404).json({ error: 'not found' });
  const old = JSON.parse(row.profile);
  // anti-cheat guardrail: lifetime merit and wins may only grow, and by sane increments
  const s = summarize(profile), so = summarize(old);
  if (s.merit_life < so.merit_life || s.merit_life - so.merit_life > 5000) s.merit_life = so.merit_life;
  if (s.wins < so.wins || s.wins - so.wins > 50) s.wins = so.wins;
  profile.name = row.name; // name changes go through support, not the client
  profile.meritLife = s.merit_life;
  db.prepare(`UPDATE players SET profile=?, merit_life=?, wins=?, best_streak=?, rank=?, updated_at=? WHERE id=?`)
    .run(JSON.stringify(profile), s.merit_life, s.wins, s.best_streak, s.rank, Date.now(), req.playerId);
  res.json({ ok: true });
});

// ---------- leaderboards ----------
app.get('/api/leaderboard', (req, res) => {
  const top = db.prepare('SELECT name, merit_life AS merit, wins, best_streak AS best, rank FROM players ORDER BY merit_life DESC LIMIT 25').all();
  const wk = weekKey();
  const weekly = db.prepare('SELECT name, time FROM weekly WHERE week=? ORDER BY time ASC LIMIT 5').all(wk);
  res.json({ top, weekly, week: wk });
});
app.post('/api/weekly', auth, (req, res) => {
  const { time } = req.body || {};
  if (!Number.isFinite(time) || time < 5 || time > 3600) return res.status(400).json({ error: 'bad time' });
  const row = db.prepare('SELECT name FROM players WHERE id=?').get(req.playerId);
  const wk = weekKey();
  const cur = db.prepare('SELECT time FROM weekly WHERE week=? AND player_id=?').get(wk, req.playerId);
  if (!cur || time < cur.time) {
    db.prepare('INSERT INTO weekly (week,player_id,name,time) VALUES (?,?,?,?) ON CONFLICT(week,player_id) DO UPDATE SET time=excluded.time')
      .run(wk, req.playerId, row.name, Math.round(time));
  }
  res.json({ ok: true });
});

// ---------- admin ----------
app.get('/api/admin/ping', adminAuth, (req, res) => res.json({ ok: true }));
app.get('/api/admin/players', adminAuth, (req, res) => {
  const players = db.prepare('SELECT name, email, merit_life AS meritLife, wins, updated_at FROM players ORDER BY merit_life DESC LIMIT 500')
    .all().map(p => ({ ...p, google: true }));
  res.json({ players });
});
app.post('/api/admin/clear-pin', adminAuth, (req, res) => {
  // (cloud accounts authenticate with Google, so there is no passcode;
  //  this endpoint exists for hybrid deployments that migrated local accounts)
  const { name } = req.body || {};
  const row = db.prepare('SELECT id, profile FROM players WHERE name=?').get(name);
  if (!row) return res.status(404).json({ error: 'not found' });
  const prof = JSON.parse(row.profile);
  delete prof.pinHash;
  db.prepare('UPDATE players SET profile=? WHERE id=?').run(JSON.stringify(prof), row.id);
  res.json({ ok: true });
});
app.get('/api/admin/adcfg', adminAuth, (req, res) => {
  const row = db.prepare("SELECT value FROM config WHERE key='adcfg'").get();
  res.json({ adcfg: row ? JSON.parse(row.value) : null });
});
app.put('/api/admin/adcfg', adminAuth, (req, res) => {
  db.prepare("INSERT INTO config (key,value) VALUES ('adcfg',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(JSON.stringify(req.body.adcfg || {}));
  res.json({ ok: true });
});
app.get('/api/adcfg', (req, res) => {  // game clients read the shared ad/difficulty config here
  const row = db.prepare("SELECT value FROM config WHERE key='adcfg'").get();
  res.json({ adcfg: row ? JSON.parse(row.value) : null });
});
app.post('/api/admin/reset-leaderboard', adminAuth, (req, res) => {
  db.prepare('UPDATE players SET merit_life=0, wins=0, best_streak=0').run();
  db.prepare('DELETE FROM weekly').run();
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`TK Conquest backend listening on :${PORT}`));
