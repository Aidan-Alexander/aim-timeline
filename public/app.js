import { store, MODE } from './store.js';
import { CONFIG } from './config.js';

// ---- constants ------------------------------------------------------------
const ROW_H = 30;
const LABEL_MIN = 130, LABEL_MAX = 420;   // department-column width clamp (content-sized in computeLabelW)
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
  labelW: 220,   // recomputed from department names in applyLabelW()
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

// Canvas text measurement: decide whether a "wrap"-enabled title actually needs a
// second line at the current zoom. Without this, turning on wrap always reserved a
// taller row even when the title comfortably fit on one line.
const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
let _measureCtx = null;
function measureTextWidth(text, font) {
  if (!_measureCtx) _measureCtx = document.createElement('canvas').getContext('2d');
  _measureCtx.font = font;
  return _measureCtx.measureText(text || '').width;
}
function willWrap(ev) {
  if (!ev.wrap) return false;
  const s = toDays(ev.start_date), e = Math.max(toDays(ev.end_date), s + 1);
  const avail = Math.max(8, (e - s) * state.px) - 15;   // bar width minus horizontal padding
  const fs = ev.importance === 'minor' ? 11 : 12;
  const fw = ev.importance === 'minor' ? 500 : 650;
  return measureTextWidth(ev.title, `${fw} ${fs}px ${FONT_STACK}`) > avail;
}

// The department (label) column is sized to its CONTENT — just wide enough for the
// longest department name — then it stops growing, clamped to a floor/ceiling. The
// ceiling tracks the viewport too, so a narrow phone truncates (ellipsis) instead of
// being swallowed by the column. Width also lives in --label-w so the sticky header
// and lanes match exactly. Recomputed in reload() and on resize.
function computeLabelW() {
  let widest = 0;
  for (const d of (state.departments || [])) widest = Math.max(widest, measureTextWidth(d.name, '600 13px ' + FONT_STACK));
  // chrome around the name: L/R padding + grip + swatch + gaps + the "hide" link + edit pencil
  const chrome = 12 + 14 + 10 + 8 * 4 + measureTextWidth('hide', '11px ' + FONT_STACK) + measureTextWidth('✎', '13px ' + FONT_STACK) + 12 + 6;
  const ceiling = Math.min(LABEL_MAX, Math.round(window.innerWidth * 0.4));
  const floor = Math.min(LABEL_MIN, ceiling);
  return Math.round(Math.max(floor, Math.min(ceiling, widest + chrome)));
}
function applyLabelW() {
  state.labelW = computeLabelW();
  document.documentElement.style.setProperty('--label-w', state.labelW + 'px');
}

// per-event bar height (minor is shorter; titles that actually wrap need a 2nd line)
const ROW_GAP = 6, LANE_PAD = 6;
function barHeight(ev) {
  const base = ev.importance === 'minor' ? 18 : 24;
  return willWrap(ev) ? base + 15 : base;
}

