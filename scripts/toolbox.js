/*! Property of EQ — all rights reserved. Unauthorised use prohibited. */
// ─────────────────────────────────────────────────────────────
// scripts/toolbox.js  —  EQ Solves Field
// Site Reports v2 — Toolbox Talks.
// Sibling module to scripts/site-reports.js (Prestart). Mirrors that
// file's shape so Diary (v3) and Weekly (v4) can follow the same pattern.
// Depends on: app-state.js, utils.js, supabase.js, audit.js, permissions.js
//
// Why a separate file (not appended to site-reports.js):
//   site-reports.js is already 885 lines. Four workflows in one file
//   pushes it past 3,000 — painful merges, harder PR reviews. One
//   file per workflow keeps each module under 1k lines and lets us
//   extract shared helpers (photo, signature, offline queue) into a
//   future scripts/site-report-shared.js once Diary lands.
//
// For v1, the photo / signature / offline-queue helpers are copy-pasted
// from site-reports.js with `toolbox` / `_tbx` prefixes. Refactor target:
// once Diary lands and the pattern repeats a third time, extract.
// ─────────────────────────────────────────────────────────────

// ── Module state ────────────────────────────────────────────
let toolboxCache       = [];
let toolboxDraft       = null;
let toolboxCurrentId   = null;

// v3.4.54 pattern: per-action inflight guard. Prevents iPad double-tap
// from firing duplicate Save / Submit (which would write duplicate
// audit entries and, after v2 emails ship, duplicate notifications).
const _toolboxInflight = new Set();

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

  _injectToolboxStyleOnce();

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
    +     '<div style="font-size:10px;color:var(--ink-3)">' + (d.photos || []).length + ' / ' + TOOLBOX_MAX_PHOTOS + '</div>'
    +   '</div>'
    +   _renderToolboxPhotos(d)
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

  _updateToolboxOfflineBadge();
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
  if (!toolboxDraft || !toolboxDraft.attendance || !toolboxDraft.attendance[i]) return;
  openToolboxSignatureModal(i);
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

  const method = toolboxCurrentId ? 'PATCH' : 'POST';
  const path = toolboxCurrentId
    ? 'toolbox_talks?id=eq.' + encodeURIComponent(toolboxCurrentId)
    : 'toolbox_talks';

  // Offline-first write path (same pattern as prestart).
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const localId = toolboxCurrentId || ('local_' + Date.now() + '_' + Math.floor(Math.random() * 1000));
    _enqueueToolboxWrite(method, path, payload, localId);
    if (typeof showToast === 'function') showToast('Offline — saved locally, will sync when connected');
    return { id: localId, _offline: true };
  }

  try {
    const ret = await sbFetch(path, method, payload, 'return=representation');
    if (Array.isArray(ret) && ret[0]) return ret[0];
    return toolboxCurrentId ? { id: toolboxCurrentId } : { id: null };
  } catch (e) {
    const localId = toolboxCurrentId || ('local_' + Date.now() + '_' + Math.floor(Math.random() * 1000));
    _enqueueToolboxWrite(method, path, payload, localId);
    if (typeof showToast === 'function') showToast('Network hiccup — saved locally, will sync');
    return { id: localId, _offline: true };
  }
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

// ══════════════════════════════════════════════════════════════
// Photos / signature pad / offline queue / mobile CSS.
// Mirrors site-reports.js Prestart helpers with toolbox-namespaced
// state. Refactor target: extract to scripts/site-report-shared.js
// once Diary lands and the pattern repeats a third time.
// ══════════════════════════════════════════════════════════════

// ── 1. Photos ─────────────────────────────────────────────────
const TOOLBOX_MAX_PHOTOS    = 8;
const TOOLBOX_PHOTO_MAX_DIM = 1600;
const TOOLBOX_PHOTO_QUALITY = 0.7;

