// ─────────────────────────────────────────────────────────────
// ROSTER MODULE
// Extracted from index.html as part of Stage 2 refactor.
// Depends on: app-state.js, utils.js (loaded before this file).
// Globals consumed: STATE, SITE_COLOR_MAP, LEAVE_TERMS, ALL_DAYS, ALL_LABELS,
//                   rosterSort, rosterActiveDay, rosterHasInteracted,
//                   currentPage, isManager
// Globals produced: siteColor, isLeave, chip, isKnownSite, getWeekSchedule,
//                   getPersonSchedule, getAllSiteCodes, getSiteName, getSiteAddress,
//                   renderRosterLegend, fillWeek, setSortCol, sortPeople,
//                   getVisibleRosterDays, getVisibleRosterDayLabels,
//                   syncRosterActiveDay, setRosterDay, stepRosterDay,
//                   getRosterPeopleForGroup, renderRosterDayView, renderRoster,
//                   attachRdvSwipe
// ─────────────────────────────────────────────────────────────

// ── Site / leave colour helpers ───────────────────────────────
function siteColor(s){
  if(!s||s.trim()==='') return 'empty';
  const u = s.toUpperCase().trim();
  if(LEAVE_TERMS.some(l=>u===l||u.startsWith(l))) return 'grey';
  for(const [k,v] of Object.entries(SITE_COLOR_MAP)){
    if(u===k||u.startsWith(k)) return v;
  }
  return 'purple';
}
function isLeave(s){ return !s||s.trim()===''||LEAVE_TERMS.some(l=>s.toUpperCase()===l||s.toUpperCase().startsWith(l)); }

function chip(s){
  if(!s||s.trim()===''||s==='nan') return `<span class="chip chip-empty">—</span>`;
  const c = siteColor(s);
  const lbl = s.length>7 ? s.slice(0,6)+'…' : s;
  const unknown = !isKnownSite(s);
  const attrs = unknown
    ? ' title="⚠ Unknown site — not in Sites list" style="outline:2px solid #F59E0B;outline-offset:-2px"'
    : ` title="${s}"`;
  const badge = unknown ? '<span style="font-size:8px;vertical-align:super;margin-left:1px;color:#D97706">?</span>' : '';
  return `<span class="chip chip-${c}"${attrs}>${lbl}${badge}</span>`;
}

// ── Week / schedule helpers ───────────────────────────────────
function getWeekSchedule(week){ return STATE.schedule.filter(r=>r.week===week); }
function getPersonSchedule(name, week){
  return STATE.schedule.find(r=>r.name===name&&r.week===week)
    || {name,week,mon:'',tue:'',wed:'',thu:'',fri:'',sat:'',sun:''};
}

// All unique site codes across all schedules (for dropdowns)
function getAllSiteCodes(){
  const days=['mon','tue','wed','thu','fri','sat','sun'];
  return [...new Set(
    STATE.schedule.flatMap(r=>days.map(d=>r[d]||''))
      .filter(s=>s&&!isLeave(s)&&s.trim().length>0)
  )].sort();
}

// Returns full site name from STATE.sites, falls back to abbr
function getSiteName(abbr){
  if(!abbr||abbr.trim()==='') return '';
  const site = STATE.sites.find(s=>s.abbr===abbr||abbr.startsWith(s.abbr));
  return site ? site.name : abbr;
}
// Returns site address from STATE.sites
function getSiteAddress(abbr){
  if(!abbr||abbr.trim()==='') return '';
  const site = STATE.sites.find(s=>s.abbr===abbr||abbr.startsWith(s.abbr));
  return site ? (site.address||'') : '';
}
// True if code is a known site abbreviation, leave code, or status
function isKnownSite(s){
  if(!s||s.trim()==='') return true;
  if(isLeave(s)) return true;
  return STATE.sites.some(site=>s===site.abbr||s.startsWith(site.abbr));
}

