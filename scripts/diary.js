/*! Property of EQ — all rights reserved. Unauthorised use prohibited. */
// ─────────────────────────────────────────────────────────────
// scripts/diary.js  —  EQ Solves Field
// Site Reports v3 — Daily Site Diary.
// Sibling module to scripts/site-reports.js (Prestart) and
// scripts/toolbox.js (Toolbox). Photos / signature / offline queue
// come from scripts/site-reports-shared.js (v3.4.76 refactor).
//
// Diary-specific surface: weather, shift_type, repeating sections
// (work_areas, delays, incidents, visitors), plus free-text
// materials_received / equipment_status / notes.
//
// Depends on: app-state.js, utils.js, supabase.js, audit.js,
//             permissions.js, site-reports-shared.js
// ─────────────────────────────────────────────────────────────

// ── Module state ────────────────────────────────────────────
let diaryCache       = [];
let diaryDraft       = null;
let diaryCurrentId   = null;

const _diaryInflight = new Set();

// ── Shared controllers (from site-reports-shared.js) ─────────
const diaryPhotos = window.SiteReportsShared.createPhotoController({
  getDraft:  function () { return diaryDraft; },
  onChange:  renderDiaryForm,
  prefix:    'diary',
  maxPhotos: 8,
  callbackNames: {
    add:        'addDiaryPhoto',
    remove:     'removeDiaryPhoto',
    setCaption: 'setDiaryPhotoCaption',
    lightbox:   'openDiaryPhotoLightbox',
  },
});

const diarySignature = window.SiteReportsShared.createSignatureController({
  getDraft:      function () { return diaryDraft; },
  attendanceKey: 'attendance',
  onChange:      renderDiaryForm,
  prefix:        'diary',
  workflowLabel: 'Diary',
});

const diaryQueue = window.SiteReportsShared.createOfflineQueue({
  storageKey:    'eq_diary_offline_queue_v1',
  pillElementId: 'diary-offline-pill',
  pageName:      'diary',
  table:         'site_diaries',
  reloadAndRender: async function () {
    await loadDiaries();
    if (typeof currentPage !== 'undefined' && currentPage === 'diary') renderDiary();
  },
});

// Stagger replay 600ms after Toolbox's (1800), so three workflows
// don't fire simultaneous queue replays on page load.
diaryQueue.startReplayListener(2100);

// ── Constants ───────────────────────────────────────────────
const SHIFT_TYPES = [
  { id: 'day',   label: 'Day' },
  { id: 'night', label: 'Night' },
  { id: 'split', label: 'Split' },
];

const INCIDENT_TYPES = [
  { id: 'near-miss', label: 'Near-miss' },
  { id: 'injury',    label: 'Injury' },
  { id: 'spill',     label: 'Spill' },
  { id: 'damage',    label: 'Damage to plant / property' },
  { id: 'other',     label: 'Other' },
];

// ── Load ─────────────────────────────────────────────────────
async function loadDiaries() {
  try {
    const rows = await sbFetch('site_diaries?select=*&order=diary_date.desc&limit=200');
    diaryCache = Array.isArray(rows) ? rows : [];
  } catch (e) {
    console.warn('EQ[diary] load failed:', e && e.message || e);
    diaryCache = [];
  }
  updateDiaryBadge();
}

function updateDiaryBadge() {
  const today  = _diaryTodayIso();
  const drafts = diaryCache.filter(r => r.status === 'draft' && r.diary_date === today).length;
  const badge  = document.getElementById('badge-diary');
  if (badge) {
    badge.textContent   = drafts;
    badge.style.display = drafts > 0 ? '' : 'none';
  }
}