function addToolboxPhoto(fileInput) {
  if (!toolboxDraft) return;
  if (!fileInput.files || !fileInput.files[0]) return;
  if ((toolboxDraft.photos || []).length >= TOOLBOX_MAX_PHOTOS) {
    if (typeof showToast === 'function') showToast('Max ' + TOOLBOX_MAX_PHOTOS + ' photos');
    return;
  }
  const file = fileInput.files[0];
  if (!/^image\//.test(file.type)) {
    if (typeof showToast === 'function') showToast('Image files only');
    return;
  }
  _toolboxResizeImageToBase64(file, function (base64) {
    if (!base64) {
      if (typeof showToast === 'function') showToast('Photo too large or unreadable');
      return;
    }
    if (!Array.isArray(toolboxDraft.photos)) toolboxDraft.photos = [];
    toolboxDraft.photos.push({
      id:       'p_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      caption:  '',
      base64:   base64,
      taken_at: new Date().toISOString(),
      taken_by: (typeof currentManagerName !== 'undefined' && currentManagerName) || null
    });
    fileInput.value = '';
    renderToolboxForm();
  });
}

function _toolboxResizeImageToBase64(file, callback) {
  const reader = new FileReader();
  reader.onload = function (e) {
    const img = new Image();
    img.onload = function () {
      let width = img.width;
      let height = img.height;
      const max = TOOLBOX_PHOTO_MAX_DIM;
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
      try { callback(canvas.toDataURL('image/jpeg', TOOLBOX_PHOTO_QUALITY)); }
      catch (err) { callback(null); }
    };
    img.onerror = function () { callback(null); };
    img.src = e.target.result;
  };
  reader.onerror = function () { callback(null); };
  reader.readAsDataURL(file);
}

function removeToolboxPhoto(i) {
  if (!toolboxDraft || !toolboxDraft.photos) return;
  toolboxDraft.photos.splice(i, 1);
  renderToolboxForm();
}

function setToolboxPhotoCaption(i, caption) {
  if (!toolboxDraft || !toolboxDraft.photos || !toolboxDraft.photos[i]) return;
  toolboxDraft.photos[i].caption = caption;
}

function openToolboxPhotoLightbox(i) {
  if (!toolboxDraft || !toolboxDraft.photos || !toolboxDraft.photos[i]) return;
  const p = toolboxDraft.photos[i];
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.92);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px;cursor:zoom-out';
  overlay.onclick = function () { overlay.remove(); };
  const img = document.createElement('img');
  img.src = p.base64;
  img.style.cssText = 'max-width:100%;max-height:90vh;object-fit:contain';
  overlay.appendChild(img);
  document.body.appendChild(overlay);
}

function _renderToolboxPhotos(d) {
  const photos = d.photos || [];
  const grid = photos.map(function (p, i) {
    const cap = p.caption
      ? '<div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,.65);color:#fff;font-size:9px;padding:2px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(p.caption) + '</div>'
      : '';
    return '<div style="position:relative;width:84px;height:84px;border-radius:6px;overflow:hidden;border:1px solid var(--border);background:var(--surface-2);cursor:pointer;flex-shrink:0">'
      + '<img src="' + esc(p.base64) + '" style="width:100%;height:100%;object-fit:cover" onclick="openToolboxPhotoLightbox(' + i + ')">'
      + '<button onclick="removeToolboxPhoto(' + i + ');event.stopPropagation()" title="Remove" style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,.6);color:#fff;border:none;border-radius:50%;width:20px;height:20px;cursor:pointer;font-size:11px;line-height:1;display:flex;align-items:center;justify-content:center">✕</button>'
      + cap
    + '</div>';
  }).join('');
  const addBtn = photos.length < TOOLBOX_MAX_PHOTOS
    ? '<label style="width:84px;height:84px;border:1px dashed var(--border);border-radius:6px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;background:var(--surface);font-size:10px;color:var(--ink-3);user-select:none;flex-shrink:0">'
      + '<span style="font-size:22px;line-height:1">📷</span>'
      + '<span style="margin-top:2px">Add photo</span>'
      + '<input type="file" accept="image/*" capture="environment" onchange="addToolboxPhoto(this)" style="display:none">'
    + '</label>'
    : '';
  const captionInputs = photos.length
    ? '<div style="margin-top:8px;display:grid;grid-template-columns:1fr 1fr;gap:6px">'
      + photos.map(function (p, i) {
        return '<input type="text" placeholder="Caption photo ' + (i + 1) + '" value="' + esc(p.caption || '') + '" oninput="setToolboxPhotoCaption(' + i + ', this.value)" style="padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:11px;font-family:inherit">';
      }).join('')
    + '</div>'
    : '';
  return '<div style="display:flex;flex-wrap:wrap;gap:6px">' + grid + addBtn + '</div>' + captionInputs;
}