// Row layout with VARIABLE row heights. Events the user has PINNED (row_index set,
// via drag or the right-click menu) claim their exact row first. The rest auto-pack:
// major events laid out FIRST (toward the TOP), minors below them; majors and minors
// never share a row, and a `solo` event gets a dedicated row. With nothing pinned this
// is exactly the majors-above-minors packing; pins just override where chosen events go.
function layoutLane(events) {
  const byStart = (a, b) => toDays(a.start_date) - toDays(b.start_date) || toDays(a.end_date) - toDays(b.end_date);
  const rows = [];            // { endDay, height, solo, minor, pinned, placeholder }
  const rowOf = {};
  const pinned = events.filter(ev => ev.row_index != null);
  const auto = events.filter(ev => ev.row_index == null);

  // 1) pinned events claim their explicit row index (rows above a high pin become
  //    empty placeholders that auto events can later fill).
  if (pinned.length) {
    const ensureRow = i => { while (rows.length <= i) rows.push({ endDay: -Infinity, height: 24, placeholder: true }); };
    for (const ev of [...pinned].sort(byStart)) {
      const s = toDays(ev.start_date), e = Math.max(toDays(ev.end_date), s + 1);
      const h = barHeight(ev), i = Math.max(0, ev.row_index | 0);
      ensureRow(i);
      const r = rows[i];
      if (r.placeholder) { r.placeholder = false; r.pinned = true; r.endDay = e; r.height = h; r.minor = ev.importance === 'minor'; }
      else { r.endDay = Math.max(r.endDay, e); r.height = Math.max(r.height, h); }
      if (ev.solo) r.solo = true;
      rowOf[ev.id] = i;
    }
  }

  // 2) auto events: majors first (toward the top), then minors.
  const place = (ev, minor) => {
    const s = toDays(ev.start_date), e = Math.max(toDays(ev.end_date), s + 1);
    const h = barHeight(ev);
    if (ev.solo) { rowOf[ev.id] = rows.length; rows.push({ endDay: e, height: h, solo: true, minor }); return; }
    let i = rows.findIndex(r => !r.solo && !r.pinned && !r.placeholder && r.minor === minor && s >= r.endDay);   // share a same-tier row
    if (i !== -1) { rows[i].endDay = e; rows[i].height = Math.max(rows[i].height, h); rowOf[ev.id] = i; return; }
    i = rows.findIndex(r => r.placeholder);   // else fill an empty gap row left above a high pin
    if (i !== -1) { rows[i] = { endDay: e, height: h, minor }; rowOf[ev.id] = i; return; }
    rowOf[ev.id] = rows.length; rows.push({ endDay: e, height: h, minor });   // else a new row at the bottom
  };
  auto.filter(ev => ev.importance !== 'minor').sort(byStart).forEach(ev => place(ev, false));
  auto.filter(ev => ev.importance === 'minor').sort(byStart).forEach(ev => place(ev, true));
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
  tl.style.width = (state.labelW + trackW) + 'px';

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
  const grip = el('span', 'lane-grip'); grip.textContent = '⠿'; grip.title = 'Drag to reorder departments';
  grip.addEventListener('click', ev => ev.stopPropagation());   // don't open the editor on a grip click
  const sw = el('span', 'swatch'); sw.style.background = dept.color;
  const nm = document.createElement('span'); nm.className = 'lane-name'; nm.textContent = dept.name;
  const hideBtn = el('span', 'lane-hide'); hideBtn.textContent = 'hide'; hideBtn.title = 'Hide this department for everyone';
  hideBtn.addEventListener('click', ev => { ev.stopPropagation(); requestHide(dept, true); });
  const pencil = el('span', 'lane-edit'); pencil.textContent = '✎'; pencil.title = 'Edit department';
  label.append(grip, sw, nm, hideBtn, pencil);
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
    const bar = el('div', `bar ${ev.importance}${willWrap(ev) ? ' wrap' : ''}${ev.locked ? ' locked' : ''}`);
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

// ---- drag to move / resize / re-row --------------------------------------
// Which row did the cursor land on within a lane body? Returns an index into the
// lane's rows, or rows.length to mean "a new row below everything".
function rowAtY(layout, offsetY) {
  for (let i = 0; i < layout.rows.length; i++) {
    if (offsetY < layout.rowY[i] + layout.rows[i].height) return i;
  }
  const last = layout.rows.length - 1;
  const lastBot = layout.rowY[last] + layout.rows[last].height;
  return offsetY > lastBot + ROW_GAP ? layout.rows.length : last;
}

function wireDrag() {
  const tl = $('timeline');
  tl.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;            // ignore right/middle click (right-click opens the context menu)
    const bar = e.target.closest('.bar');
    if (!bar || !state.unlocked) return;
    const ev = state.events.find(x => x.id === bar.dataset.id);
    if (!ev) return;
    const body = bar.closest('.lane-body');
    const layout = layoutLane(state.events.filter(x => x.department_id === ev.department_id));
    drag = {
      bar, ev, body, layout, isResize: e.target.classList.contains('resize'),
      startX: e.clientX, startY: e.clientY, moved: 0,
      origLeft: parseFloat(bar.style.left), origTop: parseFloat(bar.style.top), origW: parseFloat(bar.style.width),
      sDays: toDays(ev.start_date), eDays: toDays(ev.end_date), startRow: layout.rowOf[ev.id] ?? 0,
    };
    bar.setPointerCapture(e.pointerId);
    bar.classList.add('dragging');
    tooltip().classList.add('hidden');
    e.preventDefault();
  });
  tl.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
    drag.moved = Math.max(drag.moved, Math.abs(dx), Math.abs(dy));
    if (drag.isResize) { drag.bar.style.width = Math.max(8, drag.origW + dx) + 'px'; return; }
    drag.bar.style.left = (drag.origLeft + dx) + 'px';
    drag.bar.style.top = (drag.origTop + dy) + 'px';   // follow vertically too (snaps to a row on drop)
  });
  tl.addEventListener('pointerup', async e => {
    if (!drag) return;
    const d = drag; drag = null;
    d.bar.classList.remove('dragging');
    const deltaDays = Math.round((e.clientX - d.startX) / state.px);
    if (d.moved < 4) { openEditor(d.ev); return; }
    if (d.ev.locked && !confirm(LOCK_MSG)) { render(); return; }   // revert the drag
    const payload = { ...d.ev };
    if (d.isResize) {
      payload.end_date = daysToISO(Math.max(d.sDays + 1, d.eDays + deltaDays));
    } else {
      payload.start_date = daysToISO(d.sDays + deltaDays);
      payload.end_date = daysToISO(d.eDays + deltaDays);
      // vertical move → pin to the row it was dropped on (only when it actually changed)
      const targetRow = rowAtY(d.layout, e.clientY - d.body.getBoundingClientRect().top);
      if (targetRow !== d.startRow) payload.row_index = targetRow;
    }
    await commitSave(payload);
  });
}

