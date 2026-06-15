// Frontend config. These values are PUBLIC and safe to commit/ship:
// the anon key is read-only because of Row Level Security (see supabase/schema.sql).
//
// Leave SUPABASE_URL empty to run in LOCAL DEMO mode (seed data + your browser's
// localStorage, no backend needed — great for trying the tool offline).
// Fill both in to point at a real Supabase project.
export const CONFIG = {
  SUPABASE_URL: 'https://adivpzuiwuscvtziiptu.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_0Q5HMBKvLVoU2Cwpb-cRvA_1OxIg3_p',  // public-safe (read-only via RLS)

  // Where the password-gated write function lives (Netlify).
  SAVE_ENDPOINT: '/.netlify/functions/save-change',

  // LOCAL DEMO ONLY: unlocks editing when running with no backend. This is NOT a
  // secret — it ships in the browser, so keep it a throwaway value (don't reuse the
  // real one here, especially in a public repo).
  // In LIVE mode this is ignored — the real password is the EDIT_PASSWORD env var
  // on Netlify, checked server-side and never shipped to the browser.
  DEMO_PASSWORD: 'demo',
};

export const IS_LIVE = Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
