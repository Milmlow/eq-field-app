/*! Property of EQ — all rights reserved. Unauthorised use prohibited. */
// ─────────────────────────────────────────────────────────────
// scripts/site-reports.js  —  EQ Solves Field
// Site Reports v1 — Prestart Briefings.
// v3.4.76 refactor: photos / signature pad / offline queue extracted
// to scripts/site-reports-shared.js. This module keeps only Prestart-
// specific logic: HRCW categories, crew sign-off shape, dual-source
// notice pointing users away from sks-field-reports.netlify.app.
// Depends on: app-state.js, utils.js, supabase.js, audit.js,
//             permissions.js, site-reports-shared.js
// ─────────────────────────────────────────────────────────────

// ── Module state ────────────────────────────────────────────
let prestartCache       = [];
let prestartDraft       = null;
let prestartCurrentId   = null;

// v3.4.54 pattern: per-action inflight guard against iPad double-tap.
const _prestartInflight = new Set();

// ── HRCW categories ─────────────────────────────────────────
// NSW WHS Regulation Schedule 3. Same 19 items the SKS prestart
// paper form lists. ids are stable strings so the array column
// stays human-readable in Supabase rather than positional integers.
const HRCW_CATEGORIES = [
  { id: 'cs',     label: 'Confined space' },
  { id: 'elec',   label: 'Energised electrical' },
  { id: 'demo',   label: 'Demolition' },
  { id: 'asb',    label: 'Asbestos' },
  { id: 'h2m',    label: 'Height > 2m / fall risk' },
  { id: 'gas',    label: 'Pressurised gas' },
  { id: 'expl',   label: 'Explosives' },
  { id: 'road',   label: 'Adjacent to road / rail' },
  { id: 'water',  label: 'In or near water' },
  { id: 'tele',   label: 'Telecommunications towers' },
  { id: 'dive',   label: 'Diving work' },
  { id: 'mob',    label: 'Mobile plant' },
  { id: 'preca',  label: 'Tilt-up / precast concrete' },
  { id: 'trench', label: 'Trench / shaft / excavation > 1.5m' },
  { id: 'tunnel', label: 'Tunnels' },
  { id: 'chem',   label: 'Chemicals / fuel / refrigerant' },
  { id: 'temp',   label: 'Extreme temperature' },
  { id: 'bio',    label: 'Biological material' },
  { id: 'press',  label: 'Pressure vessels' }
];

// ── Shared controllers (v3.4.76) ────────────────────────────
const prestartPhotos = window.SiteReportsShared.createPhotoController({
  getDraft:  function () { return prestartDraft; },
  onChange:  renderPrestartForm,
  prefix:    'prestart',
  maxPhotos: 8,
  callbackNames: {
    add:        'addPrestartPhoto',
    remove:     'removePrestartPhoto',
    setCaption: 'setPrestartPhotoCaption',
    lightbox:   'openPrestartPhotoLightbox',
  },
});

const prestartSignature = window.SiteReportsShared.createSignatureController({
  getDraft:      function () { return prestartDraft; },
  attendanceKey: 'crew',
  onChange:      renderPrestartForm,
  prefix:        'prestart',
  workflowLabel: 'Prestart',
});

const prestartQueue = window.SiteReportsShared.createOfflineQueue({
  storageKey:    'eq_prestart_offline_queue_v1',
  pillElementId: 'prestart-offline-pill',
  pageName:      'prestart',
  table:         'prestarts',
  reloadAndRender: async function () {
    await loadPrestarts();
    if (typeof currentPage !== 'undefined' && currentPage === 'prestart') renderPrestart();
  },
});

prestartQueue.startReplayListener(1500);

// ── Load ─────────────────────────────────────────────────────
async function loadPrestarts() {
  try {
    const rows = await sbFetch('prestarts?select=*&order=briefing_date.desc,briefing_time.desc&limit=200');
    prestartCache = Array.isArray(rows) ? rows : [];
  } catch (e) {
    console.warn('EQ[prestart] load failed:', e && e.message || e);
    prestartCache = [];
  }
  updatePrestartBadge();
}