// ---- right-click context menu on events -----------------------------------
function closeContextMenu() { $('context-menu')?.remove(); }
function showContextMenu(x, y, ev) {
  closeContextMenu();
  const menu = el('div', 'context-menu'); menu.id = 'context-menu';
  const item = (label, fn, opts = {}) => {
    const b = el('button', 'ctx-item' + (opts.danger ? ' danger' : ''));
    b.textContent = label;
    if (opts.disabled) b.disabled = true; else b.addEventListener('click', fn);
    menu.appendChild(b);
  };
  const sep = () => menu.appendChild(el('div', 'ctx-sep'));
  const cur = layoutLane(state.events.filter(e => e.department_id === ev.department_id)).rowOf[ev.id] ?? 0;
  item('Edit…', () => { closeContextMenu(); openEditor(ev); });
  item('Duplicate event', async () => { closeContextMenu(); await duplicateEvent(ev); });
  sep();
  item('↑ Move up a row', () => { closeContextMenu(); setEventRow(ev, cur - 1); }, { disabled: cur <= 0 });
  item('↓ Move down a row', () => { closeContextMenu(); setEventRow(ev, cur + 1); });
  item('Reset to automatic row', () => { closeContextMenu(); setEventRow(ev, null); }, { disabled: ev.row_index == null });
  sep();
  item('Delete', async () => {
    closeContextMenu();
    if (confirm(`Delete "${ev.title}"?`)) { try { await removeEvent(ev); toast('Deleted'); } catch (e) { toast('⚠ ' + e.message); } }
  }, { danger: true });
  menu.style.left = x + 'px'; menu.style.top = y + 'px';
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();   // clamp onto screen on both axes
  menu.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
  menu.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
}
async function duplicateEvent(ev) {
  const { id, created_at, updated_at, ...rest } = ev;   // drop identity/timestamps → an insert
  try {
    const saved = await store.saveEvent({ ...rest }, state.name);
    await reload();
    if (saved) pushUndo(`duplicate "${saved.title}"`, async () => { await store.deleteEvent(saved.id, state.name); await reload(); });
    toast('Duplicated');
  } catch (e) { toast('⚠ ' + e.message); }
}
async function setEventRow(ev, rowIndex) {
  try { await commitSave({ ...ev, row_index: rowIndex }); } catch { /* commitSave already toasts */ }
}
async function removeEvent(ev) {
  const snap = clone(ev);
  await store.deleteEvent(ev.id, state.name);
  await reload();
  pushUndo(`delete "${snap.title}"`, async () => { const { id: _d, ...rest } = snap; await store.saveEvent(rest, state.name); await reload(); });
}
function wireContextMenu() {
  const tl = $('timeline');
  tl.addEventListener('contextmenu', e => {
    const bar = e.target.closest('.bar');
    if (!bar || !state.unlocked) return;
    const ev = state.events.find(x => x.id === bar.dataset.id);
    if (!ev) return;
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, ev);
  });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#context-menu')) closeContextMenu(); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeContextMenu(); });
  $('timeline-wrap').addEventListener('scroll', closeContextMenu, true);
}

