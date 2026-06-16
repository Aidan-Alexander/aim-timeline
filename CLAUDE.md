# AIM Timeline — notes for Claude Code

This repo is a web tool showing AIM's big-picture timeline (a swimlane Gantt),
replacing a spreadsheet. **Live site: https://aim-timeline.netlify.app**

## When the user wants to view or edit the timeline
**Read [`API.md`](API.md) and follow it.** It has the read endpoints and the
password-gated write API with copy-paste curl examples. Key rules:

- **Reads** are public (Supabase REST + the publishable key listed in API.md).
- **Writes** go to the Netlify function and need the shared **edit password**. Ask
  the user for it, or read it from `$AIM_EDIT_PASSWORD`. **Never** write the password
  into a file or commit it.
- Always resolve department **names → ids** first (GET /departments).
- Convert natural dates to `YYYY-MM-DD`; compute end dates from durations.
- For **edits**, GET the event first and send the *complete* object back (an update
  overwrites every field — omitted fields get cleared).
- After a change, re-read to confirm and tell the user what changed. Every write is
  logged in the History panel under the `name` you send.

A friendly way to start a session (no clone needed — Claude Code can WebFetch it):
> Read https://raw.githubusercontent.com/Aidan-Alexander/aim-timeline/master/API.md
> and help me edit the AIM timeline. I'll give you the edit password when needed.

## Working on the code itself
Vanilla JS frontend in `public/` (no build step), Supabase backend
(`supabase/schema.sql`), one Netlify function (`netlify/functions/save-change.js`).
Netlify auto-deploys from `master`. After changing `schema.sql`, the user must
re-run it in the Supabase SQL editor (it's idempotent — safe to re-run).