function updatePrestartBadge() {
  const today  = _prestartTodayIso();
  const drafts = prestartCache.filter(r => r.status === 'draft' && r.briefing_date === today).length;
  const badge  = document.getElementById('badge-prestart');
  if (badge) {
    badge.textContent   = drafts;
    badge.style.display = drafts > 0 ? '' : 'none';
  }
}

// ── List render ─────────────────────────────────────────────
function renderPrestart() {
  const el = document.getElementById('page-prestart-list');
  if (!el) return;

  window.SiteReportsShared.injectMobileStyle('prestart');
  _injectPrestartNoticeStyleOnce();

  if (!window.EQ_PERMS || !window.EQ_PERMS.can('reports.prestart.view')) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">🔒</div><p>Supervision access required.</p></div>';
    return;
  }

  const today  = _prestartTodayIso();
  const todays = prestartCache.filter(r => r.briefing_date === today);
  const past   = prestartCache.filter(r => r.briefing_date !== today);

  let html = _renderPrestartDualSourceNotice();
  html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 18px;border-bottom:1px solid var(--border);background:var(--surface)">';
  html +=   '<div>';
  html +=     '<div style="font-size:14px;font-weight:700;color:var(--ink)">Today — ' + esc(_formatAuDate(today)) + '</div>';
  html +=     '<div style="font-size:11px;color:var(--ink-3);margin-top:2px">' + todays.length + ' prestart' + (todays.length === 1 ? '' : 's') + '</div>';
  html +=   '</div>';
  html +=   '<button class="btn edit-only" onclick="openPrestartForm()">＋ New prestart</button>';
  html += '</div>';

  if (todays.length) {
    html += '<div>' + todays.map(_prestartRow).join('') + '</div>';
  } else {
    html += '<div class="empty" style="padding:16px 18px;background:var(--surface-2)"><p style="font-size:12px;color:var(--ink-3)">No prestarts today — tap <strong>New prestart</strong> to start one.</p></div>';
  }

  html += '<div style="padding:6px 18px;font-size:10px;font-weight:700;color:var(--ink-3);text-transform:uppercase;letter-spacing:.5px;background:var(--surface-2);border-bottom:1px solid var(--border);border-top:1px solid var(--border)">Past 7 days</div>';
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const recent = past.filter(r => new Date(r.briefing_date) >= cutoff).slice(0, 50);
  if (recent.length) {
    html += recent.map(_prestartRow).join('');
  } else {
    html += '<div class="empty" style="padding:16px 18px"><p style="font-size:12px;color:var(--ink-3)">Nothing yet in the past 7 days.</p></div>';
  }

  el.innerHTML = html;
}

function _prestartRow(r) {
  const site       = (STATE.sites || []).find(s => s.abbr === r.site_abbr);
  const siteLabel  = site ? site.name : (r.site_abbr ? '(' + r.site_abbr + ')' : '(no site)');
  const time       = r.briefing_time ? String(r.briefing_time).slice(0, 5) : '';
  const crewCount  = Array.isArray(r.crew) ? r.crew.length : 0;
  const signed     = Array.isArray(r.crew) ? r.crew.filter(c => c && c.signed_at).length : 0;
  const statusChip = r.status === 'submitted'
    ? '<span style="font-size:10px;font-weight:700;color:var(--green);background:var(--green-lt);padding:2px 6px;border-radius:3px">SUBMITTED</span>'
    : '<span style="font-size:10px;font-weight:700;color:var(--amber);background:var(--amber-lt);padding:2px 6px;border-radius:3px">DRAFT</span>';

  return '<button onclick="openPrestart(\'' + esc(r.id) + '\')" style="display:block;width:100%;text-align:left;padding:10px 18px;border:0;border-bottom:1px solid var(--border);background:var(--surface);cursor:pointer">'
    + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">'
    +   '<span style="font-size:13px;font-weight:600;color:var(--ink)">' + esc(siteLabel) + '</span>'
    +   statusChip
    +   '<span style="margin-left:auto;font-size:11px;color:var(--ink-3)">' + esc(_formatAuDate(r.briefing_date)) + ' ' + esc(time) + '</span>'
    + '</div>'
    + '<div style="font-size:11px;color:var(--ink-3)">Crew ' + signed + '/' + crewCount + ' signed · By ' + esc(r.created_by || '—') + '</div>'
  + '</button>';
}

