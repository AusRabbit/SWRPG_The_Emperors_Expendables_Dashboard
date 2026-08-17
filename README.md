# The Emperor's Expendables — Live Dashboard

The player- and GM-facing dashboard for *The Emperor's Expendables*, a Star
Wars FFG (Edge of the Empire / Age of Rebellion / Force and Destiny) group
campaign. It's a full campaign companion, not just a stat board: character
sheets, a shared dice roller with real FFG dice mechanics, a live combat
tracker, and a couple of small GM utilities, all kept in sync across
everyone's browser during a session.

Current party: **Eleena Daru**, **Kenno**, **Vesh Talorr**.

## What it does

- **Character tab** — one full sheet per PC: portrait, Motivation &
  Obligation, live initiative tracker, Destiny Pool, Wounds/Strain/Soak,
  XP, Credits, Critical Injuries (static + live-tracked), Weapons, Armor,
  Characteristics, Skills, Talents, Inventory, and a note box to send the
  GM a message. Clicking a skill or weapon jumps straight to the Dice
  Roller preloaded with the right dice.
- **Party tab** — a side-by-side skill comparison table for the whole
  party, plus the live initiative tracker and shared Destiny Pool.
- **Dice Roller tab** — build an FFG dice pool (Ability/Proficiency/Boost/
  Difficulty/Challenge/Setback/Force), pick a difficulty or maneuver
  preset, upgrade or downgrade dice (RAW-correct: once you're out of base
  dice to upgrade, it adds one instead of doing nothing, and the undo
  button can unwind that exact sequence), and roll. Results are computed
  client-side from the real FFG face tables and posted to a **shared roll
  log** everyone at the table sees within a couple of seconds, tagged with
  any weapon Special text if the roll was loaded from a weapon. Click a
  log entry to copy it to your clipboard.
- **NPC Summary** and **Locations** tabs — quick player-facing reference
  lists, no secrets.
- **GM Notes** tab — a private inbox of notes players have sent from
  their character tab (e.g. "I'd like to spend XP on X").
- **Live initiative tracker** — a row of PC (blue) / NPC (red) boxes
  showing turn order; spent seats darken to a tinted version of their own
  color rather than going flat grey, and the current seat pulses gently.
  Shown on the Party tab, the Dice Roller tab, and every character tab.

## Data model

Two files, two different update rhythms:

- **`public/data/ledger.json`** — the static, GM-authored source of truth
  for character sheets: names, characteristics, skills, talents, weapons,
  armor, inventory, consolidated Critical Injuries, NPCs, locations. Only
  changes when the GM edits it directly (typically once per session, at
  consolidation).
- **`data/live.json`** — the small set of values that change *during*
  play, updated by the GM (or the GM's chat assistant) mid-session and
  polled by every browser automatically:

  ```json
  {
    "destiny": { "light": 0, "dark": 0 },
    "wounds": { "eleena": 0, "kenno": 0, "vesh": 0 },
    "strain": { "eleena": 0, "kenno": 0, "vesh": 0 },
    "criticalInjuries": { "eleena": [], "kenno": [], "vesh": [] },
    "initiative": { "order": [], "taken": 0 }
  }
  ```

  - `wounds` / `strain` — current values, keyed by each character's
    `liveId` (set on that character in ledger.json). Thresholds stay in
    ledger.json.
  - `destiny` — the shared party Destiny Pool.
  - `criticalInjuries` — Table 6-10 result numbers only (e.g. `[30, 66]`),
    one array per character. Rolled live during a scene, before they've
    been written up properly in the ledger. The dashboard resolves each
    number to its name via a built-in lookup table and shows it with a
    small live-indicator dot alongside whatever's already consolidated in
    ledger.json. Purely additive — never touches ledger.json.
  - `initiative` — combat order. **Always present**, even outside combat:
    `order` is the fixed PC/NPC seat sequence for the encounter (empty
    when there's no active fight), `taken` is how many seats from the
    front have acted this round. The dashboard hides the tracker
    automatically whenever `order` is empty — there's no separate field
    to add or remove, just values to fill in and clear back out.

Edit `data/live.json` directly on GitHub (or via whatever tool/chat
session is running the game) — no build or redeploy needed, the page
picks up the change on its next poll.

## Architecture

This deploys as a single **Cloudflare Worker with static assets** (not
Cloudflare Pages) — see `worker/index.js` and `wrangler.jsonc`. The Worker
handles three custom routes and falls back to serving the built React app
for everything else:

- **`GET /live`** — proxies `data/live.json` from this repo via the
  authenticated GitHub Contents API (not raw.githubusercontent.com, which
  is CDN-cached and can lag), edge-cached for `CACHE_SECONDS` (currently
  3s) so rapid polling from multiple players doesn't multiply GitHub API
  calls. Requires a `GITHUB_TOKEN` secret (Settings → Variables and
  Secrets) — the API is authenticated specifically so it isn't subject to
  the 60/hr unauthenticated rate limit.
- **`GET/POST/DELETE /rolls`** — the shared dice-roll log, backed by a
  **Durable Object** (`RollLog`) rather than KV, so writes from multiple
  players posting at once are serialized (no lost rolls) and reads are
  strongly consistent (no propagation lag). Never touches `live.json` or
  `ledger.json`.
- **`GET/POST /notes`** — the GM notes inbox, same pattern, backed by a
  second Durable Object (`NotesLog`).

Both Durable Objects run on Cloudflare's SQLite storage backend
(`new_sqlite_classes` in `wrangler.jsonc`'s `migrations`), which is
available on the Workers **Free** plan — no paid tier or KV namespace
required.

The client polls `/live` every 3 seconds (`LIVE_POLL_MS` in `src/App.jsx`)
and `/rolls` every 1.5 seconds while the Dice Roller tab is open.

## Local dev

```
npm install
npm run dev
```

## Deploy

```
npm run build
npx wrangler deploy
```

Or connect the repo in the Cloudflare dashboard (Workers & Pages → Create
→ Connect GitHub) for automatic deploys on push. Either way, set the
`GITHUB_TOKEN` secret once (a GitHub personal access token with `repo`
read access to this repository) — without it, `/live` returns a 500.

Redeploys are only needed when the app's *code* changes. Updating
`ledger.json` or `live.json` never requires one — both are read live from
GitHub at request time, not bundled into the build.
