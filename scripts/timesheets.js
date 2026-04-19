// ─────────────────────────────────────────────────────────────
// scripts/timesheets.js  —  EQ Solves Field
// Timesheets: render, cell save, batch fill, export,
// staff self-entry (renderStaffTs, onStaffTsCellChange).
// Depends on: app-state.js, utils.js, supabase.js, roster.js
// ─────────────────────────────────────────────────────────────

const TS_DAYS   = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const TS_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ── Job Combobox ─────────────────────────────────────────────
// Custom dropdown for job number inputs. Shows filtered active
// job numbers with description. Allows manual free-text entry.

let _activeCombobox = null;

function _getActiveJobs() {
  return (typeof jobNumbers !== 'undefined' ? jobNumbers : []).filter(j => j.status === 'Active');
}

function openJobCombobox(inputEl) {
  closeJobCombobox();
  const jobs = _getActiveJobs();
  if (!jobs.length) return;

  const rect = inputEl.getBoundingClientRect();
  const drop = document.createElement('div');
  drop.id = 'job-combobox-dropdown';
  drop.className = 'job-combobox-dropdown';

  // Position below the input, flip above if near bottom of viewport
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;
  const flipAbove = spaceBelow < 240 && spaceAbove > spaceBelow;

  drop.style.position = 'fixed';
  drop.style.left   = rect.left + 'px';
  drop.style.width  = Math.max(rect.width, 260) + 'px';
  drop.style.zIndex = '9999';

  if (flipAbove) {
    drop.style.bottom = (window.innerHeight - rect.top + 2) + 'px';
    drop.style.top    = 'auto';
  } else {
    drop.style.top    = (rect.bottom + 2) + 'px';
    drop.style.bottom = 'auto';
  }

  // Prevent scroll inside dropdown from closing it
  drop.addEventListener('mousedown', function(e) { e.preventDefault(); });
  drop.addEventListener('touchstart', function(e) { e.stopPropagation(); }, { passive: true });

  _activeCombobox = { input: inputEl, dropdown: drop };
  document.body.appendChild(drop);
  _renderComboboxOptions(inputEl.value);
}

function _renderComboboxOptions(filter) {
  if (!_activeCombobox) return;
  const drop = _activeCombobox.dropdown;
  const q    = (filter || '').toLowerCase().trim();
  const jobs = _getActiveJobs();

  const filtered = q
    ? jobs.filter(j =>
        (j.number || '').toLowerCase().includes(q) ||
        (j.description || '').toLowerCase().includes(q) ||
        (j.client || '').toLowerCase().includes(q))
    : jobs;

  if (!filtered.length) {
    drop.innerHTML = '<div class="jcb-empty">No matches</div>';
    return;
  }

  drop.innerHTML = filtered.map(j => {
    const desc = j.description ? ' \u2014 ' + esc(j.description) : '';
    const client = j.client ? '<span class="jcb-client">' + esc(j.client) + '</span>' : '';
    return `<div class="jcb-option" data-value="${esc(j.number)}"
      onmousedown="selectComboboxOption(event, '${esc(j.number)}')"
      ontouchend="selectComboboxOption(event, '${esc(j.number)}')">
      <span class="jcb-number">${esc(j.number)}</span>
      <span class="jcb-desc">${desc}</span>
      ${client}
    </div>`;
  }).join('');
}

function selectComboboxOption(e, value) {
  e.preventDefault(); // prevent blur before we set the value
  if (!_activeCombobox) return;
  const input = _activeCombobox.input;
  input.value = value;
  input.dispatchEvent(new Event('change'));
  closeJobCombobox();
  // Move focus to the hours input next to it
  const hrsInput = input.closest('.ts-cell, div')
    ?.querySelector('input[data-type="hrs"], input[type="number"]');
  if (hrsInput) hrsInput.focus();
}

function closeJobCombobox() {
  if (_activeCombobox && _activeCombobox.dropdown) {
    _activeCombobox.dropdown.remove();
  }
  _activeCombobox = null;
}

function _onComboboxInput(el) {
  el.value = el.value.toUpperCase();
  if (_activeCombobox && _activeCombobox.input === el) {
    _renderComboboxOptions(el.value);
  } else {
    openJobCombobox(el);
  }
}

function _onComboboxFocus(el) {
  openJobCombobox(el);
}

function _onComboboxBlur() {
  // Longer delay to allow scrolling and touch interactions on the dropdown
  setTimeout(closeJobCombobox, 300);
}

// Close combobox on scroll OUTSIDE the dropdown, or on resize
document.addEventListener('scroll', function(e) {
  if (_activeCombobox && _activeCombobox.dropdown && _activeCombobox.dropdown.contains(e.target)) return;
  closeJobCombobox();
}, true);
window.addEventListener('resize', closeJobCombobox);

// ── Load ──────────────────────────────────────────────────────

async function loadTimesheets() {
  try {
    const rows = await sbFetch('timesheets?select=*');
    STATE.timesheets = rows;
  } catch (e) {
    STATE.timesheets = [];
    console.warn('Timesheets load failed:', e);
  }
}

// ── Helpers ───────────────────────────────────────────────────

function getTsEntry(name, week) {
  return (STATE.timesheets || []).find(r => r.name === name && r.week === week) || null;
}

function tsTotalHrs(entry) {
  if (!entry) return 0;
  return TS_DAYS.reduce((s, d) => {
    const jobStr = entry[d + '_job'] || '';
    if (jobStr.includes('|')) {
      return s + jobStr.split('|').reduce((sum, part) => {
        return sum + (parseFloat(part.split(':')[1]) || 0);
      }, 0);
    }
    // v3.4.4 (T3): count hours whenever they're recorded, even if the job
    // column is blank — the old "jobStr && h" guard hid legitimate hours and
    // distorted the weekly total.
    return s + (parseFloat(entry[d + '_hrs']) || 0);
  }, 0);
}

function updateTsRowTotal(name, week) {
  const entry = getTsEntry(name, week);
  const total = tsTotalHrs(entry);
  const id    = 'tst-' + name.replace(/\W/g, '_');
  const el    = document.getElementById(id);
  if (!el) return;
  el.textContent = total > 0 ? total + 'h' : '—';
  el.className   = 'ts-total-col ' + (total >= 40 ? 'ts-total-green' : total > 0 ? 'ts-total-amber' : 'ts-total-empty');
}

// ── Save cell ─────────────────────────────────────────────────