// ── List render ─────────────────────────────────────────────
function renderDiary() {
  const el = document.getElementById('page-diary-list');
  if (!el) return;

  window.SiteReportsShared.injectMobileStyle('diary');

  if (!window.EQ_PERMS || !window.EQ_PERMS.can('reports.diary.view')) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">🔒</div><p>Supervision access required.</p></div>';
    return;
  }

  const today  = _diaryTodayIso();
  const todays = diaryCache.filter(r => r.diary_date === today);
  const past   = diaryCache.filter(r => r.diary_date !== today);

  let html = '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 18px;border-bottom:1px solid var(--border);background:var(--surface)">';
  html +=   '<div>';
  html +=     '<div style="font-size:14px;font-weight:700;color:var(--ink)">Today — ' + esc(_diaryFormatAuDate(today)) + '</div>';
  html +=     '<div style="font-size:11px;color:var(--ink-3);margin-top:2px">' + todays.length + ' diar' + (todays.length === 1 ? 'y' : 'ies') + '</div>';
  html +=   '</div>';
  html +=   '<button class="btn edit-only" onclick="openDiaryForm()">＋ New diary</button>';
  html += '</div>';

  if (todays.length) {
    html += '<div>' + todays.map(_diaryRow).join('') + '</div>';
  } else {
    html += '<div class="empty" style="padding:16px 18px;background:var(--surface-2)"><p style="font-size:12px;color:var(--ink-3)">No diaries logged today — tap <strong>New diary</strong> to start one.</p></div>';
  }

  html += '<div style="padding:6px 18px;font-size:10px;font-weight:700;color:var(--ink-3);text-transform:uppercase;letter-spacing:.5px;background:var(--surface-2);border-bottom:1px solid var(--border);border-top:1px solid var(--border)">Past 30 days</div>';
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const recent = past.filter(r => new Date(r.diary_date) >= cutoff).slice(0, 50);
  if (recent.length) {
    html += recent.map(_diaryRow).join('');
  } else {
    html += '<div class="empty" style="padding:16px 18px"><p style="font-size:12px;color:var(--ink-3)">Nothing in the past 30 days.</p></div>';
  }

  el.innerHTML = html;
}

function _diaryRow(r) {
  const site       = (STATE.sites || []).find(s => s.abbr === r.site_abbr);
  const siteLabel  = site ? site.name : (r.site_abbr ? '(' + r.site_abbr + ')' : '(no site)');
  const shiftLabel = r.shift_type ? r.shift_type.toUpperCase() : '';
  const incidentCt = Array.isArray(r.incidents) ? r.incidents.length : 0;
  const delayCt    = Array.isArray(r.delays) ? r.delays.length : 0;
  const statusChip = r.status === 'submitted'
    ? '<span style="font-size:10px;font-weight:700;color:var(--green);background:var(--green-lt);padding:2px 6px;border-radius:3px">SUBMITTED</span>'
    : '<span style="font-size:10px;font-weight:700;color:var(--amber);background:var(--amber-lt);padding:2px 6px;border-radius:3px">DRAFT</span>';
  const incidentChip = incidentCt > 0
    ? '<span style="font-size:10px;font-weight:700;color:var(--red);background:rgba(239,68,68,.12);padding:2px 6px;border-radius:3px;margin-left:6px">⚠ ' + incidentCt + '</span>'
    : '';

  return '<button onclick="openDiary(\'' + esc(r.id) + '\')" style="display:block;width:100%;text-align:left;padding:10px 18px;border:0;border-bottom:1px solid var(--border);background:var(--surface);cursor:pointer">'
    + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">'
    +   '<span style="font-size:13px;font-weight:600;color:var(--ink)">' + esc(siteLabel) + '</span>'
    +   (shiftLabel ? '<span style="font-size:10px;color:var(--ink-3)">' + esc(shiftLabel) + '</span>' : '')
    +   statusChip
    +   incidentChip
    +   '<span style="margin-left:auto;font-size:11px;color:var(--ink-3)">' + esc(_diaryFormatAuDate(r.diary_date)) + '</span>'
    + '</div>'
    + '<div style="font-size:11px;color:var(--ink-3)">' + delayCt + ' delay' + (delayCt === 1 ? '' : 's') + ' · ' + incidentCt + ' incident' + (incidentCt === 1 ? '' : 's') + ' · By ' + esc(r.created_by || '—') + '</div>'
  + '</button>';
}

// ── Form open ───────────────────────────────────────────────
function openDiaryForm(id) {
  if (!window.EQ_PERMS || !window.EQ_PERMS.can('reports.diary.create')) {
    if (typeof showToast === 'function') showToast('Supervision access required');
    return;
  }
  diaryCurrentId = id || null;
  if (id) {
    const existing = diaryCache.find(r => String(r.id) === String(id));
    diaryDraft = existing
      ? JSON.parse(JSON.stringify(existing))
      : _diaryFresh();
  } else {
    diaryDraft = _diaryFresh();
  }
  renderDiaryForm();
  if (typeof openModal === 'function') openModal('modal-diary');
}

function openDiary(id) { openDiaryForm(id); }

function _diaryFresh() {
  return {
    site_abbr:          '',
    diary_date:         _diaryTodayIso(),
    shift_type:         'day',
    start_time:         '07:00',
    end_time:           '15:30',
    supervisor:         (typeof currentManagerName !== 'undefined' && currentManagerName) || '',
    subcontractor:      '',
    weather:            { temp_min: '', temp_max: '', conditions: '', wind: '', rain_mm: '', humidity: '' },
    work_areas:         [],
    delays:             [],
    incidents:          [],
    visitors:           [],
    materials_received: '',
    equipment_status:   '',
    notes:              '',
    attendance:         [],
    photos:             [],
    status:             'draft'
  };
}

