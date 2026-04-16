// ─────────────────────────────────────────────────────────────
// scripts/leave.js  —  EQ Solves Field
// Leave requests: submit, approve/reject, calendar, email,
// CC list, print, clear, badge, schedule write-back.
// Depends on: app-state.js, utils.js, supabase.js, roster.js
// ─────────────────────────────────────────────────────────────

// ── Module state ─────────────────────────────────────────────
let leaveRequests = [];
let leaveMode     = 'range';
let pickedDays    = [];
let leaveCCList   = [];
let leaveViewMode = 'list';
let leaveCalMonth = new Date().getMonth();
let leaveCalYear  = new Date().getFullYear();

// ── Load / save CC list ───────────────────────────────────────

async function loadLeaveCCList() {
  try {
    const rows = await sbFetch('app_config?key=eq.leave_cc_list&select=value');
    if (rows && rows[0] && rows[0].value) leaveCCList = JSON.parse(rows[0].value);
  } catch (e) {
    leaveCCList = JSON.parse(localStorage.getItem('eq_leave_cc') || '[]');
  }
}

async function saveLeaveCCList() {
  try {
    await sbFetch('app_config?key=eq.leave_cc_list', 'PATCH', { value: JSON.stringify(leaveCCList) });
  } catch (e) {
    localStorage.setItem('eq_leave_cc', JSON.stringify(leaveCCList));
  }
}

function openLeaveCCConfig() {
  if (!isManager) { showToast('Supervision access required'); return; }
  renderLeaveCCList();
  openModal('modal-leave-cc');
}

function renderLeaveCCList() {
  const el = document.getElementById('leave-cc-list');
  if (!leaveCCList.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--ink-3);padding:8px 0">No CC recipients configured yet.</div>';
    return;
  }
  el.innerHTML = leaveCCList.map((email, i) =>
    `<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;margin-bottom:4px">
      <span style="flex:1;font-size:12px;color:var(--ink)">${esc(email)}</span>
      <button onclick="removeLeaveCC(${i})" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:14px;padding:0">✕</button>
    </div>`
  ).join('');
}

function addLeaveCC() {
  const input = document.getElementById('leave-cc-new');
  const email = input.value.trim().toLowerCase();
  if (!email || !email.includes('@')) { showToast('Enter a valid email'); return; }
  if (leaveCCList.includes(email)) { showToast('Already in the list'); return; }
  leaveCCList.push(email);
  saveLeaveCCList();
  input.value = '';
  renderLeaveCCList();
  showToast(`${email} added to CC list`);
}

function removeLeaveCC(idx) {
  const removed = leaveCCList.splice(idx, 1);
  saveLeaveCCList();
  renderLeaveCCList();
  showToast(`${removed} removed`);
}

// ── Load from Supabase ────────────────────────────────────────

let showArchivedLeave = false;

async function loadLeaveRequests() {
  try {
    const archiveFilter = showArchivedLeave ? '' : '&archived=eq.false';
    leaveRequests = await sbFetch('leave_requests?select=*&order=created_at.desc' + archiveFilter);
  } catch (e) {
    leaveRequests = [];
  }
  updateLeaveBadge();
}

function updateLeaveBadge() {
  const pending = leaveRequests.filter(r => r.status === 'Pending').length;
  const badge   = document.getElementById('badge-leave');
  if (badge) {
    badge.textContent    = pending;
    badge.style.display  = pending > 0 ? '' : 'none';
  }
}

// ── Date helpers ──────────────────────────────────────────────

function getWeekForDate(date) {
  const mon = new Date(date);
  mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
  const dd = String(mon.getDate()).padStart(2, '0');
  const mm = String(mon.getMonth() + 1).padStart(2, '0');
  const yy = String(mon.getFullYear()).slice(-2);
  return `${dd}.${mm}.${yy}`;
}

// ── Submit ────────────────────────────────────────────────────

function setLeaveMode(mode) {
  leaveMode = mode;
  document.getElementById('leave-range-fields').style.display = mode === 'range' ? '' : 'none';
  document.getElementById('leave-pick-fields').style.display  = mode === 'pick'  ? '' : 'none';
  document.getElementById('leave-mode-range').className = mode === 'range' ? 'btn btn-sm' : 'btn btn-secondary btn-sm';
  document.getElementById('leave-mode-pick').className  = mode === 'pick'  ? 'btn btn-sm' : 'btn btn-secondary btn-sm';
}

function addPickedDay() {
  const val = document.getElementById('leave-pick-date').value;
  if (!val || pickedDays.includes(val)) return;
  pickedDays.push(val);
  pickedDays.sort();
  renderPickedDays();
  document.getElementById('leave-pick-date').value = '';
}