async function saveTsCell(name, grp, week, day, job, hrs) {
  if (!isManager) { showToast('Supervision access required'); return; }
  if (!STATE.timesheets) STATE.timesheets = [];
  let entry = STATE.timesheets.find(r => r.name === name && r.week === week);
  if (!entry) {
    entry = {
      name, group: grp, week,
      mon_job: null, mon_hrs: null, tue_job: null, tue_hrs: null,
      wed_job: null, wed_hrs: null, thu_job: null, thu_hrs: null,
      fri_job: null, fri_hrs: null, sat_job: null, sat_hrs: null,
      sun_job: null, sun_hrs: null
    };
    STATE.timesheets.push(entry);
  }
  // BUG-002 FIX: single assignment (was duplicated)
  entry[day + '_job'] = job || null;
  entry[day + '_hrs'] = hrs || null;
  updateTsRowTotal(name, week);

  const row = { name, group: grp, week };
  TS_DAYS.forEach(d => {
    row[d + '_job'] = entry[d + '_job'] || null;
    const hVal = entry[d + '_hrs'];
    if (hVal != null && String(hVal).includes('|')) {
      row[d + '_hrs'] = String(hVal).split('|').reduce((s, x) => s + (parseFloat(x) || 0), 0);
    } else {
      row[d + '_hrs'] = parseFloat(hVal) || null;
    }
  });

  // v3.4.4 (T2): compare-and-swap on updated_at to detect concurrent edits.
  // When entry.id + entry.updated_at are known (i.e. loaded from server), do
  // a CAS PATCH. Zero affected rows means another supervisor wrote first —
  // refresh from server and tell the user before they clobber unknowingly.
  // When we don't have an id yet (first insert), fall back to the existing
  // upsert path.
  try {
    if (entry.id && entry.updated_at) {
      const enc = encodeURIComponent(entry.updated_at);
      const res = await sbFetch(
        `timesheets?id=eq.${entry.id}&updated_at=eq.${enc}`,
        'PATCH', row, 'return=representation'
      );
      if (Array.isArray(res) && res.length === 0) {
        try {
          const fresh = await sbFetch(`timesheets?id=eq.${entry.id}&select=*`);
          if (fresh && fresh[0]) Object.assign(entry, fresh[0]);
        } catch (re) { console.warn('EQ[ts] refresh after CAS miss failed:', re); }
        renderTimesheets();
        showToast('⚠ Another supervisor edited this row — your change was NOT saved. Review and retry.');
        return;
      }
      if (Array.isArray(res) && res[0]) {
        entry.id = res[0].id;
        entry.updated_at = res[0].updated_at;
      }
    } else {
      const res = await sbFetch(
        'timesheets?on_conflict=name,week,org_id',
        'POST', row, 'resolution=merge-duplicates,return=representation'
      );
      if (Array.isArray(res) && res[0]) {
        entry.id = res[0].id;
        entry.updated_at = res[0].updated_at;
      }
    }
  } catch (e) {
    showToast('Timesheet save failed — check connection');
    console.error('EQ[ts] save error:', e);
  }
}

// ── Cell change handler ───────────────────────────────────────

function onTsCellChange(el) {
  // TS-003: Validate hours
  if (el.dataset.type === 'hrs') {
    const val = parseFloat(el.value);
    if (val > 24) { showToast('⚠ Hours cannot exceed 24 per day'); el.value = 24; }
    if (val > 12 && val <= 24) showToast(`⚠ ${el.dataset.name}: ${val}h entered for ${el.dataset.day.toUpperCase()}`);
  }
  if (!isManager) { showToast('Supervision access required'); el.value = ''; return; }

  const { name, group, week, day } = el.dataset;
  const row = el.closest('tr');

  const job0El = row.querySelector(`[data-name="${name}"][data-day="${day}"][data-type="job"][data-slot="0"]`);
  const hrs0El = row.querySelector(`[data-name="${name}"][data-day="${day}"][data-type="hrs"][data-slot="0"]`);
  const job1El = row.querySelector(`[data-name="${name}"][data-day="${day}"][data-type="job"][data-slot="1"]`);
  const hrs1El = row.querySelector(`[data-name="${name}"][data-day="${day}"][data-type="hrs"][data-slot="1"]`);

  const job0 = job0El ? job0El.value.trim() : '';
  const hrs0 = hrs0El ? parseFloat(hrs0El.value) || 0 : 0;
  const job1 = job1El ? job1El.value.trim() : '';
  const hrs1 = hrs1El ? parseFloat(hrs1El.value) || 0 : 0;

  let combinedJob, combinedHrs;
  if (job1) {
    combinedJob = `${job0}:${hrs0}|${job1}:${hrs1}`;
    combinedHrs = hrs0 + hrs1;
  } else {
    combinedJob = job0 || null;
    combinedHrs = hrs0 || null;
  }

  saveTsCell(name, group, week, day, combinedJob, combinedHrs);
  updateLastUpdated();
  auditLog(`${day.toUpperCase()} → ${combinedJob || 'cleared'} / ${combinedHrs || '—'}h`, 'Timesheet', name, week);
}

// ── Split row toggle ──────────────────────────────────────────

function toggleTsSplit(pid, btn) {
  const row = document.getElementById('split-' + pid);
  if (!row) return;
  const show = row.style.display === 'none';
  row.style.display = show ? 'flex' : 'none';
  btn.classList.toggle('active', show);
  if (!show) {
    row.querySelectorAll('input').forEach(el => { el.value = ''; onTsCellChange(el); });
  }
}