// ─────────────────────────────────────────────────────────────
// ROSTER LEGEND — active abbreviations this week
// ─────────────────────────────────────────────────────────────
function renderRosterLegend(){
  const week = STATE.currentWeek;
  const days = ['mon','tue','wed','thu','fri','sat','sun'];
  const sched = getWeekSchedule(week);
  // Read filters from DOM (same source as renderRoster)
  const search      = (document.getElementById('roster-search')?.value||'').toLowerCase();
  const groupFilter = document.getElementById('roster-group')?.value||'';
  const siteFilter  = document.getElementById('roster-site')?.value||'';
  // Check if entire week is empty (no entries at all, not just filtered)
  const weekHasAnyData = STATE.schedule.some(r=>r.week===week&&
    ['mon','tue','wed','thu','fri','sat','sun'].some(d=>r[d]&&r[d].trim()));
  if(!weekHasAnyData && !search && !groupFilter && !siteFilter){
    document.getElementById('roster-content').innerHTML=
      `<div class="empty">
        <div class="empty-icon">📅</div>
        <p style="font-weight:700;color:var(--navy);margin-bottom:6px">No roster data for this week</p>
        <p style="font-size:12px;color:var(--ink-3)">Use Edit Roster to add allocations, or select a different week.</p>
      </div>`;
    return;
  }
  // Collect unique active site codes this week
  const activeCodes = [...new Set(
    sched.flatMap(r=>days.map(d=>r[d]||'').filter(s=>s&&!isLeave(s)&&s.trim()))
  )].sort();
  // Collect leave codes used this week
  const leaveCodes = [...new Set(
    sched.flatMap(r=>days.map(d=>r[d]||'').filter(s=>s&&isLeave(s)&&s.trim()))
  )].sort();
  const lb = document.getElementById('legend-bar');
  if(!lb) return;
  if(!activeCodes.length && !leaveCodes.length){
    lb.innerHTML='<span style="font-size:11px;color:var(--ink-3)">No data for this week</span>'; return;
  }
  const colorDot = {blue:'#2563EB',green:'#16A34A',amber:'#D97706',red:'#DC2626',purple:'#7C77B9',grey:'#94A3B8',empty:'#CBD5E1'};
  const leaveLabels = {
    'AL':'Annual Leave','A/L':'Annual Leave','U/L':'Unpaid Leave','LVE':'Leave',
    'RDO':'RDO','PH':'Public Holiday','JURY':'Jury Duty','OFF':'Day Off',
    'TAFE':'TAFE','SICK':'Sick Leave','SL':'Sick Leave','PENDING':'Pending'
  };
  let html = '<span style="font-size:10px;font-weight:700;color:var(--ink-3);text-transform:uppercase;letter-spacing:.5px;margin-right:4px">This week:</span>';
  html += activeCodes.map(code=>{
    const col = siteColor(code);
    const dot = colorDot[col]||'#94A3B8';
    const full = getSiteName(code);
    const label = full===code ? code : `${code} — ${full}`;
    return `<span class="legend-item"><span class="legend-dot" style="background:${dot}"></span>${label}</span>`;
  }).join('');
  if(leaveCodes.length){
    html += '<span style="font-size:10px;font-weight:700;color:var(--ink-3);text-transform:uppercase;letter-spacing:.5px;margin:0 4px 0 8px;border-left:1px solid var(--border);padding-left:8px">Leave:</span>';
    html += leaveCodes.map(code=>{
      const full = leaveLabels[code.toUpperCase()]||code;
      return `<span class="legend-item"><span class="legend-dot" style="background:#94A3B8"></span>${full}</span>`;
    }).join('');
  }
  lb.innerHTML = html;
}


function fillWeek(name, week){
  if(!isManager){ showToast('Supervision access required'); return; }
  const entry = STATE.schedule.find(r=>r.name===name&&r.week===week)
    || {name,week,mon:'',tue:'',wed:'',thu:'',fri:'',sat:'',sun:''};
  const val = entry.mon;
  if(!val){ showToast('Set Monday first, then fill'); return; }
  ['tue','wed','thu','fri'].forEach(d=>entry[d]=val);
  if(!STATE.schedule.find(r=>r.name===name&&r.week===week)) STATE.schedule.push(entry);

  renderEditor();
  if(currentPage==='roster') renderRoster();
  showToast(`${name}: Mon–Fri filled with ${val}`);
}

// ─────────────────────────────────────────────────────────────
// ROSTER SORT
// ─────────────────────────────────────────────────────────────
function setSortCol(col){
  if(rosterSort.col===col) rosterSort.dir = rosterSort.dir==='asc'?'desc':'asc';
  else { rosterSort.col=col; rosterSort.dir='asc'; }
  renderRoster();
}

