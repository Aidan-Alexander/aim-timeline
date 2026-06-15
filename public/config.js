// Frontend config. These values are PUBLIC and safe to commit/ship:
// the anon key is read-only because of Row Level Security (see supabase/schema.sql).
//
// Leave SUPABASE_URL empty to run in LOCAL DEMO mode (seed data + your browser's
// localStorage, no backend needed — great for trying the tool offline).
// Fill both in to point at a real Supabase project.
export const CONFIG = {
  SUPABASE_URL: '',        // e.g. 'https://xxxx.supabase.co'
  SUPABASE_ANON_KEY: '',   // the public anon key

  // Where the password-gated write function lives (Netlify).
  SAVE_ENDPOINT: '/.netlify/functions/save-change',

  // LOCAL DEMO ONLY: the password that unlocks editing when there's no backend.
  // In LIVE mode this value is ignored — the real password is the EDIT_PASSWORD
  // environment variable on Netlify (set it to the same value), checked server-side
  // and never shipped to the browser.
  DEMO_PASSWORD: 'evafanclub',
};

export const IS_LIVE = Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
