/*! Property of EQ — all rights reserved. Unauthorised use prohibited. */
// ─────────────────────────────────────────────────────────────
// scripts/toolbox.js  —  EQ Solves Field
// Site Reports v2 — Toolbox Talks.
// Sibling module to scripts/site-reports.js (Prestart). Refactored
// in v3.4.76 to consume scripts/site-reports-shared.js for photos /
// signature pad / offline queue — the helpers that had been copy-
// pasted between Prestart and Toolbox now live in one place.
// Depends on: app-state.js, utils.js, supabase.js, audit.js,
//             permissions.js, site-reports-shared.js
// ─────────────────────────────────────────────────────────────

// ── Module state ────────────────────────────────────────────
let toolboxCache       = [];
let toolboxDraft       = null;
let toolboxCurrentId   = null;

// v3.4.54 pattern: per-action inflight guard. Prevents iPad double-tap
// from firing duplicate Save / Submit (which would write duplicate
// audit entries and, after v2 emails ship, duplicate notifications).
const _toolboxInflight = new Set();

// ── Shared controllers (v3.4.76) ────────────────────────────
// Photo / signature / offline-queue logic lives in site-reports-shared.js.
// Per-workflow global shim functions (addToolboxPhoto, etc.) are
// declared near the bottom of this file — they exist so the HTML
// rendered by SiteReportsShared.createPhotoController().renderList()
// can call back into the right workflow via plain `onclick="..."`.
const toolboxPhotos = window.SiteReportsShared.createPhotoController({
  getDraft:  function () { return toolboxDraft; },
  onChange:  renderToolboxForm,
  prefix:    'toolbox',
  maxPhotos: 8,
  callbackNames: {
    add:        'addToolboxPhoto',
    remove:     'removeToolboxPhoto',
    setCaption: 'setToolboxPhotoCaption',
    lightbox:   'openToolboxPhotoLightbox',
  },
});

const toolboxSignature = window.SiteReportsShared.createSignatureController({
  getDraft:      function () { return toolboxDraft; },
  attendanceKey: 'attendance',
  onChange:      renderToolboxForm,
  prefix:        'toolbox',
  workflowLabel: 'Toolbox',
});

const toolboxQueue = window.SiteReportsShared.createOfflineQueue({
  storageKey:    'eq_toolbox_offline_queue_v1',
  pillElementId: 'toolbox-offline-pill',
  pageName:      'toolbox',
  table:         'toolbox_talks',
  reloadAndRender: async function () {
    await loadToolboxTalks();
    if (typeof currentPage !== 'undefined' && currentPage === 'toolbox') renderToolbox();
  },
});

// Stagger replay 300ms after Prestart's so two workflows on the same
// page don't fire simultaneous queue replays.
toolboxQueue.startReplayListener(1800);

// ── Load ─────────────────────────────────────────────────────
async function loadToolboxTalks() {
  try {
    const rows = await sbFetch('toolbox_talks?select=*&order=meeting_date.desc,meeting_time.desc&limit=200');
    toolboxCache = Array.isArray(rows) ? rows : [];
  } catch (e) {
    console.warn('EQ[toolbox] load failed:', e && e.message || e);
    toolboxCache = [];
  }
  updateToolboxBadge();
}

function updateToolboxBadge() {
  const today  = _toolboxTodayIso();
  const drafts = toolboxCache.filter(r => r.status === 'draft' && r.meeting_date === today).length;
  const badge  = document.getElementById('badge-toolbox');
  if (badge) {
    badge.textContent   = drafts;
    badge.style.display = drafts > 0 ? '' : 'none';
  }
}