// ── Form open ───────────────────────────────────────────────
function openPrestartForm(id) {
  if (!window.EQ_PERMS || !window.EQ_PERMS.can('reports.prestart.create')) {
    if (typeof showToast === 'function') showToast('Supervision access required');
    return;
  }
  prestartCurrentId = id || null;
  if (id) {
    const existing = prestartCache.find(r => String(r.id) === String(id));
    prestartDraft = existing
      ? JSON.parse(JSON.stringify(existing))
      : _prestartFresh();
  } else {
    prestartDraft = _prestartFresh();
  }
  renderPrestartForm();
  if (typeof openModal === 'function') openModal('modal-prestart');
}

function openPrestart(id) { openPrestartForm(id); }

function _prestartFresh() {
  return {
    site_abbr:        '',
    briefing_date:    _prestartTodayIso(),
    briefing_time:    _prestartNowHHMM(),
    sks_rep:          (typeof currentManagerName !== 'undefined' && currentManagerName) || '',
    subcontractor:    '',
    prev_day_issues:  '',
    works_scope:      '',
    crew:             [],
    hrcw_categories:  [],
    swms_refs:        '',
    hazards:          '',
    permits:          '',
    photos:           [],
    status:           'draft'
  };
}

// ── Form render ─────────────────────────────────────────────
function renderPrestartForm() {
  const el = document.getElementById('prestart-form-body');
  if (!el || !prestartDraft) return;

  const d = prestartDraft;
  const siteOptions = (STATE.sites || []).map(function (s) {
    const sel = s.abbr === d.site_abbr ? ' selected' : '';
    const abbr = s.abbr ? ' (' + esc(s.abbr) + ')' : '';
    return '<option value="' + esc(s.abbr || '') + '"' + sel + '>' + esc(s.name) + abbr + '</option>';
  }).join('');

  const hrcwBoxes = HRCW_CATEGORIES.map(function (c) {
    const checked = (d.hrcw_categories || []).indexOf(c.id) !== -1;
    const bg      = checked ? 'var(--amber-lt)' : 'var(--surface)';
    const checkAttr = checked ? ' checked' : '';
    return '<label style="display:inline-flex;align-items:center;gap:6px;padding:4px 8px;margin:2px;border:1px solid var(--border);border-radius:6px;background:' + bg + ';font-size:11px;cursor:pointer;user-select:none">'
      + '<input type="checkbox"' + checkAttr + ' onchange="togglePrestartHrcw(\'' + esc(c.id) + '\')" style="margin:0"> '
      + esc(c.label)
    + '</label>';
  }).join('');

  const crewHtml = _renderPrestartCrew(d);
  const submitOK = canSubmitPrestart(d);

  el.innerHTML = ''
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:12px 14px">'
    +   '<label style="display:block;font-size:11px;color:var(--ink-3)">Site <span style="color:var(--red)">*</span>'
    +     '<select onchange="setPrestartField(\'site_abbr\', this.value); renderPrestartForm();" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit">'
    +       '<option value="">— Select site —</option>' + siteOptions
    +     '</select>'
    +   '</label>'
    +   '<label style="display:block;font-size:11px;color:var(--ink-3)">Supervisor'
    +     '<input type="text" value="' + esc(d.sks_rep || '') + '" onchange="setPrestartField(\'sks_rep\', this.value)" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit">'
    +   '</label>'
    +   '<label style="display:block;font-size:11px;color:var(--ink-3)">Date <span style="color:var(--red)">*</span>'
    +     '<input type="date" value="' + esc(d.briefing_date || '') + '" onchange="setPrestartField(\'briefing_date\', this.value); renderPrestartForm();" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit">'
    +   '</label>'
    +   '<label style="display:block;font-size:11px;color:var(--ink-3)">Time'
    +     '<input type="time" value="' + esc(d.briefing_time || '') + '" onchange="setPrestartField(\'briefing_time\', this.value)" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit">'
    +   '</label>'
    +   '<label style="grid-column:1/-1;display:block;font-size:11px;color:var(--ink-3)">Sub-contractor (if any)'
    +     '<input type="text" value="' + esc(d.subcontractor || '') + '" placeholder="Leave blank if SKS direct" onchange="setPrestartField(\'subcontractor\', this.value)" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit">'
    +   '</label>'
    + '</div>'

    + '<div style="padding:12px 14px;border-top:1px solid var(--border)">'
    +   '<div style="font-weight:600;font-size:12px;margin-bottom:6px;color:var(--ink)">Previous day safety issues</div>'
    +   '<textarea rows="2" onchange="setPrestartField(\'prev_day_issues\', this.value)" placeholder="Anything from yesterday the crew needs to know — incidents, near-misses, watchouts…" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit;resize:vertical">' + esc(d.prev_day_issues || '') + '</textarea>'
    + '</div>'

    + '<div style="padding:12px 14px;border-top:1px solid var(--border)">'
    +   '<div style="font-weight:600;font-size:12px;margin-bottom:6px;color:var(--ink)">Works scope <span style="color:var(--red)">*</span></div>'
    +   '<textarea rows="3" onchange="setPrestartField(\'works_scope\', this.value)" placeholder="What are we doing today on this site? Be specific — used in the audit trail." style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit;resize:vertical">' + esc(d.works_scope || '') + '</textarea>'
    + '</div>'

    + '<div style="padding:12px 14px;border-top:1px solid var(--border)">'
    +   '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">'
    +     '<div style="font-weight:600;font-size:12px;color:var(--ink)">High-risk construction work (HRCW)</div>'
    +     '<div style="font-size:10px;color:var(--ink-3)">' + (d.hrcw_categories || []).length + ' selected</div>'
    +   '</div>'
    +   '<div style="display:flex;flex-wrap:wrap">' + hrcwBoxes + '</div>'
    + '</div>'

    + '<div style="padding:12px 14px;border-top:1px solid var(--border);display:grid;grid-template-columns:1fr 1fr;gap:10px">'
    +   '<label style="grid-column:1/-1;display:block;font-size:11px;color:var(--ink-3)">SWMS references'
    +     '<input type="text" value="' + esc(d.swms_refs || '') + '" onchange="setPrestartField(\'swms_refs\', this.value)" placeholder="e.g. SKS-SWMS-EL-001, SKS-SWMS-HV-003" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit">'
    +   '</label>'
    +   '<label style="display:block;font-size:11px;color:var(--ink-3)">Hazards on site'
    +     '<textarea rows="2" onchange="setPrestartField(\'hazards\', this.value)" placeholder="One per line" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit;resize:vertical">' + esc(d.hazards || '') + '</textarea>'
    +   '</label>'
    +   '<label style="display:block;font-size:11px;color:var(--ink-3)">Permits required'
    +     '<textarea rows="2" onchange="setPrestartField(\'permits\', this.value)" placeholder="Hot work, isolation, confined space, …" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit;resize:vertical">' + esc(d.permits || '') + '</textarea>'
    +   '</label>'
    + '</div>'

    + '<div style="padding:12px 14px;border-top:1px solid var(--border)">'
    +   '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
    +     '<div style="font-weight:600;font-size:12px;color:var(--ink)">Photos</div>'
    +     '<div style="font-size:10px;color:var(--ink-3)">' + (d.photos || []).length + ' / ' + prestartPhotos.maxPhotos + '</div>'
    +   '</div>'
    +   prestartPhotos.renderList(d)
    + '</div>'

    + '<div style="padding:12px 14px;border-top:1px solid var(--border)">'
    +   '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
    +     '<div style="font-weight:600;font-size:12px;color:var(--ink)">Crew sign-off</div>'
    +     '<div style="font-size:10px;color:var(--ink-3)">' + (d.crew || []).filter(function (c) { return c && c.signed_at; }).length + ' of ' + (d.crew || []).length + ' signed</div>'
    +   '</div>'
    +   crewHtml
    + '</div>'

    + '<div style="padding:12px 14px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;align-items:center;background:var(--surface-2);position:sticky;bottom:0">'
    +   '<span id="prestart-offline-pill" style="display:none;font-size:10px;font-weight:600;color:var(--amber);background:var(--amber-lt);padding:3px 8px;border-radius:10px;margin-right:auto"></span>'
    +   '<button class="btn btn-secondary" onclick="savePrestartDraft()">Save draft</button>'
    +   '<button class="btn" onclick="submitPrestart()"' + (submitOK ? '' : ' disabled style="opacity:.5;cursor:not-allowed"') + '>Submit</button>'
    + '</div>';

  prestartQueue.updateBadge();
}