// ── Form render ─────────────────────────────────────────────
function renderDiaryForm() {
  const el = document.getElementById('diary-form-body');
  if (!el || !diaryDraft) return;

  const d = diaryDraft;
  const siteOptions = (STATE.sites || []).map(function (s) {
    const sel = s.abbr === d.site_abbr ? ' selected' : '';
    const abbr = s.abbr ? ' (' + esc(s.abbr) + ')' : '';
    return '<option value="' + esc(s.abbr || '') + '"' + sel + '>' + esc(s.name) + abbr + '</option>';
  }).join('');

  const shiftOptions = SHIFT_TYPES.map(function (st) {
    const sel = st.id === d.shift_type ? ' selected' : '';
    return '<option value="' + esc(st.id) + '"' + sel + '>' + esc(st.label) + '</option>';
  }).join('');

  const w = d.weather || {};
  const submitOK = canSubmitDiary(d);

  el.innerHTML = ''
    // Header
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:12px 14px">'
    +   '<label style="display:block;font-size:11px;color:var(--ink-3)">Site <span style="color:var(--red)">*</span>'
    +     '<select onchange="setDiaryField(\'site_abbr\', this.value); renderDiaryForm();" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit">'
    +       '<option value="">— Select site —</option>' + siteOptions
    +     '</select>'
    +   '</label>'
    +   '<label style="display:block;font-size:11px;color:var(--ink-3)">Supervisor'
    +     '<input type="text" value="' + esc(d.supervisor || '') + '" onchange="setDiaryField(\'supervisor\', this.value)" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit">'
    +   '</label>'
    +   '<label style="display:block;font-size:11px;color:var(--ink-3)">Date <span style="color:var(--red)">*</span>'
    +     '<input type="date" value="' + esc(d.diary_date || '') + '" onchange="setDiaryField(\'diary_date\', this.value); renderDiaryForm();" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit">'
    +   '</label>'
    +   '<label style="display:block;font-size:11px;color:var(--ink-3)">Shift type'
    +     '<select onchange="setDiaryField(\'shift_type\', this.value)" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit">' + shiftOptions + '</select>'
    +   '</label>'
    +   '<label style="display:block;font-size:11px;color:var(--ink-3)">Start time'
    +     '<input type="time" value="' + esc(d.start_time || '') + '" onchange="setDiaryField(\'start_time\', this.value)" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit">'
    +   '</label>'
    +   '<label style="display:block;font-size:11px;color:var(--ink-3)">End time'
    +     '<input type="time" value="' + esc(d.end_time || '') + '" onchange="setDiaryField(\'end_time\', this.value)" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit">'
    +   '</label>'
    +   '<label style="grid-column:1/-1;display:block;font-size:11px;color:var(--ink-3)">Sub-contractor (if any)'
    +     '<input type="text" value="' + esc(d.subcontractor || '') + '" placeholder="Leave blank if direct" onchange="setDiaryField(\'subcontractor\', this.value)" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit">'
    +   '</label>'
    + '</div>'

    // Weather
    + _sectionHeader('Weather', '')
    + '<div style="padding:0 14px 12px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">'
    +   '<label style="display:block;font-size:11px;color:var(--ink-3)">Min °C'
    +     '<input type="number" value="' + esc(w.temp_min) + '" onchange="setDiaryWeather(\'temp_min\', this.value)" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit">'
    +   '</label>'
    +   '<label style="display:block;font-size:11px;color:var(--ink-3)">Max °C'
    +     '<input type="number" value="' + esc(w.temp_max) + '" onchange="setDiaryWeather(\'temp_max\', this.value)" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit">'
    +   '</label>'
    +   '<label style="display:block;font-size:11px;color:var(--ink-3)">Rain (mm)'
    +     '<input type="number" step="0.1" value="' + esc(w.rain_mm) + '" onchange="setDiaryWeather(\'rain_mm\', this.value)" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit">'
    +   '</label>'
    +   '<label style="grid-column:1/3;display:block;font-size:11px;color:var(--ink-3)">Conditions'
    +     '<input type="text" value="' + esc(w.conditions) + '" placeholder="e.g. Overcast, light showers" onchange="setDiaryWeather(\'conditions\', this.value)" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit">'
    +   '</label>'
    +   '<label style="display:block;font-size:11px;color:var(--ink-3)">Wind'
    +     '<input type="text" value="' + esc(w.wind) + '" placeholder="e.g. NW 20km/h" onchange="setDiaryWeather(\'wind\', this.value)" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit">'
    +   '</label>'
    + '</div>'

    // Work areas
    + _sectionHeader('Work areas', (d.work_areas || []).length + ' area' + ((d.work_areas || []).length === 1 ? '' : 's'))
    + '<div style="padding:0 14px 12px">' + _renderWorkAreas(d.work_areas) + '</div>'

    // Delays
    + _sectionHeader('Delays', (d.delays || []).length + ' logged')
    + '<div style="padding:0 14px 12px">' + _renderDelays(d.delays) + '</div>'

    // Incidents
    + _sectionHeader('Incidents', ((d.incidents || []).length ? '⚠ ' : '') + (d.incidents || []).length + ' logged')
    + '<div style="padding:0 14px 12px">' + _renderIncidents(d.incidents) + '</div>'

    // Visitors
    + _sectionHeader('Visitors', (d.visitors || []).length + ' logged')
    + '<div style="padding:0 14px 12px">' + _renderVisitors(d.visitors) + '</div>'

    // Free-text fields
    + _sectionHeader('Materials, equipment, notes', '')
    + '<div style="padding:0 14px 12px;display:grid;grid-template-columns:1fr 1fr;gap:10px">'
    +   '<label style="display:block;font-size:11px;color:var(--ink-3)">Materials received'
    +     '<textarea rows="2" onchange="setDiaryField(\'materials_received\', this.value)" placeholder="What arrived on site today" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit;resize:vertical">' + esc(d.materials_received || '') + '</textarea>'
    +   '</label>'
    +   '<label style="display:block;font-size:11px;color:var(--ink-3)">Equipment status'
    +     '<textarea rows="2" onchange="setDiaryField(\'equipment_status\', this.value)" placeholder="Plant in use, broken, off-hired…" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit;resize:vertical">' + esc(d.equipment_status || '') + '</textarea>'
    +   '</label>'
    +   '<label style="grid-column:1/-1;display:block;font-size:11px;color:var(--ink-3)">Supervisor notes'
    +     '<textarea rows="3" onchange="setDiaryField(\'notes\', this.value)" placeholder="Anything the head office should know about today" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit;resize:vertical">' + esc(d.notes || '') + '</textarea>'
    +   '</label>'
    + '</div>'

    // Photos
    + _sectionHeader('Photos', (d.photos || []).length + ' / ' + diaryPhotos.maxPhotos)
    + '<div style="padding:0 14px 12px">' + diaryPhotos.renderList(d) + '</div>'

    // Attendance
    + _sectionHeader('Shift attendance', (d.attendance || []).filter(function (a) { return a && a.signed_at; }).length + ' of ' + (d.attendance || []).length + ' signed')
    + '<div style="padding:0 14px 12px">' + _renderDiaryAttendance(d) + '</div>'

    // Submit bar
    + '<div style="padding:12px 14px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;align-items:center;background:var(--surface-2);position:sticky;bottom:0">'
    +   '<span id="diary-offline-pill" style="display:none;font-size:10px;font-weight:600;color:var(--amber);background:var(--amber-lt);padding:3px 8px;border-radius:10px;margin-right:auto"></span>'
    +   '<button class="btn btn-secondary" onclick="saveDiaryDraft()">Save draft</button>'
    +   '<button class="btn" onclick="submitDiary()"' + (submitOK ? '' : ' disabled style="opacity:.5;cursor:not-allowed"') + '>Submit</button>'
    + '</div>';

  diaryQueue.updateBadge();
}