function removePickedDay(d) {
  pickedDays = pickedDays.filter(x => x !== d);
  renderPickedDays();
}

function renderPickedDays() {
  const el = document.getElementById('leave-picked-list');
  if (!pickedDays.length) { el.innerHTML = '<span style="font-size:11px;color:var(--ink-3)">No days selected</span>'; return; }
  el.innerHTML = pickedDays.map(d => {
    const dt    = new Date(d + 'T00:00:00');
    const label = dt.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
    return `<span style="display:inline-flex;align-items:center;gap:4px;background:var(--purple-lt);color:var(--navy);font-size:11px;font-weight:600;padding:3px 8px;border-radius:6px">${label}<button onclick="removePickedDay('${d}')" style="background:none;border:none;color:var(--ink-3);cursor:pointer;font-size:12px;padding:0 0 0 2px">✕</button></span>`;
  }).join('');
}

function openLeaveRequest() {
  const pSel   = document.getElementById('leave-person');

  // Merge staff (STATE.people) + supervisors (STATE.managers) so
  // supervisors can also submit leave requests. Dedupe by name.
  const peopleList = (STATE.people || []).map(p => ({
    name:  p.name,
    group: p.group || ''
  }));
  const supervisorList = (STATE.managers || []).map(m => ({
    name:  m.name,
    group: 'Supervisor'
  }));
  const byName = new Map();
  [...peopleList, ...supervisorList].forEach(x => {
    if (!byName.has(x.name)) byName.set(x.name, x);
  });
  const combined = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));

  pSel.innerHTML = '<option value="">— Select your name —</option>' +
    combined.map(p => {
      const suffix = p.group === 'Supervisor' ? ' — Supervisor' : '';
      return `<option value="${esc(p.name)}">${esc(p.name)}${suffix}</option>`;
    }).join('');

  const aSel = document.getElementById('leave-approver');
  const mgrs = [...(STATE.managers || [])].sort((a, b) => a.name.localeCompare(b.name));
  aSel.innerHTML = '<option value="">— Select approver —</option>' +
    mgrs.map(m => `<option value="${esc(m.name)}">${esc(m.name)}${m.role ? ' — ' + m.role : ''}</option>`).join('');

  document.getElementById('leave-type').value  = 'A/L';
  document.getElementById('leave-start').value = '';
  document.getElementById('leave-end').value   = '';
  document.getElementById('leave-note').value  = '';
  pickedDays = [];
  setLeaveMode('range');
  renderPickedDays();
  document.getElementById('leave-modal-title').textContent = 'New Leave Request';
  openModal('modal-leave-request');
}

async function submitLeaveRequest() {
  const name     = document.getElementById('leave-person').value;
  const type     = document.getElementById('leave-type').value;
  const approver = document.getElementById('leave-approver').value;
  const note     = document.getElementById('leave-note').value.trim();

  if (!name)     { showToast('Select your name');    return; }
  if (!approver) { showToast('Select an approver');  return; }

  let dateStart, dateEnd, individualDays = null;
  if (leaveMode === 'range') {
    dateStart = document.getElementById('leave-start').value;
    dateEnd   = document.getElementById('leave-end').value;
    if (!dateStart || !dateEnd) { showToast('Select start and end dates'); return; }
    if (dateEnd < dateStart)    { showToast('End date must be after start date'); return; }
  } else {
    if (!pickedDays.length) { showToast('Pick at least one day'); return; }
    dateStart     = pickedDays[0];
    dateEnd       = pickedDays[pickedDays.length - 1];
    individualDays = pickedDays;
  }

  // LEV-002: Overlap check
  const newStart = new Date(dateStart + 'T00:00:00');
  const newEnd   = new Date(dateEnd   + 'T00:00:00');
  const overlap  = leaveRequests.find(r => {
    if (r.requester_name !== name) return false;
    if (r.status !== 'Pending' && r.status !== 'Approved') return false;
    const rS = new Date(r.date_start + 'T00:00:00');
    const rE = new Date(r.date_end   + 'T00:00:00');
    return newStart <= rE && newEnd >= rS;
  });
  if (overlap) {
    showToast(`⚠ ${name} already has ${overlap.status.toLowerCase()} leave for ${overlap.date_start} to ${overlap.date_end}`);
    return;
  }

  const row = {
    requester_name:  name,
    leave_type:      type,
    date_start:      dateStart,
    date_end:        dateEnd,
    individual_days: individualDays,
    note:            note || null,
    approver_name:   approver,
    status:          'Pending'
  };

  try {
    const res = await sbFetch('leave_requests', 'POST', row, 'return=representation');
    closeModal('modal-leave-request');
    showToast('Leave request submitted');
    auditLog(`Leave request: ${name} ${type} ${dateStart} to ${dateEnd}`, 'Leave', approver, null);
    triggerLeaveEmail('new_request', res[0] || row).catch(() => {});
    await loadLeaveRequests();
    renderLeave();
  } catch (e) {
    showToast('Failed to submit — check connection');
  }
}