// ── 2. Signature pad ──────────────────────────────────────────
let _tbxSigCanvasState = null;

function openToolboxSignatureModal(attendeeIndex) {
  if (!toolboxDraft || !toolboxDraft.attendance[attendeeIndex]) return;
  if (toolboxDraft.attendance[attendeeIndex].signed_at) return; // idempotent
  const name = toolboxDraft.attendance[attendeeIndex].name;
  let modal = document.getElementById('modal-toolbox-signature');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'modal-toolbox-signature';
    modal.innerHTML =
        '<div class="modal" style="max-width:480px;width:92vw">'
      +   '<div class="modal-header">'
      +     '<h3 id="tbx-sig-title" style="margin:0">Sign — </h3>'
      +     '<button class="modal-close" onclick="closeToolboxSignature()">✕</button>'
      +   '</div>'
      +   '<div class="modal-body" style="padding:14px">'
      +     '<div style="font-size:11px;color:var(--ink-3);margin-bottom:6px">Sign with your finger or mouse — stamps signed_at + signed_by onto the talk.</div>'
      +     '<canvas id="tbx-sig-canvas" style="width:100%;height:200px;background:#fff;border:1px solid var(--border);border-radius:8px;touch-action:none;display:block"></canvas>'
      +     '<div style="display:flex;gap:8px;align-items:center;margin-top:12px">'
      +       '<button class="btn btn-secondary btn-sm" onclick="clearToolboxSignature()">Clear</button>'
      +       '<div style="flex:1"></div>'
      +       '<button class="btn btn-secondary btn-sm" onclick="closeToolboxSignature()">Cancel</button>'
      +       '<button class="btn" id="tbx-sig-save-btn">Save signature</button>'
      +     '</div>'
      +   '</div>'
      + '</div>';
    document.body.appendChild(modal);
  }
  document.getElementById('tbx-sig-title').textContent = 'Sign — ' + name;
  const saveBtn = document.getElementById('tbx-sig-save-btn');
  if (saveBtn) saveBtn.onclick = function () { saveToolboxSignature(attendeeIndex); };
  if (typeof openModal === 'function') openModal('modal-toolbox-signature');
  setTimeout(_initToolboxSignatureCanvas, 30);
}