function _renderPrestartCrew(d) {
  if (!d.crew || !d.crew.length) {
    return '<div style="font-size:12px;color:var(--ink-3);padding:8px 0">'
      + 'No crew selected yet. '
      + '<button class="btn btn-sm" onclick="addPrestartCrewFromRoster()">＋ Pull from today\'s roster</button> '
      + '<button class="btn btn-secondary btn-sm" onclick="addPrestartCrewManual()">＋ Add by name</button>'
    + '</div>';
  }
  const rows = d.crew.map(function (c, i) {
    let tick;
    if (c.signed_at && c.signature_image) {
      tick = '<img src="' + esc(c.signature_image) + '" alt="signed" style="height:34px;width:auto;max-width:90px;background:#fff;border:1px solid var(--border);border-radius:3px;padding:2px;flex-shrink:0">';
    } else if (c.signed_at) {
      tick = '<span style="color:var(--green);font-size:16px;font-weight:700">✓</span>';
    } else {
      tick = '<button class="btn btn-secondary btn-sm" onclick="signPrestartCrew(' + i + ')">Sign</button>';
    }
    const signedLabel = c.signed_at
      ? '<span style="font-size:10px;color:var(--ink-3);margin-left:8px">' + esc(_formatAuTime(c.signed_at)) + '</span>'
      : '';
    const bg = c.signed_at ? 'var(--green-lt)' : 'var(--surface)';
    return '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;margin-bottom:4px;background:' + bg + '">'
      +   '<span style="flex:1;font-size:13px;color:var(--ink)">' + esc(c.name) + '</span>'
      +   signedLabel
      +   tick
      +   '<button onclick="removePrestartCrew(' + i + ')" title="Remove" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:14px;padding:0 4px">✕</button>'
    + '</div>';
  }).join('');
  return rows + '<div style="margin-top:6px">'
    + '<button class="btn btn-secondary btn-sm" onclick="addPrestartCrewFromRoster()">↻ Refresh from today\'s roster</button> '
    + '<button class="btn btn-secondary btn-sm" onclick="addPrestartCrewManual()">＋ Add by name</button>'
  + '</div>';
}