function _sectionHeader(label, rightText) {
  return '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-top:1px solid var(--border);background:var(--surface-2);font-weight:600;font-size:12px;color:var(--ink)">'
    + '<span>' + esc(label) + '</span>'
    + (rightText ? '<span style="font-size:10px;color:var(--ink-3);font-weight:500">' + esc(rightText) + '</span>' : '')
  + '</div>';
}

// ── Repeating section renderers ─────────────────────────────
function _renderWorkAreas(items) {
  items = items || [];
  let html = '';
  if (!items.length) {
    html += '<div style="font-size:12px;color:var(--ink-3);padding:8px 0">No work areas logged. <button class="btn btn-secondary btn-sm" onclick="addDiaryWorkArea()">＋ Add area</button></div>';
    return html;
  }
  items.forEach(function (row, i) {
    html += '<div style="display:grid;grid-template-columns:2fr 3fr 1fr 1fr auto;gap:6px;padding:8px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px;background:var(--surface)">'
      + '<input type="text" value="' + esc(row.area || '') + '" placeholder="Area (e.g. Level 3 west)" oninput="setDiaryWorkAreaField(' + i + ', \'area\', this.value)" style="padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:inherit">'
      + '<input type="text" value="' + esc(row.description || '') + '" placeholder="What was done" oninput="setDiaryWorkAreaField(' + i + ', \'description\', this.value)" style="padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:inherit">'
      + '<input type="number" value="' + esc(row.crew_count) + '" placeholder="Crew" oninput="setDiaryWorkAreaField(' + i + ', \'crew_count\', this.value)" style="padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:inherit">'
      + '<input type="number" step="0.5" value="' + esc(row.hours_worked) + '" placeholder="Hrs" oninput="setDiaryWorkAreaField(' + i + ', \'hours_worked\', this.value)" style="padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:inherit">'
      + '<button onclick="removeDiaryWorkArea(' + i + ')" title="Remove" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:14px;padding:0 4px">✕</button>'
    + '</div>';
  });
  html += '<button class="btn btn-secondary btn-sm" onclick="addDiaryWorkArea()">＋ Add area</button>';
  return html;
}

