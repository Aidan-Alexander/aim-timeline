// Data layer. Presents one interface to the app and swaps its backend based on
// config.js: LOCAL demo mode (seed + localStorage) or LIVE Supabase mode.
import { CONFIG, IS_LIVE } from './config.js';
import { SEED_DEPARTMENTS, SEED_EVENTS } from './data/seed.js';

const AUDIT_FIELDS = ['department_id', 'title', 'start_date', 'end_date', 'color', 'note', 'importance', 'wrap', 'locked'];
const DEPT_AUDIT_FIELDS = ['name', 'color', 'sort_order', 'hidden'];

// --------------------------------------------------------------------------
// LOCAL store — everything lives in localStorage; writes also append to a local
// audit log so the change-log feature is fully demonstrable offline.
// --------------------------------------------------------------------------
class LocalStore {
  constructor() {
    this.mode = 'local';
    if (!localStorage.getItem('aim_events')) this.reset();
  }
  reset() {
    localStorage.setItem('aim_departments', JSON.stringify(SEED_DEPARTMENTS));
    localStorage.setItem('aim_events', JSON.stringify(SEED_EVENTS));
    localStorage.setItem('aim_audit', JSON.stringify([]));
  }
  _get(k) { return JSON.parse(localStorage.getItem(k) || '[]'); }
  _set(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

  async departments() { return this._get('aim_departments').sort((a, b) => a.sort_order - b.sort_order); }
  async events()      { return this._get('aim_events'); }
  async audit()       { return this._get('aim_audit').sort((a, b) => b.ts.localeCompare(a.ts)); }

  _log(entry) {
    const log = this._get('aim_audit');
    log.push({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), ts: new Date().toISOString(), ...entry });
    this._set('aim_audit', log);
  }

  async saveEvent(payload, actor) {
    const events = this._get('aim_events');
    if (payload.id) {
      const i = events.findIndex(ev => ev.id === payload.id);
      if (i === -1) throw new Error('Event not found');
      const before = events[i];
      const after = { ...before, ...payload };
      for (const f of AUDIT_FIELDS) {
        if (String(before[f] ?? '') !== String(after[f] ?? '')) {
          this._log({ actor, action: 'update', record_id: after.id, title: after.title, field: f, old_value: before[f], new_value: after[f] });
        }
      }
      events[i] = after;
      this._set('aim_events', events);
      return after;
    }
    const created = { ...payload, id: (crypto.randomUUID?.() || 'local-' + Date.now()) };
    events.push(created);
    this._set('aim_events', events);
    this._log({ actor, action: 'insert', record_id: created.id, title: created.title, field: null, old_value: null, new_value: null });
    return created;
  }

  async deleteEvent(id, actor) {
    const events = this._get('aim_events');
    const ev = events.find(e => e.id === id);
    this._set('aim_events', events.filter(e => e.id !== id));
    this._log({ actor, action: 'delete', record_id: id, title: ev?.title, field: null, old_value: null, new_value: null });
  }

  async saveDepartment(payload, actor) {
    const depts = this._get('aim_departments');
    if (payload.id != null && payload.id !== '') {
      const i = depts.findIndex(d => String(d.id) === String(payload.id));
      if (i === -1) throw new Error('Department not found');
      const before = depts[i], after = { ...before, ...payload, id: before.id };
      for (const f of DEPT_AUDIT_FIELDS) {
        if (String(before[f] ?? '') !== String(after[f] ?? '')) {
          this._log({ actor, action: 'update', record_id: after.id, title: after.name, field: f, old_value: before[f], new_value: after[f] });
        }
      }
      depts[i] = after; this._set('aim_departments', depts);
      return after;
    }
    const id = depts.reduce((m, d) => Math.max(m, +d.id), 0) + 1;
    const sort_order = depts.reduce((m, d) => Math.max(m, +d.sort_order || 0), 0) + 1;
    const created = { id, name: payload.name, color: payload.color || '#888888', sort_order, hidden: payload.hidden || false };
    depts.push(created); this._set('aim_departments', depts);
    this._log({ actor, action: 'insert', record_id: id, title: created.name, field: null, old_value: null, new_value: null });
    return created;
  }

  async deleteDepartment(id, actor) {
    const depts = this._get('aim_departments');
    const dept = depts.find(d => String(d.id) === String(id));
    this._set('aim_departments', depts.filter(d => String(d.id) !== String(id)));
    // cascade: remove its events (mirrors Supabase ON DELETE CASCADE), logging each
    const events = this._get('aim_events');
    const removed = events.filter(e => String(e.department_id) === String(id));
    this._set('aim_events', events.filter(e => String(e.department_id) !== String(id)));
    for (const ev of removed) this._log({ actor, action: 'delete', record_id: ev.id, title: ev.title, field: null, old_value: null, new_value: null });
    this._log({ actor, action: 'delete', record_id: id, title: dept?.name, field: null, old_value: null, new_value: null });
  }

  // In local mode any non-empty password unlocks (there is no server to check).
  async unlock(_password) { return true; }
}

// --------------------------------------------------------------------------
// LIVE store — reads come straight from Supabase (anon key, read-only via RLS);
// writes go through the password-gated Netlify function.
// --------------------------------------------------------------------------
class SupabaseStore {
  constructor() { this.mode = 'live'; this._client = null; }
  async client() {
    if (!this._client) {
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
      this._client = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    }
    return this._client;
  }
  async departments() {
    const sb = await this.client();
    const { data, error } = await sb.from('departments').select('*').order('sort_order');
    if (error) throw error;
    return data;
  }
  async events() {
    const sb = await this.client();
    const { data, error } = await sb.from('events').select('*');
    if (error) throw error;
    return data;
  }
  async audit() {
    const sb = await this.client();
    const { data, error } = await sb.from('audit_log').select('*').order('ts', { ascending: false }).limit(500);
    if (error) throw error;
    return data;
  }
  async _post(body) {
    const res = await fetch(CONFIG.SAVE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || 'Save failed');
    return out;
  }
  async saveEvent(payload, actor) {
    const pw = sessionStorage.getItem('aim_pw') || '';
    const out = await this._post({ name: actor, password: pw, action: 'upsert', payload });
    return out.event;
  }
  async deleteEvent(id, actor) {
    const pw = sessionStorage.getItem('aim_pw') || '';
    await this._post({ name: actor, password: pw, action: 'delete', id });
  }
  async saveDepartment(payload, actor) {
    const pw = sessionStorage.getItem('aim_pw') || '';
    const out = await this._post({ name: actor, password: pw, entity: 'department', action: 'upsert', payload });
    return out.record;
  }
  async deleteDepartment(id, actor) {
    const pw = sessionStorage.getItem('aim_pw') || '';
    await this._post({ name: actor, password: pw, entity: 'department', action: 'delete', id });
  }
  // Verify the password by issuing a no-op-ish check: we just store it and let
  // the first real write validate. (Could add a dedicated /verify endpoint.)
  async unlock(_password) { return true; }
}

export const store = IS_LIVE ? new SupabaseStore() : new LocalStore();
export const MODE = store.mode;
