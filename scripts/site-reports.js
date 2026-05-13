/*! Property of EQ — all rights reserved. Unauthorised use prohibited. */
// ─────────────────────────────────────────────────────────────
// scripts/site-reports.js  —  EQ Solves Field
// Site Reports module — v1 covers Prestart only.
// v2 will add Toolbox; v3 Daily Diary; v4 Weekly Report + DOCX export.
// Depends on: app-state.js, utils.js, supabase.js, audit.js, permissions.js
// ─────────────────────────────────────────────────────────────

// ── Module state ────────────────────────────────────────────
let prestartCache       = [];
let prestartDraft       = null;
let prestartCurrentId   = null;

// v3.4.54 pattern: per-action inflight guard. Prevents iPad double-tap
// from firing duplicate Save / Submit (which would write duplicate
// audit entries and, after v2 emails ship, duplicate notifications).
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

  // v3.4.68: ensure the mobile + notice stylesheet is in the DOM, once
  _injectPrestartStyleOnce();

  if (!window.EQ_PERMS || !window.EQ_PERMS.can('reports.prestart.view')) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">🔒</div><p>Supervision access required.</p></div>';
    return;
  }

  const today  = _prestartTodayIso();
  const todays = prestartCache.filter(r => r.briefing_date === today);
  const past   = prestartCache.filter(r => r.briefing_date !== today);

  // v3.4.68: dual-source notice prepended; dismissible via localStorage
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
      ? JSON.parse(JSON.stringify(existing))   // deep clone — never mutate the cache directly
      : _prestartFresh();
  } else {
    prestartDraft = _prestartFresh();
  }
  renderPrestartForm();
  if (typeof openModal === 'function') openModal('modal-prestart');
}

// Called by the list — id-coerce String for tenant-portability (v3.4.55 lesson).
function openPrestart(id) { openPrestartForm(id); }

function _prestartFresh() {
  return {
    site_abbr:          '',
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
    +     '<div style="font-size:10px;color:var(--ink-3)">' + (d.photos || []).length + ' / ' + PRESTART_MAX_PHOTOS + '</div>'
    +   '</div>'
    +   _renderPrestartPhotos(d)
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

  // v3.4.68: refresh the offline pill any time the form re-renders
  _updatePrestartOfflineBadge();
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
    // v3.4.68: render the actual signature image when present;
    // fall back to ✓ for legacy tap-to-sign records.
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
  // site_abbr IS the join key — no lookup needed beyond confirming
  // the roster has people on that abbr for the chosen day.
  const siteAbbr = prestartDraft.site_abbr;
  // Roster weeks are dd.mm.yy Monday-keyed. Reuse leave.js's getWeekForDate.
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

  // Merge: keep existing signatures, add any new names from the roster.
  // person_id matching is id-coerced via String() for tenant portability (v3.4.55 lesson).
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
  // v3.4.51 lesson: HTML-escape anything that flows to a textContent slot
  // OR to an email body. Names go to both, so trim + clamp length here.
  const raw = prompt('Crew member name (e.g. visiting subbie, late add)');
  if (!raw) return;
  const name = String(raw).trim().slice(0, 80);
  if (!name) return;
  if (!Array.isArray(prestartDraft.crew)) prestartDraft.crew = [];
  prestartDraft.crew.push({ name: name, person_id: null, signed_at: null });
  renderPrestartForm();
}

function signPrestartCrew(i) {
  // v3.4.68: opens signature canvas instead of immediate-stamping.
  // openPrestartSignatureModal handles the idempotency guard.
  if (!prestartDraft || !prestartDraft.crew || !prestartDraft.crew[i]) return;
  openPrestartSignatureModal(i);
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
  // Require at least one signed crew member before submit — guards against
  // an accidental "Submit" tap when the supervisor hasn't actually run the
  // brief. v2 will tighten to "all crew signed."
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
  // org_id is stamped automatically by sbFetch via ORG_TABLES (app-state.js).
  // No manual org_id here — single source of truth.
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

  const method = prestartCurrentId ? 'PATCH' : 'POST';
  const path = prestartCurrentId
    ? 'prestarts?id=eq.' + encodeURIComponent(prestartCurrentId)
    : 'prestarts';

  // v3.4.68: offline-first write path. Honest detection via navigator.onLine;
  // if offline, queue and return a synthetic local id so the UX continues.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const localId = prestartCurrentId || ('local_' + Date.now() + '_' + Math.floor(Math.random() * 1000));
    _enqueuePrestartWrite(method, path, payload, localId);
    if (typeof showToast === 'function') showToast('Offline — saved locally, will sync when connected');
    return { id: localId, _offline: true };
  }

  try {
    const ret = await sbFetch(path, method, payload, 'return=representation');
    if (Array.isArray(ret) && ret[0]) return ret[0];
    return prestartCurrentId ? { id: prestartCurrentId } : { id: null };
  } catch (e) {
    // Online-but-failed (transient network hiccup, 5xx). Queue rather than lose work.
    const localId = prestartCurrentId || ('local_' + Date.now() + '_' + Math.floor(Math.random() * 1000));
    _enqueuePrestartWrite(method, path, payload, localId);
    if (typeof showToast === 'function') showToast('Network hiccup — saved locally, will sync');
    return { id: localId, _offline: true };
  }
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
  // JS getDay() — Sun=0..Sat=6. Roster uses Mon-first keys.
  const map = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return map[d.getDay()];
}

