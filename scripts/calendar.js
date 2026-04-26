/*! Property of EQ — all rights reserved. Unauthorised use prohibited. */
// ─────────────────────────────────────────────────────────────
// scripts/calendar.js  —  EQ Solves Field
// Monthly calendar view: grid, side panel, leave summary bar.
// Depends on: app-state.js, utils.js, roster.js
// ─────────────────────────────────────────────────────────────

let calMonth        = new Date().getMonth();
let calYear         = new Date().getFullYear();
let calSelectedDate = null;
let calDayData      = {};

// ── Navigation ────────────────────────────────────────────────

function goToCalToday() { calMonth = new Date().getMonth(); calYear = new Date().getFullYear(); renderCalendar(); }

function stepCalMonth(dir) {
  calMonth += dir;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  if (calMonth < 0)  { calMonth = 11; calYear--; }
  renderCalendar();
}

// ── Helpers ───────────────────────────────────────────────────

function _dateToWeekKey(date) {
  const mon = new Date(date);
  mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
  const dd = String(mon.getDate()).padStart(2, '0');
  const mm = String(mon.getMonth() + 1).padStart(2, '0');
  const yy = String(mon.getFullYear()).slice(-2);
  return `${dd}.${mm}.${yy}`;
}

function _getCodeForDate(name, date) {
  const wk    = _dateToWeekKey(date);
  const entry = STATE.scheduleIndex
    ? STATE.scheduleIndex[`${name}||${wk}`]
    : STATE.schedule.find(r => r.name === name && r.week === wk);
  if (!entry) return '';
  const dayIdx = (date.getDay() + 6) % 7;
  return entry[['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'][dayIdx]] || '';
}

// ── Main render ───────────────────────────────────────────────