// ── Field setters ───────────────────────────────────────────
function setPrestartField(key, val) {
  if (!prestartDraft) return;
  prestartDraft[key] = val;
}

function togglePrestartHrcw(catId) {
  if (!prestartDraft) return;
  if (!Array.isArray(prestartDraft.hrcw_categories)) prestartDraft.hrcw_categories = [];
  const idx = prestartDraft.hrcw_categories.indexOf(catId);
  if (idx >= 0) prestartDraft.hrcw_categories.splice(idx, 1);
  else           prestartDraft.hrcw_categories.push(catId);
  renderPrestartForm();
}

// ── Crew helpers ────────────────────────────────────────────
function addPrestartCrewFromRoster() {
  if (!prestartDraft || !prestartDraft.site_abbr) {
    if (typeof showToast === 'function') showToast('Pick a site first');
    return;
  }
  const siteAbbr = prestartDraft.site_abbr;
  const wk     = (typeof getWeekForDate === 'function') ? getWeekForDate(prestartDraft.briefing_date) : null;
  const dayKey = _prestartDayKey(prestartDraft.briefing_date);
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
  const existing = new Set((prestartDraft.crew || []).map(function (c) { return c.name; }));
  matches.forEach(function (m) {
    if (!existing.has(m.name)) {
      prestartDraft.crew.push({
        name:       m.name,
        person_id:  m.id != null ? String(m.id) : null,
        signed_at:  null
      });
    }
  });
  renderPrestartForm();
  if (typeof showToast === 'function') showToast('Pulled ' + matches.length + ' from roster');
}