function _renderDelays(items) {
  items = items || [];
  let html = '';
  if (!items.length) {
    html += '<div style="font-size:12px;color:var(--ink-3);padding:8px 0">No delays. <button class="btn btn-secondary btn-sm" onclick="addDiaryDelay()">＋ Log a delay</button></div>';
    return html;
  }
  items.forEach(function (row, i) {
    html += '<div style="display:grid;grid-template-columns:90px 90px 2fr 2fr auto;gap:6px;padding:8px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px;background:var(--surface)">'
      + '<input type="time" value="' + esc(row.time || '') + '" oninput="setDiaryDelayField(' + i + ', \'time\', this.value)" style="padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:inherit">'
      + '<input type="number" value="' + esc(row.duration_min) + '" placeholder="Min" oninput="setDiaryDelayField(' + i + ', \'duration_min\', this.value)" style="padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:inherit">'
      + '<input type="text" value="' + esc(row.cause || '') + '" placeholder="Cause (e.g. rain, permit)" oninput="setDiaryDelayField(' + i + ', \'cause\', this.value)" style="padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:inherit">'
      + '<input type="text" value="' + esc(row.impact || '') + '" placeholder="Impact" oninput="setDiaryDelayField(' + i + ', \'impact\', this.value)" style="padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:inherit">'
      + '<button onclick="removeDiaryDelay(' + i + ')" title="Remove" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:14px;padding:0 4px">✕</button>'
    + '</div>';
  });
  html += '<button class="btn btn-secondary btn-sm" onclick="addDiaryDelay()">＋ Log a delay</button>';
  return html;
}

function _renderIncidents(items) {
  items = items || [];
  let html = '';
  if (!items.length) {
    html += '<div style="font-size:12px;color:var(--ink-3);padding:8px 0">No incidents — nothing to report. <button class="btn btn-secondary btn-sm" onclick="addDiaryIncident()">＋ Log an incident</button></div>';
    return html;
  }
  items.forEach(function (row, i) {
    const typeOptions = INCIDENT_TYPES.map(function (t) {
      const sel = t.id === row.type ? ' selected' : '';
      return '<option value="' + esc(t.id) + '"' + sel + '>' + esc(t.label) + '</option>';
    }).join('');
    html += '<div style="padding:8px;border:1px solid var(--red);background:rgba(239,68,68,.04);border-radius:6px;margin-bottom:6px">'
      + '<div style="display:grid;grid-template-columns:90px 150px 1fr auto;gap:6px;margin-bottom:6px">'
      +   '<input type="time" value="' + esc(row.time || '') + '" oninput="setDiaryIncidentField(' + i + ', \'time\', this.value)" style="padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:inherit">'
      +   '<select onchange="setDiaryIncidentField(' + i + ', \'type\', this.value)" style="padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:inherit"><option value="">— Type —</option>' + typeOptions + '</select>'
      +   '<input type="text" value="' + esc(row.description || '') + '" placeholder="What happened" oninput="setDiaryIncidentField(' + i + ', \'description\', this.value)" style="padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:inherit">'
      +   '<button onclick="removeDiaryIncident(' + i + ')" title="Remove" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:14px;padding:0 4px">✕</button>'
      + '</div>'
      + '<input type="text" value="' + esc(row.action_taken || '') + '" placeholder="Action taken / who notified" oninput="setDiaryIncidentField(' + i + ', \'action_taken\', this.value)" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:inherit">'
    + '</div>';
  });
  html += '<button class="btn btn-secondary btn-sm" onclick="addDiaryIncident()">＋ Log an incident</button>';
  return html;
}

