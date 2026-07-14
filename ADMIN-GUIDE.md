# Three Kingdoms: Conquest — Administration & Maintenance Guide

Everything in the game (code, story text, portraits, music) is original work generated for you, so you can host, modify, and monetize it freely.

---

## 1. Hosting & distribution

The entire game is one file: `three-kingdoms-conquest.html`.

- **Play locally:** double-click the file — it runs in any modern browser (Chrome, Edge, Safari, Firefox), desktop or mobile.
- **Host publicly:** upload the single file to any static host (Netlify, Vercel, GitHub Pages, S3, or any web server). No build step, no dependencies, no backend required.
- **Updating:** replace the file. Player progress is stored in each player's browser (see §6), so updates don't wipe saves as long as players use the same browser.

---

## 2. Admin console (separate file: `admin.html`)

Administration now lives in its **own file**, completely separate from the player game — players never see an admin button.

- **Local mode:** serve `admin.html` from the same folder/domain as the game, open it, enter the PIN (default **`1234`**, change it in *Resets & security*). Manages the same browser storage the game uses.
- **Server mode:** enter your backend URL + `ADMIN_KEY` (see BACKEND-SETUP.md) to manage a live cloud deployment: ads, music, difficulty, and the full player table.
- **User state file:** local mode can **export all players & settings to a JSON file** (backup / migration) and re-import it — this is the "users & passwords file". Passcodes are stored as hashes, never plaintext.
- Every setting saved is **global** for that deployment.

### What you can control

| Section | Setting | Effect |
|---|---|---|
| Ad controls | Ads enabled (master) | Turns all advertising on/off |
| | Banner ads on menus | Bottom banner on menu screens |
| | Interstitial after every N battles | Frequency of full-screen ads |
| | Interstitial display time | Seconds before the Continue button unlocks |
| | Banner rotation interval | Seconds between banner rotations |
| | Default ad | Fallback ad when the rotation list is empty |
| Ad inventory | Add/remove ads | Title, text, optional image URL, optional click-through link |
| Music rotation | Add/remove track URLs | Adds your own MP3/OGG files to the music rotation |
| Game difficulty | −3 … +3 | Shifts every battle's tier for all players (see §4) |
| Special cities | 0 … 5 per map | Max Wonders (Great Beacon, Iron Mine, Twin Gates…) that can spawn; default 1, 0 disables |
| Player accounts | Clear passcode | Removes a player's login passcode so they can set a new one |
| Resets | Reset ads / leaderboard / player progress | Self-explanatory; leaderboard reset is irreversible |

**Remember to press “💾 Save ad settings”** — edits are not live until saved.

---

## 3. Adding music

The game ships with **5 built-in tracks** synthesized live in the browser (pentatonic, guzheng-style). Because the game composes them at runtime, they are royalty-free by construction.

To add your own tracks:

1. Find a **royalty-free** file you have the right to use. Good sources:
   - **Pixabay Music** — free for commercial use, no attribution required.
   - **incompetech.com** (Kevin MacLeod) — free under CC-BY; credit "Kevin MacLeod (incompetech.com)" somewhere in your game/site.
   - **Free Music Archive** — filter by CC0 or CC-BY licenses.
2. Host the MP3/OGG at a **direct https URL**. If the game is hosted on a domain, the audio file's server must allow cross-origin playback (most CDNs and same-domain hosting are fine). Easiest: put the MP3 in the same folder as the game file and use its relative-to-domain URL.
3. Admin console → **Music rotation** → enter a **track name** (this is exactly what players see in their "Music track" dropdown) and the URL → *＋ Add track* → **Save**. While any custom tracks exist, players hear ONLY those in rotation; delete them all and the game reverts to the built-in synthesized tracks.
4. Custom tracks appear in every player's *Music track* selector and in the auto-rotation. If a URL fails to load, the game silently skips it.

**Tip:** keep files under ~3 MB and loop-friendly (the game loops them automatically).

---

## 4. Difficulty system

