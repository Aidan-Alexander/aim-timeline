import { store, MODE } from './store.js';
import { CONFIG } from './config.js';

// ---- constants ------------------------------------------------------------
const LABEL_W = 168;
const ROW_H = 30;
const ZOOM = [1.6, 2.4, 3.6, 5.5, 8, 12];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const LOCK_MSG = 'This event was marked as "dates locked in". Are you sure you\'d like to change it?';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---- date helpers (UTC-day integers, timezone-safe) -----------------------
const toDays = str => { const [y, m, d] = str.split('-').map(Number); return Math.floor(Date.UTC(y, m - 1, d) / 864e5); };
const daysToISO = days => { const dt = new Date(days * 864e5); return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`; };
const fmtDate = str => { const [y, m, d] = str.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const todayDays = () => Math.floor(Date.now() / 864e5);

function rgb(hex) {
  const c = (hex || '').replace('#', '');
  if (c.length < 6) return null;
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}
function idealText(color) {
  const m = color && color.startsWith('rgb') ? color.match(/\d+/g).map(Number) : rgb(color);
  if (!m) return '#fff';
  return (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) / 255 > 0.6 ? '#1c2230' : '#fff';
}
function luminance(color) {
  const m = color && color.startsWith('rgb') ? color.match(/\d+/g).map(Number) : rgb(color);
  return m ? (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) / 255 : 0;
}
// mix a colour toward white by fraction t (0..1) — used for the lighter "minor" shade
function tint(hex, t) {
  const m = rgb(hex);
  if (!m) return hex;
  const v = c => Math.round(c + (255 - c) * t);
  return `rgb(${v(m[0])},${v(m[1])},${v(m[2])})`;
}
// mix a colour toward black by fraction t — darkens a light colour for "major" bars
function shade(hex, t) {
  const m = rgb(hex);
  if (!m) return hex;
  const v = c => Math.round(c * (1 - t));
  return `rgb(${v(m[0])},${v(m[1])},${v(m[2])})`;
}
const clone = x => JSON.parse(JSON.stringify(x));

// ---- state ----------------------------------------------------------------
const state = {
  departments: [], events: [], audit: [],
  start: '2025-12-01', end: '2027-12-01', mappedEnd: '2026-12-31',
  zoom: 2, px: ZOOM[2],
  unlocked: false, name: '',
};

// Hiding a department is a SHARED change stored on the department itself, so it
// goes through the same unlock + change-log path as any other edit, and everyone
// sees the same hidden set.
async function requestHide(dept, hide) {
  if (!state.unlocked) { toast('Unlock editing to change which departments everyone sees'); openUnlockModal(); return false; }
  const before = clone(dept);
  try {
    await store.saveDepartment({ id: dept.id, name: dept.name, color: dept.color, sort_order: dept.sort_order, hidden: hide }, state.name);
    await reload();
    pushUndo(`${hide ? 'hide' : 'show'} dept "${dept.name}"`, async () => { await store.saveDepartment({ ...before, hidden: !hide }, state.name); await reload(); });
    toast(`${hide ? 'Hid' : 'Showing'} "${dept.name}"`);
    return true;
  } catch (e) { toast('⚠ ' + e.message); return false; }
}
let drag = null;

// ---- undo stack (last 10 actions) -----------------------------------------
// Each entry stores an inverse operation. Running it goes through the normal
// store methods, so the undo is itself recorded in the change log.
const UNDO_MAX = 10;
const undoStack = [];
function pushUndo(label, inverse) {
  undoStack.push({ label, inverse });
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  refreshUndo();
}
function refreshUndo() {
  const b = $('undo-btn');
  b.disabled = undoStack.length === 0;
  b.title = undoStack.length ? 'Undo: ' + undoStack[undoStack.length - 1].label : 'Nothing to undo';
}
async function doUndo() {
  const last = undoStack.pop();
  if (!last) return;
  try { await last.inverse(); toast('Undid: ' + last.label); }
  catch (e) { toast('⚠ ' + e.message); }
  refreshUndo();
}

function computeBounds(events) {
  if (!events.length) return { start: '2025-12-01', mappedEnd: '2026-12-01', end: '2027-12-01' };
  let min = Infinity, max = -Infinity;
  for (const e of events) { min = Math.min(min, toDays(e.start_date)); max = Math.max(max, toDays(e.end_date)); }
  const s = new Date(min * 864e5);
  const e = new Date((max + 365) * 864e5);   // calendar runs one year past the last event
  return {
    start: daysToISO(Math.floor(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1) / 864e5)),
    mappedEnd: daysToISO(max),
    end: daysToISO(Math.floor(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 1, 1) / 864e5)),
  };
}

// per-event bar height (minor is shorter; wrapped titles need a second line)
const ROW_GAP = 6, LANE_PAD = 6;
function barHeight(ev) {
  const base = ev.importance === 'minor' ? 18 : 24;
  return ev.wrap ? base + 15 : base;
}

// greedy interval packing with VARIABLE row heights: non-overlapping events share
// a row, clashes spill down; each row is as tall as its tallest bar.
function layoutLane(events) {
  const sorted = [...events].sort((a, b) => toDays(a.start_date) - toDays(b.start_date) || toDays(a.end_date) - toDays(b.end_date));
  const rows = [];            // { endDay, height }
  const rowOf = {};
  for (const ev of sorted) {
    const s = toDays(ev.start_date), e = Math.max(toDays(ev.end_date), s + 1);
    const h = barHeight(ev);
    let i = rows.findIndex(r => s >= r.endDay);
    if (i === -1) { i = rows.length; rows.push({ endDay: e, height: h }); }
    else { rows[i].endDay = e; rows[i].height = Math.max(rows[i].height, h); }
    rowOf[ev.id] = i;
  }
  if (!rows.length) rows.push({ endDay: 0, height: 24 });
  const rowY = []; let y = LANE_PAD;
  for (const r of rows) { rowY.push(y); y += r.height + ROW_GAP; }
  return { rowOf, rows, rowY, laneH: y - ROW_GAP + LANE_PAD };
}

// ---- rendering ------------------------------------------------------------
function render() {
  const tl = $('timeline');
  tl.innerHTML = '';
  const startDays = toDays(state.start), endDays = toDays(state.end);
  const totalDays = endDays - startDays;
  const trackW = totalDays * state.px;
  tl.style.width = (LABEL_W + trackW) + 'px';

  // ticks: month boundaries (strong) + Mondays (light)
  const ticks = [];
  for (let d = startDays, guard = 0; d < endDays && guard < 2000; guard++) {
    const dt = new Date(d * 864e5);
    if (dt.getUTCDate() === 1) ticks.push({ x: (d - startDays) * state.px, month: true });
    if (dt.getUTCDay() === 1) ticks.push({ x: (d - startDays) * state.px, month: false }); // Monday
    d++;
  }

  // "not yet mapped" zone: from the last event's end to the calendar end (+1 year)
  const unmapped = { x: Math.max(0, (toDays(state.mappedEnd) - startDays) * state.px) };
  unmapped.w = trackW - unmapped.x;

  tl.appendChild(renderHeader(startDays, endDays, trackW, unmapped));
  const visible = state.departments.filter(d => !d.hidden);
  visible.forEach((dept, i) => tl.appendChild(renderLane(dept, startDays, trackW, ticks, i === 0, unmapped)));
}

function renderHeader(startDays, endDays, trackW, unmapped) {
  const head = el('div', 'time-header');
  const corner = el('div', 'corner');
  corner.textContent = 'Department';
  const track = el('div', 'header-track');
  track.style.width = trackW + 'px';

  if (unmapped && unmapped.w > 0) {
    const band = el('div', 'unmapped');
    band.style.left = unmapped.x + 'px';
    band.style.width = unmapped.w + 'px';
    const lbl = el('div', 'unmapped-label');
    lbl.textContent = 'Not yet mapped';
    band.appendChild(lbl);
    track.appendChild(band);
  }

  // months
  let y = new Date(startDays * 864e5).getUTCFullYear();
  let m = new Date(startDays * 864e5).getUTCMonth();
  for (let guard = 0; guard < 60; guard++) {
    const mStart = Math.floor(Date.UTC(y, m, 1) / 864e5);
    if (mStart >= endDays) break;
    const daysIn = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const cell = el('div', 'month');
    cell.style.left = Math.max(0, (mStart - startDays)) * state.px + 'px';
    cell.style.width = daysIn * state.px + 'px';
    cell.textContent = MONTHS[m] + (m === 0 ? ` ${y}` : '');
    track.appendChild(cell);
    m++; if (m > 11) { m = 0; y++; }
  }
  // week ticks (show date on Mondays)
  for (let d = startDays; d < endDays; d++) {
    if (new Date(d * 864e5).getUTCDay() === 1) {
      const t = el('div', 'week-tick');
      t.style.left = (d - startDays) * state.px + 'px';
      t.textContent = new Date(d * 864e5).getUTCDate();
      track.appendChild(t);
    }
  }
  head.append(corner, track);
  return head;
}

function renderLane(dept, startDays, trackW, ticks, labelToday, unmapped) {
  const lane = el('div', 'lane');
  const label = el('div', 'lane-label');
  const sw = el('span', 'swatch'); sw.style.background = dept.color;
  const nm = document.createElement('span'); nm.className = 'lane-name'; nm.textContent = dept.name;
  const hideBtn = el('span', 'lane-hide'); hideBtn.textContent = 'hide'; hideBtn.title = 'Hide this department for everyone';
  hideBtn.addEventListener('click', ev => { ev.stopPropagation(); requestHide(dept, true); });
  const pencil = el('span', 'lane-edit'); pencil.textContent = '✎'; pencil.title = 'Edit department';
  label.append(sw, nm, hideBtn, pencil);
  label.addEventListener('click', () => { if (state.unlocked) openDeptEditor(dept); });

  const body = el('div', 'lane-body');
  body.style.width = trackW + 'px';

  const events = state.events.filter(e => e.department_id === dept.id);
  const { rowOf, rows, rowY, laneH } = layoutLane(events);
  body.style.height = laneH + 'px';

  // "not yet mapped" shaded band (drawn first, behind gridlines/bars)
  if (unmapped && unmapped.w > 0) {
    const band = el('div', 'unmapped');
    band.style.left = unmapped.x + 'px';
    band.style.width = unmapped.w + 'px';
    body.appendChild(band);
  }

  // gridlines (month lines are darker than week lines)
  for (const t of ticks) {
    const g = el('div', 'gridline' + (t.month ? ' gridline-month' : ''));
    g.style.left = t.x + 'px';
    body.appendChild(g);
  }
  // today line
  const td = todayDays();
  if (td >= startDays && td <= toDays(state.end)) {
    const line = el('div', 'today-line' + (labelToday ? ' labeled' : ''));
    line.style.left = (td - startDays) * state.px + 'px';
    body.appendChild(line);
  }

  // bars
  for (const ev of events) {
    const s = toDays(ev.start_date), e = Math.max(toDays(ev.end_date), s + 1);
    const h = barHeight(ev);
    const ri = rowOf[ev.id];
    const base = ev.color || dept.color;
    // minor = lighter shade + dark text; major = full (and darkened if light) shade + light text
    const bg = ev.importance === 'minor'
      ? tint(base, 0.74)
      : (luminance(base) > 0.5 ? shade(base, 0.42) : base);
    const bar = el('div', `bar ${ev.importance}${ev.wrap ? ' wrap' : ''}${ev.locked ? ' locked' : ''}`);
    bar.dataset.id = ev.id;
    bar.style.left = (s - startDays) * state.px + 'px';
    bar.style.width = Math.max(8, (e - s) * state.px) + 'px';
    bar.style.height = h + 'px';
    bar.style.top = rowY[ri] + (rows[ri].height - h) / 2 + 'px';
    bar.style.background = bg;
    bar.style.color = idealText(bg);
    if (ev.importance === 'minor') bar.style.boxShadow = 'inset 0 0 0 1px ' + tint(base, 0.35);
    const lbl = el('span', 'bar-label'); lbl.textContent = ev.title;
    bar.appendChild(lbl);
    bar.appendChild(el('div', 'resize'));
    attachTooltip(bar, ev);
    body.appendChild(bar);
  }

  lane.append(label, body);
  return lane;
}

const el = (tag, cls) => { const n = document.createElement(tag); if (cls) n.className = cls; return n; };

// ---- tooltip --------------------------------------------------------------
const tooltip = () => $('tooltip');
function attachTooltip(bar, ev) {
  bar.addEventListener('mouseenter', e => {
    if (drag) return;
    const t = tooltip();
    t.innerHTML = `<div class="tt-title">${esc(ev.title)}</div>
      <div class="tt-dates">${fmtDate(ev.start_date)} &rarr; ${fmtDate(ev.end_date)}</div>
      ${ev.note ? `<div class="tt-note">${esc(ev.note)}</div>` : ''}
      <div class="tt-imp">${ev.importance}${ev.locked ? ' · 🔒 dates locked' : ''}</div>`;
    t.classList.remove('hidden');
    moveTooltip(e);
  });
  bar.addEventListener('mousemove', moveTooltip);
  bar.addEventListener('mouseleave', () => tooltip().classList.add('hidden'));
}
function moveTooltip(e) {
  const t = tooltip(), pad = 14, r = t.getBoundingClientRect();
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + r.width > innerWidth) x = e.clientX - r.width - pad;
  if (y + r.height > innerHeight) y = e.clientY - r.height - pad;
  t.style.left = x + 'px'; t.style.top = y + 'px';
}

// ---- drag to move / resize -----------------------------------------------
function wireDrag() {
  const tl = $('timeline');
  tl.addEventListener('pointerdown', e => {
    const bar = e.target.closest('.bar');
    if (!bar || !state.unlocked) return;
    const ev = state.events.find(x => x.id === bar.dataset.id);
    if (!ev) return;
    drag = {
      bar, ev, isResize: e.target.classList.contains('resize'),
      startX: e.clientX, moved: 0,
      origLeft: parseFloat(bar.style.left), origW: parseFloat(bar.style.width),
      sDays: toDays(ev.start_date), eDays: toDays(ev.end_date),
    };
    bar.setPointerCapture(e.pointerId);
    bar.classList.add('dragging');
    tooltip().classList.add('hidden');
    e.preventDefault();
  });
  tl.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    drag.moved = Math.max(drag.moved, Math.abs(dx));
    if (drag.isResize) drag.bar.style.width = Math.max(8, drag.origW + dx) + 'px';
    else drag.bar.style.left = (drag.origLeft + dx) + 'px';
  });
  tl.addEventListener('pointerup', async e => {
    if (!drag) return;
    const d = drag; drag = null;
    d.bar.classList.remove('dragging');
    const deltaDays = Math.round((e.clientX - d.startX) / state.px);
    if (d.moved < 4) { openEditor(d.ev); return; }
    if (d.ev.locked && !confirm(LOCK_MSG)) { render(); return; }   // revert the drag
    const payload = { ...d.ev };
    if (d.isResize) payload.end_date = daysToISO(Math.max(d.sDays + 1, d.eDays + deltaDays));
    else { payload.start_date = daysToISO(d.sDays + deltaDays); payload.end_date = daysToISO(d.eDays + deltaDays); }
    await commitSave(payload);
  });
}

// ---- editing --------------------------------------------------------------
function openEditor(ev) {
  $('panel-title').textContent = ev ? 'Edit event' : 'Add event';
  $('f-id').value = ev?.id || '';
  $('f-title').value = ev?.title || '';
  const sel = $('f-dept'); sel.innerHTML = '';
  for (const d of state.departments) {
    const o = document.createElement('option'); o.value = d.id; o.textContent = d.name; sel.appendChild(o);
  }
  sel.value = ev?.department_id || state.departments[0]?.id;
  $('f-start').value = ev?.start_date || daysToISO(todayDays());
  $('f-end').value = ev?.end_date || daysToISO(todayDays() + 7);
  for (const r of document.getElementsByName('imp')) r.checked = (r.value === (ev?.importance || 'major'));
  const deptColor = state.departments.find(d => d.id == (ev?.department_id || state.departments[0]?.id))?.color || '#3b5bdb';
  const hasColor = !!ev?.color;
  $('f-color').value = ev?.color || deptColor;
  $('f-color-clear').checked = !hasColor;
  $('f-color').disabled = !hasColor;
  $('f-wrap').checked = !!ev?.wrap;
  $('f-locked').checked = !!ev?.locked;
  $('f-note').value = ev?.note || '';
  $('f-delete').classList.toggle('hidden', !ev);
  $('form-error').textContent = '';
  $('panel').classList.remove('hidden');
}

async function commitSave(payload) {
  const before = payload.id ? clone(state.events.find(e => e.id === payload.id)) : null;
  try {
    const saved = await store.saveEvent(payload, state.name);
    await reload();
    if (before) pushUndo(`edit "${before.title}"`, async () => { await store.saveEvent(before, state.name); await reload(); });
    else if (saved) pushUndo(`add "${saved.title}"`, async () => { await store.deleteEvent(saved.id, state.name); await reload(); });
    toast(payload.id ? 'Saved' : 'Added');
  } catch (e) { toast('⚠ ' + e.message); throw e; }
}

function wireForm() {
  $('f-color-clear').addEventListener('change', e => { $('f-color').disabled = e.target.checked; });
  $('f-dept').addEventListener('change', () => {
    if ($('f-color-clear').checked) {
      const c = state.departments.find(d => d.id == $('f-dept').value)?.color;
      if (c) $('f-color').value = c;
    }
  });
  $('event-form').addEventListener('submit', async e => {
    e.preventDefault();
    const payload = {
      id: $('f-id').value || undefined,
      department_id: Number($('f-dept').value),
      title: $('f-title').value.trim(),
      start_date: $('f-start').value,
      end_date: $('f-end').value,
      importance: [...document.getElementsByName('imp')].find(r => r.checked).value,
      color: $('f-color-clear').checked ? null : $('f-color').value,
      wrap: $('f-wrap').checked,
      locked: $('f-locked').checked,
      note: $('f-note').value.trim(),
    };
    if (toDays(payload.end_date) < toDays(payload.start_date)) { $('form-error').textContent = 'End date is before start date.'; return; }
    const prev = payload.id ? state.events.find(e => e.id === payload.id) : null;
    if (prev && prev.locked && (prev.start_date !== payload.start_date || prev.end_date !== payload.end_date) && !confirm(LOCK_MSG)) return;
    try { await commitSave(payload); $('panel').classList.add('hidden'); }
    catch (e) { $('form-error').textContent = e.message; }
  });
  $('f-delete').addEventListener('click', async () => {
    const id = $('f-id').value;
    if (!id || !confirm('Delete this event?')) return;
    const ev = clone(state.events.find(e => e.id === id));
    try {
      await store.deleteEvent(id, state.name); await reload();
      if (ev) pushUndo(`delete "${ev.title}"`, async () => { const { id: _drop, ...rest } = ev; await store.saveEvent(rest, state.name); await reload(); });
      $('panel').classList.add('hidden'); toast('Deleted');
    } catch (e) { $('form-error').textContent = e.message; }
  });
  $('panel-close').addEventListener('click', () => $('panel').classList.add('hidden'));
}

// ---- history --------------------------------------------------------------
function deptName(id) { return state.departments.find(d => d.id == id)?.name || id; }
function fmtVal(field, v) {
  if (v == null || v === '') return '∅';
  if (field === 'start_date' || field === 'end_date') return fmtDate(v);
  if (field === 'department_id') return deptName(v);
  return v;
}
const PRETTY = { start_date: 'start', end_date: 'end', department_id: 'department', importance: 'importance', title: 'title', color: 'colour', note: 'note' };

function renderHistory(filter = '') {
  const list = $('history-list'); list.innerHTML = '';
  const f = filter.toLowerCase();
  const rows = state.audit.filter(a => !f || (a.actor + ' ' + (a.title || '') + ' ' + (a.field || '')).toLowerCase().includes(f));
  if (!rows.length) { list.innerHTML = '<li class="h-meta" style="padding:18px">No changes yet.</li>'; return; }
  for (const a of rows) {
    const li = document.createElement('li');
    const title = esc(a.title || 'event');
    let line, cls = '';
    if (a.action === 'insert') { line = `added <strong>"${title}"</strong>`; cls = 'h-add'; }
    else if (a.action === 'delete') { line = `deleted <strong>"${title}"</strong>`; cls = 'h-del'; }
    else line = `changed ${PRETTY[a.field] || a.field} of <strong>"${title}"</strong>: ${esc(fmtVal(a.field, a.old_value))} → ${esc(fmtVal(a.field, a.new_value))}`;
    const when = new Date(a.ts);
    li.innerHTML = `<div class="${cls}"><span class="h-actor">${esc(a.actor)}</span> ${line}</div>
      <div class="h-meta">${when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · ${when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</div>`;
    list.appendChild(li);
  }
}

// ---- unlock ---------------------------------------------------------------
function setUnlocked(on) {
  state.unlocked = on;
  document.body.classList.toggle('editing', on);
  $('add-btn').classList.toggle('hidden', !on);
  $('add-dept-btn').classList.toggle('hidden', !on);
  $('undo-btn').classList.toggle('hidden', !on);
  refreshUndo();
  $('edit-btn').textContent = on ? 'Lock' : 'Edit';
}

// ---- departments ----------------------------------------------------------
function openDeptEditor(dept) {
  $('dept-modal-title').textContent = dept ? 'Edit department' : 'Add department';
  $('d-id').value = dept?.id ?? '';
  $('d-name').value = dept?.name || '';
  $('d-color').value = dept?.color || '#5b4e9c';
  $('dept-delete').classList.toggle('hidden', !dept);
  $('dept-error').textContent = '';
  $('dept-modal').classList.remove('hidden');
  $('d-name').focus();
}
function wireDept() {
  $('add-dept-btn').addEventListener('click', () => openDeptEditor(null));
  $('dept-cancel').addEventListener('click', () => $('dept-modal').classList.add('hidden'));
  $('dept-save').addEventListener('click', async () => {
    const name = $('d-name').value.trim();
    if (!name) { $('dept-error').textContent = 'Please enter a name.'; return; }
    const payload = { id: $('d-id').value || undefined, name, color: $('d-color').value };
    const before = payload.id ? clone(state.departments.find(d => String(d.id) === String(payload.id))) : null;
    try {
      const saved = await store.saveDepartment(payload, state.name);
      await reload();
      if (before) pushUndo(`edit dept "${before.name}"`, async () => { await store.saveDepartment(before, state.name); await reload(); });
      else if (saved) pushUndo(`add dept "${saved.name}"`, async () => { await store.deleteDepartment(saved.id, state.name); await reload(); });
      $('dept-modal').classList.add('hidden');
      toast(payload.id ? 'Department saved' : 'Department added');
    } catch (e) { $('dept-error').textContent = e.message; }
  });
  $('dept-delete').addEventListener('click', async () => {
    const id = $('d-id').value;
    if (!id) return;
    const n = state.events.filter(e => String(e.department_id) === String(id)).length;
    const warn = `Delete the "${$('d-name').value}" department?` +
      (n ? `\n\nThis will also permanently delete its ${n} event${n === 1 ? '' : 's'}.` : '') +
      `\n\nThis cannot be undone.`;
    if (!confirm(warn)) return;
    const dept = clone(state.departments.find(d => String(d.id) === String(id)));
    const evs = clone(state.events.filter(e => String(e.department_id) === String(id)));
    try {
      await store.deleteDepartment(isNaN(+id) ? id : +id, state.name);
      await reload();
      pushUndo(`delete dept "${dept.name}"`, async () => {
        const { id: _d, ...dRest } = dept;
        const newDept = await store.saveDepartment(dRest, state.name);     // gets a fresh id
        for (const ev of evs) { const { id: _e, department_id: _x, ...eRest } = ev; await store.saveEvent({ ...eRest, department_id: newDept.id }, state.name); }
        await reload();
      });
      $('dept-modal').classList.add('hidden');
      toast('Department deleted');
    } catch (e) { $('dept-error').textContent = e.message; }
  });
}
function openUnlockModal() {
  $('u-name').value = state.name || sessionStorage.getItem('aim_name') || '';
  $('unlock-error').textContent = '';
  $('unlock').classList.remove('hidden');
  $('u-name').focus();
}
function wireUnlock() {
  $('edit-btn').addEventListener('click', () => {
    if (state.unlocked) { setUnlocked(false); return; }
    openUnlockModal();
  });
  $('unlock-cancel').addEventListener('click', () => $('unlock').classList.add('hidden'));
  $('unlock-go').addEventListener('click', async () => {
    const name = $('u-name').value.trim(), pw = $('u-pw').value;
    if (!name) { $('unlock-error').textContent = 'Please enter your name.'; return; }
    if (MODE === 'live') {
      if (!pw) { $('unlock-error').textContent = 'Enter the edit password.'; return; }
    } else if (pw !== CONFIG.DEMO_PASSWORD) {
      $('unlock-error').textContent = 'Wrong password.'; return;
    }
    state.name = name;
    sessionStorage.setItem('aim_name', name);
    sessionStorage.setItem('aim_pw', pw);
    $('unlock').classList.add('hidden');
    $('u-pw').value = '';
    setUnlocked(true);
    toast(`Editing as ${name}`);
  });
}

// ---- show / hide departments (view preference) ----------------------------
function refreshDeptsBtn() {
  const n = state.departments.filter(d => d.hidden).length;
  $('depts-btn').textContent = n ? `Departments (${n} hidden)` : 'Departments';
}
function renderDeptsPanel() {
  const list = $('depts-list'); list.innerHTML = '';
  for (const d of state.departments) {
    const li = document.createElement('li');
    const id = `dchk-${d.id}`;
    li.innerHTML = `<label for="${id}"><input type="checkbox" id="${id}" ${d.hidden ? '' : 'checked'} />
      <span class="dot" style="background:${esc(d.color)}"></span> ${esc(d.name)}</label>`;
    li.querySelector('input').addEventListener('change', async e => {
      const wantVisible = e.target.checked;
      const ok = await requestHide(d, !wantVisible);
      if (!ok) e.target.checked = !wantVisible;   // revert if locked / failed
    });
    list.appendChild(li);
  }
}
function wireDepts() {
  $('depts-btn').addEventListener('click', e => {
    e.stopPropagation();
    const p = $('depts-panel');
    const show = p.classList.contains('hidden');
    p.classList.toggle('hidden', !show);
    if (show) renderDeptsPanel();
  });
  $('depts-all').addEventListener('click', async () => {
    if (!state.unlocked) { toast('Unlock editing to change which departments everyone sees'); openUnlockModal(); return; }
    const hiddenDepts = state.departments.filter(d => d.hidden);
    if (!hiddenDepts.length) return;
    for (const d of hiddenDepts) await store.saveDepartment({ id: d.id, name: d.name, color: d.color, sort_order: d.sort_order, hidden: false }, state.name);
    await reload();
    pushUndo(`show all departments (${hiddenDepts.length})`, async () => {
      for (const d of hiddenDepts) await store.saveDepartment({ id: d.id, name: d.name, color: d.color, sort_order: d.sort_order, hidden: true }, state.name);
      await reload();
    });
  });
  // click-away closes the popover
  document.addEventListener('click', e => {
    const p = $('depts-panel');
    if (!p.classList.contains('hidden') && !p.contains(e.target) && e.target !== $('depts-btn')) p.classList.add('hidden');
  });
}

// ---- misc UI --------------------------------------------------------------
let toastTimer;
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 2400);
}
function scrollToToday() {
  const wrap = $('timeline-wrap'), startDays = toDays(state.start);
  const td = todayDays();
  const target = (td >= startDays && td <= toDays(state.end)) ? (td - startDays) * state.px - 140 : 0;
  wrap.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
}
function setZoom(delta) {
  const wrap = $('timeline-wrap'), startDays = toDays(state.start);
  const centerDays = startDays + (wrap.scrollLeft + wrap.clientWidth / 2 - LABEL_W) / state.px;
  state.zoom = Math.max(0, Math.min(ZOOM.length - 1, state.zoom + delta));
  state.px = ZOOM[state.zoom];
  $('zoom-label').textContent = state.px < 2.5 ? 'Months' : state.px < 6 ? 'Weeks' : 'Days';
  render();
  wrap.scrollLeft = (centerDays - startDays) * state.px + LABEL_W - wrap.clientWidth / 2;
}

// ---- boot -----------------------------------------------------------------
async function reload() {
  state.departments = await store.departments();
  state.events = await store.events();
  state.audit = await store.audit();
  // Bounds (and where "Not yet mapped" begins) follow the VISIBLE lanes only —
  // hidden departments shouldn't stretch the timeline past the last shown event.
  const hiddenDepts = new Set(state.departments.filter(d => d.hidden).map(d => d.id));
  const b = computeBounds(state.events.filter(e => !hiddenDepts.has(e.department_id)));
  state.start = b.start; state.end = b.end; state.mappedEnd = b.mappedEnd;
  render();
  refreshDeptsBtn();
  if (!$('history').classList.contains('hidden')) renderHistory($('history-search').value);
  if (!$('depts-panel').classList.contains('hidden')) renderDeptsPanel();
}

async function init() {
  const badge = $('mode-badge');
  badge.textContent = MODE === 'live' ? 'live' : 'demo (local)';
  badge.classList.toggle('live', MODE === 'live');

  await reload();

  wireDrag(); wireForm(); wireUnlock(); wireDept(); wireDepts();
  $('zoom-in').addEventListener('click', () => setZoom(1));
  $('zoom-out').addEventListener('click', () => setZoom(-1));
  $('today-btn').addEventListener('click', scrollToToday);
  $('add-btn').addEventListener('click', () => openEditor(null));
  $('undo-btn').addEventListener('click', doUndo);
  $('history-btn').addEventListener('click', () => { $('history').classList.toggle('hidden'); renderHistory($('history-search').value); });
  $('history-close').addEventListener('click', () => $('history').classList.add('hidden'));
  $('howto-btn').addEventListener('click', () => $('howto').classList.remove('hidden'));
  $('howto-close').addEventListener('click', () => $('howto').classList.add('hidden'));
  $('howto').addEventListener('click', e => { if (e.target === $('howto')) $('howto').classList.add('hidden'); });
  $('howto-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('howto-prompt').textContent); $('howto-copy').textContent = 'Copied ✓'; }
    catch { const r = document.createRange(); r.selectNode($('howto-prompt')); getSelection().removeAllRanges(); getSelection().addRange(r); $('howto-copy').textContent = 'Selected'; }
    setTimeout(() => { $('howto-copy').textContent = 'Copy'; }, 1600);
  });
  $('history-search').addEventListener('input', e => renderHistory(e.target.value));
  $('zoom-label').textContent = 'Weeks';

  scrollToToday();
}

init().catch(e => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<div class="toast">Failed to load: ${esc(e.message)}</div>`); });
