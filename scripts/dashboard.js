// ─────────────────────────────────────────────────────────────
// scripts/dashboard.js  —  EQ Solves Field
// Dashboard: site breakdown, leave summary, pending leave cards.
// Depends on: app-state.js, utils.js, roster.js
// ─────────────────────────────────────────────────────────────

// Sort state for the site-breakdown table
let dashSort = { col: 'total', dir: 'desc' };

function dashSortBy(col) {
  if (dashSort.col === col) {
    dashSort.dir = dashSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    dashSort.col = col;
    // Sensible defaults: names ascending, numbers descending
    dashSort.dir = (col === 'site' || col === 'lead') ? 'asc' : 'desc';
  }
  renderDashboard();
}

function dashResetFilters() {
  const f = document.getElementById('dash-site-filter');
  const g = document.getElementById('dash-group-filter');
  if (f) f.value = '';
  if (g) g.value = '';
  dashSort = { col: 'total', dir: 'desc' };
  renderDashboard();
}

function renderDashboard() {
  const week       = STATE.currentWeek;
  const sched      = getWeekSchedule(week);
  const days       = ['mon', 'tue', 'wed', 'thu', 'fri'];
  const dayLabels  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const weekDates  = getWeekDates(week);

  // Guard: if no people or schedule loaded yet, show loading state
  if (!STATE.people.length) {
    document.getElementById('dashboard-sites').innerHTML =
      '<div class="empty"><div class="empty-icon">⏳</div><p>Loading data…</p></div>';
    document.getElementById('dashboard-leave').innerHTML = '';
    return;
  }

  const colMap = {
    blue:'var(--blue)', green:'var(--green)', amber:'var(--amber)',
    red:'var(--red)', grey:'var(--ink-3)', purple:'var(--purple)', empty:'var(--ink-4)'
  };

  // Read filter state
  const filterEl  = document.getElementById('dash-site-filter');
  const groupEl   = document.getElementById('dash-group-filter');
  const siteQuery = (filterEl && filterEl.value || '').trim().toLowerCase();
  const groupFilt = (groupEl && groupEl.value || '');

  // Index people → group so we can filter by group
  const personGroup = {};
  STATE.people.forEach(p => { personGroup[p.name] = p.group; });
  const passGroup = (name) => !groupFilt || personGroup[name] === groupFilt;

  // Build per-site per-day counts
  const siteData = {};
  sched.forEach(r => days.forEach(d => {
    const s = r[d];
    if (s && !isLeave(s) && s.trim()) {
      if (!passGroup(r.name)) return;
      if (!siteData[s]) siteData[s] = { total: 0, days: {} };
      if (!siteData[s].days[d]) siteData[s].days[d] = [];
      siteData[s].days[d].push(r.name);
      siteData[s].total++;
    }
  }));

  // Apply site-name filter (matches either abbr or full name)
  let entries = Object.entries(siteData);
  if (siteQuery) {
    entries = entries.filter(([abbr]) => {
      const full = (getSiteName(abbr) || '').toLowerCase();
      return abbr.toLowerCase().includes(siteQuery) || full.includes(siteQuery);
    });
  }

  // Sort per dashSort state
  const dir = dashSort.dir === 'asc' ? 1 : -1;
  const sorted = entries.sort((a, b) => {
    const [abbrA, dA] = a, [abbrB, dB] = b;
    let va, vb;
    if (dashSort.col === 'site') {
      va = (getSiteName(abbrA) || abbrA).toLowerCase();
      vb = (getSiteName(abbrB) || abbrB).toLowerCase();
    } else if (dashSort.col === 'lead') {
      const sA = STATE.sites.find(x => x.abbr === abbrA);
      const sB = STATE.sites.find(x => x.abbr === abbrB);
      va = ((sA && sA.site_lead) || '').toLowerCase();
      vb = ((sB && sB.site_lead) || '').toLowerCase();
    } else if (dashSort.col === 'total') {
      const uA = new Set(); days.forEach(d => (dA.days[d] || []).forEach(n => uA.add(n)));
      const uB = new Set(); days.forEach(d => (dB.days[d] || []).forEach(n => uB.add(n)));
      va = uA.size; vb = uB.size;
    } else {
      // day column
      va = (dA.days[dashSort.col] || []).length;
      vb = (dB.days[dashSort.col] || []).length;
    }
    if (va < vb) return -1 * dir;
    if (va > vb) return  1 * dir;
    return 0;
  });

  const sortArrow = (col) =>
    dashSort.col === col ? (dashSort.dir === 'asc' ? ' ↑' : ' ↓') : '';

  let sitesHtml = '';
  if (!sorted.length) {
    const emptyMsg = (siteQuery || groupFilt)
      ? `No sites match the current filter`
      : `No site allocations for ${formatWeekLabel(week)}`;
    sitesHtml = `<div class="empty"><div class="empty-icon">🏗</div><p>${emptyMsg}</p><p style="font-size:11px;margin-top:4px">${(siteQuery || groupFilt) ? 'Try clearing filters' : 'Edit the roster to allocate staff to sites'}</p></div>`;
  } else {
    const thBase = 'padding:8px 10px;text-align:center;font-size:11px;font-weight:700;cursor:pointer;user-select:none';
    sitesHtml = '<div class="roster-card" style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">';
    sitesHtml += '<thead><tr style="background:var(--navy);color:white">';
    sitesHtml += `<th style="${thBase};text-align:left;padding:8px 12px;min-width:160px" onclick="dashSortBy('site')">Site${sortArrow('site')}</th>`;
    sitesHtml += `<th style="${thBase};text-align:left;padding:8px 6px;min-width:80px" onclick="dashSortBy('lead')">Lead${sortArrow('lead')}</th>`;
    days.forEach((d, i) => {
      sitesHtml += `<th style="${thBase};min-width:55px" onclick="dashSortBy('${d}')">${dayLabels[i]}${sortArrow(d)}<br><span style="font-weight:400;font-size:9px;opacity:.7">${weekDates[i]}</span></th>`;
    });
    sitesHtml += `<th style="${thBase}" onclick="dashSortBy('total')">Total${sortArrow('total')}</th></tr></thead><tbody>`;

    sorted.forEach(([abbr, data], idx) => {
      const col          = colMap[siteColor(abbr)] || 'var(--ink-3)';
      const fullName     = getSiteName(abbr);
      const siteObj      = STATE.sites.find(x => x.abbr === abbr);
      const lead         = siteObj && siteObj.site_lead ? siteObj.site_lead.split(' ')[0] : '—';
      const bg           = idx % 2 === 0 ? 'var(--surface)' : 'var(--surface-2)';
      const uniquePeople = new Set();
      days.forEach(d => (data.days[d] || []).forEach(n => uniquePeople.add(n)));

      sitesHtml += `<tr style="background:${bg};border-bottom:1px solid var(--border)">`;
      sitesHtml += `<td style="padding:8px 12px;font-weight:600;color:var(--ink)">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${col};margin-right:6px;vertical-align:middle;flex-shrink:0"></span>
        ${fullName !== abbr ? `${esc(fullName)} <span style="font-size:10px;color:var(--ink-4);font-weight:500">${esc(abbr)}</span>` : esc(abbr)}
      </td>`;
      sitesHtml += `<td style="padding:8px 6px;font-size:11px;color:var(--ink-2)">${esc(lead)}</td>`;
      days.forEach(d => {
        const names  = data.days[d] || [];
        const count  = names.length;
        const title  = names.sort().join(', ');
        const cellBg = count === 0 ? '' : count <= 2 ? 'background:var(--blue-lt)' : count <= 4 ? 'background:var(--green-lt)' : 'background:var(--amber-lt)';
        sitesHtml += `<td style="padding:8px 10px;text-align:center;font-weight:700;${cellBg};cursor:default" title="${esc(title)}">${count || '<span style=color:var(--ink-4)>—</span>'}</td>`;
      });
      sitesHtml += `<td style="padding:8px 10px;text-align:center;font-weight:800;color:var(--navy)">${uniquePeople.size}</td>`;
      sitesHtml += '</tr>';
    });
    sitesHtml += '</tbody></table></div>';
  }

  const sitesEl = document.getElementById('dashboard-sites');
  if (sitesEl) sitesEl.innerHTML = sitesHtml;

  // Leave summary chips
  const onLeave = sched.filter(r => days.some(d => isLeave(r[d])));
  const leaveHtml = onLeave.length
    ? onLeave.map(r => {
        const codes = [...new Set(days.map(d => r[d]).filter(v => v && isLeave(v)))];
        const code  = codes[0] || 'LVE';
        return `<span style="background:var(--amber-lt);border:1px solid #FDE68A;border-radius:7px;padding:4px 11px;font-size:11.5px;font-weight:600;color:var(--amber)">${esc(r.name)} <span style="font-size:9px;opacity:.7">${code}</span></span>`;
      }).join('')
    : '<p style="font-size:12px;color:var(--ink-3)">No leave recorded this week</p>';

  const leaveEl = document.getElementById('dashboard-leave');
  if (leaveEl) leaveEl.innerHTML = leaveHtml;

  // Pending leave request cards
  const pending = (typeof leaveRequests !== 'undefined' ? leaveRequests : []).filter(r => r.status === 'Pending');
  const lrEl    = document.getElementById('dashboard-leave-requests');
  if (!lrEl) return;
  if (!pending.length) { lrEl.innerHTML = ''; return; }

  const typeLabels = { 'A/L': 'Annual Leave', 'U/L': 'Unpaid Leave', 'RDO': 'RDO' };
  let lrHtml = `<div class="section-header"><div class="section-title" style="color:var(--amber)">⏳ Pending Leave — ${pending.length}</div></div>`;
  lrHtml += '<div class="roster-card" style="overflow:hidden;border:1px solid #FDE68A">';
  pending.forEach(r => {
    const ds  = new Date(r.date_start + 'T00:00:00');
    const de  = new Date(r.date_end   + 'T00:00:00');
    const fmt = d => d.toLocaleDateString('en-AU', { weekday:'short', day:'numeric', month:'short' });
    const datesStr = r.individual_days && r.individual_days.length
      ? r.individual_days.map(d => fmt(new Date(d + 'T00:00:00'))).join(', ')
      : ds.getTime() === de.getTime() ? fmt(ds) : `${fmt(ds)} → ${fmt(de)}`;
    let bizDays = 0;
    if (r.individual_days && r.individual_days.length) { bizDays = r.individual_days.length; }
    else { const d = new Date(ds); while (d <= de) { if (d.getDay() !== 0 && d.getDay() !== 6) bizDays++; d.setDate(d.getDate() + 1); } }
    lrHtml += `<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--border);background:#FFFDF5">
      <div style="flex:1;min-width:0">
        <span style="font-weight:700;color:var(--navy)">${esc(r.requester_name)}</span>
        <span style="margin-left:6px;padding:2px 7px;border-radius:5px;font-size:10px;font-weight:600;background:var(--purple-lt);color:var(--purple)">${typeLabels[r.leave_type] || r.leave_type}</span>
        <div style="font-size:11px;color:var(--ink-2);margin-top:2px">${datesStr} — ${bizDays} day${bizDays !== 1 ? 's' : ''}</div>
        <div style="font-size:10px;color:var(--ink-3);margin-top:1px">Approver: ${esc(r.approver_name)}</div>
      </div>
      ${isManager ? `<button class="btn btn-primary btn-sm" onclick="openLeaveRespond(${r.id})" style="font-size:11px;flex-shrink:0">Review</button>` : ''}
    </div>`;
  });
  lrHtml += '</div>';
  lrEl.innerHTML = lrHtml;
}