// ── List render ─────────────────────────────────────────────
function renderToolbox() {
  const el = document.getElementById('page-toolbox-list');
  if (!el) return;

  window.SiteReportsShared.injectMobileStyle('toolbox');

  if (!window.EQ_PERMS || !window.EQ_PERMS.can('reports.toolbox.view')) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">🔒</div><p>Supervision access required.</p></div>';
    return;
  }

  const today  = _toolboxTodayIso();
  const todays = toolboxCache.filter(r => r.meeting_date === today);
  const past   = toolboxCache.filter(r => r.meeting_date !== today);

  let html = '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 18px;border-bottom:1px solid var(--border);background:var(--surface)">';
  html +=   '<div>';
  html +=     '<div style="font-size:14px;font-weight:700;color:var(--ink)">Today — ' + esc(_toolboxFormatAuDate(today)) + '</div>';
  html +=     '<div style="font-size:11px;color:var(--ink-3);margin-top:2px">' + todays.length + ' toolbox talk' + (todays.length === 1 ? '' : 's') + '</div>';
  html +=   '</div>';
  html +=   '<button class="btn edit-only" onclick="openToolboxForm()">＋ New toolbox talk</button>';
  html += '</div>';

  if (todays.length) {
    html += '<div>' + todays.map(_toolboxRow).join('') + '</div>';
  } else {
    html += '<div class="empty" style="padding:16px 18px;background:var(--surface-2)"><p style="font-size:12px;color:var(--ink-3)">No toolbox talks today — tap <strong>New toolbox talk</strong> to start one.</p></div>';
  }

  html += '<div style="padding:6px 18px;font-size:10px;font-weight:700;color:var(--ink-3);text-transform:uppercase;letter-spacing:.5px;background:var(--surface-2);border-bottom:1px solid var(--border);border-top:1px solid var(--border)">Past 30 days</div>';
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const recent = past.filter(r => new Date(r.meeting_date) >= cutoff).slice(0, 50);
  if (recent.length) {
    html += recent.map(_toolboxRow).join('');
  } else {
    html += '<div class="empty" style="padding:16px 18px"><p style="font-size:12px;color:var(--ink-3)">Nothing in the past 30 days.</p></div>';
  }

  el.innerHTML = html;
}

function _toolboxRow(r) {
  const site       = (STATE.sites || []).find(s => s.abbr === r.site_abbr);
  const siteLabel  = site ? site.name : (r.site_abbr ? '(' + r.site_abbr + ')' : '(no site)');
  const time       = r.meeting_time ? String(r.meeting_time).slice(0, 5) : '';
  const topic      = r.topic ? esc(r.topic) : '<em style="color:var(--ink-3)">(no topic)</em>';
  const attCount   = Array.isArray(r.attendance) ? r.attendance.length : 0;
  const signed     = Array.isArray(r.attendance) ? r.attendance.filter(a => a && a.signed_at).length : 0;
  const statusChip = r.status === 'submitted'
    ? '<span style="font-size:10px;font-weight:700;color:var(--green);background:var(--green-lt);padding:2px 6px;border-radius:3px">SUBMITTED</span>'
    : '<span style="font-size:10px;font-weight:700;color:var(--amber);background:var(--amber-lt);padding:2px 6px;border-radius:3px">DRAFT</span>';

  return '<button onclick="openToolbox(\'' + esc(r.id) + '\')" style="display:block;width:100%;text-align:left;padding:10px 18px;border:0;border-bottom:1px solid var(--border);background:var(--surface);cursor:pointer">'
    + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">'
    +   '<span style="font-size:13px;font-weight:600;color:var(--ink)">' + esc(siteLabel) + '</span>'
    +   statusChip
    +   '<span style="margin-left:auto;font-size:11px;color:var(--ink-3)">' + esc(_toolboxFormatAuDate(r.meeting_date)) + ' ' + esc(time) + '</span>'
    + '</div>'
    + '<div style="font-size:12px;color:var(--ink);margin-bottom:2px">' + topic + '</div>'
    + '<div style="font-size:11px;color:var(--ink-3)">Attendance ' + signed + '/' + attCount + ' signed · By ' + esc(r.created_by || '—') + '</div>'
  + '</button>';
}

// ── Form open ───────────────────────────────────────────────
function openToolboxForm(id) {
  if (!window.EQ_PERMS || !window.EQ_PERMS.can('reports.toolbox.create')) {
    if (typeof showToast === 'function') showToast('Supervision access required');
    return;
  }
  toolboxCurrentId = id || null;
  if (id) {
    const existing = toolboxCache.find(r => String(r.id) === String(id));
    toolboxDraft = existing
      ? JSON.parse(JSON.stringify(existing))   // deep clone — never mutate the cache directly
      : _toolboxFresh();
  } else {
    toolboxDraft = _toolboxFresh();
  }
  renderToolboxForm();
  if (typeof openModal === 'function') openModal('modal-toolbox');
}

// Called by the list — id-coerce String for tenant-portability (v3.4.55 lesson).
function openToolbox(id) { openToolboxForm(id); }