// ── Fill week from Monday ─────────────────────────────────────
// Copies the current Monday cell (job + hours) for one person into
// Tue–Fri of the same week. Honours split-day entries: the raw
// `mon_job` string (e.g. "D5384:4|D5385:4") and numeric `mon_hrs`
// copy through saveTsCell unchanged.
// Triggered from the ">> Week" button in the Monday cell.
async function fillTsWeekFromMon(name, grp) {
  if (!isManager) { showToast('Supervision access required'); return; }
  if (!name) return;
  const week  = STATE.currentWeek;
  const entry = (STATE.timesheets || []).find(r => r.name === name && r.week === week);
  if (!entry || !entry.mon_job) { showToast('Fill Monday first'); return; }

  const monJob = entry.mon_job;
  const monHrs = entry.mon_hrs;
  const days   = ['tue', 'wed', 'thu', 'fri'];

  // v3.4.4 (T6): itemise what will be overwritten so supervisors don't
  // unknowingly erase earlier entries.
  const hasExisting = days.some(d => entry[d + '_job'] || entry[d + '_hrs']);
  if (hasExisting) {
    const dayLbl = { tue:'Tue', wed:'Wed', thu:'Thu', fri:'Fri' };
    const lines = days.map(d => {
      const j = entry[d + '_job'] || '';
      const h = entry[d + '_hrs'];
      if (!j && (h == null || h === '')) return `  ${dayLbl[d]}: (empty)`;
      const jLabel = String(j).includes('|') ? String(j) : (j || '—');
      return `  ${dayLbl[d]}: ${jLabel} / ${h || 0}h`;
    }).join('\n');
    const monLabel = String(monJob).includes('|') ? String(monJob) : String(monJob).split(':')[0];
    const ok = window.confirm(
      `${name} — overwrite Tue–Fri with Monday's values?\n\n` +
      `Current data:\n${lines}\n\n` +
      `New values for each day:\n  ${monLabel} / ${monHrs || 0}h\n\n` +
      `This cannot be undone.`
    );
    if (!ok) return;
  }

  for (const d of days) {
    await saveTsCell(name, grp, week, d, monJob, monHrs);
  }
  renderTimesheets();
  showToast('✓ Copied Mon → Tue–Fri');
  auditLog(
    `Fill week from Mon: ${String(monJob).split('|')[0]} / ${monHrs || 0}h`,
    'Timesheet', name, week
  );
}

// ── Render grid ───────────────────────────────────────────────

function _getTsFilteredPeople() {
  const grpFilter = (document.getElementById('ts-group-filter') || {}).value || '';
  const searchRaw = (document.getElementById('ts-search') || {}).value || '';
  const search    = searchRaw.toLowerCase().trim();

  let people = [...STATE.people]
    .filter(p => p.group === 'Apprentice' || p.group === 'Labour Hire');

  if (typeof agencyMode !== 'undefined' && agencyMode && typeof agencyName !== 'undefined') {
    people = people.filter(p => p.agency === agencyName);
  }
  if (grpFilter) people = people.filter(p => p.group === grpFilter);
  if (search)    people = people.filter(p => p.name.toLowerCase().includes(search));

  return people.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}