// ---- drag to reorder departments (lanes) ----------------------------------
// In edit mode each lane label gets a grip handle. Dragging it lifts the lane
// and shows a drop indicator; on release the new order is saved as each
// department's `sort_order` (the same field the lanes are sorted by on load).
let laneDrag = null;
function positionDropIndicator(target) {
  const d = laneDrag; if (!d) return;
  const ind = $('drop-indicator'); if (!ind) return;
  const n = d.offsets.length;
  ind.style.top = (target < n ? d.offsets[target] : d.offsets[n - 1] + d.heights[n - 1]) + 'px';
}
function wireLaneReorder() {
  const tl = $('timeline');
  tl.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const grip = e.target.closest('.lane-grip');
    if (!grip || !state.unlocked) return;
    const lane = grip.closest('.lane');
    const lanes = [...tl.querySelectorAll('.lane')];
    const fromIndex = lanes.indexOf(lane);
    if (fromIndex === -1) return;
    e.preventDefault(); e.stopPropagation();
    laneDrag = {
      lane, fromIndex, target: fromIndex, startY: e.clientY,
      offsets: lanes.map(l => l.offsetTop),
      heights: lanes.map(l => l.offsetHeight),
      rects: lanes.map(l => l.getBoundingClientRect()),
    };
    grip.setPointerCapture(e.pointerId);
    lane.classList.add('lane-dragging');
    document.body.classList.add('reordering');
    tooltip().classList.add('hidden');
    const ind = el('div', 'drop-indicator'); ind.id = 'drop-indicator';
    tl.appendChild(ind);
    positionDropIndicator(fromIndex);
  });
  tl.addEventListener('pointermove', e => {
    if (!laneDrag) return;
    const d = laneDrag;
    d.lane.style.transform = `translateY(${e.clientY - d.startY}px)`;
    let target = d.rects.length;
    for (let i = 0; i < d.rects.length; i++) {
      const r = d.rects[i];
      if (e.clientY < r.top + r.height / 2) { target = i; break; }
    }
    d.target = target;
    positionDropIndicator(target);
  });
  const finish = async () => {
    if (!laneDrag) return;
    const d = laneDrag; laneDrag = null;
    d.lane.style.transform = '';
    d.lane.classList.remove('lane-dragging');
    document.body.classList.remove('reordering');
    $('drop-indicator')?.remove();
    let to = d.target;
    if (to > d.fromIndex) to -= 1;          // removing the dragged lane first shifts later targets up
    if (to === d.fromIndex) return;          // dropped back where it started
    const visible = state.departments.filter(x => !x.hidden);
    const [moved] = visible.splice(d.fromIndex, 1);
    visible.splice(to, 0, moved);
    await commitReorder(visible);
  };
  tl.addEventListener('pointerup', finish);
  tl.addEventListener('pointercancel', finish);
}

// Persist a new department order. `newVisibleOrder` is the desired order of the
// visible lanes; hidden departments keep their slots. Only departments whose
// sort_order actually changes are written (one logged change each).
async function commitReorder(newVisibleOrder) {
  const visibleIds = new Set(newVisibleOrder.map(d => d.id));
  let vi = 0;
  const newFull = state.departments.map(d => visibleIds.has(d.id) ? newVisibleOrder[vi++] : d);
  const changes = [];
  newFull.forEach((d, i) => {
    const order = i + 1;
    if (d.sort_order !== order) changes.push({ id: d.id, name: d.name, color: d.color, hidden: d.hidden, oldOrder: d.sort_order, newOrder: order });
  });
  if (!changes.length) return;
  try {
    for (const c of changes) await store.saveDepartment({ id: c.id, name: c.name, color: c.color, sort_order: c.newOrder, hidden: c.hidden }, state.name);
    await reload();
    pushUndo('reorder departments', async () => {
      for (const c of changes) await store.saveDepartment({ id: c.id, name: c.name, color: c.color, sort_order: c.oldOrder, hidden: c.hidden }, state.name);
      await reload();
    });
    toast('Reordered departments');
  } catch (e) { toast('⚠ ' + e.message); await reload(); }
}