function _toolboxFresh() {
  return {
    site_abbr:       '',
    meeting_date:    _toolboxTodayIso(),
    meeting_time:    _toolboxNowHHMM(),
    facilitator:     (typeof currentManagerName !== 'undefined' && currentManagerName) || '',
    subcontractor:   '',
    topic:           '',
    safety_message:  '',
    items_reviewed:  '',
    open_actions:    '',
    hazards:         '',
    swms_refs:       '',
    next_meeting:    '',
    attendance:      [],
    photos:          [],
    status:          'draft'
  };
}

// ── Form render ─────────────────────────────────────────────
function renderToolboxForm() {
  const el = document.getElementById('toolbox-form-body');
  if (!el || !toolboxDraft) return;

  const d = toolboxDraft;
  const siteOptions = (STATE.sites || []).map(function (s) {
    const sel = s.abbr === d.site_abbr ? ' selected' : '';
    const abbr = s.abbr ? ' (' + esc(s.abbr) + ')' : '';
    return '<option value="' + esc(s.abbr || '') + '"' + sel + '>' + esc(s.name) + abbr + '</option>';
  }).join('');

  const attendanceHtml = _renderToolboxAttendance(d);
  const submitOK = canSubmitToolbox(d);

  el.innerHTML = ''
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:12px 14px">'
    +   '<label style="display:block;font-size:11px;color:var(--ink-3)">Site <span style="color:var(--red)">*</span>'
    +     '<select onchange="setToolboxField(\'site_abbr\', this.value); renderToolboxForm();" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit">'
    +       '<option value="">— Select site —</option>' + siteOptions
    +     '</select>'
    +   '</label>'
    +   '<label style="display:block;font-size:11px;color:var(--ink-3)">Facilitator'
    +     '<input type="text" value="' + esc(d.facilitator || '') + '" onchange="setToolboxField(\'facilitator\', this.value)" placeholder="Who ran the talk" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit">'
    +   '</label>'
    +   '<label style="display:block;font-size:11px;color:var(--ink-3)">Date <span style="color:var(--red)">*</span>'
    +     '<input type="date" value="' + esc(d.meeting_date || '') + '" onchange="setToolboxField(\'meeting_date\', this.value); renderToolboxForm();" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit">'
    +   '</label>'
    +   '<label style="display:block;font-size:11px;color:var(--ink-3)">Time'
    +     '<input type="time" value="' + esc(d.meeting_time || '') + '" onchange="setToolboxField(\'meeting_time\', this.value)" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit">'
    +   '</label>'
    +   '<label style="grid-column:1/-1;display:block;font-size:11px;color:var(--ink-3)">Sub-contractor (if any)'
    +     '<input type="text" value="' + esc(d.subcontractor || '') + '" placeholder="Leave blank if direct" onchange="setToolboxField(\'subcontractor\', this.value)" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit">'
    +   '</label>'
    + '</div>'

    + '<div style="padding:12px 14px;border-top:1px solid var(--border)">'
    +   '<div style="font-weight:600;font-size:12px;margin-bottom:6px;color:var(--ink)">Topic <span style="color:var(--red)">*</span></div>'
    +   '<input type="text" value="' + esc(d.topic || '') + '" onchange="setToolboxField(\'topic\', this.value)" placeholder="e.g. Working at heights — fall arrest harness check" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit">'
    + '</div>'

    + '<div style="padding:12px 14px;border-top:1px solid var(--border)">'
    +   '<div style="font-weight:600;font-size:12px;margin-bottom:6px;color:var(--ink)">Key safety message</div>'
    +   '<textarea rows="2" onchange="setToolboxField(\'safety_message\', this.value)" placeholder="The one thing every attendee should walk away knowing" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit;resize:vertical">' + esc(d.safety_message || '') + '</textarea>'
    + '</div>'

    + '<div style="padding:12px 14px;border-top:1px solid var(--border)">'
    +   '<div style="font-weight:600;font-size:12px;margin-bottom:6px;color:var(--ink)">Items reviewed</div>'
    +   '<textarea rows="4" onchange="setToolboxField(\'items_reviewed\', this.value)" placeholder="One per line — what did you cover? PPE, SWMS, incident review, near-miss, …" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit;resize:vertical">' + esc(d.items_reviewed || '') + '</textarea>'
    + '</div>'

    + '<div style="padding:12px 14px;border-top:1px solid var(--border);display:grid;grid-template-columns:1fr 1fr;gap:10px">'
    +   '<label style="display:block;font-size:11px;color:var(--ink-3)">Open actions (from prior talks)'
    +     '<textarea rows="2" onchange="setToolboxField(\'open_actions\', this.value)" placeholder="What\'s still being chased from last week" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit;resize:vertical">' + esc(d.open_actions || '') + '</textarea>'
    +   '</label>'
    +   '<label style="display:block;font-size:11px;color:var(--ink-3)">Hazards discussed'
    +     '<textarea rows="2" onchange="setToolboxField(\'hazards\', this.value)" placeholder="One per line" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit;resize:vertical">' + esc(d.hazards || '') + '</textarea>'
    +   '</label>'
    +   '<label style="display:block;font-size:11px;color:var(--ink-3)">SWMS / SOP references'
    +     '<input type="text" value="' + esc(d.swms_refs || '') + '" onchange="setToolboxField(\'swms_refs\', this.value)" placeholder="e.g. SKS-SWMS-EL-001" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit">'
    +   '</label>'
    +   '<label style="display:block;font-size:11px;color:var(--ink-3)">Next meeting'
    +     '<input type="date" value="' + esc(d.next_meeting || '') + '" onchange="setToolboxField(\'next_meeting\', this.value)" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:6px;font-family:inherit">'
    +   '</label>'
    + '</div>'

    + '<div style="padding:12px 14px;border-top:1px solid var(--border)">'
    +   '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
    +     '<div style="font-weight:600;font-size:12px;color:var(--ink)">Photos</div>'
    +     '<div style="font-size:10px;color:var(--ink-3)">' + (d.photos || []).length + ' / ' + toolboxPhotos.maxPhotos + '</div>'
    +   '</div>'
    +   toolboxPhotos.renderList(d)
    + '</div>'

    + '<div style="padding:12px 14px;border-top:1px solid var(--border)">'
    +   '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
    +     '<div style="font-weight:600;font-size:12px;color:var(--ink)">Attendance sign-off</div>'
    +     '<div style="font-size:10px;color:var(--ink-3)">' + (d.attendance || []).filter(function (a) { return a && a.signed_at; }).length + ' of ' + (d.attendance || []).length + ' signed</div>'
    +   '</div>'
    +   attendanceHtml
    + '</div>'

    + '<div style="padding:12px 14px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;align-items:center;background:var(--surface-2);position:sticky;bottom:0">'
    +   '<span id="toolbox-offline-pill" style="display:none;font-size:10px;font-weight:600;color:var(--amber);background:var(--amber-lt);padding:3px 8px;border-radius:10px;margin-right:auto"></span>'
    +   '<button class="btn btn-secondary" onclick="saveToolboxDraft()">Save draft</button>'
    +   '<button class="btn" onclick="submitToolbox()"' + (submitOK ? '' : ' disabled style="opacity:.5;cursor:not-allowed"') + '>Submit</button>'
    + '</div>';

  toolboxQueue.updateBadge();
}