// ── Review / respond ──────────────────────────────────────────

function openLeaveRespond(id) {
  if (!isManager) { showToast('Supervision access required'); return; }
  const req = leaveRequests.find(r => r.id === id);
  if (!req) return;

  document.getElementById('leave-respond-id').value    = id;
  document.getElementById('leave-response-note').value = '';

  const ds  = new Date(req.date_start + 'T00:00:00');
  const de  = new Date(req.date_end   + 'T00:00:00');
  const fmt = d => d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  let datesHtml;
  if (req.individual_days && req.individual_days.length) {
    datesHtml = req.individual_days
      .map(d => new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }))
      .join(', ');
  } else {
    datesHtml = `${fmt(ds)} → ${fmt(de)}`;
  }

  let bizDays = 0;
  if (req.individual_days && req.individual_days.length) {
    bizDays = req.individual_days.length;
  } else {
    const d = new Date(ds);
    while (d <= de) { if (d.getDay() !== 0 && d.getDay() !== 6) bizDays++; d.setDate(d.getDate() + 1); }
  }

  const typeLabels = { 'A/L': 'Annual Leave', 'U/L': 'Unpaid Leave', 'RDO': 'RDO' };

  document.getElementById('leave-respond-detail').innerHTML = `
    <div style="background:var(--surface-2);border-radius:10px;padding:16px;border:1px solid var(--border)">
      <div style="font-size:16px;font-weight:700;color:var(--navy);margin-bottom:8px">${esc(req.requester_name)}</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:8px">
        <div><span style="font-size:10px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.5px">Type</span><br><span style="font-weight:600">${typeLabels[req.leave_type] || req.leave_type}</span></div>
        <div><span style="font-size:10px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.5px">Days</span><br><span style="font-weight:600">${bizDays} day${bizDays !== 1 ? 's' : ''}</span></div>
      </div>
      <div style="font-size:12px;color:var(--ink-2);margin-bottom:4px">${datesHtml}</div>
      ${req.note ? `<div style="font-size:12px;color:var(--ink-3);margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">📝 ${esc(req.note)}</div>` : ''}
      <div style="font-size:10px;color:var(--ink-4);margin-top:8px">Requested: ${new Date(req.created_at).toLocaleString('en-AU')}</div>
    </div>`;

  openModal('modal-leave-respond');
}

async function respondLeave(status) {
  if (!isManager) { showToast('Supervision access required'); return; }
  // BUG-014 FIX: read id exactly once
  const id   = parseInt(document.getElementById('leave-respond-id').value);
  const note = document.getElementById('leave-response-note').value.trim();
  const req  = leaveRequests.find(r => r.id === id);

  // A01-04: Block self-approval
  if (req && req.requester_name === currentManagerName && status === 'Approved') {
    showToast('⚠ You cannot approve your own leave request. Ask another supervisor.');
    return;
  }
  if (!req) return;

  try {
    await sbFetch(`leave_requests?id=eq.${id}`, 'PATCH', {
      status:         status,
      response_note:  note || null,
      responded_by:   currentManagerName,
      responded_at:   new Date().toISOString()
    });

    if (status === 'Approved') {
      // LEV-003: Warn about roster conflicts
      const leaveDates = _getLeaveDates(req);
      const conflicts  = [];
      leaveDates.forEach(ds => {
        const weekStr = getWeekForDate(new Date(ds + 'T00:00:00'));
        const dayName = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(ds + 'T00:00:00').getDay()];
        const sched   = STATE.schedule.find(r => r.name === req.requester_name && r.week === weekStr);
        if (sched && sched[dayName] && !isLeave(sched[dayName])) {
          conflicts.push(sched[dayName] + ' on ' + ds);
        }
      });
      if (conflicts.length) {
        showToast('⚠ Overwriting roster entries: ' + conflicts.slice(0, 3).join(', ') + (conflicts.length > 3 ? '…' : ''));
      }
      await writeLeaveToSchedule(req);
    }

    closeModal('modal-leave-respond');
    showToast(`Leave ${status.toLowerCase()} for ${req.requester_name}`);
    auditLog(`Leave ${status}: ${req.requester_name} ${req.leave_type}`, 'Leave', `${req.date_start} to ${req.date_end}`, null);
    const updatedReq = { ...req, status, response_note: note || null, responded_by: currentManagerName };
    triggerLeaveEmail('status_update', updatedReq).catch(() => {});
    await loadLeaveRequests();
    renderLeave();
  } catch (e) {
    showToast('Failed — check connection');
  }
}