// ---- editing --------------------------------------------------------------
function openEditor(ev) {
  $('panel-title').textContent = ev ? 'Edit event' : 'Add event';
  $('f-id').value = ev?.id || '';
  $('f-row').value = ev?.row_index ?? '';   // preserved across edits (set by drag / right-click)
  $('f-title').value = ev?.title || '';
  const sel = $('f-dept'); sel.innerHTML = '';
  for (const d of state.departments) {
    const o = document.createElement('option'); o.value = d.id; o.textContent = d.name; sel.appendChild(o);
  }
  sel.value = ev?.department_id || state.departments[0]?.id;
  $('f-start').value = ev?.start_date || daysToISO(todayDays());
  $('f-end').value = ev?.end_date || daysToISO(todayDays() + 7);
  $('f-end').min = $('f-start').value;   // end picker can't go before the start, and opens on it
  for (const r of document.getElementsByName('imp')) r.checked = (r.value === (ev?.importance || 'major'));
  const deptColor = state.departments.find(d => d.id == (ev?.department_id || state.departments[0]?.id))?.color || '#3b5bdb';
  const hasColor = !!ev?.color;
  $('f-color').value = ev?.color || deptColor;
  $('f-color-clear').checked = !hasColor;
  $('f-color').disabled = !hasColor;
  $('f-wrap').checked = !!ev?.wrap;
  $('f-solo').checked = !!ev?.solo;
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
  // When a start date is picked, the end-date selector starts from it (and the end
  // jumps forward if it was empty or earlier than the new start).
  $('f-start').addEventListener('change', () => {
    const s = $('f-start').value;
    if (!s) return;
    $('f-end').min = s;
    if (!$('f-end').value || toDays($('f-end').value) < toDays(s)) $('f-end').value = s;
  });
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
      solo: $('f-solo').checked,
      locked: $('f-locked').checked,
      row_index: $('f-row').value === '' ? null : Number($('f-row').value),
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
    const ev = state.events.find(e => e.id === id);
    try {
      await removeEvent(ev);
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
const PRETTY = { start_date: 'start', end_date: 'end', department_id: 'department', importance: 'importance', title: 'title', color: 'colour', note: 'note', wrap: 'wrap', solo: 'own row', locked: 'locked dates', row_index: 'row' };

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
  $('edit-btn').textContent = on ? 'Lock' : 'Edit manually';
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
  const centerDays = startDays + (wrap.scrollLeft + wrap.clientWidth / 2 - state.labelW) / state.px;
  state.zoom = Math.max(0, Math.min(ZOOM.length - 1, state.zoom + delta));
  state.px = ZOOM[state.zoom];
  $('zoom-label').textContent = state.px < 2.5 ? 'Months' : state.px < 6 ? 'Weeks' : 'Days';
  render();
  wrap.scrollLeft = (centerDays - startDays) * state.px + state.labelW - wrap.clientWidth / 2;
}

// ---- boot -----------------------------------------------------------------
async function reload() {
  state.departments = await store.departments();
  state.events = await store.events();
  state.audit = await store.audit();
  applyLabelW();   // size the label column to the (possibly changed) department names
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

  wireDrag(); wireLaneReorder(); wireContextMenu(); wireForm(); wireUnlock(); wireDept(); wireDepts();
  // the column's viewport cap can change on rotate/resize → recompute width + repaint
  let rAF;
  window.addEventListener('resize', () => { cancelAnimationFrame(rAF); rAF = requestAnimationFrame(() => { applyLabelW(); render(); }); });
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
