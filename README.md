# AIM Timeline

A web replacement for the "AIM - Timeline" Gantt spreadsheet: a swimlane timeline
of big-picture, org-wide events with an **automatic, attributed change log**.

- **View:** open the link — no login.
- **Edit:** unlock with a shared password + your name. Your name is recorded against
  every change.
- **Change log:** every add / move / edit / delete is logged (who, what, when) and
  shown in the History panel.

## Two ways to run

### 1. Local demo mode (no backend) — try it now
`public/config.js` ships with empty Supabase values, so the app runs entirely on
seed data + your browser's `localStorage`. Editing and the change log work fully;
changes persist in your browser only.

```bash
cd aim-timeline
npx serve public          # or: python3 -m http.server -d public 8000
```
Open the printed URL. In demo mode any password unlocks editing.

### 2. Live mode (shared, real backend)
1. **Supabase** → create a free project → SQL editor → paste & run
   [`supabase/schema.sql`](supabase/schema.sql). This creates the tables, the
   change-log trigger, the write RPCs, and Row Level Security (anon = read-only).
2. **Seed it** with the current timeline:
   ```bash
   npm install
   SUPABASE_URL=https://xxxx.supabase.co \
   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
   npm run seed
   ```
3. **Frontend** → edit [`public/config.js`](public/config.js) and fill in
   `SUPABASE_URL` + `SUPABASE_ANON_KEY` (Settings → API). These are public-safe.
4. **Netlify** → connect this repo (or drag-drop). Set environment variables
   (Site settings → Environment):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`  ← secret; powers the write function only
   - `EDIT_PASSWORD`              ← the shared editing password (rotate any time)
5. Deploy. Share the URL. Editors enter the password + their name once per session.

Local live testing: `npm install && npm run dev` (Netlify CLI) serves the site and
the function together at http://localhost:8888.

## Why writes go through a function
The anon key in `config.js` is safe to publish because RLS only lets it **read**.
All writes go through `netlify/functions/save-change.js`, which holds the edit
password and the privileged service-role key (never shipped to the browser). That
makes the password a real gate, and the self-entered name in the log can't be
forged from the browser console.

## Files
- `public/` — the static site (deployed by Netlify)
  - `index.html`, `style.css`
  - `app.js` — renderer (day-based axis, lane packing), drag-edit, tooltips, history
  - `store.js` — data layer (local demo ↔ Supabase)
  - `config.js` — backend config (edit this for live mode)
  - `data/seed.js` — seed timeline (single source of truth for seeding)
- `netlify/functions/save-change.js` — password-gated write gateway
- `supabase/schema.sql` — tables, change-log trigger, write RPCs, RLS
- `scripts/seed.mjs` — one-time import of seed data into Supabase
- `netlify.toml`, `package.json`

## Features
- Swimlane timeline on a day-based axis (fractional bars, week/month gridlines, a
  darker line at each month, "today" marker, week/month zoom).
- Per-lane row packing: non-overlapping events share a row, clashes spill down.
- Major / minor importance (major = full colour + light text, auto-darkened if the
  colour is light; minor = lighter shade + dark text). Optional per-event title wrap.
- Hover tooltips (full title, exact dates, note).
- Add / edit / delete / drag-move / drag-resize events; add / edit / delete
  departments (delete confirms and cascades to the department's events).
- **Show / hide departments** — a shared setting stored on the department (everyone
  sees the same board). Toggle from the Departments button or the small "hide" link
  on a lane label; changing it needs editing unlocked, like any shared change.
- **Undo** the last 10 actions (each undo is itself recorded in the change log).
- Calendar runs one year past the last event; that span is shaded "Not yet mapped".
- Full change log (who/what/when), filterable.

## Notes / future
- Concurrency is last-write-wins with the audit log as the safety net; Supabase
  Realtime can be added to live-refresh the board for simultaneous editors.
- Seed dates are Monday-aligned estimates transcribed from the original sheet.
  Fine-tune in the edit panel, or re-import precisely from the live sheet.
- Undo is per browser session (in-memory); the change log is the durable record.
- Easy follow-ups: PNG/PDF export, threaded comments, milestone markers, a public
  read-only token link, and an "as-of-date" time machine that replays the audit log.