function _siteLabelForLog(d) {
  const site = (STATE.sites || []).find(function (s) { return s.abbr === d.site_abbr; });
  return site ? site.name : (d.site_abbr || 'no site');
}

// ══════════════════════════════════════════════════════════════
// v3.4.68 — MVP additions to bring prestart up to "Ben can use it
// daily" parity with sks-field-reports v29:
//   1. Photos (max 8 per prestart, resized + JPEG-compressed,
//      stored inline as base64 in prestarts.photos JSONB)
//   2. Signature pad (HTML5 canvas, base64 PNG stored on the
//      crew[i].signature_image alongside signed_at/signed_by)
//   3. Offline write queue (localStorage-backed, replays on
//      navigator 'online' + page load)
//   4. Mobile-responsive CSS for form + signature modal
//   5. Dual-source notice ("EQ Field is the new home for prestarts")
// ══════════════════════════════════════════════════════════════

// ── 1. Photos ─────────────────────────────────────────────────
const PRESTART_MAX_PHOTOS    = 8;
const PRESTART_PHOTO_MAX_DIM = 1600;
const PRESTART_PHOTO_QUALITY = 0.7;

function addPrestartPhoto(fileInput) {
  if (!prestartDraft) return;
  if (!fileInput.files || !fileInput.files[0]) return;
  if ((prestartDraft.photos || []).length >= PRESTART_MAX_PHOTOS) {
    if (typeof showToast === 'function') showToast('Max ' + PRESTART_MAX_PHOTOS + ' photos');
    return;
  }
  const file = fileInput.files[0];
  if (!/^image\//.test(file.type)) {
    if (typeof showToast === 'function') showToast('Image files only');
    return;
  }
  _resizeImageToBase64(file, function (base64) {
    if (!base64) {
      if (typeof showToast === 'function') showToast('Photo too large or unreadable');
      return;
    }
    if (!Array.isArray(prestartDraft.photos)) prestartDraft.photos = [];
    prestartDraft.photos.push({
      id:       'p_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      caption:  '',
      base64:   base64,
      taken_at: new Date().toISOString(),
      taken_by: (typeof currentManagerName !== 'undefined' && currentManagerName) || null
    });
    fileInput.value = '';
    renderPrestartForm();
  });
}