function _renderVisitors(items) {
  items = items || [];
  let html = '';
  if (!items.length) {
    html += '<div style="font-size:12px;color:var(--ink-3);padding:8px 0">No visitors logged. <button class="btn btn-secondary btn-sm" onclick="addDiaryVisitor()">＋ Log a visitor</button></div>';
    return html;
  }
  items.forEach(function (row, i) {
    html += '<div style="display:grid;grid-template-columns:2fr 2fr 90px 90px 2fr auto;gap:6px;padding:8px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px;background:var(--surface)">'
      + '<input type="text" value="' + esc(row.name || '') + '" placeholder="Name" oninput="setDiaryVisitorField(' + i + ', \'name\', this.value)" style="padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:inherit">'
      + '<input type="text" value="' + esc(row.company || '') + '" placeholder="Company" oninput="setDiaryVisitorField(' + i + ', \'company\', this.value)" style="padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:inherit">'
      + '<input type="time" value="' + esc(row.time_in || '') + '" placeholder="In" oninput="setDiaryVisitorField(' + i + ', \'time_in\', this.value)" style="padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:inherit">'
      + '<input type="time" value="' + esc(row.time_out || '') + '" placeholder="Out" oninput="setDiaryVisitorField(' + i + ', \'time_out\', this.value)" style="padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:inherit">'
      + '<input type="text" value="' + esc(row.purpose || '') + '" placeholder="Purpose" oninput="setDiaryVisitorField(' + i + ', \'purpose\', this.value)" style="padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:inherit">'
      + '<button onclick="removeDiaryVisitor(' + i + ')" title="Remove" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:14px;padding:0 4px">✕</button>'
    + '</div>';
  });
  html += '<button class="btn btn-secondary btn-sm" onclick="addDiaryVisitor()">＋ Log a visitor</button>';
  return html;
}

// ── Attendance render (shared shape) ────────────────────────
function _renderDiaryAttendance(d) {
  if (!d.attendance || !d.attendance.length) {
    return '<div style="font-size:12px;color:var(--ink-3);padding:8px 0">'
      + 'No shift attendance yet. '
      + '<button class="btn btn-sm" onclick="addDiaryAttendanceFromRoster()">＋ Pull from today\'s roster</button> '
      + '<button class="btn btn-secondary btn-sm" onclick="addDiaryAttendanceManual()">＋ Add by name</button>'
    + '</div>';
  }
  const rows = d.attendance.map(function (a, i) {
    let tick;
    if (a.signed_at && a.signature_image) {
      tick = '<img src="' + esc(a.signature_image) + '" alt="signed" style="height:34px;width:auto;max-width:90px;background:#fff;border:1px solid var(--border);border-radius:3px;padding:2px;flex-shrink:0">';
    } else if (a.signed_at) {
      tick = '<span style="color:var(--green);font-size:16px;font-weight:700">✓</span>';
    } else {
      tick = '<button class="btn btn-secondary btn-sm" onclick="signDiaryAttendee(' + i + ')">Sign</button>';
    }
    const signedLabel = a.signed_at
      ? '<span style="font-size:10px;color:var(--ink-3);margin-left:8px">' + esc(_diaryFormatAuTime(a.signed_at)) + '</span>'
      : '';
    const bg = a.signed_at ? 'var(--green-lt)' : 'var(--surface)';
    return '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;margin-bottom:4px;background:' + bg + '">'
      +   '<span style="flex:1;font-size:13px;color:var(--ink)">' + esc(a.name) + '</span>'
      +   signedLabel
      +   tick
      +   '<button onclick="removeDiaryAttendee(' + i + ')" title="Remove" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:14px;padding:0 4px">✕</button>'
    + '</div>';
  }).join('');
  return rows + '<div style="margin-top:6px">'
    + '<button class="btn btn-secondary btn-sm" onclick="addDiaryAttendanceFromRoster()">↻ Refresh from today\'s roster</button> '
    + '<button class="btn btn-secondary btn-sm" onclick="addDiaryAttendanceManual()">＋ Add by name</button>'
  + '</div>';
}

// ── Field setters ───────────────────────────────────────────
function setDiaryField(key, val) {
  if (!diaryDraft) return;
  diaryDraft[key] = val;
}

function setDiaryWeather(key, val) {
  if (!diaryDraft) return;
  if (!diaryDraft.weather) diaryDraft.weather = {};
  diaryDraft.weather[key] = val;
}

// Generic repeating-section setters / mutators
function _setRowField(arrayKey, i, field, val) {
  if (!diaryDraft) return;
  const arr = diaryDraft[arrayKey];
  if (!arr || !arr[i]) return;
  arr[i][field] = val;
  // No re-render — preserve input focus mid-typing.
}