function _getLeaveDates(req) {
  if (req.individual_days && req.individual_days.length) return req.individual_days;
  const dates = [];
  const d     = new Date(req.date_start + 'T00:00:00');
  const end   = new Date(req.date_end   + 'T00:00:00');
  while (d <= end) {
    if (d.getDay() !== 0 && d.getDay() !== 6) dates.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

async function writeLeaveToSchedule(req) {
  // Supervisors aren't on the roster — the leave request itself is
  // the record of record for them. Skip the schedule write-back.
  const isOnRoster = (STATE.people || []).some(p => p.name === req.requester_name);
  if (!isOnRoster) return;

  const dates = _getLeaveDates(req);
  const byWeek = {};
  dates.forEach(ds => {
    const dt     = new Date(ds + 'T00:00:00');
    const wk     = getWeekForDate(dt);
    const dayIdx = (dt.getDay() + 6) % 7;
    const dayKey = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'][dayIdx];
    if (!byWeek[wk]) byWeek[wk] = [];
    byWeek[wk].push(dayKey);
  });

  for (const [week, dayKeys] of Object.entries(byWeek)) {
    for (const day of dayKeys) {
      await saveCellToSB(req.requester_name, week, day, req.leave_type);
    }
    let entry = STATE.schedule.find(r => r.name === req.requester_name && r.week === week);
    if (!entry) {
      entry = { name: req.requester_name, week, mon: '', tue: '', wed: '', thu: '', fri: '', sat: '', sun: '' };
      STATE.schedule.push(entry);
    }
    dayKeys.forEach(d => { entry[d] = req.leave_type; });
    if (STATE.scheduleIndex) STATE.scheduleIndex[`${req.requester_name}||${week}`] = entry;
  }
}

// ── Archive ──────────────────────────────────────────────────
// Archiving hides leave requests from the default view but does
// NOT touch the roster/schedule — approved leave stays on the grid.

async function archiveLeaveRequest(id) {
  if (!isManager) { showToast('Supervision access required'); return; }
  const req = leaveRequests.find(r => r.id === id);
  if (!req) return;
  try {
    await sbFetch(`leave_requests?id=eq.${id}`, 'PATCH', { archived: true });
    req.archived = true;
    if (!showArchivedLeave) leaveRequests = leaveRequests.filter(r => r.id !== id);
    updateLeaveBadge();
    renderLeave();
    showToast(`${req.requester_name} leave archived`);
    auditLog(`Archived leave: ${req.requester_name} ${req.leave_type}`, 'Leave', `${req.date_start} to ${req.date_end}`, null);
  } catch (e) {
    showToast('Archive failed — check connection');
  }
}

async function unarchiveLeaveRequest(id) {
  if (!isManager) { showToast('Supervision access required'); return; }
  const req = leaveRequests.find(r => r.id === id);
  if (!req) return;
  try {
    await sbFetch(`leave_requests?id=eq.${id}`, 'PATCH', { archived: false });
    req.archived = false;
    updateLeaveBadge();
    renderLeave();
    showToast(`${req.requester_name} leave restored`);
  } catch (e) {
    showToast('Restore failed — check connection');
  }
}

function confirmArchiveAllResolved() {
  if (!isManager) { showToast('Supervision access required'); return; }
  const resolved = leaveRequests.filter(r => (r.status === 'Approved' || r.status === 'Rejected') && !r.archived);
  if (!resolved.length) { showToast('No resolved requests to archive'); return; }
  document.getElementById('confirm-title').textContent = 'Archive Resolved Requests';
  document.getElementById('confirm-msg').textContent =
    `Archive ${resolved.length} resolved request${resolved.length !== 1 ? 's' : ''} (Approved + Rejected)? They'll be hidden from this view but preserved for records. The roster is not affected.`;
  document.getElementById('confirm-action').textContent = 'Archive';
  document.getElementById('confirm-action').onclick = async () => {
    try {
      const ids = resolved.map(r => r.id);
      for (const id of ids) {
        await sbFetch(`leave_requests?id=eq.${id}`, 'PATCH', { archived: true });
      }
      closeModal('modal-confirm');
      await loadLeaveRequests();
      renderLeave();
      showToast(`${resolved.length} request${resolved.length !== 1 ? 's' : ''} archived`);
      auditLog('Archived all resolved leave requests', 'Leave', `${resolved.length} archived`, null);
    } catch (e) {
      showToast('Archive failed — check connection');
    }
  };
  openModal('modal-confirm');
}

async function toggleShowArchived() {
  showArchivedLeave = !showArchivedLeave;
  const btn = document.getElementById('leave-archive-toggle');
  if (btn) {
    btn.textContent = showArchivedLeave ? '📦 Hide Archived' : '📦 Show Archived';
    btn.style.background = showArchivedLeave ? 'var(--purple-lt)' : '';
    btn.style.color = showArchivedLeave ? 'var(--purple)' : '';
  }
  await loadLeaveRequests();
  renderLeave();
}

// ── Resend email ──────────────────────────────────────────────

async function resendLeaveEmail(id) {
  const req = leaveRequests.find(r => r.id === id);
  if (!req) { showToast('Request not found'); return; }
  showToast('Resending email…');
  await triggerLeaveEmail('new_request', req);
}

// ── Email via Netlify Function ────────────────────────────────

async function triggerLeaveEmail(type, record) {
  try {
    const typeLabels = { 'A/L': 'Annual Leave', 'U/L': 'Unpaid Leave', 'RDO': 'RDO' };
    let to, cc = [], subject, html;

    if (type === 'new_request') {
      const mgr = (STATE.managers || []).find(m => m.name === record.approver_name);
      if (!mgr || !mgr.email) {
        showToast(`⚠ No email on file for approver ${record.approver_name} — notification not sent`);
        return;
      }
      to      = mgr.email;
      cc      = leaveCCList.filter(e => e && e !== to);
      subject = `Leave Request: ${record.requester_name} — ${typeLabels[record.leave_type] || record.leave_type} (${record.date_start} to ${record.date_end})`;
      html    = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:500px;margin:0 auto">
        <div style="background:#1F335C;padding:20px 24px;border-radius:12px 12px 0 0">
          <h2 style="color:white;margin:0;font-size:18px">Leave Request</h2>
          <p style="color:rgba(255,255,255,.6);margin:4px 0 0;font-size:13px">EQ Solves — Field</p>
        </div>
        <div style="background:white;padding:24px;border:1px solid #E5E7EB;border-top:none;border-radius:0 0 12px 12px">
          <p style="margin:0 0 16px;font-size:14px;color:#374151"><strong>${escHtml(record.requester_name)}</strong> has submitted a leave request for your approval.</p>
          <table style="width:100%;font-size:13px;color:#374151;border-collapse:collapse">
            <tr><td style="padding:8px 0;color:#6B7280;width:100px">Type</td><td style="padding:8px 0;font-weight:600">${typeLabels[record.leave_type] || record.leave_type}</td></tr>
            <tr><td style="padding:8px 0;color:#6B7280">Dates</td><td style="padding:8px 0;font-weight:600">${record.date_start} to ${record.date_end}</td></tr>
            ${record.note ? `<tr><td style="padding:8px 0;color:#6B7280">Note</td><td style="padding:8px 0">${escHtml(record.note)}</td></tr>` : ''}
          </table>
          <div style="margin-top:20px">
            <a href="https://eq-solves-field.netlify.app" style="display:inline-block;background:#1F335C;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">Review in App →</a>
          </div>
        </div>
      </div>`;
    } else if (type === 'status_update') {
      const person = (STATE.people || []).find(p => p.name === record.requester_name);
      if (!person || !person.email) {
        showToast(`⚠ No email on file for ${record.requester_name} — notification not sent`);
        return;
      }
      to      = person.email;
      const statusColor = record.status === 'Approved' ? '#16A34A' : '#DC2626';
      subject = `Leave ${record.status}: ${typeLabels[record.leave_type] || record.leave_type} (${record.date_start} to ${record.date_end})`;
      html    = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:500px;margin:0 auto">
        <div style="background:#1F335C;padding:20px 24px;border-radius:12px 12px 0 0">
          <h2 style="color:white;margin:0;font-size:18px">Leave ${record.status}</h2>
          <p style="color:rgba(255,255,255,.6);margin:4px 0 0;font-size:13px">EQ Solves — Field</p>
        </div>
        <div style="background:white;padding:24px;border:1px solid #E5E7EB;border-top:none;border-radius:0 0 12px 12px">
          <p style="margin:0 0 16px;font-size:14px;color:#374151">Your leave request has been <strong style="color:${statusColor}">${record.status.toLowerCase()}</strong> by ${escHtml(record.responded_by)}.</p>
          <table style="width:100%;font-size:13px;color:#374151;border-collapse:collapse">
            <tr><td style="padding:8px 0;color:#6B7280;width:100px">Type</td><td style="padding:8px 0;font-weight:600">${typeLabels[record.leave_type] || record.leave_type}</td></tr>
            <tr><td style="padding:8px 0;color:#6B7280">Dates</td><td style="padding:8px 0;font-weight:600">${record.date_start} to ${record.date_end}</td></tr>
            ${record.response_note ? `<tr><td style="padding:8px 0;color:#6B7280">Note</td><td style="padding:8px 0">${escHtml(record.response_note)}</td></tr>` : ''}
          </table>
          <div style="margin-top:20px">
            <a href="https://eq-solves-field.netlify.app" style="display:inline-block;background:#1F335C;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">View in App →</a>
          </div>
        </div>
      </div>`;
    } else return;

    const eqToken = sessionStorage.getItem('eq_session_token') || localStorage.getItem('eq_agent_token') || '';
    const resp = await fetch('/.netlify/functions/send-email', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-eq-token': eqToken },
      body:    JSON.stringify({ to: [to], cc: cc.length ? cc : undefined, subject, html })
    });
    const data = await resp.json();
    if (resp.ok) {
      showToast('📧 Email sent to ' + to);
    } else {
      console.error('Resend error:', data);
      showToast('Email failed: ' + (data.message || JSON.stringify(data)));
    }
  } catch (e) {
    console.error('Email error:', e);
    showToast('Email failed: ' + e.message);
  }
}

// ── List render ───────────────────────────────────────────────

function setLeaveView(mode) {
  leaveViewMode = mode;
  document.getElementById('leave-view-list').className = mode === 'list'     ? 'btn btn-sm' : 'btn btn-secondary btn-sm';
  document.getElementById('leave-view-cal').className  = mode === 'calendar' ? 'btn btn-sm' : 'btn btn-secondary btn-sm';
  document.getElementById('leave-calendar').style.display  = mode === 'calendar' ? '' : 'none';
  document.getElementById('leave-content').style.display   = mode === 'list'     ? '' : 'none';
  if (mode === 'calendar') renderLeaveCalendar();
}

function renderLeave() {
  const search       = (document.getElementById('leave-search').value || '').toLowerCase();
  const statusFilter = document.getElementById('leave-filter-status').value;

  let rows = leaveRequests;
  if (statusFilter) rows = rows.filter(r => r.status === statusFilter);
  if (search)       rows = rows.filter(r =>
    r.requester_name.toLowerCase().includes(search) ||
    r.approver_name.toLowerCase().includes(search)
  );

  if (!rows.length) {
    document.getElementById('leave-content').innerHTML =
      '<div class="empty"><div class="empty-icon">🏖</div><p>No leave requests found</p></div>';
    return;
  }

  const statusStyle = {
    Pending:  'background:#FFFBEB;color:#D97706;border:1px solid #FCD34D',
    Approved: 'background:#F0FDF4;color:#16A34A;border:1px solid #86EFAC',
    Rejected: 'background:#FEF2F2;color:#DC2626;border:1px solid #FCA5A5'
  };
  const typeLabels = { 'A/L': 'Annual Leave', 'U/L': 'Unpaid Leave', 'RDO': 'RDO' };

  let html = '<div class="roster-card" style="overflow:hidden">';
  rows.forEach(r => {
    const ds  = new Date(r.date_start + 'T00:00:00');
    const de  = new Date(r.date_end   + 'T00:00:00');
    const fmt = d => d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
    let datesStr;
    if (r.individual_days && r.individual_days.length) {
      datesStr = r.individual_days.map(d => fmt(new Date(d + 'T00:00:00'))).join(', ');
    } else {
      datesStr = ds.getTime() === de.getTime() ? fmt(ds) : `${fmt(ds)} → ${fmt(de)}`;
    }
    let bizDays = 0;
    if (r.individual_days && r.individual_days.length) {
      bizDays = r.individual_days.length;
    } else {
      const d = new Date(ds);
      while (d <= de) { if (d.getDay() !== 0 && d.getDay() !== 6) bizDays++; d.setDate(d.getDate() + 1); }
    }
    const canRespond = isManager && r.status === 'Pending';
    const isResolved = r.status === 'Approved' || r.status === 'Rejected';
    const isArchived = !!r.archived;
    const rowBg = isArchived ? 'background:var(--surface-2);opacity:.7' : (r.status === 'Pending' ? 'background:#FFFDF5' : '');
    html += `<div style="display:flex;align-items:flex-start;gap:14px;padding:14px 18px;border-bottom:1px solid var(--border);${rowBg}">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span style="font-weight:700;color:var(--navy);font-size:14px">${esc(r.requester_name)}</span>
          <span style="padding:2px 8px;border-radius:5px;font-size:10px;font-weight:700;${statusStyle[r.status] || ''}">${r.status}</span>
          <span style="padding:2px 8px;border-radius:5px;font-size:10px;font-weight:600;background:var(--purple-lt);color:var(--purple)">${typeLabels[r.leave_type] || r.leave_type}</span>
          ${isArchived ? '<span style="padding:2px 8px;border-radius:5px;font-size:10px;font-weight:600;background:var(--surface-2);color:var(--ink-4);border:1px solid var(--border)">📦 Archived</span>' : ''}
        </div>
        <div style="font-size:12px;color:var(--ink-2);margin-bottom:2px">${datesStr} — <strong>${bizDays} day${bizDays !== 1 ? 's' : ''}</strong></div>
        <div style="font-size:11px;color:var(--ink-3)">Approver: ${esc(r.approver_name)}</div>
        ${r.note          ? `<div style="font-size:11px;color:var(--ink-3);margin-top:2px">📝 ${escHtml(r.note)}</div>` : ''}
        ${r.response_note ? `<div style="font-size:11px;color:var(--ink-3);margin-top:2px">💬 ${escHtml(r.response_note)} <span style="opacity:.6">— ${esc(r.responded_by || '')}</span></div>` : ''}
        <div style="font-size:10px;color:var(--ink-4);margin-top:4px">${new Date(r.created_at).toLocaleString('en-AU')}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
        ${canRespond ? `<button class="btn btn-primary btn-sm" onclick="openLeaveRespond(${r.id})">Review</button>` : ''}
        ${r.status === 'Pending' ? `<button class="btn btn-secondary btn-sm" onclick="resendLeaveEmail(${r.id})" style="font-size:10px">📧 Resend</button>` : ''}
        ${isResolved && !isArchived && isManager ? `<button class="btn btn-secondary btn-sm" onclick="archiveLeaveRequest(${r.id})" style="font-size:10px">📦 Archive</button>` : ''}
        ${isArchived && isManager ? `<button class="btn btn-secondary btn-sm" onclick="unarchiveLeaveRequest(${r.id})" style="font-size:10px">↩ Restore</button>` : ''}
      </div>
    </div>`;
  });
  html += '</div>';
  document.getElementById('leave-content').innerHTML = html;
}

// ── Print ─────────────────────────────────────────────────────

function printLeaveRequests() {
  const statusFilter = document.getElementById('leave-filter-status').value;
  const search       = (document.getElementById('leave-search').value || '').toLowerCase();
  let rows = leaveRequests;
  if (statusFilter) rows = rows.filter(r => r.status === statusFilter);
  if (search)       rows = rows.filter(r => r.requester_name.toLowerCase().includes(search) || r.approver_name.toLowerCase().includes(search));
  if (!rows.length) { showToast('No requests to print'); return; }

  const typeLabels = { 'A/L': 'Annual Leave', 'U/L': 'Unpaid Leave', 'RDO': 'RDO' };
  const fmt        = d => new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  const tableRows = rows.map(r => {
    let datesStr;
    if (r.individual_days && r.individual_days.length) {
      datesStr = r.individual_days.map(d => fmt(d)).join(', ');
    } else {
      datesStr = r.date_start === r.date_end ? fmt(r.date_start) : `${fmt(r.date_start)} → ${fmt(r.date_end)}`;
    }
    let bizDays = 0;
    if (r.individual_days && r.individual_days.length) { bizDays = r.individual_days.length; }
    else { const d = new Date(r.date_start + 'T00:00:00'); const e = new Date(r.date_end + 'T00:00:00'); while (d <= e) { if (d.getDay() !== 0 && d.getDay() !== 6) bizDays++; d.setDate(d.getDate() + 1); } }

    return `<tr>
      <td>${esc(r.requester_name)}</td>
      <td>${typeLabels[r.leave_type] || r.leave_type}</td>
      <td>${datesStr}</td>
      <td style="text-align:center">${bizDays}</td>
      <td>${esc(r.approver_name)}</td>
      <td style="font-weight:700;color:${r.status === 'Approved' ? '#16A34A' : r.status === 'Rejected' ? '#DC2626' : '#D97706'}">${r.status}</td>
      <td>${r.note || '—'}</td>
    </tr>`;
  }).join('');

  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html><head><title>EQ Leave Requests</title>
    <style>
      body{font-family:-apple-system,sans-serif;margin:24px;color:#1a1a1a}
      h1{font-size:18px;color:#1F335C;margin-bottom:4px}
      .sub{font-size:12px;color:#666;margin-bottom:16px}
      table{width:100%;border-collapse:collapse;font-size:11px}
      th{background:#1F335C;color:white;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
      td{padding:7px 10px;border-bottom:1px solid #e5e5e5}
      tr:nth-child(even){background:#f8f9fa}
      @media print{body{margin:12px}}
    </style></head><body>
    <h1>EQ Solves — Field · Leave Requests</h1>
    <div class="sub">${statusFilter || 'All'} requests · Printed ${new Date().toLocaleString('en-AU')} · ${rows.length} record${rows.length !== 1 ? 's' : ''}</div>
    <table><thead><tr><th>Name</th><th>Type</th><th>Dates</th><th>Days</th><th>Approver</th><th>Status</th><th>Note</th></tr></thead>
    <tbody>${tableRows}</tbody></table>
  </body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 300);
}

// ── Leave calendar ────────────────────────────────────────────

function stepLeaveMonth(dir) {
  leaveCalMonth += dir;
  if (leaveCalMonth > 11) { leaveCalMonth = 0; leaveCalYear++; }
  if (leaveCalMonth < 0)  { leaveCalMonth = 11; leaveCalYear--; }
  renderLeaveCalendar();
}

function renderLeaveCalendar() {
  const months   = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('leave-cal-month').textContent = `${months[leaveCalMonth]} ${leaveCalYear}`;

  const approved = leaveRequests.filter(r => r.status === 'Approved' || r.status === 'Pending');
  const dayMap   = {};

  approved.forEach(r => {
    const dates = _getLeaveDates(r);
    dates.forEach(ds => {
      const dt = new Date(ds + 'T00:00:00');
      if (dt.getMonth() !== leaveCalMonth || dt.getFullYear() !== leaveCalYear) return;
      if (!dayMap[ds]) dayMap[ds] = [];
      dayMap[ds].push({ name: r.requester_name, type: r.leave_type, status: r.status });
    });
  });

  const firstDay  = new Date(leaveCalYear, leaveCalMonth, 1);
  const lastDay   = new Date(leaveCalYear, leaveCalMonth + 1, 0);
  const startDow  = (firstDay.getDay() + 6) % 7;
  const totalDays = lastDay.getDate();
  const todayStr  = new Date().toISOString().slice(0, 10);

  const typeColors = { 'A/L': 'var(--blue)', 'U/L': 'var(--amber)', 'RDO': 'var(--green)' };
  const typeBg     = { 'A/L': 'var(--blue-lt)', 'U/L': 'var(--amber-lt)', 'RDO': 'var(--green-lt)' };

  let html = '<div class="roster-card" style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;table-layout:fixed"><thead><tr>';
  ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach((d, i) => {
    const we = i >= 5;
    html += `<th style="padding:6px 4px;text-align:center;font-size:10px;font-weight:700;color:${we ? 'var(--ink-4)' : 'var(--ink-3)'};text-transform:uppercase;letter-spacing:.5px">${d}</th>`;
  });
  html += '</tr></thead><tbody><tr>';
  for (let i = 0; i < startDow; i++) html += '<td style="padding:4px;vertical-align:top;border:1px solid var(--border);background:var(--surface-2)"></td>';

  for (let day = 1; day <= totalDays; day++) {
    const dow     = (startDow + day - 1) % 7;
    const ds      = `${leaveCalYear}-${String(leaveCalMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isToday = ds === todayStr;
    const isWe    = dow >= 5;
    const entries = dayMap[ds] || [];
    html += `<td style="padding:4px;vertical-align:top;border:1px solid var(--border);min-height:60px;height:70px;${isWe ? 'background:var(--surface-2);' : ''}${isToday ? 'outline:2px solid var(--purple);outline-offset:-2px;' : ''}">`;
    html += `<div style="font-size:11px;font-weight:${isToday ? '800' : '600'};color:${isToday ? 'var(--purple)' : isWe ? 'var(--ink-4)' : 'var(--ink-2)'};margin-bottom:2px">${day}</div>`;
    entries.forEach(e => {
      const bg  = typeBg[e.type]    || 'var(--surface-2)';
      const col = typeColors[e.type] || 'var(--ink-2)';
      html += `<div style="background:${bg};color:${col};font-size:9px;font-weight:600;padding:1px 4px;border-radius:3px;margin-bottom:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(e.name)} — ${e.type}">${esc(e.name.split(' ')[0])} <span style="opacity:.7">${e.type}</span></div>`;
    });
    html += '</td>';
    if (dow === 6 && day < totalDays) html += '</tr><tr>';
  }

  const lastDow = (startDow + totalDays - 1) % 7;
  for (let i = lastDow + 1; i < 7; i++) html += '<td style="padding:4px;vertical-align:top;border:1px solid var(--border);background:var(--surface-2)"></td>';
  html += '</tr></tbody></table></div>';

  html += '<div style="display:flex;gap:12px;margin-top:8px;flex-wrap:wrap">';
  [['A/L', 'Annual Leave'], ['U/L', 'Unpaid Leave'], ['RDO', 'RDO']].forEach(([code, label]) => {
    html += `<span style="font-size:10px;color:var(--ink-3);display:flex;align-items:center;gap:4px"><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${typeBg[code]}"></span>${label}</span>`;
  });
  html += '</div>';
  document.getElementById('leave-cal-grid').innerHTML = html;
}