function _resizeImageToBase64(file, callback) {
  const reader = new FileReader();
  reader.onload = function (e) {
    const img = new Image();
    img.onload = function () {
      let width = img.width;
      let height = img.height;
      const max = PRESTART_PHOTO_MAX_DIM;
      if (width > max || height > max) {
        const scale = Math.min(max / width, max / height);
        width  = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      try { callback(canvas.toDataURL('image/jpeg', PRESTART_PHOTO_QUALITY)); }
      catch (err) { callback(null); }
    };
    img.onerror = function () { callback(null); };
    img.src = e.target.result;
  };
  reader.onerror = function () { callback(null); };
  reader.readAsDataURL(file);
}

function removePrestartPhoto(i) {
  if (!prestartDraft || !prestartDraft.photos) return;
  prestartDraft.photos.splice(i, 1);
  renderPrestartForm();
}

function setPrestartPhotoCaption(i, caption) {
  // No re-render — would lose textarea focus mid-typing
  if (!prestartDraft || !prestartDraft.photos || !prestartDraft.photos[i]) return;
  prestartDraft.photos[i].caption = caption;
}

function openPrestartPhotoLightbox(i) {
  if (!prestartDraft || !prestartDraft.photos || !prestartDraft.photos[i]) return;
  const p = prestartDraft.photos[i];
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px;cursor:zoom-out';
  overlay.onclick = function () { overlay.remove(); };
  const img = document.createElement('img');
  img.src = p.base64;
  img.style.cssText = 'max-width:100%;max-height:90vh;object-fit:contain';
  overlay.appendChild(img);
  document.body.appendChild(overlay);
}

function _renderPrestartPhotos(d) {
  const photos = d.photos || [];
  const grid = photos.map(function (p, i) {
    const cap = p.caption
      ? '<div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.65);color:#fff;font-size:9px;padding:2px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(p.caption) + '</div>'
      : '';
    return '<div style="position:relative;width:84px;height:84px;border-radius:6px;overflow:hidden;border:1px solid var(--border);background:var(--surface-2);cursor:pointer;flex-shrink:0">'
      + '<img src="' + esc(p.base64) + '" style="width:100%;height:100%;object-fit:cover" onclick="openPrestartPhotoLightbox(' + i + ')">'
      + '<button onclick="removePrestartPhoto(' + i + ');event.stopPropagation()" title="Remove" style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,.6);color:#fff;border:none;border-radius:50%;width:20px;height:20px;cursor:pointer;font-size:11px;line-height:1;display:flex;align-items:center;justify-content:center">✕</button>'
      + cap
    + '</div>';
  }).join('');
  const addBtn = photos.length < PRESTART_MAX_PHOTOS
    ? '<label style="width:84px;height:84px;border:1px dashed var(--border);border-radius:6px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;background:var(--surface);font-size:10px;color:var(--ink-3);user-select:none;flex-shrink:0">'
      + '<span style="font-size:22px;line-height:1">📷</span>'
      + '<span style="margin-top:2px">Add photo</span>'
      + '<input type="file" accept="image/*" capture="environment" onchange="addPrestartPhoto(this)" style="display:none">'
    + '</label>'
    : '';
  const captionInputs = photos.length
    ? '<div style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:6px">'
      + photos.map(function (p, i) {
        return '<input type="text" placeholder="Caption photo ' + (i + 1) + '" value="' + esc(p.caption || '') + '" oninput="setPrestartPhotoCaption(' + i + ', this.value)" style="padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:11px;font-family:inherit">';
      }).join('')
    + '</div>'
    : '';
  return '<div style="display:flex;flex-wrap:wrap;gap:6px">' + grid + addBtn + '</div>' + captionInputs;
}

// ── 2. Signature pad ──────────────────────────────────────────
let _sigCanvasState = null;

function openPrestartSignatureModal(crewIndex) {
  if (!prestartDraft || !prestartDraft.crew[crewIndex]) return;
  if (prestartDraft.crew[crewIndex].signed_at) return; // idempotent
  const name = prestartDraft.crew[crewIndex].name;
  let modal = document.getElementById('modal-prestart-signature');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'modal-prestart-signature';
    modal.innerHTML =
        '<div class="modal" style="max-width:480px;width:92vw">'
      +   '<div class="modal-header">'
      +     '<h3 id="sig-title" style="margin:0">Sign — </h3>'
      +     '<button class="modal-close" onclick="closePrestartSignature()">✕</button>'
      +   '</div>'
      +   '<div class="modal-body" style="padding:14px">'
      +     '<div style="font-size:11px;color:var(--ink-3);margin-bottom:6px">Sign with your finger or mouse — stamps signed_at + signed_by onto the briefing.</div>'
      +     '<canvas id="sig-canvas" style="width:100%;height:200px;background:#fff;border:1px solid var(--border);border-radius:8px;touch-action:none;display:block"></canvas>'
      +     '<div style="display:flex;gap:8px;align-items:center;margin-top:12px">'
      +       '<button class="btn btn-secondary btn-sm" onclick="clearPrestartSignature()">Clear</button>'
      +       '<div style="flex:1"></div>'
      +       '<button class="btn btn-secondary btn-sm" onclick="closePrestartSignature()">Cancel</button>'
      +       '<button class="btn" id="sig-save-btn">Save signature</button>'
      +     '</div>'
      +   '</div>'
      + '</div>';
    document.body.appendChild(modal);
  }
  document.getElementById('sig-title').textContent = 'Sign — ' + name;
  const saveBtn = document.getElementById('sig-save-btn');
  if (saveBtn) saveBtn.onclick = function () { savePrestartSignature(crewIndex); };
  if (typeof openModal === 'function') openModal('modal-prestart-signature');
  setTimeout(_initSignatureCanvas, 30);
}