function _initToolboxSignatureCanvas() {
  const canvas = document.getElementById('tbx-sig-canvas');
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
  _tbxSigCanvasState = { canvas: canvas, ctx: ctx, drawing: false, hasInk: false };
  function pos(evt) {
    const r = canvas.getBoundingClientRect();
    const t = evt.touches ? evt.touches[0] : evt;
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  }
  function start(evt) { evt.preventDefault(); _tbxSigCanvasState.drawing = true; const p = pos(evt); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
  function move(evt)  { if (!_tbxSigCanvasState.drawing) return; evt.preventDefault(); const p = pos(evt); ctx.lineTo(p.x, p.y); ctx.stroke(); _tbxSigCanvasState.hasInk = true; }
  function end(evt)   { if (evt) evt.preventDefault(); _tbxSigCanvasState.drawing = false; }
  canvas.addEventListener('mousedown',  start);
  canvas.addEventListener('mousemove',  move);
  canvas.addEventListener('mouseup',    end);
  canvas.addEventListener('mouseleave', end);
  canvas.addEventListener('touchstart', start);
  canvas.addEventListener('touchmove',  move);
  canvas.addEventListener('touchend',   end);
}

function clearToolboxSignature() {
  if (!_tbxSigCanvasState) return;
  const c = _tbxSigCanvasState.canvas;
  _tbxSigCanvasState.ctx.clearRect(0, 0, c.width, c.height);
  _tbxSigCanvasState.hasInk = false;
}

function saveToolboxSignature(attendeeIndex) {
  if (!_tbxSigCanvasState || !_tbxSigCanvasState.hasInk) {
    if (typeof showToast === 'function') showToast('Sign first — empty signatures don\'t count');
    return;
  }
  const dataUri = _tbxSigCanvasState.canvas.toDataURL('image/png');
  if (!toolboxDraft || !toolboxDraft.attendance[attendeeIndex]) return;
  toolboxDraft.attendance[attendeeIndex].signature_image = dataUri;
  toolboxDraft.attendance[attendeeIndex].signed_at = new Date().toISOString();
  toolboxDraft.attendance[attendeeIndex].signed_by = (typeof currentManagerName !== 'undefined' && currentManagerName) || null;
  closeToolboxSignature();
  renderToolboxForm();
}

function closeToolboxSignature() {
  if (typeof closeModal === 'function') closeModal('modal-toolbox-signature');
  _tbxSigCanvasState = null;
}

// ── 3. Offline write queue ────────────────────────────────────
const TOOLBOX_QUEUE_KEY = 'eq_toolbox_offline_queue_v1';

function _readToolboxQueue() {
  try { return JSON.parse(localStorage.getItem(TOOLBOX_QUEUE_KEY) || '[]'); }
  catch (e) { return []; }
}
function _writeToolboxQueue(items) {
  try { localStorage.setItem(TOOLBOX_QUEUE_KEY, JSON.stringify(items || [])); }
  catch (e) { console.warn('EQ[toolbox] queue write failed (storage full?):', e); }
}

function _enqueueToolboxWrite(method, path, payload, localId) {
  const queue = _readToolboxQueue();
  queue.push({
    qid:       'q_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    localId:   localId,
    queued_at: new Date().toISOString(),
    tenant:    (typeof TENANT !== 'undefined' && TENANT.ORG_SLUG) || 'unknown',
    method:    method,
    path:      path,
    payload:   payload
  });
  _writeToolboxQueue(queue);
  _updateToolboxOfflineBadge();
}

function _updateToolboxOfflineBadge() {
  const myTenant = (typeof TENANT !== 'undefined' && TENANT.ORG_SLUG) || 'unknown';
  const queue = _readToolboxQueue().filter(function (q) { return q.tenant === myTenant; });
  const el = document.getElementById('toolbox-offline-pill');
  if (el) {
    if (queue.length) {
      el.style.display = '';
      el.textContent = '⏳ ' + queue.length + ' offline write' + (queue.length === 1 ? '' : 's') + ' pending';
    } else {
      el.style.display = 'none';
    }
  }
}

async function _replayToolboxQueue() {
  if (!navigator.onLine) return;
  const all = _readToolboxQueue();
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
      console.warn('EQ[toolbox] replay failed for', item.qid, e && e.message || e);
      remaining.push(item);
    }
  }
  _writeToolboxQueue(remaining);
  _updateToolboxOfflineBadge();
  if (synced > 0) {
    if (typeof showToast === 'function') showToast('Synced ' + synced + ' offline toolbox talk' + (synced === 1 ? '' : 's'));
    await loadToolboxTalks();
    if (typeof currentPage !== 'undefined' && currentPage === 'toolbox') renderToolbox();
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', _replayToolboxQueue);
  setTimeout(_replayToolboxQueue, 1800);  // staggered slightly behind prestart's 1500
}

// ── 4. Mobile CSS ─────────────────────────────────────────────
function _injectToolboxStyleOnce() {
  if (document.getElementById('toolbox-mvp-style')) return;
  const s = document.createElement('style');
  s.id = 'toolbox-mvp-style';
  s.textContent = ''
    + '@media (max-width: 640px) {'
    +   '#modal-toolbox .modal { max-width:100vw !important; width:100vw !important; height:100vh !important; max-height:100vh !important; border-radius:0 !important; }'
    +   '#toolbox-form-body div[style*="grid-template-columns:1fr 1fr"],'
    +   '#toolbox-form-body div[style*="grid-template-columns: 1fr 1fr"]'
    +   ' { grid-template-columns:1fr !important; }'
    +   '#modal-toolbox-signature .modal { max-width:100vw !important; width:100vw !important; }'
    +   '#modal-toolbox-signature canvas { height:260px !important; }'
    + '}';
  document.head.appendChild(s);
}