function _renderToolboxAttendance(d) {
  if (!d.attendance || !d.attendance.length) {
    return '<div style="font-size:12px;color:var(--ink-3);padding:8px 0">'
      + 'No attendees yet. '
      + '<button class="btn btn-sm" onclick="addToolboxAttendeesFromRoster()">＋ Pull from today\'s roster</button> '
      + '<button class="btn btn-secondary btn-sm" onclick="addToolboxAttendeeManual()">＋ Add by name</button>'
    + '</div>';
  }
  const rows = d.attendance.map(function (a, i) {
    let tick;
    if (a.signed_at && a.signature_image) {
      tick = '<img src="' + esc(a.signature_image) + '" alt="signed" style="height:34px;width:auto;max-width:90px;background:#fff;border:1px solid var(--border);border-radius:3px;padding:2px;flex-shrink:0">';
    } else if (a.signed_at) {
      tick = '<span style="color:var(--green);font-size:16px;font-weight:700">✓</span>';
    } else {
      tick = '<button class="btn btn-secondary btn-sm" onclick="signToolboxAttendee(' + i + ')">Sign</button>';
    }
    const signedLabel = a.signed_at
      ? '<span style="font-size:10px;color:var(--ink-3);margin-left:8px">' + esc(_toolboxFormatAuTime(a.signed_at)) + '</span>'
      : '';
    const bg = a.signed_at ? 'var(--green-lt)' : 'var(--surface)';
    return '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;margin-bottom:4px;background:' + bg + '">'
      +   '<span style="flex:1;font-size:13px;color:var(--ink)">' + esc(a.name) + '</span>'
      +   signedLabel
      +   tick
      +   '<button onclick="removeToolboxAttendee(' + i + ')" title="Remove" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:14px;padding:0 4px">✕</button>'
    + '</div>';
  }).join('');
  return rows + '<div style="margin-top:6px">'
    + '<button class="btn btn-secondary btn-sm" onclick="addToolboxAttendeesFromRoster()">↻ Refresh from today\'s roster</button> '
    + '<button class="btn btn-secondary btn-sm" onclick="addToolboxAttendeeManual()">＋ Add by name</button>'
  + '</div>';
}

