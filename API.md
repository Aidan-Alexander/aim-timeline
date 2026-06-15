# AIM Timeline — API (drive the timeline from Claude Code)

Tell Claude Code things like:

> Using API.md, add "Board retreat" to the Ops lane from 3–7 March 2027 (major).
> Using API.md, move "AIM Connect" in AIM General to the week of 15 June 2026.
> Using API.md, what's on the Recruitment lane in Q3?

Claude reads this file, looks up the department, formats the dates, and calls the
API below. **Editing needs the shared edit password** (see "Auth").

---

## Setup (once)

1. **Site URL** — replace every `https://YOUR-SITE.netlify.app` below with your live
   Netlify URL. (Reads don't need it; only writes do.)
2. **Password** — put the shared edit password in your shell so it's never typed in
   plaintext or saved to history/files:
   ```bash
   export AIM_EDIT_PASSWORD='the-shared-password'
   ```
   The write examples read it via `$AIM_EDIT_PASSWORD`.
3. **Your name** — replace `YOUR NAME` in writes; it's recorded against every change
   in the History panel.

---

## Auth

- **Reads** are public (no password). They use the publishable key (safe to share):
  - `apikey` + `Authorization: Bearer` headers = `sb_publishable_0Q5HMBKvLVoU2Cwpb-cRvA_1OxIg3_p`
- **Writes** go through the password-gated function. Every write body must include
  `name` and `password`. A bad password returns `{"error":"Wrong edit password."}`.

---

## Data model

**events**: `id` (uuid), `department_id` (int), `title`, `start_date` (YYYY-MM-DD),
`end_date` (YYYY-MM-DD), `color` (hex like `#3F9D57`, or null = use lane colour),
`note`, `importance` (`major` | `minor`), `wrap` (bool), `locked` (bool — confirm
before date changes).

**departments**: `id` (int), `name`, `color` (hex), `sort_order` (int), `hidden` (bool).

---

## Read

Resolve department names → ids (do this first for any write):
```bash
curl -s 'https://adivpzuiwuscvtziiptu.supabase.co/rest/v1/departments?select=id,name,hidden&order=sort_order' \
  -H "apikey: sb_publishable_0Q5HMBKvLVoU2Cwpb-cRvA_1OxIg3_p" \
  -H "Authorization: Bearer sb_publishable_0Q5HMBKvLVoU2Cwpb-cRvA_1OxIg3_p"
```

List events (optionally filter), e.g. all events for department 2, soonest first:
```bash
curl -s 'https://adivpzuiwuscvtziiptu.supabase.co/rest/v1/events?select=*&department_id=eq.2&order=start_date' \
  -H "apikey: sb_publishable_0Q5HMBKvLVoU2Cwpb-cRvA_1OxIg3_p" \
  -H "Authorization: Bearer sb_publishable_0Q5HMBKvLVoU2Cwpb-cRvA_1OxIg3_p"
```
Find one event by title (URL-encode spaces as `%20`): append `&title=eq.Board%20retreat`.

Recent changes (the audit log):
```bash
curl -s 'https://adivpzuiwuscvtziiptu.supabase.co/rest/v1/audit_log?select=ts,actor,action,title,field,old_value,new_value&order=ts.desc&limit=20' \
  -H "apikey: sb_publishable_0Q5HMBKvLVoU2Cwpb-cRvA_1OxIg3_p" \
  -H "Authorization: Bearer sb_publishable_0Q5HMBKvLVoU2Cwpb-cRvA_1OxIg3_p"
```

---

## Write

All writes: `POST https://YOUR-SITE.netlify.app/.netlify/functions/save-change`
with `content-type: application/json`. Success → `{"ok":true,...}`.

### Add an event
```bash
curl -s -X POST 'https://YOUR-SITE.netlify.app/.netlify/functions/save-change' \
  -H 'content-type: application/json' \
  -d '{
    "name": "YOUR NAME",
    "password": "'"$AIM_EDIT_PASSWORD"'",
    "entity": "event",
    "action": "upsert",
    "payload": {
      "department_id": 7,
      "title": "Board retreat",
      "start_date": "2027-03-03",
      "end_date": "2027-03-07",
      "importance": "major"
    }
  }'
```
Optional `payload` fields: `note`, `color` (omit/null = lane colour), `importance`
(`major` default | `minor`), `wrap` (bool), `locked` (bool).

### Edit an event — IMPORTANT: send the FULL event
An update overwrites every field from `payload`, so **omitted fields get cleared**.
Always GET the event first, change what you want, and send back all fields plus its `id`:
```bash
# 1) fetch it (note the id), then 2) POST the complete object back:
curl -s -X POST 'https://YOUR-SITE.netlify.app/.netlify/functions/save-change' \
  -H 'content-type: application/json' \
  -d '{
    "name": "YOUR NAME",
    "password": "'"$AIM_EDIT_PASSWORD"'",
    "entity": "event",
    "action": "upsert",
    "payload": {
      "id": "PASTE-EVENT-UUID",
      "department_id": 8,
      "title": "AIM Connect",
      "start_date": "2026-06-15",
      "end_date": "2026-06-22",
      "color": null,
      "note": "",
      "importance": "major",
      "wrap": false,
      "locked": false
    }
  }'
```

### Delete an event
```bash
curl -s -X POST 'https://YOUR-SITE.netlify.app/.netlify/functions/save-change' \
  -H 'content-type: application/json' \
  -d '{"name":"YOUR NAME","password":"'"$AIM_EDIT_PASSWORD"'","entity":"event","action":"delete","id":"PASTE-EVENT-UUID"}'
```

### Departments
Same shape with `"entity":"department"`.
- **Add**: `payload` = `{ "name": "Comms", "color": "#0aa5a5" }` (id auto-assigned).
- **Edit / hide / show**: send the full department object (id + name + color +
  sort_order + hidden), e.g. to hide: `payload` = `{ "id": 3, "name": "Foundation Program", "color": "#2E7D32", "sort_order": 3, "hidden": true }`.
- **Delete**: `{ "entity":"department", "action":"delete", "id": 3 }` — this also
  deletes that department's events (cascade).

---

## Tips for Claude

- Convert natural dates to `YYYY-MM-DD` (e.g. "3 March 2027" → `2027-03-03`). If a
  duration is given ("a 2-week retreat from 3 Mar"), compute the end date.
- Always resolve department names to `department_id` via the departments read first.
- For edits, fetch the event and merge — never send a partial payload.
- After a write, optionally re-read to confirm, and report back what changed.
- If the function returns `{"error":"Wrong edit password."}`, the user needs to set
  `AIM_EDIT_PASSWORD` correctly.