function _addRow(arrayKey, fresh) {
  if (!diaryDraft) return;
  if (!Array.isArray(diaryDraft[arrayKey])) diaryDraft[arrayKey] = [];
  diaryDraft[arrayKey].push(Object.assign({ id: 'r_' + Date.now() + '_' + Math.floor(Math.random() * 1000) }, fresh));
  renderDiaryForm();
}

function _removeRow(arrayKey, i) {
  if (!diaryDraft || !diaryDraft[arrayKey]) return;
  diaryDraft[arrayKey].splice(i, 1);
  renderDiaryForm();
}

// Work areas
function addDiaryWorkArea() { _addRow('work_areas', { area: '', description: '', crew_count: '', hours_worked: '' }); }
function removeDiaryWorkArea(i) { _removeRow('work_areas', i); }
function setDiaryWorkAreaField(i, field, val) { _setRowField('work_areas', i, field, val); }

// Delays
function addDiaryDelay() { _addRow('delays', { time: _diaryNowHHMM(), duration_min: '', cause: '', impact: '' }); }
function removeDiaryDelay(i) { _removeRow('delays', i); }
function setDiaryDelayField(i, field, val) { _setRowField('delays', i, field, val); }

// Incidents
function addDiaryIncident() { _addRow('incidents', { time: _diaryNowHHMM(), type: '', description: '', action_taken: '' }); }
function removeDiaryIncident(i) { _removeRow('incidents', i); }
function setDiaryIncidentField(i, field, val) { _setRowField('incidents', i, field, val); }

// Visitors
function addDiaryVisitor() { _addRow('visitors', { name: '', company: '', time_in: _diaryNowHHMM(), time_out: '', purpose: '' }); }
function removeDiaryVisitor(i) { _removeRow('visitors', i); }
function setDiaryVisitorField(i, field, val) { _setRowField('visitors', i, field, val); }

// ── Attendance helpers ──────────────────────────────────────
function addDiaryAttendanceFromRoster() {
  if (!diaryDraft || !diaryDraft.site_abbr) {
    if (typeof showToast === 'function') showToast('Pick a site first');
    return;
  }
  const siteAbbr = diaryDraft.site_abbr;
  const wk     = (typeof getWeekForDate === 'function') ? getWeekForDate(diaryDraft.diary_date) : null;
  const dayKey = _diaryDayKey(diaryDraft.diary_date);
  if (!wk || !dayKey) {
    if (typeof showToast === 'function') showToast('Could not resolve roster day from date');
    return;
  }
  const matches = (STATE.schedule || []).filter(function (s) {
    return s.week === wk && s[dayKey] === siteAbbr;
  });
  if (!matches.length) {
    if (typeof showToast === 'function') showToast('No one rostered to ' + siteAbbr + ' on ' + dayKey.toUpperCase() + ' for week ' + wk);
    return;
  }
  const existing = new Set((diaryDraft.attendance || []).map(function (a) { return a.name; }));
  matches.forEach(function (m) {
    if (!existing.has(m.name)) {
      diaryDraft.attendance.push({
        name:       m.name,
        person_id:  m.id != null ? String(m.id) : null,
        signed_at:  null
      });
    }
  });
  renderDiaryForm();
  if (typeof showToast === 'function') showToast('Pulled ' + matches.length + ' from roster');
}

function addDiaryAttendanceManual() {
  const raw = prompt('Attendee name');
  if (!raw) return;
  const name = String(raw).trim().slice(0, 80);
  if (!name) return;
  if (!Array.isArray(diaryDraft.attendance)) diaryDraft.attendance = [];
  diaryDraft.attendance.push({ name: name, person_id: null, signed_at: null });
  renderDiaryForm();
}

function signDiaryAttendee(i) {
  diarySignature.openModal(i);
}

function removeDiaryAttendee(i) {
  if (!diaryDraft || !diaryDraft.attendance) return;
  diaryDraft.attendance.splice(i, 1);
  renderDiaryForm();
}

// ── Submit gating ───────────────────────────────────────────
function canSubmitDiary(d) {
  if (!d) return false;
  if (!d.site_abbr) return false;
  if (!d.diary_date) return false;
  // Minimum for submit: site + date + at least one work area logged.
  // Attendance not required (some shifts have no formal sign-on).
  if (!d.work_areas || !d.work_areas.length) return false;
  return true;
}