function addPrestartCrewManual() {
  const raw = prompt('Crew member name (e.g. visiting subbie, late add)');
  if (!raw) return;
  const name = String(raw).trim().slice(0, 80);
  if (!name) return;
  if (!Array.isArray(prestartDraft.crew)) prestartDraft.crew = [];
  prestartDraft.crew.push({ name: name, person_id: null, signed_at: null });
  renderPrestartForm();
}

function signPrestartCrew(i) {
  prestartSignature.openModal(i);
}

function removePrestartCrew(i) {
  if (!prestartDraft || !prestartDraft.crew) return;
  prestartDraft.crew.splice(i, 1);
  renderPrestartForm();
}

// ── Submit gating ───────────────────────────────────────────
function canSubmitPrestart(d) {
  if (!d) return false;
  if (!d.site_abbr) return false;
  if (!d.works_scope || !d.works_scope.trim()) return false;
  if (!d.crew || !d.crew.length) return false;
  return d.crew.some(function (c) { return c && c.signed_at; });
}

// ── Persist ─────────────────────────────────────────────────
async function savePrestartDraft() {
  if (!prestartDraft) return;
  const key = 'draft:' + (prestartCurrentId || 'new');
  if (_prestartInflight.has(key)) return;
  _prestartInflight.add(key);

  try {
    prestartDraft.status = 'draft';
    const written = await _persistPrestart(prestartDraft);
    if (written) {
      prestartCurrentId = written.id || prestartCurrentId;
      if (typeof auditLog === 'function') {
        auditLog('Saved draft', 'Prestart', _siteLabelForLog(prestartDraft), null);
      }
      if (typeof showToast === 'function') showToast('Draft saved');
      await loadPrestarts();
      renderPrestart();
    }
  } catch (e) {
    console.warn('EQ[prestart] draft save failed:', e && e.message || e);
    if (typeof showToast === 'function') showToast('Save failed — try again');
  } finally {
    _prestartInflight.delete(key);
  }
}

async function submitPrestart() {
  if (!prestartDraft || !canSubmitPrestart(prestartDraft)) {
    if (typeof showToast === 'function') showToast('Site, scope, and at least one signed crew member required');
    return;
  }
  const key = 'submit:' + (prestartCurrentId || 'new');
  if (_prestartInflight.has(key)) return;
  _prestartInflight.add(key);

  try {
    prestartDraft.status       = 'submitted';
    prestartDraft.submitted_at = new Date().toISOString();
    prestartDraft.submitted_by = (typeof currentManagerName !== 'undefined' && currentManagerName) || null;
    const written = await _persistPrestart(prestartDraft);
    if (written) {
      prestartCurrentId = written.id || prestartCurrentId;
      if (typeof auditLog === 'function') {
        auditLog('Submitted prestart', 'Prestart', _siteLabelForLog(prestartDraft), null);
      }
      if (typeof showToast === 'function') showToast('Prestart submitted ✓');
      if (typeof closeModal === 'function') closeModal('modal-prestart');
      await loadPrestarts();
      renderPrestart();
    }
  } catch (e) {
    console.warn('EQ[prestart] submit failed:', e && e.message || e);
    if (typeof showToast === 'function') showToast('Submit failed — try again');
  } finally {
    _prestartInflight.delete(key);
  }
}