function renderCalendar() {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const lbl    = document.getElementById('cal-month-label');
  if (lbl) lbl.textContent = `${months[calMonth]} ${calYear}`;

  const firstDay  = new Date(calYear, calMonth, 1);
  const lastDay   = new Date(calYear, calMonth + 1, 0);
  const startDow  = (firstDay.getDay() + 6) % 7; // 0 = Mon
  const totalDays = lastDay.getDate();
  const todayStr  = new Date().toISOString().slice(0, 10);

  // Build per-day data
  calDayData = {};
  for (let d = 1; d <= totalDays; d++) {
    const dt  = new Date(calYear, calMonth, d);
    const dow = (dt.getDay() + 6) % 7;
    if (dow >= 5) continue; // skip weekends for data build (still rendered)
    const ds = _isoDate(dt);
    calDayData[ds] = { sites: {}, leave: {}, ph: false, dt };

    STATE.people.forEach(p => {
      const code = _getCodeForDate(p.name, dt);
      if (!code || !code.trim()) return;
      const u = code.toUpperCase().trim();
      if (u === 'PH') { calDayData[ds].ph = true; return; }
      if (isLeave(code)) {
        const lbl2 = u === 'A/L' ? 'Annual Leave' : u === 'RDO' ? 'RDO' : u === 'U/L' ? 'Unpaid Leave' : u === 'LVE' ? 'Leave' : code;
        if (!calDayData[ds].leave[lbl2]) calDayData[ds].leave[lbl2] = [];
        calDayData[ds].leave[lbl2].push({ name: p.name, group: p.group });
      } else {
        const siteName = getSiteName(code);
        const siteAddr = getSiteAddress(code);
        const key      = siteName !== code ? `${code}|||${siteName}|||${siteAddr}` : `${code}|||${code}|||`;
        if (!calDayData[ds].sites[key]) calDayData[ds].sites[key] = [];
        calDayData[ds].sites[key].push({ name: p.name, group: p.group });
      }
    });
  }

  const colMap = { blue:'#2563EB', green:'#16A34A', amber:'#D97706', red:'#DC2626', purple:'#7C77B9', grey:'#94A3B8', empty:'#CBD5E1' };
  const bgMap  = { blue:'#EFF4FF', green:'#F0FDF4', amber:'#FFFBEB', red:'#FEF2F2', purple:'#EEEDF8', grey:'#F8FAFC', empty:'#F8FAFC' };

  let html = `<div class="roster-card" style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;table-layout:fixed;min-width:560px"><thead><tr>`;
  ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach((d, i) => {
    const we = i >= 5;
    html += `<th style="padding:8px 6px;text-align:center;font-size:10px;font-weight:700;color:${we ? 'var(--ink-4)' : 'var(--ink-3)'};text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid var(--border);background:var(--surface-2)">${d}</th>`;
  });
  html += `</tr></thead><tbody><tr>`;

  for (let i = 0; i < startDow; i++) html += `<td style="border:1px solid var(--border);background:var(--surface-2);height:100px;vertical-align:top;padding:6px"></td>`;

  for (let day = 1; day <= totalDays; day++) {
    const dow        = (startDow + day - 1) % 7;
    const dt         = new Date(calYear, calMonth, day);
    const ds         = _isoDate(dt);
    const isToday    = ds === todayStr;
    const isSelected = ds === calSelectedDate;
    const isWe       = dow >= 5;
    const data       = calDayData[ds] || {};
    const isPH       = data.ph;

    const cellBg = isSelected ? 'var(--navy)' : isPH ? '#FEF3C7' : isWe ? 'var(--surface-2)' : 'var(--surface)';
    const outline = isToday && !isSelected ? 'outline:2px solid var(--purple);outline-offset:-2px;' : '';

    if (!isWe) {
      html += `<td onclick="openCalPanel('${ds}')" style="border:1px solid var(--border);background:${cellBg};height:100px;vertical-align:top;padding:6px;${outline}cursor:pointer;transition:background .15s" onmouseover="if(!this.dataset.sel)this.style.background='var(--surface-2)'" onmouseout="this.style.background='${cellBg}'" data-sel="${isSelected ? '1' : ''}">`;
    } else {
      html += `<td style="border:1px solid var(--border);background:${cellBg};height:100px;vertical-align:top;padding:6px">`;
    }

    const dayColor = isSelected ? 'white' : isToday ? 'var(--purple)' : isWe ? 'var(--ink-4)' : 'var(--ink-2)';
    html += `<div style="font-size:12px;font-weight:${isToday || isSelected ? '800' : '600'};color:${dayColor};margin-bottom:4px">${day}${isPH ? ` <span style="font-size:9px;font-weight:700;color:${isSelected ? 'rgba(255,255,255,.7)' : '#B45309'}">PH</span>` : ''}</div>`;

    if (!isWe && data.sites) {
      const siteEntries = Object.entries(data.sites).sort((a, b) => b[1].length - a[1].length);
      siteEntries.slice(0, 3).forEach(([key, people]) => {
        const [abbr] = key.split('|||');
        const col    = siteColor(abbr);
        const bg     = isSelected ? 'rgba(255,255,255,.15)' : bgMap[col] || '#EFF4FF';
        const fg     = isSelected ? 'white' : colMap[col] || '#1D4ED8';
        const border = isSelected ? 'rgba(255,255,255,.2)' : (colMap[col] || '#2563EB') + '44';
        html += `<div style="display:flex;align-items:center;justify-content:space-between;background:${bg};border:1px solid ${border};border-radius:4px;padding:1px 5px;margin-bottom:2px;font-size:10px;overflow:hidden"><span style="font-weight:700;color:${fg};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:75%">${abbr}</span><span style="font-weight:700;color:${fg};flex-shrink:0;margin-left:2px">${people.length}</span></div>`;
      });
      if (siteEntries.length > 3) html += `<div style="font-size:9px;color:${isSelected ? 'rgba(255,255,255,.6)' : 'var(--ink-3)'};margin-top:1px">+${siteEntries.length - 3} more</div>`;
      const leaveEntries = Object.entries(data.leave || {});
      if (leaveEntries.length) {
        const tot = leaveEntries.reduce((s, [, p]) => s + p.length, 0);
        html += `<div style="font-size:9px;color:${isSelected ? 'rgba(255,255,255,.7)' : 'var(--green)'};font-weight:600;margin-top:2px">✓ ${tot} on leave</div>`;
      }
    } else if (isPH) {
      html += `<div style="font-size:10px;color:${isSelected ? 'rgba(255,255,255,.8)' : '#B45309'};font-weight:600">Public Holiday</div>`;
    }

    html += '</td>';
    if (dow === 6 && day < totalDays) html += '</tr><tr>';
  }

  const lastDow = (startDow + totalDays - 1) % 7;
  for (let i = lastDow + 1; i < 7; i++) html += `<td style="border:1px solid var(--border);background:var(--surface-2);height:100px;vertical-align:top;padding:6px"></td>`;
  html += '</tr></tbody></table></div>';

  // ── Leave summary bar ─────────────────────────────────────
  const leaveByPerson = {};
  Object.entries(calDayData).forEach(([ds, d]) => {
    Object.entries(d.leave || {}).forEach(([type, people]) => {
      people.forEach(person => {
        if (!leaveByPerson[person.name]) leaveByPerson[person.name] = { group: person.group, entries: [] };
        leaveByPerson[person.name].entries.push({ ds, type });
      });
    });
  });

  if (Object.keys(leaveByPerson).length) {
    const monthNames  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const typeCol     = { 'Annual Leave': 'var(--green)', 'RDO': 'var(--amber)', 'Unpaid Leave': 'var(--amber)', 'Leave': 'var(--ink-3)' };
    const typeBg      = { 'Annual Leave': 'var(--green-lt)', 'RDO': 'var(--amber-lt)', 'Unpaid Leave': 'var(--amber-lt)', 'Leave': 'var(--slate-lt)' };
    const groupCol    = { 'Direct': 'var(--navy)', 'Apprentice': 'var(--purple)', 'Labour Hire': 'var(--navy-3)' };
    const groupBadge  = { 'Direct': 'Direct', 'Apprentice': 'App', 'Labour Hire': 'LH' };
    const groupOrder  = { 'Direct': 0, 'Apprentice': 1, 'Labour Hire': 2 };

    const fmtDate = ds => { const d = new Date(ds + 'T00:00:00'); return `${d.getDate()} ${monthNames[d.getMonth()]}`; };
    const groupRuns = entries => {
      const sorted = [...entries].sort((a, b) => a.ds.localeCompare(b.ds));
      const runs   = [];
      sorted.forEach(e => {
        const last = runs[runs.length - 1];
        if (last && last.type === e.type) {
          const diff = (new Date(e.ds + 'T00:00:00') - new Date(last.end + 'T00:00:00')) / 86400000;
          if (diff <= 3) { last.end = e.ds; last.days++; return; }
        }
        runs.push({ type: e.type, start: e.ds, end: e.ds, days: 1 });
      });
      return runs;
    };

    const sortedPeople = Object.entries(leaveByPerson)
      .sort(([na, a], [nb, b]) => (groupOrder[a.group] ?? 9) - (groupOrder[b.group] ?? 9) || na.localeCompare(nb));

    html += `<div style="margin-top:12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
      <div style="padding:10px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
        <span style="font-size:10px;font-weight:700;color:var(--ink-3);text-transform:uppercase;letter-spacing:.5px">Leave This Month</span>
        <span style="font-size:11px;color:var(--ink-3)">${sortedPeople.length} staff</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:0">`;

    sortedPeople.forEach(([name, data]) => {
      const runs = groupRuns(data.entries);
      html += `<div style="padding:10px 14px;border-bottom:1px solid var(--border);border-right:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:5px">
          <span style="font-size:12px;font-weight:700;color:var(--navy);flex:1">${esc(name)}</span>
          <span style="font-size:9px;font-weight:700;color:white;background:${groupCol[data.group] || 'var(--navy)'};padding:1px 5px;border-radius:3px;flex-shrink:0">${groupBadge[data.group] || data.group}</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:3px">
          ${runs.map(run => {
            const col       = typeCol[run.type]  || 'var(--ink-3)';
            const bg        = typeBg[run.type]   || 'var(--slate-lt)';
            const dateLabel = run.start === run.end ? fmtDate(run.start) : `${fmtDate(run.start)} – ${fmtDate(run.end)}`;
            const daysLabel = run.days > 1 ? ` <span style="color:var(--ink-3);font-weight:400">(${run.days}d)</span>` : '';
            return `<div style="display:inline-flex;align-items:center;gap:5px;font-size:11px">
              <span style="background:${bg};color:${col};font-weight:600;padding:1px 6px;border-radius:4px;font-size:10px;white-space:nowrap">${run.type}</span>
              <span style="color:var(--ink-2);font-weight:500">${dateLabel}${daysLabel}</span>
            </div>`;
          }).join('')}
        </div>
      </div>`;
    });
    html += '</div></div>';
  }

  const wrap = document.getElementById('cal-grid-wrap');
  if (wrap) wrap.innerHTML = html;
}

