// Seed data transcribed from the original "AIM - Timeline" sheet.
// Dates are Monday-aligned 2026 estimates read from the spreadsheet and are meant
// as a faithful starting point — fine-tune any date in the app's edit panel.
// `importance`: 'major' = prominent, 'minor' = muted secondary detail.

export const SEED_DEPARTMENTS = [
  { id: 1, name: 'AIM Research',      color: '#C0571F', sort_order: 1, hidden: false },
  { id: 2, name: 'Recruitment',       color: '#2F7DD1', sort_order: 2, hidden: false },
  { id: 3, name: 'Foundation Program',color: '#2E7D32', sort_order: 3, hidden: false },
  { id: 4, name: 'Incubation Program',color: '#8E1F2E', sort_order: 4, hidden: false },
  { id: 5, name: 'Funding Circles',   color: '#B5722E', sort_order: 5, hidden: false },
  { id: 6, name: 'Founding To Give',  color: '#E020C0', sort_order: 6, hidden: false },
  { id: 7, name: 'Ops',               color: '#5B4E9C', sort_order: 7, hidden: false },
  { id: 8, name: 'AIM General',       color: '#C28A2B', sort_order: 8, hidden: false },
  { id: 9, name: 'In-person weeks',   color: '#7A4A1E', sort_order: 9, hidden: false },
];

let _n = 0;
const e = (department_id, title, start_date, end_date, importance = 'major', extra = {}) => ({
  id: 'seed-' + (++_n),
  department_id, title, start_date, end_date, importance,
  color: extra.color || null,
  wrap: extra.wrap || false,
  solo: extra.solo || false,
  locked: extra.locked || false,
  note: extra.note || '',
});