- 200 campaign battles ramp across **10 tiers** (Recruit → Legend), roughly one tier every 19 battles; every 10th battle is a **boss** at +1 tier with a special ability.
- Tier controls four things: enemy recruit speed, AI decision rate, AI aggression, and the "grace period" before the AI targets the player.
- The admin **difficulty shifter (−3…+3)** adds to every battle's tier. If analytics/feedback show players quitting early, set −1 or −2. For a hardcore audience, go positive.
- Players who hit a wall have three sanctioned ladders: **War Council upgrades** (funded by merit — even losses pay +10), **hero XP** (perks grow +5%/level), and **duo bonds**.

---

## 4b. Cross-device play (players AND admin settings)

With the backend deployed and `BACKEND_URL` set in the game file (see BACKEND-SETUP.md):
- **Players:** the same commander name + passcode logs in from any device or browser and resumes the exact same save — accounts live on the server, not in the browser. Google sign-in is an optional second path.
- **Admin settings:** use the Admin Console in **server mode**; everything you save (ads, music, difficulty, special cities) is fetched live by every game client at boot and whenever the sound settings open.
Without a backend, saves remain per-browser (the honest limit of static hosting).

## 5. Player accounts & security

- Accounts are name-based. A player may set a **passcode** at login; it's stored as a SHA-256 hash, and the name can't be used without it.
- **Forgotten passcode:** Admin console → Players → type the name → *Clear passcode*.
- Honest limitation: this is client-side protection suitable for casual play. It stops name-squatting, but a technical user with access to the same browser/deployment storage could tamper. **True account security (e.g., Google Sign-In) requires hosting with a server**: register an OAuth client ID in Google Cloud Console, verify ID tokens server-side, and store profiles in a database. The current storage layer was written so a backend can replace it by swapping the four functions in the `store` object.

---

## 6. How data is stored (backup & reset)

The game writes through a three-layer cascade — first available layer wins on read:

1. **Claude artifact storage** (when played inside Claude) — persists per user; "shared:true" keys (leaderboard, ad config, weekly boards, admin PIN) are visible to all players.
2. **Browser localStorage** (when self-hosted / opened locally) — keys are prefixed `tk3k_`. `tk3k_P:` = per-browser player data, `tk3k_S:` = shared-style data (on a static host these are per-browser too; a real shared leaderboard across devices needs a backend).
3. **In-memory** — fallback for the current session only.

Key inventory:

| Key | Contents |
|---|---|
| `player:<name>` | Full profile: merit, lifetime merit, campaign progress, stars, hero XP, upgrades, badges, settings, passcode hash |
| `leaderboard` (shared) | Name → lifetime merit, wins, best streak, rank |
| `weekly:<year-Wnn>` (shared) | Name → fastest weekly-challenge clear (seconds) |
| `adcfg` (shared) | All ad settings, music URLs, difficulty shift |
| `adminpin` (shared) | Admin PIN |
| `lastUser` | Last login name (convenience) |

**Backup:** in the browser DevTools console, run
`copy(JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('tk3k_')))))`
then paste into a file. **Restore** by looping the object back into `localStorage.setItem`.

---

## 7. Monetization notes

- **Banner slot:** bottom of all menu screens; rotates through your ad inventory on the interval you set.
- **Interstitial slot:** between battles, frequency- and duration-controlled; the Continue button unlocks after the countdown.
- Replace the placeholder ads with real inventory via the admin panel. If you later join an ad network (e.g., a web games ad SDK), the two display containers to wire up in the code are `#ad-banner-card` and `#inter-content`.

---

## 8. Customization cheatsheet (edit the HTML directly)

| What | Where in the file |
|---|---|
| Story chapters (20) | `const CHAPTERS = [...]` |
| Per-battle flavor lines | `const FLAVOR = [...]` |
| Generals, perks, unlock costs, portraits | `const GENERALS = [...]` |
| Duo bonds | `const BONDS = [...]` |
| Boss faces & names | `const BOSSES` / `MINORS` |
| Boss abilities per chapter | `const CH_ABIL = [...]` |
| Badge definitions | `const BADGES = [...]` |
| Upgrade types & pricing | `const UPGRADES` / `upgCost()` |
| Built-in music | `AudioSys.tracks` (bpm, drums, base pitch, density) |
| Difficulty tuning | `setupAI()` (tier formulas) and `campaignLevel()` |
| Colors/theme | CSS `:root` variables at the top |

After any edit, just reload the page — no build step.

---

## 9. Troubleshooting