function sortPeople(people, week){
  const {col, dir} = rosterSort;
  const mult = dir==='asc' ? 1 : -1;
  return [...people].sort((a,b)=>{
    let av, bv;
    if(col==='name'){
      av=a.name.toLowerCase(); bv=b.name.toLowerCase();
    } else if(col==='phone'){
      av=a.phone||'zzz'; bv=b.phone||'zzz';
    } else {
      // day column
      av=(getPersonSchedule(a.name,week)[col]||'').toLowerCase();
      bv=(getPersonSchedule(b.name,week)[col]||'').toLowerCase();
    }
    return av<bv ? -mult : av>bv ? mult : 0;
  });
}

// ─────────────────────────────────────────────────────────────
// MOBILE ROSTER DAY SLIDER — helpers
// (state vars rosterActiveDay, rosterHasInteracted, ALL_DAYS, ALL_LABELS
//  are declared in app-state.js)
// ─────────────────────────────────────────────────────────────
function getVisibleRosterDays(week){
  const weekSched = getWeekSchedule(week);
  const showSat = weekSched.some(r=>r.sat&&r.sat.trim());
  const showSun = weekSched.some(r=>r.sun&&r.sun.trim());
  return ALL_DAYS.filter((_,i)=>i<5||(i===5&&showSat)||(i===6&&showSun));
}

function getVisibleRosterDayLabels(week){
  const weekSched = getWeekSchedule(week);
  const showSat = weekSched.some(r=>r.sat&&r.sat.trim());
  const showSun = weekSched.some(r=>r.sun&&r.sun.trim());
  return ALL_LABELS.filter((_,i)=>i<5||(i===5&&showSat)||(i===6&&showSun));
}

function syncRosterActiveDay(){
  const week = STATE.currentWeek;
  const visible = getVisibleRosterDays(week);
  if(visible.includes(rosterActiveDay)) return; // still valid — keep it
  // Try to find today's weekday in the visible days
  const dayMap = {1:'mon',2:'tue',3:'wed',4:'thu',5:'fri',6:'sat',0:'sun'};
  const todayKey = dayMap[new Date().getDay()];
  if(visible.includes(todayKey)){ rosterActiveDay = todayKey; return; }
  rosterActiveDay = visible[0] || 'mon';
}

function setRosterDay(day){
  rosterActiveDay = day;
  rosterHasInteracted = true;
  // Dismiss swipe hint
  const hint = document.getElementById('roster-swipe-hint');
  if(hint){ hint.style.opacity='0'; hint.style.transition='opacity .3s'; setTimeout(()=>{ hint.style.display='none'; }, 320); }
  renderRoster();
}

function stepRosterDay(dir){
  const visible = getVisibleRosterDays(STATE.currentWeek);
  const idx = visible.indexOf(rosterActiveDay);
  const next = idx + dir;
  if(next < 0 || next >= visible.length) return;
  setRosterDay(visible[next]);
}

function getRosterPeopleForGroup(group, week, search, groupFilter, siteFilter){
  let people = STATE.people.filter(p=>p.group===group);
  if(groupFilter && group !== groupFilter) return [];
  if(search) people = people.filter(p=>p.name.toLowerCase().includes(search));
  if(siteFilter){
    const visDays = getVisibleRosterDays(week);
    people = people.filter(p=>{
      const s = getPersonSchedule(p.name, week);
      return visDays.some(d=>s[d]===siteFilter);
    });
  }
  return sortPeople(people, week);
}