// ── Persist ─────────────────────────────────────────────────
async function saveDiaryDraft() {
  if (!diaryDraft) return;
  const key = 'draft:' + (diaryCurrentId || 'new');
  if (_diaryInflight.has(key)) return;
  _diaryInflight.add(key);

  try {
    diaryDraft.status = 'draft';
    const written = await _persistDiary(diaryDraft);
    if (written) {
      diaryCurrentId = written.id || diaryCurrentId;
      if (typeof auditLog === 'function') {
        auditLog('Saved draft', 'Diary', _diarySiteLabelForLog(diaryDraft), null);
      }
      if (typeof showToast === 'function') showToast('Draft saved');
      await loadDiaries();
      renderDiary();
    }
  } catch (e) {
    console.warn('EQ[diary] draft save failed:', e && e.message || e);
    if (typeof showToast === 'function') showToast('Save failed — try again');
  } finally {
    _diaryInflight.delete(key);
  }
}

async function submitDiary() {
  if (!diaryDraft || !canSubmitDiary(diaryDraft)) {
    if (typeof showToast === 'function') showToast('Site, date, and at least one work area required');
    return;
  }
  const key = 'submit:' + (diaryCurrentId || 'new');
  if (_diaryInflight.has(key)) return;
  _diaryInflight.add(key);

  try {
    diaryDraft.status       = 'submitted';
    diaryDraft.submitted_at = new Date().toISOString();
    diaryDraft.submitted_by = (typeof currentManagerName !== 'undefined' && currentManagerName) || null;
    const written = await _persistDiary(diaryDraft);
    if (written) {
      diaryCurrentId = written.id || diaryCurrentId;
      if (typeof auditLog === 'function') {
        auditLog('Submitted diary', 'Diary', _diarySiteLabelForLog(diaryDraft), null);
      }
      if (typeof showToast === 'function') showToast('Diary submitted ✓');
      if (typeof closeModal === 'function') closeModal('modal-diary');
      await loadDiaries();
      renderDiary();
    }
  } catch (e) {
    console.warn('EQ[diary] submit failed:', e && e.message || e);
    if (typeof showToast === 'function') showToast('Submit failed — try again');
  } finally {
    _diaryInflight.delete(key);
  }
}

async function _persistDiary(record) {
  const payload = {
    site_abbr:          record.site_abbr || null,
    diary_date:         record.diary_date,
    shift_type:         record.shift_type || null,
    start_time:         record.start_time || null,
    end_time:           record.end_time || null,
    supervisor:         record.supervisor || null,
    subcontractor:      record.subcontractor || null,
    weather:            record.weather || {},
    work_areas:         record.work_areas || [],
    delays:             record.delays || [],
    incidents:          record.incidents || [],
    visitors:           record.visitors || [],
    materials_received: record.materials_received || null,
    equipment_status:   record.equipment_status || null,
    notes:              record.notes || null,
    attendance:         record.attendance || [],
    photos:             record.photos || [],
    status:             record.status || 'draft',
    submitted_at:       record.submitted_at || null,
    submitted_by:       record.submitted_by || null,
    created_by:         record.created_by || (typeof currentManagerName !== 'undefined' && currentManagerName) || 'unknown'
  };
  return diaryQueue.persist(record, diaryCurrentId, payload);
}

// ── Internal helpers ────────────────────────────────────────
function _diaryTodayIso() {
  const d = new Date();
  return d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0');
}

function _diaryNowHHMM() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function _diaryFormatAuDate(iso) {
  if (!iso) return '';
  const parts = String(iso).split('-');
  if (parts.length !== 3) return iso;
  return parts[2] + '/' + parts[1] + '/' + parts[0].slice(2);
}

function _diaryFormatAuTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function _diaryDayKey(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const map = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return map[d.getDay()];
}

function _diarySiteLabelForLog(d) {
  const site = (STATE.sites || []).find(function (s) { return s.abbr === d.site_abbr; });
  return site ? site.name : (d.site_abbr || 'no site');
}

// ── Shims for inline onclick="..." in shared photo HTML ─────
function addDiaryPhoto(fileInput)          { return diaryPhotos.add(fileInput); }
function removeDiaryPhoto(i)               { return diaryPhotos.remove(i); }
function setDiaryPhotoCaption(i, caption)  { return diaryPhotos.setCaption(i, caption); }
function openDiaryPhotoLightbox(i)         { return diaryPhotos.lightbox(i); }

// v3.5.2: count accessor for the Site Reports HUB. Returns total
// diary entries dated today (any status). `diaryCache` is module-
// local so the HUB can't reach it directly.
window.eqGetDiariesTodayCount = function () {
  try {
    if (!Array.isArray(diaryCache)) return 0;
    const today = _diaryTodayIso();
    let n = 0;
    for (let i = 0; i < diaryCache.length; i++) {
      if (diaryCache[i] && diaryCache[i].diary_date === today) n++;
    }
    return n;
  } catch (e) { return 0; }
};