// ── Field setters ───────────────────────────────────────────
function setToolboxField(key, val) {
  if (!toolboxDraft) return;
  toolboxDraft[key] = val;
}

// ── Attendance helpers ──────────────────────────────────────
function addToolboxAttendeesFromRoster() {
  if (!toolboxDraft || !toolboxDraft.site_abbr) {
    if (typeof showToast === 'function') showToast('Pick a site first');
    return;
  }
  const siteAbbr = toolboxDraft.site_abbr;
  const wk     = (typeof getWeekForDate === 'function') ? getWeekForDate(toolboxDraft.meeting_date) : null;
  const dayKey = _toolboxDayKey(toolboxDraft.meeting_date);
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
  const existing = new Set((toolboxDraft.attendance || []).map(function (a) { return a.name; }));
  matches.forEach(function (m) {
    if (!existing.has(m.name)) {
      toolboxDraft.attendance.push({
        name:       m.name,
        person_id:  m.id != null ? String(m.id) : null,
        signed_at:  null
      });
    }
  });
  renderToolboxForm();
  if (typeof showToast === 'function') showToast('Pulled ' + matches.length + ' from roster');
}

function addToolboxAttendeeManual() {
  const raw = prompt('Attendee name (e.g. visiting subbie, client rep)');
  if (!raw) return;
  const name = String(raw).trim().slice(0, 80);
  if (!name) return;
  if (!Array.isArray(toolboxDraft.attendance)) toolboxDraft.attendance = [];
  toolboxDraft.attendance.push({ name: name, person_id: null, signed_at: null });
  renderToolboxForm();
}

function signToolboxAttendee(i) {
  toolboxSignature.openModal(i);
}

function removeToolboxAttendee(i) {
  if (!toolboxDraft || !toolboxDraft.attendance) return;
  toolboxDraft.attendance.splice(i, 1);
  renderToolboxForm();
}

// ── Submit gating ───────────────────────────────────────────
function canSubmitToolbox(d) {
  if (!d) return false;
  if (!d.site_abbr) return false;
  if (!d.topic || !d.topic.trim()) return false;
  if (!d.attendance || !d.attendance.length) return false;
  // Require at least one signed attendee.
  return d.attendance.some(function (a) { return a && a.signed_at; });
}

// ── Persist ─────────────────────────────────────────────────
async function saveToolboxDraft() {
  if (!toolboxDraft) return;
  const key = 'draft:' + (toolboxCurrentId || 'new');
  if (_toolboxInflight.has(key)) return;
  _toolboxInflight.add(key);

  try {
    toolboxDraft.status = 'draft';
    const written = await _persistToolbox(toolboxDraft);
    if (written) {
      toolboxCurrentId = written.id || toolboxCurrentId;
      if (typeof auditLog === 'function') {
        auditLog('Saved draft', 'Toolbox', _toolboxSiteLabelForLog(toolboxDraft), null);
      }
      if (typeof showToast === 'function') showToast('Draft saved');
      await loadToolboxTalks();
      renderToolbox();
    }
  } catch (e) {
    console.warn('EQ[toolbox] draft save failed:', e && e.message || e);
    if (typeof showToast === 'function') showToast('Save failed — try again');
  } finally {
    _toolboxInflight.delete(key);
  }
}