async function _persistPrestart(record) {
  const payload = {
    site_abbr:        record.site_abbr || null,
    briefing_date:    record.briefing_date,
    briefing_time:    record.briefing_time || null,
    sks_rep:          record.sks_rep || null,
    subcontractor:    record.subcontractor || null,
    prev_day_issues:  record.prev_day_issues || null,
    works_scope:      record.works_scope || null,
    crew:             record.crew || [],
    hrcw_categories:  record.hrcw_categories || [],
    swms_refs:        record.swms_refs || null,
    hazards:          record.hazards || null,
    permits:          record.permits || null,
    photos:           record.photos || [],
    status:           record.status || 'draft',
    submitted_at:     record.submitted_at || null,
    submitted_by:     record.submitted_by || null,
    created_by:       record.created_by || (typeof currentManagerName !== 'undefined' && currentManagerName) || 'unknown'
  };
  return prestartQueue.persist(record, prestartCurrentId, payload);
}

// ── Internal helpers ────────────────────────────────────────
function _prestartTodayIso() {
  const d = new Date();
  return d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0');
}

function _prestartNowHHMM() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function _formatAuDate(iso) {
  if (!iso) return '';
  const parts = String(iso).split('-');
  if (parts.length !== 3) return iso;
  return parts[2] + '/' + parts[1] + '/' + parts[0].slice(2);
}

function _formatAuTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function _prestartDayKey(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const map = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return map[d.getDay()];
}

function _siteLabelForLog(d) {
  const site = (STATE.sites || []).find(function (s) { return s.abbr === d.site_abbr; });
  return site ? site.name : (d.site_abbr || 'no site');
}

// ── Dual-source notice (Prestart-specific) ──────────────────
// Banner pointing users away from sks-field-reports.netlify.app
// during the absorption period. Dismissible via localStorage.
// Retires when Path C completes and Ben + Royce sign off.
function _injectPrestartNoticeStyleOnce() {
  if (document.getElementById('prestart-notice-style')) return;
  const s = document.createElement('style');
  s.id = 'prestart-notice-style';
  s.textContent = ''
    + '.prestart-dual-source-notice {'
    +   'background:linear-gradient(180deg,#FEF3C7 0%,#FDE68A 100%);'
    +   'border-bottom:1px solid #F59E0B; padding:8px 14px; font-size:11px;'
    +   'color:#78350F; display:flex; align-items:center; gap:8px;'
    + '}';
  document.head.appendChild(s);
}

function _renderPrestartDualSourceNotice() {
  try { if (localStorage.getItem('eq_prestart_dual_dismissed') === '1') return ''; }
  catch (e) {}
  return '<div class="prestart-dual-source-notice">'
    + '<span style="font-size:14px;line-height:1">🆕</span>'
    + '<span style="flex:1">EQ Field is the new home for prestarts. Use this in place of sks-field-reports.netlify.app — the two will merge once Ben approves.</span>'
    + '<button onclick="dismissPrestartDualNotice()" style="background:none;border:none;color:#78350F;font-size:14px;cursor:pointer;padding:0 4px;font-weight:700">✕</button>'
  + '</div>';
}

function dismissPrestartDualNotice() {
  try { localStorage.setItem('eq_prestart_dual_dismissed', '1'); } catch (e) {}
  if (typeof currentPage !== 'undefined' && currentPage === 'prestart') renderPrestart();
}

// ── Shims for inline onclick="..." in shared HTML ──────────
function addPrestartPhoto(fileInput)          { return prestartPhotos.add(fileInput); }
function removePrestartPhoto(i)               { return prestartPhotos.remove(i); }
function setPrestartPhotoCaption(i, caption)  { return prestartPhotos.setCaption(i, caption); }
function openPrestartPhotoLightbox(i)         { return prestartPhotos.lightbox(i); }