function _initSignatureCanvas() {
  const canvas = document.getElementById('sig-canvas');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = rect.width  * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.lineWidth   = 2.2;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.strokeStyle = '#1A1A2E';
  _sigCanvasState = { canvas: canvas, ctx: ctx, drawing: false, hasInk: false };
  function pos(evt) {
    const r = canvas.getBoundingClientRect();
    const t = evt.touches ? evt.touches[0] : evt;
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  }
  function start(evt) { evt.preventDefault(); _sigCanvasState.drawing = true; const p = pos(evt); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
  function move(evt)  { if (!_sigCanvasState.drawing) return; evt.preventDefault(); const p = pos(evt); ctx.lineTo(p.x, p.y); ctx.stroke(); _sigCanvasState.hasInk = true; }
  function end(evt)   { if (evt) evt.preventDefault(); _sigCanvasState.drawing = false; }
  canvas.addEventListener('mousedown',  start);
  canvas.addEventListener('mousemove',  move);
  canvas.addEventListener('mouseup',    end);
  canvas.addEventListener('mouseleave', end);
  canvas.addEventListener('touchstart', start);
  canvas.addEventListener('touchmove',  move);
  canvas.addEventListener('touchend',   end);
}

function clearPrestartSignature() {
  if (!_sigCanvasState) return;
  const c = _sigCanvasState.canvas;
  _sigCanvasState.ctx.clearRect(0, 0, c.width, c.height);
  _sigCanvasState.hasInk = false;
}

function savePrestartSignature(crewIndex) {
  if (!_sigCanvasState || !_sigCanvasState.hasInk) {
    if (typeof showToast === 'function') showToast('Sign first — empty signatures don\'t count');
    return;
  }
  const dataUri = _sigCanvasState.canvas.toDataURL('image/png');
  if (!prestartDraft || !prestartDraft.crew[crewIndex]) return;
  prestartDraft.crew[crewIndex].signature_image = dataUri;
  prestartDraft.crew[crewIndex].signed_at = new Date().toISOString();
  prestartDraft.crew[crewIndex].signed_by = (typeof currentManagerName !== 'undefined' && currentManagerName) || null;
  closePrestartSignature();
  renderPrestartForm();
}

function closePrestartSignature() {
  if (typeof closeModal === 'function') closeModal('modal-prestart-signature');
  _sigCanvasState = null;
}

// ── 3. Offline write queue ────────────────────────────────────
const PRESTART_QUEUE_KEY = 'eq_prestart_offline_queue_v1';

function _readPrestartQueue() {
  try { return JSON.parse(localStorage.getItem(PRESTART_QUEUE_KEY) || '[]'); }
  catch (e) { return []; }
}
function _writePrestartQueue(items) {
  try { localStorage.setItem(PRESTART_QUEUE_KEY, JSON.stringify(items || [])); }
  catch (e) { console.warn('EQ[prestart] queue write failed (storage full?):', e); }
}

function _enqueuePrestartWrite(method, path, payload, localId) {
  const queue = _readPrestartQueue();
  queue.push({
    qid:       'q_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    localId:   localId,
    queued_at: new Date().toISOString(),
    tenant:    (typeof TENANT !== 'undefined' && TENANT.ORG_SLUG) || 'unknown',
    method:    method,
    path:      path,
    payload:   payload
  });
  _writePrestartQueue(queue);
  _updatePrestartOfflineBadge();
}

function _updatePrestartOfflineBadge() {
  const myTenant = (typeof TENANT !== 'undefined' && TENANT.ORG_SLUG) || 'unknown';
  const queue = _readPrestartQueue().filter(function (q) { return q.tenant === myTenant; });
  const el = document.getElementById('prestart-offline-pill');
  if (el) {
    if (queue.length) {
      el.style.display = '';
      el.textContent = '⏳ ' + queue.length + ' offline write' + (queue.length === 1 ? '' : 's') + ' pending';
    } else {
      el.style.display = 'none';
    }
  }
}

async function _replayPrestartQueue() {
  if (!navigator.onLine) return;
  const all = _readPrestartQueue();
  if (!all.length) return;
  const myTenant = (typeof TENANT !== 'undefined' && TENANT.ORG_SLUG) || 'unknown';
  const remaining = [];
  let synced = 0;
  for (const item of all) {
    if (item.tenant !== myTenant) { remaining.push(item); continue; }
    try {
      await sbFetch(item.path, item.method, item.payload, 'return=minimal');
      synced++;
    } catch (e) {
      console.warn('EQ[prestart] replay failed for', item.qid, e && e.message || e);
      remaining.push(item);
    }
  }
  _writePrestartQueue(remaining);
  _updatePrestartOfflineBadge();
  if (synced > 0) {
    if (typeof showToast === 'function') showToast('Synced ' + synced + ' offline prestart' + (synced === 1 ? '' : 's'));
    await loadPrestarts();
    if (typeof currentPage !== 'undefined' && currentPage === 'prestart') renderPrestart();
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', _replayPrestartQueue);
  setTimeout(_replayPrestartQueue, 1500);
}

// ── 4 + 5. Mobile CSS + dual-source notice ────────────────────
function _injectPrestartStyleOnce() {
  if (document.getElementById('prestart-mvp-style')) return;
  const s = document.createElement('style');
  s.id = 'prestart-mvp-style';
  s.textContent = ''
    + '@media (max-width: 640px) {'
    +   '#modal-prestart .modal { max-width:100vw !important; width:100vw !important; height:100vh !important; max-height:100vh !important; border-radius:0 !important; }'
    +   '#prestart-form-body div[style*="grid-template-columns:1fr 1fr"],'
    +   '#prestart-form-body div[style*="grid-template-columns: 1fr 1fr"]'
    +   ' { grid-template-columns:1fr !important; }'
    +   '#modal-prestart-signature .modal { max-width:100vw !important; width:100vw !important; }'
    +   '#modal-prestart-signature canvas { height:260px !important; }'
    + '}'
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