function renderRosterDayView(week, search, groupFilter, siteFilter){
  syncRosterActiveDay();
  const day      = rosterActiveDay;
  const visible  = getVisibleRosterDays(week);
  const labels   = getVisibleRosterDayLabels(week);
  const weekDates= getWeekDates(week);
  // weekDates index matches ALL_DAYS index (mon=0..sun=6)
  const dayIdx   = ALL_DAYS.indexOf(day);
  const dayLabel = ALL_LABELS[dayIdx] || day;
  const dateStr  = weekDates[dayIdx] || '';

  const groups  = ['Direct','Apprentice','Labour Hire'];
  const gClass  = {'Direct':'direct','Apprentice':'apprentice','Labour Hire':'labour'};
  const gIcon   = {'Direct':'⚡','Apprentice':'🎓','Labour Hire':'🔧'};
  const rowClass= {'Direct':'','Apprentice':'row-app','Labour Hire':'row-lh'};

  // Count total allocations for the day (after filters, non-leave, non-empty)
  let totalCount = 0;

  // Build group sections
  let groupsHtml = '';
  groups.forEach(g=>{
    const people = getRosterPeopleForGroup(g, week, search, groupFilter, siteFilter);
    // Only include people who have something on this day
    const active = people.filter(p=>{
      const val = getPersonSchedule(p.name, week)[day];
      return val && val.trim() && val.trim() !== 'nan';
    });
    if(!active.length) return;
    totalCount += active.length;
    const rc = rowClass[g];
    groupsHtml += `<div class="rdv-group-section">
      <div class="rdv-group-header ${gClass[g]}">
        <span>${gIcon[g]}</span><span>${g}</span>
        <span class="rdv-group-count">${active.length}</span>
      </div>
      <div class="roster-card" style="border-radius:0 0 8px 8px">
        ${active.map(p=>{
          const val = getPersonSchedule(p.name, week)[day];
          return `<div class="rdv-person-row ${rc}">
            <span class="rdv-person-name">${esc(p.name)}</span>
            ${chip(val)}
          </div>`;
        }).join('')}
      </div>
    </div>`;
  });

  if(!groupsHtml){
    groupsHtml = `<div class="empty"><div class="empty-icon">📭</div><p>No allocations for ${dayLabel} ${dateStr}</p></div>`;
  }

  // Day chip row
  const chipsHtml = visible.map((d,i)=>{
    const lbl  = labels[i];
    const dIdx = ALL_DAYS.indexOf(d);
    const dt   = weekDates[dIdx] || '';
    return `<button class="rdv-day-chip${d===day?' active':''}" onclick="setRosterDay('${d}')" aria-label="${lbl} ${dt}">
      <div>${lbl}</div>
      <div style="font-size:9px;font-weight:500;opacity:.7;margin-top:1px">${dt}</div>
    </button>`;
  }).join('');

  return `
    <div class="rdv-day-chips">${chipsHtml}</div>
    <div class="rdv-summary-card">
      <div>
        <div class="rdv-summary-day">${dayLabel}</div>
        <div class="rdv-summary-date">${dateStr} · w/c ${week}</div>
      </div>
      <div class="rdv-summary-count">${totalCount} on site</div>
    </div>
    <div class="rdv-panel rdv-viewport" id="rdv-viewport">${groupsHtml}</div>
  `;
}

function renderRoster(){
  const week   = STATE.currentWeek;
  const search = document.getElementById('roster-search').value.toLowerCase();
  const group  = document.getElementById('roster-group').value;
  const site   = document.getElementById('roster-site').value;

  // ── Mobile: day-slider view ──────────────────────────────────
  if(window.innerWidth <= 768){
    const html = renderRosterDayView(week, search, group, site);
    document.getElementById('roster-content').innerHTML = html;
    attachRdvSwipe();
    renderRosterLegend();
    // Update swipe hint visibility
    const hint = document.getElementById('roster-swipe-hint');
    if(hint && !rosterHasInteracted){
      hint.style.display = 'flex';
      hint.style.opacity = '1';
    }
    return;
  }

  // ── Desktop: full weekly table ───────────────────────────────
  const allDays   = ['mon','tue','wed','thu','fri','sat','sun'];
  const allLabels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const weekSched = getWeekSchedule(week);
  const showSat = weekSched.some(r=>r.sat&&r.sat.trim());
  const showSun = weekSched.some(r=>r.sun&&r.sun.trim());
  const days      = allDays.filter((_,i)=>i<5||(i===5&&showSat)||(i===6&&showSun));
  const dayLabels = allLabels.filter((_,i)=>i<5||(i===5&&showSat)||(i===6&&showSun));
  const groups = ['Direct','Apprentice','Labour Hire'];
  const gClass = {'Direct':'direct','Apprentice':'apprentice','Labour Hire':'labour'};
  const gIcon  = {'Direct':'⚡','Apprentice':'🎓','Labour Hire':'🔧'};

  const weekDates = getWeekDates(week);

  function thClass(col){ return `sortable${rosterSort.col===col?' sort-'+rosterSort.dir:''}`; }

  let html='';
  groups.forEach(g=>{
    let people = STATE.people.filter(p=>p.group===g);
    if(group && g!==group) return;
    if(search) people = people.filter(p=>p.name.toLowerCase().includes(search));
    if(site)   people = people.filter(p=>{ const s=getPersonSchedule(p.name,week); return days.some(d=>s[d]===site); });
    if(!people.length) return;
    people = sortPeople(people, week);
    html+=`<div class="group-section" style="margin-bottom:14px">
      <div class="group-strip ${gClass[g]}"><span>${gIcon[g]}</span><span>${g}</span><span class="group-strip-count">${people.length}</span></div>
      <div class="roster-card"><div class="table-scroll"><table>
        <thead><tr>
          <th class="name-col ${thClass('name')}" onclick="setSortCol('name')">Name</th>
          ${days.map((d,i)=>`<th class="center ${thClass(d)}" onclick="setSortCol('${d}')">${dayLabels[i]}<br><span style="font-size:9px;font-weight:400;color:var(--ink-3)">${weekDates[allDays.indexOf(d)]}</span></th>`).join('')}
        </tr></thead>
        <tbody>${people.map(p=>{
          const s=getPersonSchedule(p.name,week);
          const rc=g==='Apprentice'?'row-app':g==='Labour Hire'?'row-lh':'';
          return `<tr class="${rc}">
            <td class="name-col">${esc(p.name)}</td>
            ${days.map(d=>`<td class="day-cell">${chip(s[d])}</td>`).join('')}
          </tr>`;
        }).join('')}</tbody>
      </table></div></div>
    </div>`;
  });
  document.getElementById('roster-content').innerHTML = html||'<div class="empty"><div class="empty-icon">🔍</div><p>No results match your filters</p></div>';
  renderRosterLegend();
}