async function submitToolbox() {
  if (!toolboxDraft || !canSubmitToolbox(toolboxDraft)) {
    if (typeof showToast === 'function') showToast('Site, topic, and at least one signed attendee required');
    return;
  }
  const key = 'submit:' + (toolboxCurrentId || 'new');
  if (_toolboxInflight.has(key)) return;
  _toolboxInflight.add(key);

  try {
    toolboxDraft.status       = 'submitted';
    toolboxDraft.submitted_at = new Date().toISOString();
    toolboxDraft.submitted_by = (typeof currentManagerName !== 'undefined' && currentManagerName) || null;
    const written = await _persistToolbox(toolboxDraft);
    if (written) {
      toolboxCurrentId = written.id || toolboxCurrentId;
      if (typeof auditLog === 'function') {
        auditLog('Submitted toolbox talk', 'Toolbox', _toolboxSiteLabelForLog(toolboxDraft), null);
      }
      if (typeof showToast === 'function') showToast('Toolbox talk submitted ✓');
      if (typeof closeModal === 'function') closeModal('modal-toolbox');
      await loadToolboxTalks();
      renderToolbox();
    }
  } catch (e) {
    console.warn('EQ[toolbox] submit failed:', e && e.message || e);
    if (typeof showToast === 'function') showToast('Submit failed — try again');
  } finally {
    _toolboxInflight.delete(key);
  }
}

async function _persistToolbox(record) {
  // org_id is stamped automatically by sbFetch via ORG_TABLES (app-state.js).
  const payload = {
    site_abbr:        record.site_abbr || null,
    meeting_date:     record.meeting_date,
    meeting_time:     record.meeting_time || null,
    facilitator:      record.facilitator || null,
    subcontractor:    record.subcontractor || null,
    topic:            record.topic || null,
    safety_message:   record.safety_message || null,
    items_reviewed:   record.items_reviewed || null,
    open_actions:     record.open_actions || null,
    hazards:          record.hazards || null,
    swms_refs:        record.swms_refs || null,
    next_meeting:     record.next_meeting || null,
    attendance:       record.attendance || [],
    photos:           record.photos || [],
    status:           record.status || 'draft',
    submitted_at:     record.submitted_at || null,
    submitted_by:     record.submitted_by || null,
    created_by:       record.created_by || (typeof currentManagerName !== 'undefined' && currentManagerName) || 'unknown'
  };
  return toolboxQueue.persist(record, toolboxCurrentId, payload);
}

// ── Internal helpers ────────────────────────────────────────
function _toolboxTodayIso() {
  const d = new Date();
  return d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0');
}

function _toolboxNowHHMM() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function _toolboxFormatAuDate(iso) {
  if (!iso) return '';
  const parts = String(iso).split('-');
  if (parts.length !== 3) return iso;
  return parts[2] + '/' + parts[1] + '/' + parts[0].slice(2);
}

function _toolboxFormatAuTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function _toolboxDayKey(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const map = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return map[d.getDay()];
}

function _toolboxSiteLabelForLog(d) {
  const site = (STATE.sites || []).find(function (s) { return s.abbr === d.site_abbr; });
  return site ? site.name : (d.site_abbr || 'no site');
}

// ── Shims for inline onclick="..." in shared HTML ──────────
// Photo HTML from SiteReportsShared.createPhotoController().renderList()
// calls these by name. Same for the manual-attendance prompt. Each is
// a one-line delegator to the shared controller.
function addToolboxPhoto(fileInput)          { return toolboxPhotos.add(fileInput); }
function removeToolboxPhoto(i)               { return toolboxPhotos.remove(i); }
function setToolboxPhotoCaption(i, caption)  { return toolboxPhotos.setCaption(i, caption); }
function openToolboxPhotoLightbox(i)         { return toolboxPhotos.lightbox(i); }

// v3.5.2: count accessor for the Site Reports HUB. Returns the total
// number of toolbox talks with meeting_date within the last 7 days
// (any status). `toolboxCache` is module-local so the HUB can't
// reach it directly.
window.eqGetToolboxWeekCount = function () {
  try {
    if (!Array.isArray(toolboxCache)) return 0;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    cutoff.setHours(0, 0, 0, 0);
    let n = 0;
    for (let i = 0; i < toolboxCache.length; i++) {
      const r = toolboxCache[i];
      if (!r || !r.meeting_date) continue;
      const d = new Date(r.meeting_date);
      if (!isNaN(d) && d >= cutoff) n++;
    }
    return n;
  } catch (e) { return 0; }
};