function renderTimesheets() {
  const people = _getTsFilteredPeople();

  if (!people.length) {
    document.getElementById('ts-content').innerHTML =
      `<div class="empty"><div class="empty-icon">👤</div><p>No matching staff found</p></div>`;
    updateTsStats();
    return;
  }

  const week        = STATE.currentWeek;
  const weekEntries = (STATE.timesheets || []).filter(r => r.week === week);
  const hasSat      = weekEntries.some(r => r.sat_job || r.sat_hrs);
  const hasSun      = weekEntries.some(r => r.sun_job || r.sun_hrs);
  const days        = TS_DAYS.filter((_, i) =>
    i < 5 || (i === 5 && (hasSat || isManager)) || (i === 6 && (hasSun || isManager))
  );
  const dlabels = TS_LABELS.filter((_, i) =>
    i < 5 || (i === 5 && (hasSat || isManager)) || (i === 6 && (hasSun || isManager))
  );

  const disabled    = isManager ? '' : ' disabled';
  const weekDatesTs = getWeekDates(week);

  let html = `<div class="roster-card"><div class="table-scroll"><table style="width:100%">
    <thead><tr>
      <th style="min-width:140px">Name</th>
      <th style="min-width:50px">Group</th>
      ${dlabels.map((d, i) => `<th class="center" style="min-width:160px">${d}<br><span style="font-size:9px;opacity:.6;font-weight:400">${weekDatesTs[['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(d)]} — Job / Hrs</span></th>`).join('')}
      <th class="center" style="min-width:55px">Total</th>
    </tr></thead><tbody>`;

  // ── Data rows ───────────────────────────────────────────────
  let lastGroup = '';
  people.forEach(p => {
    // Group separator row
    if (p.group !== lastGroup) {
      lastGroup = p.group;
      const icon = p.group === 'Apprentice' ? '🎓' : '🔧';
      html += `<tr><td colspan="${days.length + 3}" style="background:var(--surface-2);font-size:11px;font-weight:700;color:var(--ink-3);padding:8px 10px;text-transform:uppercase;letter-spacing:.5px">${icon} ${p.group}</td></tr>`;
    }

    const entry      = getTsEntry(p.name, week);
    const total      = tsTotalHrs(entry);
    const totalClass = total >= 40 ? 'ts-total-green' : total > 0 ? 'ts-total-amber' : 'ts-total-empty';
    const rowBg      = !entry ? 'background:#FFF1F2' : total > 0 && total < 40 ? 'background:#FFFBEB' : '';
    const pid        = p.name.replace(/\W/g, '_');
    const grpBadge   = p.group === 'Apprentice'
      ? '<span style="font-size:9px;font-weight:700;color:var(--purple);background:var(--purple-lt);padding:1px 5px;border-radius:3px">APP</span>'
      : '<span style="font-size:9px;font-weight:700;color:var(--navy-3);background:var(--slate-lt);padding:1px 5px;border-radius:3px">LH</span>';

    html += `<tr style="${rowBg}">
      <td style="font-weight:600;color:var(--navy)">${esc(p.name)}</td>
      <td>${grpBadge}</td>
      ${days.map(d => {
        const rawJob = entry && entry[d + '_job'] ? entry[d + '_job'] : '';
        const rawHrs = entry && entry[d + '_hrs'] != null ? entry[d + '_hrs'] : '';
        let job1 = '', hrs1 = '', job2 = '', hrs2 = '', isSplit = false;
        if (rawJob.includes('|')) {
          // v3.4.4 (T4): validate split-day format — warn when extra pipe
          // segments are present so the malformed data doesn't silently
          // lose information. Render the first two parts either way.
          const parts = rawJob.split('|');
          if (parts.length !== 2) console.warn('EQ[ts] malformed split-day value for', p.name, d, '— expected 2 segments, got', parts.length, ':', rawJob);
          const p0 = (parts[0] || '').split(':');
          const p1 = (parts[1] || '').split(':');
          job1 = p0[0] || ''; hrs1 = p0[1] || ''; job2 = p1[0] || ''; hrs2 = p1[1] || ''; isSplit = true;
        } else {
          job1 = rawJob; hrs1 = rawHrs;
        }
        const pid2 = p.name.replace(/\W/g, '_') + '_' + d;
        // Fill-week button lives in the Mon cell only. Always visible, disabled
        // until Mon has a job number (or if user is view-only).
        const monFilled = !!(entry && entry.mon_job);
        const fwDisabled = !monFilled || !isManager;
        const fillWeekBtn = d === 'mon'
          ? `<button class="ts-fillweek-btn" title="Copy Monday's job &amp; hours into Tue–Fri"
                data-n="${esc(p.name)}" data-g="${p.group}"
                onclick="fillTsWeekFromMon(this.dataset.n, this.dataset.g)"
                ${fwDisabled ? 'disabled' : ''}
                style="margin-top:4px;width:100%;padding:4px 6px;font-size:10px;font-weight:700;color:#fff;background:${fwDisabled ? 'var(--ink-4)' : 'var(--navy)'};border:1px solid ${fwDisabled ? 'var(--ink-4)' : 'var(--navy)'};border-radius:5px;cursor:${fwDisabled ? 'not-allowed' : 'pointer'};font-family:inherit;letter-spacing:.3px;${fwDisabled ? 'opacity:.55' : ''}">&gt;&gt; Week</button>`
          : '';
        return `<td style="padding:5px 6px">
          <div class="ts-cell">
            <input class="ts-job" type="text" value="${esc(String(job1))}" placeholder="Job no."${disabled}
              data-name="${esc(p.name)}" data-group="${p.group}" data-week="${week}" data-day="${d}" data-type="job" data-slot="0"
              oninput="_onComboboxInput(this)" onfocus="_onComboboxFocus(this)" onblur="_onComboboxBlur()" onchange="onTsCellChange(this)">
            <input class="ts-hrs" type="number" value="${hrs1}" placeholder="h" min="0" max="24" step="0.5"${disabled}
              data-name="${esc(p.name)}" data-group="${p.group}" data-week="${week}" data-day="${d}" data-type="hrs" data-slot="0"
              onchange="onTsCellChange(this)">
            <button class="ts-split-btn${isSplit ? ' active' : ''}" title="Split: add second job" aria-label="Split day into two jobs" onclick="toggleTsSplit('${pid2}',this)"${disabled ? ' disabled' : ''}>＋</button>
          </div>
          <div class="ts-cell ts-split-row" id="split-${pid2}" style="display:${isSplit ? 'flex' : 'none'};margin-top:3px">
            <input class="ts-job" type="text" value="${esc(String(job2))}" placeholder="Job 2"${disabled}
              data-name="${esc(p.name)}" data-group="${p.group}" data-week="${week}" data-day="${d}" data-type="job" data-slot="1"
              oninput="_onComboboxInput(this)" onfocus="_onComboboxFocus(this)" onblur="_onComboboxBlur()" onchange="onTsCellChange(this)">
            <input class="ts-hrs" type="number" value="${hrs2}" placeholder="h" min="0" max="24" step="0.5"${disabled}
              data-name="${esc(p.name)}" data-group="${p.group}" data-week="${week}" data-day="${d}" data-type="hrs" data-slot="1"
              onchange="onTsCellChange(this)">
          </div>
          ${fillWeekBtn}
        </td>`;
      }).join('')}
      <td class="ts-total-col ${totalClass}" id="tst-${pid}">${total > 0 ? total + 'h' : '—'}</td>
    </tr>`;
  });

  html += '</tbody></table></div></div>';
  document.getElementById('ts-content').innerHTML = html;
  updateTsStats();
}

// ── Quick fill ───────────────────────────────────────────────
// Legacy tab function — kept for backward compat, now a no-op
function setTsTab(tab) { renderTimesheets(); }

// ── Stats ─────────────────────────────────────────────────────

function updateTsStats() {
  const allTs = [...STATE.people].filter(p => p.group === 'Apprentice' || p.group === 'Labour Hire');
  const week  = STATE.currentWeek;
  let complete = 0, partial = 0, empty = 0;

  allTs.forEach(p => {
    const entry   = getTsEntry(p.name, week);
    const hasAny  = entry && TS_DAYS.some(d => entry[d + '_job']);
    const hasFull = entry && ['mon','tue','wed','thu','fri'].every(d => entry[d + '_job']);
    if (!hasAny)        empty++;
    else if (hasFull)   complete++;
    else                partial++;
  });

  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('ts-stat-total',    allTs.length);
  setEl('ts-stat-complete', complete);
  setEl('ts-stat-partial',  partial);
  setEl('ts-stat-empty',    empty);

  // Completion tracker — last 6 weeks
  const tracker = document.getElementById('ts-completion-tracker');
  if (!tracker || !allTs.length) return;
  const sel        = document.getElementById('globalWeek');
  const allWeeks   = [...sel.options].map(o => o.value);
  const currIdx    = allWeeks.indexOf(week);
  const startIdx   = Math.max(0, currIdx - 5);
  const trackWeeks = allWeeks.slice(startIdx, currIdx + 1);

  let html = '<div style="font-size:10px;font-weight:700;color:var(--ink-3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Timesheet Completion — Recent Weeks</div>';
  html += '<div style="display:flex;gap:4px;flex-wrap:wrap">';
  trackWeeks.forEach(w => {
    let wComplete = 0;
    allTs.forEach(p => {
      const entry   = (STATE.timesheets || []).find(r => r.name === p.name && r.week === w);
      const hasFull = entry && ['mon','tue','wed','thu','fri'].every(d => entry[d + '_job']);
      if (hasFull) wComplete++;
    });
    const total = allTs.length;
    const pct   = total ? Math.round((wComplete / total) * 100) : 0;
    const isCur = w === week;
    let bg, color, border;
    if (pct === 100)   { bg = '#F0FDF4'; color = 'var(--green)'; border = '1px solid #86EFAC'; }
    else if (pct >= 50){ bg = '#FFFBEB'; color = 'var(--amber)'; border = '1px solid #FDE68A'; }
    else               { bg = '#FEF2F2'; color = 'var(--red)';   border = '1px solid #FECACA'; }
    html += `<div style="flex:1;min-width:80px;padding:8px 10px;border-radius:8px;background:${bg};border:${border};text-align:center;${isCur ? 'outline:2px solid var(--navy);outline-offset:-1px' : ''}">
      <div style="font-size:9px;color:var(--ink-3);font-weight:600">${w}</div>
      <div style="font-size:18px;font-weight:800;color:${color};margin:2px 0">${pct}%</div>
      <div style="font-size:9px;color:var(--ink-3)">${wComplete}/${total}</div>
    </div>`;
  });
  html += '</div>';
  tracker.innerHTML = html;
}

// ── Batch fill ────────────────────────────────────────────────

function openTsBatch() {
  if (!isManager) { showToast('Supervision access required'); return; }
  const days = TS_DAYS.map((d, i) =>
    `<button class="batch-day-btn ${i < 5 ? 'on' : ''}" data-day="${d}" onclick="this.classList.toggle('on')">${TS_LABELS[i]}</button>`
  ).join('');
  document.getElementById('ts-batch-days').innerHTML = days;
  document.getElementById('ts-batch-job').value      = '';
  document.getElementById('ts-batch-hrs').value      = '8';
  document.getElementById('ts-batch-skip').checked   = true;

  // Use current filter (or all if no filter)
  const people = _getTsFilteredPeople();
  document.getElementById('ts-batch-people').innerHTML = people.map(p =>
    `<label class="batch-person-row">
      <input type="checkbox" value="${p.id}" data-name="${esc(p.name)}" data-group="${p.group}" checked onchange="updateTsBatchCount()">
      <span style="font-size:12px;font-weight:500">${esc(p.name)}</span>
      <span style="font-size:9px;color:var(--ink-3);margin-left:auto">${p.group === 'Apprentice' ? 'APP' : 'LH'}</span>
    </label>`
  ).join('');
  updateTsBatchCount();
  openModal('modal-ts-batch');
}

function updateTsBatchCount() {
  const n = document.querySelectorAll('#ts-batch-people input:checked').length;
  document.getElementById('ts-batch-count').textContent = n + ' person' + (n !== 1 ? 's' : '') + ' selected';
}
function tsBatchSelectAll()  { document.querySelectorAll('#ts-batch-people input').forEach(cb => cb.checked = true);  updateTsBatchCount(); }
function tsBatchClearAll()   { document.querySelectorAll('#ts-batch-people input').forEach(cb => cb.checked = false); updateTsBatchCount(); }

async function runTsBatch() {
  const job  = document.getElementById('ts-batch-job').value.trim().toUpperCase();
  const hrs  = parseFloat(document.getElementById('ts-batch-hrs').value) || 0;
  if (!job) { showToast('Enter a job number'); return; }
  if (!hrs) { showToast('Enter hours per day'); return; }
  const skip   = document.getElementById('ts-batch-skip').checked;
  const days   = [...document.querySelectorAll('#ts-batch-days .batch-day-btn.on')].map(b => b.dataset.day);
  if (!days.length) { showToast('Select at least one day'); return; }
  const people = [...document.querySelectorAll('#ts-batch-people input:checked')]
    .map(cb => ({ name: cb.dataset.name, group: cb.dataset.group }));
  if (!people.length) { showToast('Select at least one person'); return; }

  closeModal('modal-ts-batch');
  if (!STATE.timesheets) STATE.timesheets = [];
  const week     = STATE.currentWeek;
  let changed    = 0;
  const promises = [];

  for (const p of people) {
    let entry = STATE.timesheets.find(r => r.name === p.name && r.week === week);
    if (!entry) {
      entry = {
        name: p.name, group: p.group, week,
        mon_job: null, mon_hrs: null, tue_job: null, tue_hrs: null,
        wed_job: null, wed_hrs: null, thu_job: null, thu_hrs: null,
        fri_job: null, fri_hrs: null, sat_job: null, sat_hrs: null, sun_job: null, sun_hrs: null
      };
      STATE.timesheets.push(entry);
    }
    days.forEach(d => {
      if (skip && entry[d + '_job']) return;
      entry[d + '_job'] = job; entry[d + '_hrs'] = hrs; changed++;
    });
    const row = { name: p.name, group: p.group, week };
    TS_DAYS.forEach(d => { row[d + '_job'] = entry[d + '_job'] || null; row[d + '_hrs'] = parseFloat(entry[d + '_hrs']) || null; });
    promises.push(sbFetch('timesheets?on_conflict=name,week,org_id', 'POST', row, 'resolution=merge-duplicates,return=minimal'));
  }

  await Promise.all(promises);
  showToast('Applied to ' + changed + ' cells');
  auditLog(`Timesheet batch: ${job} / ${hrs}h`, 'Timesheet', `${changed} cells, ${people.length} staff`, STATE.currentWeek);
  renderTimesheets();
}

// ── Exports ───────────────────────────────────────────────────

function exportTsCSV() {
  const people = [...STATE.people]
    .filter(p => p.group === 'Apprentice' || p.group === 'Labour Hire')
    .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  const week   = STATE.currentWeek;
  const header = 'Name,Group,Week,Mon Job,Mon Hrs,Tue Job,Tue Hrs,Wed Job,Wed Hrs,Thu Job,Thu Hrs,Fri Job,Fri Hrs,Sat Job,Sat Hrs,Sun Job,Sun Hrs,Total Hrs';
  const rows   = people.map(p => {
    const e     = getTsEntry(p.name, week);
    const total = tsTotalHrs(e);
    return [p.name, p.group, week,
      e?.mon_job || '', e?.mon_hrs || '', e?.tue_job || '', e?.tue_hrs || '',
      e?.wed_job || '', e?.wed_hrs || '', e?.thu_job || '', e?.thu_hrs || '',
      e?.fri_job || '', e?.fri_hrs || '', e?.sat_job || '', e?.sat_hrs || '',
      e?.sun_job || '', e?.sun_hrs || '', total || ''
    ].map(v => `"${v}"`).join(',');
  });
  downloadCSV(header + '\n' + rows.join('\n'), 'EQ_Timesheets_' + week.replace(/\./g, '-') + '.csv');
  showToast('CSV exported');
}

function exportTsPayroll() {
  const people = [...STATE.people]
    .filter(p => p.group === 'Apprentice' || p.group === 'Labour Hire')
    .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  const week   = STATE.currentWeek;
  const rows   = [
    ['"EQ Solves — Field · Timesheet Report"'],
    [`"Week: ${formatWeekLabel(week)}"`], [''],
    ['"Name"', '"Group"', '"Day"', '"Job / Docket No."', '"Hours"']
  ];
  people.forEach(p => {
    const e      = getTsEntry(p.name, week);
    let hasData  = false;
    TS_DAYS.forEach((d, i) => {
      const job = e?.[d + '_job']; const hrs = e?.[d + '_hrs'];
      if (job || hrs) { rows.push([`"${p.name}"`, `"${p.group}"`, `"${TS_LABELS[i]}"`, `"${job || ''}"`, `"${hrs || ''}"`]); hasData = true; }
    });
    if (!hasData) rows.push([`"${p.name}"`, `"${p.group}"`, '"—"', '"No data"', '""']);
    rows.push(['']);
  });
  downloadCSV(rows.map(r => r.join(',')).join('\n'), 'EQ_Payroll_' + week.replace(/\./g, '-') + '.csv');
  showToast('Payroll report exported');
}

// ── Import CSV ────────────────────────────────────────────────
// Accepts the format written by exportTsCSV():
//   Name,Group,Week,Mon Job,Mon Hrs,Tue Job,Tue Hrs, ... ,Sun Hrs,Total Hrs
// Matches people by exact name, ignores unknown names, upserts per-day via saveTsCell.
// The Week column in the CSV is authoritative (can import for a week other than currentWeek).

function _parseCsvLine(line) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQ = false; }
      else { cur += ch; }
    } else {
      if (ch === '"') { inQ = true; }
      else if (ch === ',') { out.push(cur); cur = ''; }
      else { cur += ch; }
    }
  }
  out.push(cur);
  return out.map(v => v.trim());
}

async function importTsCSV(evt) {
  if (!isManager) { showToast('Supervision access required'); evt.target.value = ''; return; }
  const file = evt.target.files && evt.target.files[0];
  if (!file) return;

  let text;
  try { text = await file.text(); }
  catch (e) { showToast('Could not read file'); evt.target.value = ''; return; }

  const lines = text.replace(/\r\n/g, '\n').split('\n').filter(l => l.trim().length);
  if (lines.length < 2) { showToast('CSV is empty'); evt.target.value = ''; return; }

  const header = _parseCsvLine(lines[0]).map(h => h.toLowerCase());
  const col = (name) => header.indexOf(name.toLowerCase());
  const iName = col('name'), iGroup = col('group'), iWeek = col('week');
  if (iName < 0 || iWeek < 0) {
    showToast('CSV missing Name / Week columns');
    evt.target.value = '';
    return;
  }

  const dayCols = TS_DAYS.map((d, i) => ({
    day:  d,
    label: TS_LABELS[i],
    job:  col(TS_LABELS[i] + ' Job'),
    hrs:  col(TS_LABELS[i] + ' Hrs')
  }));

  // Summarise for confirm dialog
  const rows = lines.slice(1).map(_parseCsvLine);
  const byWeek = {};
  rows.forEach(r => {
    const w = (r[iWeek] || '').trim();
    if (!w) return;
    byWeek[w] = (byWeek[w] || 0) + 1;
  });
  const weekSummary = Object.entries(byWeek).map(([w, n]) => `${w} (${n} staff)`).join(', ');

  const proceed = window.confirm(
    'Import timesheets from CSV?\n\n' +
    rows.length + ' row' + (rows.length === 1 ? '' : 's') + ' — ' + weekSummary + '\n\n' +
    'Existing entries for the same name+week+day will be overwritten.'
  );
  if (!proceed) { evt.target.value = ''; return; }

  const peopleByName = {};
  STATE.people.forEach(p => { peopleByName[p.name] = p; });

  let updated = 0, unknown = 0, cells = 0, clamped = 0;
  for (const r of rows) {
    const name = (r[iName] || '').trim();
    const week = (r[iWeek] || '').trim();
    if (!name || !week) continue;
    const person = peopleByName[name];
    if (!person) { unknown++; continue; }
    const group = (iGroup >= 0 ? r[iGroup] : '') || person.group;

    let rowTouched = false;
    for (const dc of dayCols) {
      const jobRaw = dc.job >= 0 ? (r[dc.job] || '').trim() : '';
      const hrsRaw = dc.hrs >= 0 ? (r[dc.hrs] || '').trim() : '';
      if (!jobRaw && !hrsRaw) continue;
      // v3.4.4 (T7): clamp imported hours to [0, 24] so CSV can't introduce
      // values the UI would otherwise refuse. Count adjustments for the toast.
      let hrs = parseFloat(hrsRaw);
      if (isNaN(hrs)) {
        hrs = null;
      } else if (hrs < 0 || hrs > 24) {
        const orig = hrs;
        hrs = Math.max(0, Math.min(24, hrs));
        clamped++;
        console.warn(`CSV import: ${name} ${dc.label} ${orig}h → clamped to ${hrs}h`);
      }
      await saveTsCell(name, group, week, dc.day, jobRaw || null, hrs);
      cells++;
      rowTouched = true;
    }
    if (rowTouched) updated++;
  }

  renderTimesheets();
  const bits = [updated + ' staff updated', cells + ' cells'];
  if (unknown) bits.push(unknown + ' unknown names skipped');
  if (clamped) bits.push(clamped + ' hours clamped to 0–24');
  showToast('✓ Imported — ' + bits.join(', '));
  auditLog('Imported timesheet CSV — ' + bits.join(', '), 'Timesheet', '', STATE.currentWeek);

  evt.target.value = '';
}

// ── Staff self-entry ──────────────────────────────────────────

function renderStaffTs() {
  if (!staffTsMode || !staffTsPerson) return;
  const name   = staffTsPerson.name;
  const group  = staffTsPerson.group;
  const week   = STATE.currentWeek;
  const entry  = getTsEntry(name, week);
  const days   = ['mon', 'tue', 'wed', 'thu', 'fri'];
  const labels = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const weekDates = getWeekDates(week);
  const total  = tsTotalHrs(entry);
  const totalColor = total >= 38 ? 'var(--green)' : total > 0 ? 'var(--amber)' : 'var(--ink-3)';

  let html = `
    <div style="background:linear-gradient(135deg,var(--navy),var(--navy-2));border-radius:12px;padding:18px 20px;margin-bottom:20px">
      <div style="font-size:18px;font-weight:700;color:white;margin-bottom:2px">${esc(name)}</div>
      <div style="font-size:12px;color:rgba(255,255,255,.5)">${group} &nbsp;·&nbsp; ${formatWeekLabel(week)}</div>
      <div id="staff-ts-total-display" style="margin-top:10px;font-size:28px;font-weight:800;color:${totalColor}">${total > 0 ? total + 'h' : '—'} <span style="font-size:13px;font-weight:500;color:rgba(255,255,255,.6)">recorded this week</span></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px">`;

  days.forEach((d, i) => {
    const rawJob = entry && entry[d + '_job'] ? entry[d + '_job'] : '';
    const rawHrs = entry && entry[d + '_hrs'] != null ? entry[d + '_hrs'] : '';
    let job1 = '', hrs1 = '', job2 = '', hrs2 = '', isSplit = false;
    if (rawJob.includes('|')) {
      // v3.4.4 (T4): same defensive parse as supervisor view.
      const parts = rawJob.split('|');
      if (parts.length !== 2) console.warn('EQ[ts] malformed split-day value (staff view) for', name, d, '—', parts.length, 'segments:', rawJob);
      const p0 = (parts[0] || '').split(':');
      const p1 = (parts[1] || '').split(':');
      job1 = p0[0] || ''; hrs1 = p0[1] || ''; job2 = p1[0] || ''; hrs2 = p1[1] || ''; isSplit = true;
    } else { job1 = rawJob; hrs1 = rawHrs; }

    const hasData = !!(job1 || hrs1);
    html += `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;box-shadow:var(--shadow-sm)">
        <div style="background:${hasData ? 'var(--navy)' : 'var(--surface-2)'};padding:10px 16px;display:flex;align-items:center;justify-content:space-between">
          <div>
            <span style="font-size:13px;font-weight:700;color:${hasData ? 'white' : 'var(--ink-2)'}">${labels[i]}</span>
            <span style="font-size:11px;color:${hasData ? 'rgba(255,255,255,.5)' : 'var(--ink-3)'};margin-left:8px">${weekDates[i]}</span>
          </div>
          <span style="font-size:11px;font-weight:700;color:${hasData ? 'rgba(255,255,255,.8)' : 'var(--ink-3)'}">${hasData ? (hrs1 || 0) + 'h recorded' : 'Not recorded'}</span>
        </div>
        <div style="padding:14px 16px;display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;gap:8px;align-items:flex-end">
            <div style="flex:1">
              <label style="font-size:10px;font-weight:700;color:var(--ink-3);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px">Job / Docket No.</label>
              <input type="text" value="${esc(String(job1))}" placeholder="e.g. D5384"
                data-name="${esc(name)}" data-group="${group}" data-week="${week}" data-day="${d}" data-type="job" data-slot="0"
                oninput="_onComboboxInput(this)" onfocus="_onComboboxFocus(this);this.style.borderColor='var(--purple)'" onblur="_onComboboxBlur();this.style.borderColor='var(--border)'" onchange="onStaffTsCellChange(this)"
                style="width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-family:monospace;font-size:13px;color:var(--ink);outline:none;transition:border-color .15s">>
            </div>
            <div style="width:80px">
              <label style="font-size:10px;font-weight:700;color:var(--ink-3);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px">Hours</label>
              <input type="number" value="${hrs1}" placeholder="8" min="0" max="24" step="0.5"
                data-name="${esc(name)}" data-group="${group}" data-week="${week}" data-day="${d}" data-type="hrs" data-slot="0"
                onchange="onStaffTsCellChange(this)"
                style="width:100%;padding:9px 8px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px;text-align:center;color:var(--ink);outline:none;transition:border-color .15s"
                onfocus="this.style.borderColor='var(--purple)'" onblur="this.style.borderColor='var(--border)'">
            </div>
          </div>
          <div id="staff-split-${d}" style="display:${isSplit ? 'flex' : 'none'};gap:8px;align-items:flex-end">
            <div style="flex:1">
              <label style="font-size:10px;font-weight:700;color:var(--ink-3);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px">Job 2</label>
              <input type="text" value="${esc(String(job2))}" placeholder="Second job"
                data-name="${esc(name)}" data-group="${group}" data-week="${week}" data-day="${d}" data-type="job" data-slot="1"
                oninput="_onComboboxInput(this)" onfocus="_onComboboxFocus(this);this.style.borderColor='var(--purple)'" onblur="_onComboboxBlur();this.style.borderColor='var(--border)'" onchange="onStaffTsCellChange(this)"
                style="width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:8px;font-family:monospace;font-size:13px;color:var(--ink);outline:none;transition:border-color .15s">>
            </div>
            <div style="width:80px">
              <label style="font-size:10px;font-weight:700;color:var(--ink-3);text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:4px">Hrs 2</label>
              <input type="number" value="${hrs2}" placeholder="h" min="0" max="24" step="0.5"
                data-name="${esc(name)}" data-group="${group}" data-week="${week}" data-day="${d}" data-type="hrs" data-slot="1"
                onchange="onStaffTsCellChange(this)"
                style="width:100%;padding:9px 8px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px;text-align:center;color:var(--ink);outline:none;transition:border-color .15s"
                onfocus="this.style.borderColor='var(--purple)'" onblur="this.style.borderColor='var(--border)'">
            </div>
          </div>
          <button onclick="toggleStaffSplit('${d}', this)"
            style="background:none;border:1px solid var(--border);border-radius:6px;padding:5px 12px;font-size:11px;font-weight:600;color:var(--ink-3);cursor:pointer;font-family:inherit;align-self:flex-start;transition:all .15s"
            onmouseover="this.style.borderColor='var(--purple)';this.style.color='var(--purple)'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--ink-3)'">
            ${isSplit ? '✕ Remove second job' : '＋ Split — add second job'}
          </button>
        </div>
      </div>`;
  });

  html += `</div>
    <div style="margin-top:14px;padding:12px 16px;background:var(--surface-2);border-radius:8px;border:1px solid var(--border);font-size:11px;color:var(--ink-3);line-height:1.6">
      💡 Your entries save automatically. Contact your supervisor to correct a previous week or reset your PIN.
    </div>`;
  document.getElementById('staff-ts-content').innerHTML = html;
}

function toggleStaffSplit(day, btn) {
  const row = document.getElementById('staff-split-' + day);
  if (!row) return;
  const show       = row.style.display === 'none';
  row.style.display = show ? 'flex' : 'none';
  btn.textContent  = show ? '✕ Remove second job' : '＋ Split — add second job';
  if (!show) row.querySelectorAll('input').forEach(el => { el.value = ''; onStaffTsCellChange(el); });
}

async function onStaffTsCellChange(el) {
  const { name, group, week, day } = el.dataset;
  if (!name || !day) return;
  const root  = document.getElementById('staff-ts-content');
  if (!root) return;

  const job0El = root.querySelector(`[data-name="${name}"][data-day="${day}"][data-type="job"][data-slot="0"]`);
  const hrs0El = root.querySelector(`[data-name="${name}"][data-day="${day}"][data-type="hrs"][data-slot="0"]`);
  const job1El = root.querySelector(`[data-name="${name}"][data-day="${day}"][data-type="job"][data-slot="1"]`);
  const hrs1El = root.querySelector(`[data-name="${name}"][data-day="${day}"][data-type="hrs"][data-slot="1"]`);

  const job0 = job0El ? job0El.value.trim() : '';
  // v3.4.4 (T5): staff self-entry now clamps to [0, 24] silently. Negative
  // values were being accepted and distorting totals.
  const _clamp = v => Math.max(0, Math.min(24, v));
  let hrs0 = hrs0El ? _clamp(parseFloat(hrs0El.value) || 0) : 0;
  if (hrs0El && parseFloat(hrs0El.value) !== hrs0 && hrs0El.value !== '') hrs0El.value = hrs0;
  const job1 = job1El ? job1El.value.trim() : '';
  let hrs1 = hrs1El ? _clamp(parseFloat(hrs1El.value) || 0) : 0;
  if (hrs1El && parseFloat(hrs1El.value) !== hrs1 && hrs1El.value !== '') hrs1El.value = hrs1;

  let combinedJob, combinedHrs;
  if (job1) { combinedJob = `${job0}:${hrs0}|${job1}:${hrs1}`; combinedHrs = hrs0 + hrs1; }
  else       { combinedJob = job0 || null;                       combinedHrs = hrs0 || null; }

  if (!STATE.timesheets) STATE.timesheets = [];
  let entry = STATE.timesheets.find(r => r.name === name && r.week === week);
  if (!entry) {
    entry = { name, group, week,
      mon_job: null, mon_hrs: null, tue_job: null, tue_hrs: null,
      wed_job: null, wed_hrs: null, thu_job: null, thu_hrs: null,
      fri_job: null, fri_hrs: null, sat_job: null, sat_hrs: null, sun_job: null, sun_hrs: null };
    STATE.timesheets.push(entry);
  }
  entry[day + '_job'] = combinedJob;
  entry[day + '_hrs'] = combinedHrs;

  const row = { name, group, week };
  TS_DAYS.forEach(d => {
    row[d + '_job'] = entry[d + '_job'] || null;
    row[d + '_hrs'] = entry[d + '_hrs'] != null ? parseFloat(entry[d + '_hrs']) || null : null;
  });
  // Only report "save failed" when sbFetch itself rejects. UI updates run in a
  // separate try so a cosmetic exception never masquerades as a failed save.
  let saveOk = true;
  try {
    await sbFetch('timesheets?on_conflict=name,week,org_id', 'POST', row, 'resolution=merge-duplicates,return=minimal');
  } catch (err) {
    saveOk = false;
    console.error('EQ[ts] staff save failed:', err);
    showToast('Save failed — check connection');
  }
  if (!saveOk) return;
  try {
    const newTotal = tsTotalHrs(entry);
    const totalEl  = document.getElementById('staff-ts-total-display');
    if (totalEl) {
      const c = newTotal >= 38 ? 'var(--green)' : newTotal > 0 ? 'var(--amber)' : 'var(--ink-3)';
      totalEl.style.color = c;
      totalEl.innerHTML   = `${newTotal > 0 ? newTotal + 'h' : '—'} <span style="font-size:13px;font-weight:500;color:rgba(255,255,255,.6)">recorded this week</span>`;
    }
  } catch (uiErr) {
    console.warn('EQ[ts] staff UI update skipped:', uiErr);
  }
}

// ── Job Numbers side panel (supervisor timesheet view) ────────

let _jobPanelOpen = false;

function toggleTsJobPanel() {
  _jobPanelOpen = !_jobPanelOpen;
  const panel = document.getElementById('ts-job-panel');
  const btn   = document.getElementById('ts-job-panel-btn');
  if (!panel) return;

  if (_jobPanelOpen) {
    panel.style.display = '';
    if (btn) { btn.textContent = '🔢 Hide Jobs'; btn.style.background = 'var(--purple-lt)'; btn.style.color = 'var(--purple)'; btn.style.borderColor = 'var(--purple)'; }
    renderTsJobPanel();
  } else {
    panel.style.display = 'none';
    if (btn) { btn.textContent = '🔢 Job Numbers'; btn.style.background = ''; btn.style.color = ''; btn.style.borderColor = ''; }
  }
}

function renderTsJobPanel() {
  const container = document.getElementById('ts-job-panel-list');
  if (!container) return;

  const jobs   = (typeof jobNumbers !== 'undefined' ? jobNumbers : []).filter(j => j.status === 'Active');
  const search = (document.getElementById('ts-job-panel-search') ? document.getElementById('ts-job-panel-search').value : '').toLowerCase();
  const filtered = search ? jobs.filter(j =>
    (j.number || '').toLowerCase().includes(search) ||
    (j.description || '').toLowerCase().includes(search) ||
    (j.client || '').toLowerCase().includes(search)
  ) : jobs;

  if (!filtered.length) {
    container.innerHTML = `<div style="padding:20px;text-align:center;color:var(--ink-4);font-size:12px">${search ? 'No matches' : 'No active job numbers'}</div>`;
    return;
  }

  // Group by site
  const bySite = {};
  filtered.forEach(j => {
    const site = j.site_name || 'No Site';
    if (!bySite[site]) bySite[site] = [];
    bySite[site].push(j);
  });

  const siteOrder = Object.keys(bySite).sort((a, b) => a === 'No Site' ? 1 : b === 'No Site' ? -1 : a.localeCompare(b));

  let html = '';
  siteOrder.forEach(site => {
    html += `<div style="padding:6px 12px 4px;font-size:10px;font-weight:700;color:var(--ink-3);text-transform:uppercase;letter-spacing:.5px;background:var(--surface-2);border-bottom:1px solid var(--border)">${esc(site)}</div>`;
    bySite[site].forEach(j => {
      html += `<div style="padding:8px 12px;border-bottom:1px solid var(--border);cursor:pointer" onclick="copyTsJobRef('${esc(j.number)}')" onmouseover="this.style.background='var(--purple-lt)'" onmouseout="this.style.background=''">
        <div style="font-size:12px;font-weight:700;color:var(--navy);font-family:monospace">${esc(j.number)}</div>
        ${j.description ? `<div style="font-size:11px;color:var(--ink-2);margin-top:1px">${esc(j.description)}</div>` : ''}
        ${j.client ? `<div style="font-size:10px;color:var(--ink-4)">${esc(j.client)}</div>` : ''}
      </div>`;
    });
  });

  container.innerHTML = html;
}

function filterTsJobPanel() {
  renderTsJobPanel();
}

function copyTsJobRef(num) {
  // Try to fill the focused job input, fallback to clipboard
  const focused = document.activeElement;
  if (focused && focused.classList.contains('ts-job')) {
    focused.value = num;
    focused.dispatchEvent(new Event('change'));
    showToast(`✓ ${num} filled`);
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(num).then(() => showToast(`📋 Copied ${num}`));
  } else {
    showToast(`Job: ${num} — tap a job field first to fill directly`);
  }
}
