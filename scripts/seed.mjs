// One-time import of the seed data into a live Supabase project.
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed.mjs
// Run AFTER applying supabase/schema.sql. Idempotent for departments (upsert);
// inserts events fresh (run against an empty `events` table).
import { createClient } from '@supabase/supabase-js';
import { SEED_DEPARTMENTS, SEED_EVENTS } from '../public/data/seed.js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { error: dErr } = await sb.from('departments').upsert(SEED_DEPARTMENTS);
if (dErr) { console.error('departments:', dErr.message); process.exit(1); }
console.log(`✓ ${SEED_DEPARTMENTS.length} departments`);

// Strip the local string ids so Postgres generates real uuids.
const rows = SEED_EVENTS.map(({ id, ...rest }) => rest);
const { error: eErr } = await sb.from('events').insert(rows);
if (eErr) { console.error('events:', eErr.message); process.exit(1); }
console.log(`✓ ${rows.length} events`);
console.log('Seed complete.');