- **"My progress reset"** — the player switched browsers/devices (saves are per-browser without a backend), or used a different name spelling. Names are case-sensitive.
- **No music** — browsers require a user tap before audio can start (the game hooks the first tap). Check the player's Music toggle, then whether a custom track URL is failing (the game falls back to built-ins).
- **Custom ad image not showing** — the image URL must be https and publicly accessible.
- **Leaderboard empty on a new deployment** — expected; it populates as players win battles.

---

## 🧪 Test Lab (new)

The admin console now has a **Test Lab** card that opens the game in a new tab in **test mode**:

- Pick **Campaign** (any saga, any battle 1–200 — battle 200 shows the saga epilogue), **Skirmish** (opponents + map size), or the current **Weekly Challenge** map.
- Override the **difficulty tier** (1–10), **game speed** (0.5×–2×), **special-cities max** (0–5), and the **kingdom** you play as.
- The game runs a throwaway **"⚙ Test Pilot"** profile: **nothing is saved** — no merit, XP, unlocks, leaderboard, or weekly times — so you can test freely without polluting real player data. The battle HUD shows a `🧪 TEST` chip.
- Overrides are passed in the URL (`?test=1&saga=…&level=…&tier=…`), so they work even before you press 💾 Save. Everything else (music, ads, global difficulty) only reaches the test tab after saving, as usual.
- The game file must sit in the same folder as `admin.html`.

## 🎵 Music seeding fix (new)

Browsers that saved an ad-config **before** the 8 royalty-free MP3s were seeded carried an empty custom-music list, which silently shadowed the new defaults — players kept hearing the synthesized tracks. Both the game and the admin console now run a **one-time migration** (`musicSeedV`): an empty list from an old config is seeded with the 8 named tracks. Deleting all tracks **after** the migration is still respected and reverts players to the built-in synthesized music, exactly as documented.

## ⚡ Live Challenge / presence (new)

The **Rival Duel** screen now starts with a **Live Challenge** card: a dropdown of every commander active in the **last 2 minutes**, with a refresh button.

- **Local mode** (no backend): presence is shared through the browser's shared storage, so it covers players in *the same browser* (other tabs/sessions on this machine). Different browsers can't see each other without the backend — separate browsers have separate storage by design.
- **Server mode** (backend deployed): the server tracks `last_seen` on every authenticated request plus a 45-second heartbeat, and `GET /api/online` returns everyone active in the last 2 minutes — across all devices.
- Challenging an online commander battles their army under their banner, commanded by a hard AI, and pays rival-duel merit. True real-time head-to-head remains a future WebSocket feature (the seeded-map engine already supports it).

New backend endpoints: `POST /api/presence` (heartbeat), `GET /api/online` (public list). New column: `players.last_seen`.

## 👥 Multiple players on one computer (new login helper)

- **Same browser, different times:** fully supported. Each commander saves under their own key; the login screen now lists **"Commanders on this device"** so players tap their name to switch. Recommend every player sets a **passcode** so no one can open someone else's commander. (With the backend deployed, note the game auto-resumes the *last cloud session* — the ⎋ logout button switches accounts.)
- **Different browsers, same time:** also fine — browsers keep fully separate storage, so nothing collides. The only limitation is that in local mode each browser has its **own leaderboard**; they merge only once the backend is deployed (or via the admin Export/Import tools).

## 🏮 Saga epilogues (new)

Winning battle 200 of any saga now opens a full illustrated epilogue — an original SVG scene plus a four-paragraph ending unique to Shu, Wei, and Wu — before the normal victory panel. Once a saga is complete, a **"🏮 View the Saga Epilogue"** button appears on that saga's campaign screen to replay it anytime.

## 🌦 Weather & seasons (new graphics pass)

- **Seasons** cycle by chapter (spring → summer → autumn → winter): ground palette, tree foliage (blossoms, deep green, gold, snow-capped), and snow drifts change accordingly.
- **Live weather** is seeded per level and biased by season: rain, thunderstorms (with lightning flashes), snow, drifting blossom petals, falling leaves, and rolling fog. The battle HUD chip shows the weather icon. Weather animation is driven by battle time, so it pauses with the game.
- **New terrain set-pieces**: blossom trees, bamboo groves, paifang gates, stone lanterns, riverside fishing huts, and signal-beacon towers with smoke — mixed differently on every level.