// ── Side panel ────────────────────────────────────────────────

function openCalPanel(ds) {
  const data = calDayData[ds];
  if (!data) return;
  calSelectedDate = ds;

  const dt       = new Date(ds + 'T00:00:00');
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months   = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('cal-panel-date').textContent = `${dayNames[dt.getDay()]} ${dt.getDate()} ${months[dt.getMonth()]} ${dt.getFullYear()}`;

  const totalStaff = Object.values(data.sites).reduce((s, p) => s + p.length, 0);
  const totalLeave = Object.values(data.leave).reduce((s, p) => s + p.length, 0);
  document.getElementById('cal-panel-sub').textContent =
    data.ph ? 'Public Holiday' : `${totalStaff} on site · ${totalLeave} on leave`;

  const colMap     = { blue:'#2563EB', green:'#16A34A', amber:'#D97706', red:'#DC2626', purple:'#7C77B9', grey:'#94A3B8', empty:'#CBD5E1' };
  const bgMap      = { blue:'#EFF4FF', green:'#F0FDF4', amber:'#FFFBEB', red:'#FEF2F2', purple:'#EEEDF8', grey:'#F8FAFC', empty:'#F8FAFC' };
  const groupBadge = { 'Direct': 'Direct', 'Apprentice': 'App', 'Labour Hire': 'LH' };
  const groupCol   = { 'Direct': 'var(--navy)', 'Apprentice': 'var(--purple)', 'Labour Hire': 'var(--navy-3)' };

  let body = '';
  if (data.ph) body += `<div style="text-align:center;padding:20px 0;color:#B45309;font-size:14px;font-weight:600">🏖 Public Holiday</div>`;

  const siteEntries = Object.entries(data.sites).sort((a, b) => b[1].length - a[1].length);
  if (siteEntries.length) {
    body += `<div style="font-size:10px;font-weight:700;color:var(--ink-3);text-transform:uppercase;letter-spacing:.6px;margin-bottom:10px">${totalStaff} Staff on Site</div>`;
    siteEntries.forEach(([key, people]) => {
      const [abbr, name, addr] = key.split('|||');
      const col   = siteColor(abbr);
      const label = name && name !== abbr ? name : abbr;
      body += `<div style="margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${colMap[col] || 'var(--navy)'};flex-shrink:0"></span>
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--navy)">${esc(label)}</div>
            ${addr ? `<div style="font-size:10px;color:var(--ink-3);margin-top:1px">📍 ${esc(addr)}</div>` : ''}
          </div>
          <span style="margin-left:auto;background:${bgMap[col] || 'var(--blue-lt)'};color:${colMap[col] || 'var(--blue)'};font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px">${people.length}</span>
        </div>
        <div style="padding-left:16px;display:flex;flex-direction:column;gap:3px">
          ${people.sort((a, b) => a.name.localeCompare(b.name)).map(p => `
            <div style="display:flex;align-items:center;gap:6px">
              <span style="font-size:12px;color:var(--ink-2);flex:1">${esc(p.name)}</span>
              <span style="font-size:9px;font-weight:700;color:white;background:${groupCol[p.group] || 'var(--navy)'};padding:1px 5px;border-radius:3px">${groupBadge[p.group] || p.group}</span>
            </div>`).join('')}
        </div>
      </div>`;
    });
  }

  const leaveEntries = Object.entries(data.leave);
  if (leaveEntries.length) {
    if (siteEntries.length) body += `<div style="border-top:1px solid var(--border);margin:10px 0"></div>`;
    body += `<div style="font-size:10px;font-weight:700;color:var(--ink-3);text-transform:uppercase;letter-spacing:.6px;margin-bottom:10px">${totalLeave} On Leave</div>`;
    leaveEntries.forEach(([type, people]) => {
      const leaveCol = type === 'Annual Leave' ? 'var(--green)' : type === 'RDO' ? 'var(--amber)' : 'var(--ink-3)';
      const leaveBg  = type === 'Annual Leave' ? 'var(--green-lt)' : type === 'RDO' ? 'var(--amber-lt)' : 'var(--slate-lt)';
      body += `<div style="margin-bottom:10px">
        <div style="display:inline-flex;align-items:center;gap:5px;background:${leaveBg};color:${leaveCol};font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;margin-bottom:6px">${type} (${people.length})</div>
        <div style="padding-left:8px;display:flex;flex-direction:column;gap:3px">
          ${people.sort((a, b) => a.name.localeCompare(b.name)).map(p => `
            <div style="display:flex;align-items:center;gap:6px">
              <span style="font-size:12px;color:var(--ink-2);flex:1">${esc(p.name)}</span>
              <span style="font-size:9px;font-weight:700;color:white;background:${groupCol[p.group] || 'var(--navy)'};padding:1px 5px;border-radius:3px">${groupBadge[p.group] || p.group}</span>
            </div>`).join('')}
        </div>
      </div>`;
    });
  }

  if (!siteEntries.length && !leaveEntries.length && !data.ph) {
    body = `<div style="text-align:center;padding:30px 0;color:var(--ink-3)"><div style="font-size:24px;margin-bottom:8px">📭</div><div style="font-size:12px">No allocations recorded</div></div>`;
  }

  document.getElementById('cal-panel-body').innerHTML = body;
  const panel = document.getElementById('cal-side-panel');
  if (panel) panel.style.width = '312px';
  renderCalendar(); // re-render to show selected state
}

function closeCalPanel() {
  calSelectedDate = null;
  const panel = document.getElementById('cal-side-panel');
  if (panel) panel.style.width = '0';
  renderCalendar();
}

// ── Utility ───────────────────────────────────────────────────

function _isoDate(dt) {
  return dt.getFullYear() + '-' +
    String(dt.getMonth() + 1).padStart(2, '0') + '-' +
    String(dt.getDate()).padStart(2, '0');
}