export const SEED_EVENTS = [
  // ---- AIM Research --------------------------------------------------------
  e(1, "Finishing H2'25 Research Rounds", '2025-12-29', '2026-01-12', 'minor'),
  e(1, "Prioritization stage H1'26 (10W)", '2026-01-12', '2026-03-23', 'major'),
  e(1, "Evaluation stage H1'26 (14W)",     '2026-03-23', '2026-06-29', 'major'),
  e(1, "Prioritization stage H2'26 (9W)",  '2026-07-13', '2026-09-14', 'major'),
  e(1, "Evaluation stage H2'26 (16W)",     '2026-09-14', '2027-01-04', 'major'),
  e(1, "ceip support", '2026-02-09', '2026-03-02', 'minor'),
  e(1, "ceip support", '2026-09-14', '2026-10-05', 'minor'),

  // ---- Recruitment ---------------------------------------------------------
  e(2, "Outreach (phil, H2)", '2026-02-09', '2026-03-09', 'major'),
  e(2, "Phil Offers",         '2026-03-09', '2026-05-04', 'major'),
  e(2, "CE Offers",           '2026-05-04', '2026-06-01', 'minor'),
  e(2, "Vetting",             '2026-02-23', '2026-06-15', 'major'),
  e(2, "Outreach",            '2026-07-13', '2026-08-17', 'major'),
  e(2, "Vetting",             '2026-08-10', '2026-11-16', 'major'),
  e(2, "Offers",              '2026-11-16', '2026-12-07', 'major'),

  // ---- Foundation Program --------------------------------------------------
  e(3, "Foundation program run externally by Judith with Elevate", '2026-03-09', '2026-12-14', 'major',
    { color: '#3F9D57', note: 'Run externally — informational on our timeline.' }),
  e(3, "Book club",             '2027-01-04', '2027-01-25', 'minor'),
  e(3, "H1 Incubation Program", '2027-01-25', '2027-03-22', 'major'),
  e(3, "Funding",               '2027-03-22', '2027-04-12', 'major'),
  e(3, "In person week",        '2027-02-08', '2027-02-15', 'major'),

  // ---- Incubation Program --------------------------------------------------
  e(4, "Book club",             '2026-01-05', '2026-01-26', 'minor'),
  e(4, "H1 Incubation Program", '2026-02-02', '2026-04-13', 'major'),
  e(4, "In person week",        '2026-02-16', '2026-02-23', 'major'),
  e(4, "Funding",               '2026-04-13', '2026-05-04', 'major'),
  e(4, "Book club",             '2026-07-27', '2026-08-17', 'minor'),
  e(4, "H2 Incubation Program", '2026-08-17', '2026-10-19', 'major'),
  e(4, "In person week",        '2026-08-31', '2026-09-07', 'major'),
  e(4, "Funding",               '2026-10-19', '2026-11-09', 'major'),

  // ---- Funding Circles -----------------------------------------------------
  e(5, "SAFC - Applications",                      '2026-02-02', '2026-02-23', 'minor'),
  e(5, "SAFC - Circle Running",                    '2026-02-23', '2026-03-23', 'minor'),
  e(5, "Send out RFMF survey",                     '2026-02-02', '2026-02-09', 'minor'),
  e(5, "Survey due date",                          '2026-02-16', '2026-02-23', 'minor'),
  e(5, "MH not up to date",                        '2026-03-09', '2026-04-06', 'minor', { note: 'Needs updating.' }),
  e(5, "Meta not up to date",                      '2026-03-16', '2026-04-13', 'minor', { note: 'Needs updating.' }),
  e(5, "Run coordination circle",                  '2026-03-23', '2026-03-30', 'minor'),
  e(5, "Most likely GHFC opening — Decisions Sep", '2026-08-03', '2026-09-21', 'major', { note: 'Most likely as of March 2026.', wrap: true }),
  e(5, "SAFC (most likely as of March 2026)",      '2026-08-10', '2026-10-05', 'major'),
  e(5, "not up to date, might change",             '2026-09-21', '2026-10-19', 'minor'),
  e(5, "not up to date, might change",             '2026-10-05', '2026-10-26', 'minor'),
  e(5, "Send out RFMF survey",                     '2026-10-05', '2026-10-12', 'minor'),
  e(5, "Run coordination circle",                  '2026-11-09', '2026-11-16', 'minor'),

  // ---- Founding To Give ----------------------------------------------------
  e(6, "In person",        '2026-01-12', '2026-02-09', 'major'),
  e(6, "Founding to Give", '2026-02-09', '2026-04-13', 'major'),
  e(6, "Con'd support",    '2026-04-13', '2026-05-11', 'minor'),

  // ---- Ops -----------------------------------------------------------------
  e(7, "IP Ops",   '2025-12-15', '2026-01-05', 'minor'),
  e(7, "Retreat",  '2026-02-02', '2026-02-09', 'major'),
  e(7, "IP Ops",   '2026-04-06', '2026-04-20', 'minor'),
  e(7, "Seed grant processing", '2026-04-13', '2026-05-04', 'minor'),
  e(7, "AIM Connect", '2026-04-20', '2026-04-27', 'major'),
  e(7, "Retreat",  '2026-06-08', '2026-06-15', 'major'),
  e(7, "Seed grant processing", '2026-07-06', '2026-07-27', 'minor'),
  e(7, "IP Ops",   '2026-07-13', '2026-07-27', 'minor'),
  e(7, "Audit (1 Sep)", '2026-09-01', '2026-09-14', 'minor'),
  e(7, "Seed grant processing + Timelining for next year", '2026-09-07', '2026-11-09', 'major', { wrap: true }),
  e(7, "IP Ops",   '2026-11-09', '2026-11-23', 'minor'),
  e(7, "IP Ops",   '2026-12-14', '2027-01-04', 'minor'),

  // ---- AIM General ---------------------------------------------------------
  e(8, "Strat Planning",          '2025-12-08', '2026-01-05', 'minor'),
  e(8, "Raises",                  '2026-01-05', '2026-01-19', 'minor'),
  e(8, "Retreat (3-6 Feb)",       '2026-02-03', '2026-02-06', 'major'),
  e(8, "OK OKR setting",          '2026-02-09', '2026-02-23', 'minor'),
  e(8, "Internal budget approval",'2026-02-16', '2026-03-09', 'minor'),
  e(8, "360 Lite",                '2026-06-01', '2026-06-22', 'minor'),
  e(8, "Office busy (EAG)",       '2026-06-08', '2026-06-22', 'minor'),
  e(8, "AIM Connect",             '2026-06-15', '2026-06-22', 'major'),
  e(8, "Retreat",                 '2026-07-20', '2026-07-27', 'major'),
  e(8, "OK OKR setting",          '2026-08-10', '2026-08-24', 'minor'),
  e(8, "Budgeting for next year", '2026-10-05', '2026-11-02', 'minor'),
  e(8, "AIM Connect",             '2026-11-09', '2026-11-16', 'major'),
  e(8, "360s",                    '2026-11-16', '2026-11-30', 'minor'),
  e(8, "Xmas do",                 '2026-12-14', '2026-12-21', 'minor'),

  // ---- In-person weeks -----------------------------------------------------
  e(9, "For Profit in-person", '2026-01-12', '2026-01-19', 'major'),
  e(9, "Retreat (3-6 Feb)",    '2026-02-03', '2026-02-06', 'major'),
  e(9, "CEIP In Person",       '2026-06-22', '2026-06-29', 'major'),
  e(9, "CEIP In Person",       '2026-11-23', '2026-11-30', 'major'),
];