// ─────────────────────────────────────────────────────────────
// MOBILE ROSTER: swipe gestures, hint, resize
// ─────────────────────────────────────────────────────────────
(function(){

  var txStart = 0, tyStart = 0, txLast = 0, tyLast = 0, tracking = false;

  function onTouchStart(e){
    if(window.innerWidth > 768) return;
    if(!document.getElementById('rdv-viewport')) return;
    txStart  = e.touches[0].clientX;
    tyStart  = e.touches[0].clientY;
    txLast   = txStart;
    tyLast   = tyStart;
    tracking = true;
  }

  function onTouchMove(e){
    if(!tracking) return;
    txLast = e.touches[0].clientX;
    tyLast = e.touches[0].clientY;
  }

  function onTouchEnd(){
    if(!tracking) return;
    tracking = false;
    var dx    = txLast - txStart;
    var dy    = tyLast - tyStart;
    var absDx = Math.abs(dx);
    var absDy = Math.abs(dy);
    if(absDx < 50 || absDx <= absDy) return;
    if(dx < 0) stepRosterDay(1);   // swipe left  → next day
    else        stepRosterDay(-1);  // swipe right → prev day
  }

  // Attach once to the stable #roster-content container (not the recreated #rdv-viewport)
  document.addEventListener('DOMContentLoaded', function(){
    var rc = document.getElementById('roster-content');
    if(rc){
      rc.addEventListener('touchstart', onTouchStart, { passive: true });
      rc.addEventListener('touchmove',  onTouchMove,  { passive: true });
      rc.addEventListener('touchend',   onTouchEnd,   { passive: true });
    }
  });

  // no-op — swipe is now delegated from roster-content, not per-render
  window.attachRdvSwipe = function(){};

  // ── Hint ─────────────────────────────────────────────────────
  function initHint(){
    if(window.innerWidth > 768) return;
    var hint = document.getElementById('roster-swipe-hint');
    if(!hint) return;
    if(rosterHasInteracted){ hint.style.display='none'; return; }
    hint.style.display = 'flex';
    hint.style.opacity = '1';
  }

  // ── Resize → re-render ───────────────────────────────────────
  var resizeTimer;
  window.addEventListener('resize', function(){
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function(){
      if(typeof currentPage !== 'undefined' && currentPage === 'roster') renderRoster();
    }, 200);
  });

  // ── showPage hook ────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function(){
    initHint();
    var origShowPage = window.showPage;
    if(typeof origShowPage === 'function'){
      window.showPage = function(id){
        origShowPage(id);
        if(id === 'roster') setTimeout(initHint, 60);
      };
    }
  });

})();
