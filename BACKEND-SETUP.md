# Three Kingdoms: Conquest — Backend Setup Guide
### Google Sign-In · Cloud saves · True cross-device leaderboard

The game works fully offline, but with this backend deployed you get: players sign in with Google (server-verified, unhijackable), progress that follows them across every device, one real global leaderboard, and cheat guardrails.

---

## 1. Architecture at a glance

```
 game (three-kingdoms-conquest.html)      admin console (admin.html)
        │  HTTPS/JSON                            │  X-Admin-Key
        ▼                                        ▼
 ┌──────────────────────── server/server.js ────────────────────────┐
 │  POST /api/auth/google   verify Google ID token → session (JWT)  │
 │  GET/PUT /api/profile    load/save the player's full profile     │
 │  GET  /api/leaderboard   top-25 lifetime merit + weekly top-5    │
 │  POST /api/weekly        submit weekly-challenge time            │
 │  GET  /api/adcfg         shared ad/music/difficulty config       │
 │  /api/admin/*            players list, clear pin, adcfg, resets  │
 └──────────────────┬───────────────────────────────────────────────┘
                    ▼
              data.sqlite  (players, weekly, config tables)
```

Security model: the client never proves identity itself. Google issues an ID token, the **server** verifies it against Google's keys (`google-auth-library`), then issues its own 30-day session token (HMAC-signed JWT). Profile writes have guardrails: lifetime merit and wins can only increase, and only by sane per-save increments.

---

## 2. Create the Google OAuth client (5 minutes)

1. Go to **console.cloud.google.com** → create (or pick) a project.
2. *APIs & Services → OAuth consent screen*: External, app name "Three Kingdoms Conquest", add your email. Publish.
3. *APIs & Services → Credentials → Create credentials → OAuth client ID*:
   - Application type: **Web application**
   - **Authorized JavaScript origins**: the exact origin(s) where the game is served, e.g. `https://game.yourdomain.com` (and `http://localhost:8080` for testing).
4. Copy the **Client ID** (ends in `.apps.googleusercontent.com`).

> Google Sign-In requires the game to be served over **https** from a real origin (localhost is allowed for testing). It will not work from a `file://` double-clicked page — that's why the game keeps the local name/passcode mode as a fallback.

---

## 3. Deploy the server

Works on any Node 18+ host: a $5 VPS, Render, Railway, Fly.io, etc.

```bash
cd server
npm install
GOOGLE_CLIENT_ID="xxxxx.apps.googleusercontent.com" \
ADMIN_KEY="choose-a-long-random-string" \
JWT_SECRET="another-long-random-string" \
ALLOW_ORIGIN="https://game.yourdomain.com" \
node server.js            # listens on :8787 (override with PORT=)
```

Environment variables:

| Var | Required | Purpose |
|---|---|---|
| `GOOGLE_CLIENT_ID` | yes | The OAuth client ID from step 2 |
| `ADMIN_KEY` | yes | Secret the admin console sends in `X-Admin-Key` |
| `JWT_SECRET` | recommended | Session signing key (random if unset — sessions reset on restart) |
| `ALLOW_ORIGIN` | recommended | CORS lockdown to your game's domain |
| `PORT` / `DB_PATH` | optional | Defaults `8787` / `./data.sqlite` |

Put it behind HTTPS (Caddy, nginx + certbot, or your PaaS does it automatically).

**Backup** = copy `data.sqlite` (it's the whole database: players, weekly boards, shared config).

---

## 4. Wire the game and the admin console

1. Open `three-kingdoms-conquest.html`, find the config block at the top of the script:
   ```js
   const BACKEND_URL = '';   →   const BACKEND_URL = 'https://api.yourdomain.com';
   ```
2. Host the game file on the origin you registered in step 2. Two cross-device paths now exist:
   - **Name + passcode (no Google setup needed):** with `BACKEND_URL` set, the normal "Enter the Realm" login creates/verifies the account **on the server** — the same name + passcode works from any laptop, phone, or browser, always resuming the same save. A passcode (4+ chars) is required so accounts can't be hijacked.
   - **Google sign-in:** appears as a button once `GOOGLE_CLIENT_ID` is configured; same cross-device behavior with Google identity.
   The game also **fetches the shared admin config (`/api/adcfg`) live** at boot and whenever the sound settings open — so ads, music, difficulty, and special-city settings saved in the Admin Console (server mode) reach every player on every device without redeploying anything. If the server is unreachable, the game gracefully falls back to the local browser save.
3. Open `admin.html`, choose **Connect to server**, enter your backend URL and `ADMIN_KEY`. You can now manage ads, music, difficulty, and players for the live deployment. (The **Unlock local mode** path still manages a same-origin static deployment without a backend.)

---

## 5. API quick reference

| Endpoint | Auth | Body / Returns |
|---|---|---|
| `GET /api/config` | — | `{googleClientId}` |
| `POST /api/auth/google` | — | `{credential}` → `{token, profile}` |
| `POST /api/auth/local` | — | `{name, pin}` → `{token, profile}` — name+passcode account, no Google needed |
| `GET /api/profile` | Bearer | `{profile}` |
| `PUT /api/profile` | Bearer | `{profile}` → `{ok}` (guardrails applied) |
| `GET /api/leaderboard` | — | `{top:[{name,merit,wins,best,rank}], weekly:[{name,time}], week}` |
| `POST /api/weekly` | Bearer | `{time}` → `{ok}` (keeps the best) |
| `GET /api/adcfg` | — | `{adcfg}` shared ad/music/difficulty config |
| `GET /api/admin/ping` | X-Admin-Key | `{ok}` |
| `GET /api/admin/players` | X-Admin-Key | `{players:[…]}` |
| `POST /api/admin/clear-pin` | X-Admin-Key | `{name}` → `{ok}` |
| `GET/PUT /api/admin/adcfg` | X-Admin-Key | shared config read/write |
| `POST /api/admin/reset-leaderboard` | X-Admin-Key | zeroes merit/wins, clears weekly |

---

## 6. Roadmap ideas the schema already supports

- **Live PvP**: add a WebSocket layer (`ws` package) with a match table; both clients send orders, the server simulates the battle authoritatively. The deterministic engine (seeded maps, fixed tick) was written with this in mind.
- **Seasons**: snapshot `players.merit_life` monthly into a `seasons` table; reward top ranks with exclusive badges.
- **Cross-device ad config**: the game can be extended to fetch `/api/adcfg` at boot so admin changes propagate instantly to all devices.
