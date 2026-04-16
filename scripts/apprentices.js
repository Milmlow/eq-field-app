// ─────────────────────────────────────────────────────────────
// scripts/apprentices.js  —  EQ Solves Field  v2.0
// Apprentice Management: profiles, Skills Passport,
// tradesman feedback, self-assessment, rotations.
// Depends on: app-state.js, utils.js, supabase.js
// Changes v2.0:
//   - Contacts are source of truth (year_level on people)
//   - Add Profile → Add Contact flow (no double-ups)
//   - Profile details pulled from people record
//   - Period dropdowns: Q1–Q4 current calendar year
//   - skills_ratings UPSERT (no duplicates)
//   - Rater name dropdowns: contacts + supervision list, type-to-find
//   - Feedback name: same combobox
//   - Site/Project: job numbers list + free text
// ─────────────────────────────────────────────────────────────

let apprenticeProfiles = [];
let competencies = [];
let _uuidNameCache = {};
let skillsRatings = [];
let feedbackEntries = [];
let apprenticeRotations = [];
let activeApprenticeId = null;
let activeApprenticeTab = 'overview';

// ── Helpers: period ───────────────────────────────────────────

function getPeriodOptions() {
  const yr = new Date().getFullYear();
  return ['Q1 ' + yr, 'Q2 ' + yr, 'Q3 ' + yr, 'Q4 ' + yr];
}

function getCurrentPeriod() {
  const m = new Date().getMonth(); // 0-11
  const yr = new Date().getFullYear();
  const q = m < 3 ? 1 : m < 6 ? 2 : m < 9 ? 3 : 4;
  return 'Q' + q + ' ' + yr;
}

function periodSelectHtml(id, selected) {
  const opts = getPeriodOptions();
  let h = '<select id="' + id + '" style="width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px;background:var(--surface);color:var(--ink)">';
  opts.forEach(o => {
    h += '<option value="' + o + '"' + (o === (selected || getCurrentPeriod()) ? ' selected' : '') + '>' + o + '</option>';
  });
  h += '</select>';
  return h;
}

// ── Helpers: people/contacts combobox ────────────────────────

function nameComboHtml(id, placeholder, value) {
  // Datalist of all people (direct + supervision/managers) + free text
  const allPeople = [];
  (STATE.people || []).forEach(p => allPeople.push(p.name));
  (STATE.managers || []).forEach(m => { if (!allPeople.includes(m.name)) allPeople.push(m.name); });
  allPeople.sort();

  let h = '<input id="' + id + '" list="' + id + '-list" autocomplete="off" placeholder="' + (placeholder || 'Type to search or enter name') + '" value="' + esc(value || '') + '" style="width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px;background:var(--surface);color:var(--ink);box-sizing:border-box">';
  h += '<datalist id="' + id + '-list">';
  allPeople.forEach(n => { h += '<option value="' + esc(n) + '">'; });
  h += '</datalist>';
  return h;
}

// ── Helpers: job number combobox ──────────────────────────────

function jobComboHtml(id, placeholder, value) {
  // jobNumbers is the module-level array from scripts/jobnumbers.js
  const jobs = (typeof jobNumbers !== 'undefined' ? jobNumbers : null) || STATE.jobNumbers || STATE.job_numbers || [];
  let h = '<input id="' + id + '" list="' + id + '-list" autocomplete="off" placeholder="' + (placeholder || 'Job number or project name') + '" value="' + esc(value || '') + '" style="width:100%;padding:9px 10px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:13px;background:var(--surface);color:var(--ink);box-sizing:border-box">';
  h += '<datalist id="' + id + '-list">';
  jobs.forEach(j => {
    const label = (j.number || j.job_number || '') + (j.description ? ' — ' + j.description : '') + (j.site_name ? ' (' + j.site_name + ')' : '');
    h += '<option value="' + esc(label) + '">';
  });
  h += '</datalist>';
  return h;
}

// ── Data loading ──────────────────────────────────────────────

async function loadApprenticeData() {
  try {
    const [profiles, comps, ratings, feedback, rots, dbPeople] = await Promise.all([
      sbFetch('apprentice_profiles?order=id.asc'),
      sbFetch('competencies?order=sort_order.asc&active=eq.true'),
      sbFetch('skills_ratings?order=period.asc,rating_type.asc,competency_id.asc'),
      sbFetch('feedback_entries?order=feedback_date.desc'),
      sbFetch('rotations?order=date_start.desc'),
      sbFetch('people?select=id,name,year_level,group&order=name.asc'),
    ]);

    // Build UUID→name + UUID→year_level lookups
    const uuidToName = {};
    const uuidToYear = {};
    if (dbPeople && dbPeople.length) {
      dbPeople.forEach(p => {
        uuidToName[String(p.id)] = p.name;
        if (p.year_level) uuidToYear[String(p.id)] = p.year_level;
      });
    }
    if (typeof STATE !== 'undefined' && STATE.people) {
      STATE.people.forEach(p => { uuidToName[String(p.name)] = p.name; });
    }
    _uuidNameCache = { ...uuidToName };

    if (profiles) {
      apprenticeProfiles = profiles.map(p => ({
        ...p,
        _resolvedName: uuidToName[String(p.person_id)] || null,
        _resolvedYear: uuidToYear[String(p.person_id)] || p.year_level || null,
      }));
    }
    if (comps && comps.length) competencies = comps;
    if (ratings) skillsRatings = ratings;
    if (feedback) feedbackEntries = feedback;
    if (rots) apprenticeRotations = rots;
  } catch (e) {
    console.warn('EQ[apprentices] load failed:', e && e.message || e);
  }
}

// ── Name resolver ─────────────────────────────────────────────

function getPersonNameById(personId) {
  const seed = (STATE.people || []).find(x => x.id === personId || String(x.id) === String(personId));
  if (seed) return seed.name;
  const prof = apprenticeProfiles.find(x => String(x.person_id) === String(personId));
  if (prof && prof._resolvedName) return prof._resolvedName;
  return _uuidNameCache[String(personId)] || 'Unknown';
}

// ── Year badge ────────────────────────────────────────────────

function yearBadge(year) {
  const labels = { 1: '1st Year', 2: '2nd Year', 3: '3rd Year', 4: '4th Year' };
  const colors = {
    1: '#EFF4FF;color:#2563EB',
    2: '#F0FDF4;color:#16A34A',
    3: '#FFFBEB;color:#D97706',
    4: '#EEEDF8;color:#7C77B9'
  };
  return '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:' + (colors[year] || '#F8FAFC;color:#64748B') + '">' + (labels[year] || (year + 'th Year')) + '</span>';
}

function avgRating(apprenticeId, type) {
  const ratings = skillsRatings.filter(r => r.apprentice_id === apprenticeId && r.rating_type === type);
  if (!ratings.length) return null;
  return (ratings.reduce((s, r) => s + r.rating, 0) / ratings.length).toFixed(1);
}

function ratingColor(r) {
  if (!r) return 'var(--ink-4)';
  if (r <= 2) return '#DC2626';
  if (r <= 3) return '#D97706';
  return '#16A34A';
}

function ratingBg(r) {
  if (!r) return '#F8FAFC';
  if (r <= 2) return '#FEF2F2';
  if (r <= 3) return '#FFFBEB';
  return '#F0FDF4';
}

function starDisplay(rating) {
  if (!rating) return '<span style="color:var(--ink-4);font-size:13px">—</span>';
  const full = Math.round(rating);
  return Array.from({ length: 5 }, (_, i) =>
    '<span style="color:' + (i < full ? '#F59E0B' : '#E5E7EB') + ';font-size:16px">★</span>'
  ).join('');
}

// ── Main list render ──────────────────────────────────────────

function renderApprentices() {
  const container = document.getElementById('apprentices-content');
  if (!container) return;

  if (activeApprenticeId) {
    renderApprenticeProfile(activeApprenticeId);
    return;
  }

  const apprenticePeople = (STATE.people || []).filter(p => p.group === 'Apprentice');

  if (!apprenticePeople.length) {
    container.innerHTML = '<div class="empty"><div class="empty-icon">🎓</div><p>No apprentices on the roster yet</p>' +
      (isManager ? '<button class="btn btn-primary" style="margin-top:12px" onclick="openAddContact()">+ Add Contact</button>' : '') +
      '</div>';
    return;
  }

  let html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">';
  html += '<div><div class="section-title">Apprentice Management</div><div style="font-size:12px;color:var(--ink-3);margin-top:3px">Skills tracking, feedback and development</div></div>';
  if (isManager) {
    html += '<button class="btn btn-primary btn-sm" onclick="openAddContact()">+ Add Contact</button>';
  }
  html += '</div>';

  html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px">';

  apprenticePeople.forEach(person => {
    const profile = apprenticeProfiles.find(p =>
      String(p.person_id) === String(person.id) || p._resolvedName === person.name
    );
    const selfAvg = profile ? avgRating(profile.id, 'self') : null;
    const tradeAvg = profile ? avgRating(profile.id, 'tradesman') : null;
    const feedbackCount = profile ? feedbackEntries.filter(f => f.apprentice_id === profile.id).length : 0;
    // Year level from contact (source of truth) or profile fallback
    const yearLevel = person.year_level || (profile && profile.year_level);

    html += '<div class="roster-card" style="padding:18px 20px;cursor:pointer;transition:box-shadow .15s" onclick="openApprenticeProfile(' + (profile ? profile.id : 'null') + ',\'' + esc(person.name) + '\')" onmouseover="this.style.boxShadow=\'0 4px 16px rgba(0,0,0,.12)\'" onmouseout="this.style.boxShadow=\'\'">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">';
    html += '<div><div style="font-size:15px;font-weight:700;color:var(--navy)">' + esc(person.name) + '</div>';
    html += '<div style="margin-top:4px">' + (yearLevel ? yearBadge(yearLevel) : '<span style="font-size:10px;color:var(--ink-4)">Year not set</span>') + '</div></div>';
    html += '<div style="font-size:32px">🎓</div>';
    html += '</div>';

    if (profile) {
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">';
      html += '<div style="background:var(--surface-2);border-radius:8px;padding:8px 10px;text-align:center">';
      html += '<div style="font-size:10px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Self</div>';
      html += '<div style="font-size:18px;font-weight:800;color:' + ratingColor(selfAvg) + '">' + (selfAvg || '—') + '</div></div>';
      html += '<div style="background:var(--surface-2);border-radius:8px;padding:8px 10px;text-align:center">';
      html += '<div style="font-size:10px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Tradesman</div>';
      html += '<div style="font-size:18px;font-weight:800;color:' + ratingColor(tradeAvg) + '">' + (tradeAvg || '—') + '</div></div>';
      html += '</div>';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--ink-3);padding-top:10px;border-top:1px solid var(--border)">';
      html += '<span>' + feedbackCount + ' feedback ' + (feedbackCount === 1 ? 'entry' : 'entries') + '</span>';
      html += '<span style="color:var(--purple);font-weight:600">View Profile →</span>';
      html += '</div>';
    } else {
      html += '<div style="font-size:12px;color:var(--ink-3);margin-bottom:8px">No skills profile yet</div>';
      if (isManager) {
        html += '<div style="font-size:11px;color:var(--purple);font-weight:600">Click to set up →</div>';
      }
    }
    html += '</div>';
  });

  html += '</div>';
  container.innerHTML = html;
}

// ── Open profile (or redirect to Add Contact) ─────────────────

function openApprenticeProfile(profileId, personName) {
  if (!profileId) {
    if (isManager) {
      // No profile — guide to set up profile (contact already exists)
      openSetupProfile(personName);
    } else {
      showToast('No profile set up yet for ' + personName);
    }
    return;
  }
  activeApprenticeId = profileId;
  activeApprenticeTab = 'overview';
  renderApprenticeProfile(profileId);
}

function renderApprenticeProfile(profileId) {
  const container = document.getElementById('apprentices-content');
  const profile = apprenticeProfiles.find(p => p.id === profileId);
  if (!profile || !container) return;

  const person = (STATE.people || []).find(p =>
    String(p.id) === String(profile.person_id) || p.name === profile._resolvedName
  );
  const personName = person ? person.name : (profile._resolvedName || 'Unknown');
  // Year from contact (source of truth)
  const yearLevel = (person && person.year_level) || profile._resolvedYear || profile.year_level;
  const site = (STATE.sites || []).find(s => s.abbr === profile.current_site);

  let html = '<div style="margin-bottom:16px">';
  html += '<button class="btn btn-secondary btn-sm" onclick="closeApprenticeProfile()" style="margin-bottom:14px">← All Apprentices</button>';
  html += '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">';
  html += '<div style="font-size:40px">🎓</div>';
  html += '<div>';
  html += '<div style="font-size:20px;font-weight:800;color:var(--navy)">' + esc(personName) + '</div>';
  html += '<div style="display:flex;gap:8px;align-items:center;margin-top:4px;flex-wrap:wrap">';
  if (yearLevel) html += yearBadge(yearLevel);
  if (profile.current_site) html += '<span style="font-size:11px;color:var(--ink-3)">📍 ' + esc(site ? site.name : profile.current_site) + '</span>';
  if (profile.start_date) html += '<span style="font-size:11px;color:var(--ink-3)">📅 Started ' + profile.start_date + '</span>';
  html += '</div></div></div>';

  // Tabs
  const fbCount = feedbackEntries.filter(f => f.apprentice_id === profileId).length;
  const tabs = [
    { id: 'overview', label: '👤 Overview' },
    { id: 'passport', label: '🎯 Skills Passport' },
    { id: 'feedback', label: '💬 Feedback (' + fbCount + ')' },
    { id: 'rotations', label: '🏗 Rotations' },
  ];
  html += '<div style="display:flex;gap:4px;margin-top:16px;border-bottom:2px solid var(--border);padding-bottom:0">';
  tabs.forEach(t => {
    const active = activeApprenticeTab === t.id;
    html += '<button onclick="setApprenticeTab(' + profileId + ',\'' + t.id + '\')" style="padding:9px 16px;border:none;background:none;font-family:inherit;font-size:12px;font-weight:' + (active ? '700' : '500') + ';color:' + (active ? 'var(--navy)' : 'var(--ink-3)') + ';cursor:pointer;border-bottom:2px solid ' + (active ? 'var(--navy)' : 'transparent') + ';margin-bottom:-2px">' + t.label + '</button>';
  });
  html += '</div></div>';

  if (activeApprenticeTab === 'overview') html += renderApprenticeOverviewTab(profile, personName, person);
  else if (activeApprenticeTab === 'passport') html += renderSkillsPassportTab(profile);
  else if (activeApprenticeTab === 'feedback') html += renderFeedbackTab(profile, personName);
  else if (activeApprenticeTab === 'rotations') html += renderRotationsTab(profile);

  container.innerHTML = html;
}

function setApprenticeTab(profileId, tab) {
  activeApprenticeTab = tab;
  renderApprenticeProfile(profileId);
}

function closeApprenticeProfile() {
  activeApprenticeId = null;
  activeApprenticeTab = 'overview';
  renderApprentices();
}

// ── Overview tab ──────────────────────────────────────────────

function renderApprenticeOverviewTab(profile, personName, person) {
  const yearLevel = (person && person.year_level) || profile._resolvedYear || profile.year_level;
  let html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">';

  // Goals card
  html += '<div class="roster-card" style="padding:18px 20px;grid-column:1/-1">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">';
  html += '<div style="font-size:13px;font-weight:700;color:var(--navy)">Development Goals</div>';
  if (isManager) html += '<button class="btn btn-secondary btn-sm" onclick="openEditGoals(' + profile.id + ')">Edit Goals</button>';
  html += '</div>';
  html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">';
  const goals = [
    { label: '🔧 Technical', val: profile.goal_technical },
    { label: '💼 Professional', val: profile.goal_professional },
    { label: '🌱 Personal', val: profile.goal_personal },
  ];
  goals.forEach(g => {
    html += '<div style="background:var(--surface-2);border-radius:8px;padding:12px 14px">';
    html += '<div style="font-size:10px;font-weight:700;color:var(--ink-3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">' + g.label + '</div>';
    html += '<div style="font-size:12px;color:var(--ink-2);line-height:1.5">' + (g.val ? esc(g.val) : '<span style="color:var(--ink-4)">Not set yet</span>') + '</div>';
    html += '</div>';
  });
  html += '</div></div>';

  // Details card — from contact record
  html += '<div class="roster-card" style="padding:18px 20px">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">';
  html += '<div style="font-size:13px;font-weight:700;color:var(--navy)">Contact Details</div>';
  if (isManager) html += '<button class="btn btn-secondary btn-sm" onclick="openEditContactYear(\'' + esc(personName) + '\',' + profile.id + ')">Edit</button>';
  html += '</div>';
  const details = [
    ['Year Level', yearLevel ? yearBadge(yearLevel) : '<span style="color:var(--ink-4)">Not set</span>'],
    ['Phone', (person && person.phone) || '—'],
    ['Email', (person && person.email) || '—'],
    ['Start Date', profile.start_date || '—'],
    ['Current Site', profile.current_site || '—'],
    ['Active', profile.active ? '✅ Yes' : '❌ No'],
  ];
  details.forEach(([label, val]) => {
    html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px">';
    html += '<span style="color:var(--ink-3)">' + label + '</span><span style="font-weight:600">' + val + '</span>';
    html += '</div>';
  });
  if (profile.notes) html += '<div style="margin-top:12px;font-size:12px;color:var(--ink-2);background:var(--surface-2);padding:10px 12px;border-radius:6px;line-height:1.5">' + esc(profile.notes) + '</div>';
  html += '</div>';

  // At a glance
  const selfAvg = avgRating(profile.id, 'self');
  const tradeAvg = avgRating(profile.id, 'tradesman');
  const fbCount = feedbackEntries.filter(f => f.apprentice_id === profile.id).length;
  const rotCount = apprenticeRotations.filter(r => r.apprentice_id === profile.id).length;
  html += '<div class="roster-card" style="padding:18px 20px">';
  html += '<div style="font-size:13px;font-weight:700;color:var(--navy);margin-bottom:14px">At a Glance</div>';
  [['Self Rating', selfAvg ? selfAvg + ' / 5' : 'Not rated', ratingColor(selfAvg)],
   ['Trade Rating', tradeAvg ? tradeAvg + ' / 5' : 'Not rated', ratingColor(tradeAvg)],
   ['Feedback Entries', fbCount, 'var(--ink)'],
   ['Rotations', rotCount, 'var(--ink)']].forEach(([label, val, col]) => {
    html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px">';
    html += '<span style="color:var(--ink-3)">' + label + '</span><span style="font-weight:700;color:' + col + '">' + val + '</span>';
    html += '</div>';
  });
  html += '</div>';
  html += '</div>';

  // Action buttons
  if (isManager) {
    html += '<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">';
    html += '<button class="btn btn-primary btn-sm" onclick="openFeedbackForm(' + profile.id + ',\'' + esc(personName) + '\')">+ Give Feedback</button>';
    html += '<button class="btn btn-secondary btn-sm" onclick="openTradesmanRatingForm(' + profile.id + ',\'' + esc(personName) + '\')">Rate Skills</button>';
    html += '<button class="btn btn-secondary btn-sm" onclick="openAddRotation(' + profile.id + ',\'' + esc(personName) + '\')">+ Add Rotation</button>';
    html += '</div>';
  }
  return html;
}

// ── Skills Passport tab ───────────────────────────────────────

function renderSkillsPassportTab(profile) {
  const periods = [...new Set(skillsRatings.filter(r => r.apprentice_id === profile.id).map(r => r.period))].sort();
  const latestPeriod = periods[periods.length - 1] || null;

  let html = '<div style="margin-top:16px">';
  if (periods.length > 1) {
    html += '<div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap">';
    periods.forEach(p => {
      html += '<button onclick="renderPassportForPeriod(' + profile.id + ',\'' + esc(p) + '\')" class="btn btn-' + (p === latestPeriod ? '' : 'secondary ') + 'btn-sm">' + esc(p) + '</button>';
    });
    html += '</div>';
  }
  if (!latestPeriod) {
    html += '<div class="empty"><div class="empty-icon">🎯</div><p>No ratings yet. Tap \'How am I going?\' to start — takes 2 minutes.</p>';
    html += '<button class="btn btn-primary" style="margin-top:12px" onclick="openSelfAssessmentForm(' + profile.id + ')">How am I going? 🤔</button></div>';
    html += '</div>';
    return html;
  }
  html += renderPassportGrid(profile.id, latestPeriod);
  html += '<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">';
  html += '<button class="btn btn-primary btn-sm" onclick="openSelfAssessmentForm(' + profile.id + ')">How am I going? 🤔</button>';
  if (isManager) {
    html += '<button class="btn btn-secondary btn-sm" onclick="openTradesmanRatingForm(' + profile.id + ',\'\')">How are they actually going? 😎</button>';
  }
  html += '</div>';
  html += '</div>';
  return html;
}

function renderPassportGrid(apprenticeId, period) {
  const appRatings = skillsRatings.filter(r => r.apprentice_id === apprenticeId && r.period === period);
  const selfMap = {};
  const tradeMap = {};
  appRatings.forEach(r => {
    if (r.rating_type === 'self') selfMap[r.competency_id] = r;
    else tradeMap[r.competency_id] = r;
  });

  let html = '<div class="roster-card" style="overflow-x:auto">';
  html += '<div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">';
  html += '<span style="font-size:13px;font-weight:700;color:var(--navy)">Skills Passport — ' + esc(period) + '</span>';
  html += '<div style="display:flex;gap:10px;font-size:11px">';
  html += '<span><span style="color:#DC2626;font-weight:700">● </span>Needs attention (1–2)</span>';
  html += '<span><span style="color:#D97706;font-weight:700">● </span>Progressing (3)</span>';
  html += '<span><span style="color:#16A34A;font-weight:700">● </span>Confident (4–5)</span>';
  html += '</div></div>';
  html += '<table style="width:100%;border-collapse:collapse;font-size:12px">';
  html += '<thead><tr style="background:var(--navy);color:white">';
  html += '<th style="padding:10px 14px;text-align:left;width:45%">Competency</th>';
  html += '<th style="padding:10px 10px;text-align:center">Self</th>';
  html += '<th style="padding:10px 10px;text-align:center">Tradesman</th>';
  html += '<th style="padding:10px 10px;text-align:center">Gap</th>';
  html += '</tr></thead><tbody>';

  competencies.forEach((comp, i) => {
    const self = selfMap[comp.id];
    const trade = tradeMap[comp.id];
    const selfR = self ? self.rating : null;
    const tradeR = trade ? trade.rating : null;
    const gap = (selfR !== null && tradeR !== null) ? Math.abs(selfR - tradeR) : null;
    const hasGapWarning = gap !== null && gap >= 2;
    const rowBg = hasGapWarning ? 'background:#FFFBEB;border-left:3px solid #D97706' : (i % 2 === 0 ? '' : 'background:var(--surface-2)');

    html += '<tr style="border-bottom:1px solid var(--border);' + rowBg + '">';
    html += '<td style="padding:9px 14px;font-weight:500;color:var(--ink)">' + esc(comp.name) + '</td>';
    html += '<td style="padding:9px 10px;text-align:center">' + (selfR ? '<span style="font-size:15px;font-weight:800;color:' + ratingColor(selfR) + ';background:' + ratingBg(selfR) + ';padding:2px 8px;border-radius:6px">' + selfR + '</span>' : '<span style="color:var(--ink-4);font-size:11px">—</span>') + '</td>';
    html += '<td style="padding:9px 10px;text-align:center">' + (tradeR ? '<span style="font-size:15px;font-weight:800;color:' + ratingColor(tradeR) + ';background:' + ratingBg(tradeR) + ';padding:2px 8px;border-radius:6px">' + tradeR + '</span>' : '<span style="color:var(--ink-4);font-size:11px">—</span>') + '</td>';
    html += '<td style="padding:9px 10px;text-align:center">';
    if (gap !== null) {
      const gc = gap >= 2 ? '#D97706' : gap >= 1 ? '#6B7280' : '#16A34A';
      html += '<span style="font-size:12px;font-weight:700;color:' + gc + '">' + (gap === 0 ? '✓' : gap) + '</span>';
    } else {
      html += '<span style="color:var(--ink-4);font-size:11px">—</span>';
    }
    html += '</td></tr>';
  });

  html += '</tbody></table>';
  html += '<div style="padding:10px 14px;font-size:11px;color:var(--ink-3);background:var(--surface-2);border-top:1px solid var(--border)">1 = Not confident · 2 = Need supervision · 3 = Some help · 4 = Confident · 5 = Could teach others</div>';
  html += '</div>';
  return html;
}

function renderPassportForPeriod(apprenticeId, period) {
  const container = document.getElementById('apprentices-content');
  if (!container) return;
  // Re-render passport tab with selected period
  const profile = apprenticeProfiles.find(p => p.id === apprenticeId);
  if (!profile) return;
  // Find the passport-grid div and replace just that
  const gridEl = container.querySelector('.passport-grid-wrap');
  if (gridEl) {
    gridEl.innerHTML = renderPassportGrid(apprenticeId, period);
  } else {
    renderApprenticeProfile(apprenticeId);
  }
}

// ── Feedback tab ──────────────────────────────────────────────

function renderFeedbackTab(profile, personName) {
  const entries = feedbackEntries.filter(f => f.apprentice_id === profile.id);
  let html = '<div style="margin-top:16px">';
  if (isManager) {
    html += '<div style="display:flex;justify-content:flex-end;margin-bottom:12px">';
    html += '<button class="btn btn-primary btn-sm" onclick="openFeedbackForm(' + profile.id + ',\'' + esc(personName) + '\')">+ Give Feedback</button>';
    html += '</div>';
  }
  if (!entries.length) {
    html += '<div class="empty"><div class="empty-icon">💬</div><p>No feedback entries yet.</p></div>';
    html += '</div>';
    return html;
  }
  entries.forEach(entry => {
    const comp = competencies.find(c => c.id === entry.competency_id);
    const dateStr = new Date(entry.feedback_date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    html += '<div class="roster-card" style="padding:16px 18px;margin-bottom:10px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">';
    html += '<div><div style="font-size:13px;font-weight:700;color:var(--navy)">' + esc(entry.submitted_by) + '</div>';
    html += '<div style="font-size:11px;color:var(--ink-3);margin-top:2px">' + dateStr + (entry.project_site ? ' · ' + esc(entry.project_site) : '') + '</div></div>';
    if (entry.rating) html += '<span style="font-size:18px;font-weight:800;color:' + ratingColor(entry.rating) + ';background:' + ratingBg(entry.rating) + ';padding:3px 10px;border-radius:8px">' + entry.rating + '/5</span>';
    html += '</div>';
    if (comp) html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--purple);background:var(--purple-lt);padding:2px 8px;border-radius:4px;display:inline-block;margin-bottom:10px">' + esc(comp.name) + '</div>';
    [['✅ What they did well', entry.did_well], ['⏭ Trust them next with', entry.trust_next], ['🔧 Needs to improve', entry.needs_improve], ['📌 Follow-up', entry.follow_up]].forEach(([label, val]) => {
      if (!val) return;
      html += '<div style="margin-bottom:8px"><div style="font-size:10px;font-weight:700;color:var(--ink-3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">' + label + '</div>';
      html += '<div style="font-size:12px;color:var(--ink-2);line-height:1.5;padding-left:8px;border-left:3px solid var(--border)">' + esc(val) + '</div></div>';
    });
    html += '</div>';
  });
  html += '</div>';
  return html;
}

// ── Rotations tab ─────────────────────────────────────────────

function renderRotationsTab(profile) {
  const rots = apprenticeRotations.filter(r => r.apprentice_id === profile.id);
  const personName = getPersonNameById(profile.person_id);
  let html = '<div style="margin-top:16px">';
  if (isManager) {
    html += '<div style="display:flex;justify-content:flex-end;margin-bottom:12px">';
    html += '<button class="btn btn-primary btn-sm" onclick="openAddRotation(' + profile.id + ',\'' + esc(personName) + '\')">+ Add Rotation</button>';
    html += '</div>';
  }
  if (!rots.length) {
    html += '<div class="empty"><div class="empty-icon">🏗</div><p>No rotations recorded yet</p></div></div>';
    return html;
  }
  rots.forEach(rot => {
    const start = new Date(rot.date_start + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
    const end = rot.date_end ? new Date(rot.date_end + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Ongoing';
    html += '<div class="roster-card" style="padding:12px 14px;margin-bottom:8px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:flex-start">';
    html += '<div><div style="font-size:13px;font-weight:700;color:var(--navy)">' + esc(rot.project_site) + '</div>';
    html += '<div style="font-size:11px;color:var(--ink-3);margin-top:2px">' + start + ' → ' + end + (rot.supervisor ? ' · ' + esc(rot.supervisor) : '') + '</div></div>';
    if (!rot.date_end) html += '<span style="font-size:10px;font-weight:700;color:#16A34A;background:#F0FDF4;padding:2px 8px;border-radius:4px">Active</span>';
    html += '</div>';
    if (rot.main_work) html += '<div style="font-size:12px;color:var(--ink-2);margin-top:8px;line-height:1.5">' + esc(rot.main_work) + '</div>';
    html += '</div>';
  });
  html += '</div>';
  return html;
}

// ── Add Contact (entry point — source of truth) ───────────────

function openAddContact() {
  // Navigate to Contacts page with add form open, or show inline if that's not available
  if (typeof openAddPersonModal === 'function') {
    openAddPersonModal();
    showToast('Add the person as a contact first, then set up their apprentice profile');
  } else if (typeof navigateTo === 'function') {
    navigateTo('contacts');
    showToast('Add the apprentice as a contact, then return here to set up their profile');
  } else {
    showToast('Go to Contacts → Add Person to create the apprentice contact first');
  }
}

// ── Setup profile (contact exists, no profile yet) ────────────

function openSetupProfile(personName) {
  const modal = document.getElementById('modal-apprentice-profile');
  if (!modal) return;
  document.getElementById('ap-edit-id').value = '';
  document.getElementById('ap-year').value = '1';
  document.getElementById('ap-start-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('ap-notes').value = '';
  document.getElementById('ap-goal-tech').value = '';
  document.getElementById('ap-goal-prof').value = '';
  document.getElementById('ap-goal-personal').value = '';

  // Only this person — they already exist as a contact
  const person = (STATE.people || []).find(p => p.name === personName);
  let personHtml = '<option value="' + esc(personName) + '" selected>' + esc(personName) + '</option>';
  document.getElementById('ap-person').innerHTML = personHtml;
  document.getElementById('ap-person').disabled = true;

  let siteHtml = '<option value="">— None —</option>';
  (STATE.sites || []).forEach(s => { siteHtml += '<option value="' + esc(s.abbr) + '">' + esc(s.abbr) + ' — ' + esc(s.name) + '</option>'; });
  document.getElementById('ap-site').innerHTML = siteHtml;

  document.getElementById('modal-ap-title').textContent = 'Set Up Profile — ' + personName;
  openModal('modal-apprentice-profile');
}

// ── Edit Goals / Profile ──────────────────────────────────────

function openEditGoals(profileId) {
  if (!isManager) { showToast('Supervision access required'); return; }
  const profile = apprenticeProfiles.find(p => p.id === profileId);
  if (!profile) return;
  const modal = document.getElementById('modal-apprentice-profile');
  if (!modal) return;
  const personName = getPersonNameById(profile.person_id);

  document.getElementById('ap-edit-id').value = profileId;
  document.getElementById('ap-year').value = profile.year_level || 1;
  document.getElementById('ap-start-date').value = profile.start_date || '';
  document.getElementById('ap-notes').value = profile.notes || '';
  document.getElementById('ap-goal-tech').value = profile.goal_technical || '';
  document.getElementById('ap-goal-prof').value = profile.goal_professional || '';
  document.getElementById('ap-goal-personal').value = profile.goal_personal || '';

  document.getElementById('ap-person').innerHTML = '<option value="' + esc(personName) + '">' + esc(personName) + '</option>';
  document.getElementById('ap-person').disabled = true;

  let siteHtml = '<option value="">— None —</option>';
  (STATE.sites || []).forEach(s => { siteHtml += '<option value="' + esc(s.abbr) + '"' + (s.abbr === profile.current_site ? ' selected' : '') + '>' + esc(s.abbr) + ' — ' + esc(s.name) + '</option>'; });
  document.getElementById('ap-site').innerHTML = siteHtml;

  document.getElementById('modal-ap-title').textContent = 'Edit Profile — ' + personName;
  openModal('modal-apprentice-profile');
}

// ── Edit contact year level ───────────────────────────────────

function openEditContactYear(personName, profileId) {
  if (!isManager) { showToast('Supervision access required'); return; }
  const person = (STATE.people || []).find(p => p.name === personName);
  const currentYear = (person && person.year_level) || '';
  const modal = document.getElementById('modal-apprentice-profile');
  if (!modal) { showToast('Edit contact in the Contacts page'); return; }
  openEditGoals(profileId);
}

// ── Save Profile ──────────────────────────────────────────────

async function saveApprenticeProfile() {
  if (!isManager) { showToast('Supervision access required'); return; }
  const editId = document.getElementById('ap-edit-id').value;
  const personName = document.getElementById('ap-person').value;
  const yearLevel = parseInt(document.getElementById('ap-year').value);
  const startDate = document.getElementById('ap-start-date').value || null;
  const notes = document.getElementById('ap-notes').value.trim();
  const goalTech = document.getElementById('ap-goal-tech').value.trim();
  const goalProf = document.getElementById('ap-goal-prof').value.trim();
  const goalPersonal = document.getElementById('ap-goal-personal').value.trim();
  const site = document.getElementById('ap-site').value || null;

  if (!personName) { showToast('Select an apprentice'); return; }

  const profileRow = {
    year_level: yearLevel,
    start_date: startDate,
    notes,
    goal_technical: goalTech,
    goal_professional: goalProf,
    goal_personal: goalPersonal,
    current_site: site,
    updated_at: new Date().toISOString(),
  };

  try {
    if (editId) {
      await sbFetch('apprentice_profiles?id=eq.' + editId, 'PATCH', profileRow);
      // Also update year_level on people (contacts = source of truth)
      const personObj = (STATE.people || []).find(p => p.name === personName);
      if (personObj) {
        await sbFetch('people?id=eq.' + personObj.id, 'PATCH', { year_level: yearLevel });
        personObj.year_level = yearLevel; // update SEED in memory
      }
      const idx = apprenticeProfiles.findIndex(p => p.id === parseInt(editId));
      if (idx >= 0) Object.assign(apprenticeProfiles[idx], profileRow);
      showToast('Profile updated ✓');
      closeModal('modal-apprentice-profile');
      document.getElementById('ap-person').disabled = false;
      renderApprenticeProfile(parseInt(editId));
    } else {
      // New profile — resolve DB UUID from person name
      let resolvedPersonId = null;
      try {
        const dbPpl = await sbFetch('people?name=eq.' + encodeURIComponent(personName) + '&select=id&limit=1');
        if (dbPpl && dbPpl[0]) resolvedPersonId = dbPpl[0].id;
      } catch(e) {}
      if (!resolvedPersonId) { showToast('Could not find contact — add them in Contacts first'); return; }

      profileRow.person_id = resolvedPersonId;
      profileRow.org_id = TENANT.ORG_UUID;
      profileRow.active = true;

      // Also stamp year_level on people record
      await sbFetch('people?id=eq.' + resolvedPersonId, 'PATCH', { year_level: yearLevel });
      const personObj = (STATE.people || []).find(p => p.name === personName);
      if (personObj) personObj.year_level = yearLevel;

      const res = await sbFetch('apprentice_profiles', 'POST', profileRow, 'return=representation');
      const newProfile = res && res[0];
      if (newProfile) {
        newProfile._resolvedName = personName;
        newProfile._resolvedYear = yearLevel;
        apprenticeProfiles.push(newProfile);
        showToast('Profile created ✓');
        closeModal('modal-apprentice-profile');
        document.getElementById('ap-person').disabled = false;
        activeApprenticeId = newProfile.id;
        activeApprenticeTab = 'overview';
        renderApprenticeProfile(newProfile.id);
      }
    }
  } catch(e) {
    showToast('Save failed — ' + (e.message || 'check connection'));
  }
}

// ── Self-assessment form ──────────────────────────────────────

function openSelfAssessmentForm(profileId) {
  const profile = apprenticeProfiles.find(p => p.id === profileId);
  if (!profile) return;
  const personName = getPersonNameById(profile.person_id);
  const modal = document.getElementById('modal-apprentice-self');
  if (!modal) return;

  document.getElementById('sa-apprentice-id').value = profileId;
  document.getElementById('modal-sa-title').textContent = 'How am I going? 🤔 — ' + personName;

  // Period dropdown
  const periodWrap = document.getElementById('sa-period-wrap');
  if (periodWrap) periodWrap.innerHTML = periodSelectHtml('sa-period', getCurrentPeriod());

  // Build competency grid
  const existing = {};
  skillsRatings.filter(r => r.apprentice_id === profileId && r.rating_type === 'self').forEach(r => {
    if (!existing[r.period]) existing[r.period] = {};
    existing[r.period][r.competency_id] = r.rating;
  });
  const selPeriod = getCurrentPeriod();
  const existingForPeriod = existing[selPeriod] || {};

  let gridHtml = '';
  competencies.forEach(comp => {
    const current = existingForPeriod[comp.id] || 0;
    gridHtml += '<div style="padding:14px 0;border-bottom:1px solid var(--border)">';
    gridHtml += '<div style="font-size:13px;font-weight:600;color:var(--navy);margin-bottom:8px">' + esc(comp.name) + '</div>';
    gridHtml += '<div style="display:flex;gap:2px" data-comp-id="' + comp.id + '">';
    for (let i = 1; i <= 5; i++) {
      gridHtml += '<button class="sa-star" data-comp="' + comp.id + '" data-val="' + i + '" onclick="setSAStarRating(this,' + comp.id + ',' + i + ')" style="background:none;border:none;cursor:pointer;font-size:36px;padding:4px 6px;color:' + (i <= current ? '#F59E0B' : '#E5E7EB') + ';transition:color .1s;min-width:44px;min-height:44px;display:flex;align-items:center;justify-content:center">★</button>';
    }
    gridHtml += '</div>';
    const scaleLabels = ['', 'Not confident', 'Need supervision', 'Some help', 'Confident', 'Could teach'];
    gridHtml += '<div style="font-size:11px;color:var(--ink-3);margin-top:4px" id="sa-label-' + comp.id + '">' + (current > 0 ? scaleLabels[current] : 'Tap to rate') + '</div>';
    gridHtml += '</div>';
  });
  document.getElementById('sa-competencies-grid').innerHTML = gridHtml;

  // Update grid when period changes
  const periodEl = document.getElementById('sa-period');
  if (periodEl) {
    periodEl.onchange = function() {
      const p = this.value;
      const ex = existing[p] || {};
      competencies.forEach(comp => {
        const r = ex[comp.id] || 0;
        const container = document.querySelector('[data-comp-id="' + comp.id + '"]');
        if (!container) return;
        container.querySelectorAll('.sa-star[data-comp="' + comp.id + '"]').forEach((s, i) => { s.style.color = i < r ? '#F59E0B' : '#E5E7EB'; });
        const lbl = document.getElementById('sa-label-' + comp.id);
        const scaleLabels = ['', 'Not confident', 'Need supervision', 'Some help', 'Confident', 'Could teach'];
        if (lbl) lbl.textContent = r > 0 ? scaleLabels[r] : 'Tap to rate';
      });
    };
  }

  openModal('modal-apprentice-self');
}

function setSAStarRating(btn, compId, val) {
  const container = btn.closest('[data-comp-id="' + compId + '"]');
  if (!container) return;
  container.querySelectorAll('.sa-star[data-comp="' + compId + '"]').forEach((s, i) => {
    s.style.color = i < val ? '#F59E0B' : '#E5E7EB';
  });
  const scaleLabels = ['', 'Not confident', 'Need supervision', 'Some help', 'Confident', 'Could teach'];
  const lbl = document.getElementById('sa-label-' + compId);
  if (lbl) lbl.textContent = scaleLabels[val] || '';
}

async function submitSelfAssessment() {
  const profileId = parseInt(document.getElementById('sa-apprentice-id').value);
  const period = document.getElementById('sa-period').value;
  if (!period) { showToast('Select a period'); return; }
  const profile = apprenticeProfiles.find(p => p.id === profileId);
  if (!profile) return;
  const ratedBy = getPersonNameById(profile.person_id);

  const ratingRows = [];
  competencies.forEach(comp => {
    const container = document.querySelector('[data-comp-id="' + comp.id + '"]');
    if (!container) return;
    const stars = container.querySelectorAll('.sa-star[data-comp="' + comp.id + '"]');
    let rating = 0;
    stars.forEach((s, i) => { if (s.style.color === 'rgb(245, 158, 11)') rating = i + 1; });
    if (rating > 0) ratingRows.push({ competency_id: comp.id, rating, period, rating_type: 'self', rated_by: ratedBy, apprentice_id: profileId, org_id: TENANT.ORG_UUID });
  });

  if (!ratingRows.length) { showToast('Rate at least one competency'); return; }

  try {
    // UPSERT — ON CONFLICT update rating. Send as batch.
    const res = await fetch(SB_URL + '/rest/v1/skills_ratings', {
      method: 'POST',
      headers: {
        'apikey': SB_KEY,
        'Authorization': 'Bearer ' + SB_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal',
      },
      credentials: 'omit',
      body: JSON.stringify(ratingRows),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    showToast('Skills saved ✓');
    closeModal('modal-apprentice-self');
    await loadApprenticeData();
    renderApprenticeProfile(profileId);
  } catch(e) {
    showToast('Save failed — ' + (e.message || 'check connection'));
  }
}

// ── Feedback form ─────────────────────────────────────────────

function openFeedbackForm(profileId, personName) {
  if (!isManager) { showToast('Supervision access required'); return; }
  const modal = document.getElementById('modal-apprentice-feedback');
  if (!modal) return;

  document.getElementById('fb-apprentice-id').value = profileId;
  document.getElementById('fb-did-well').value = '';
  document.getElementById('fb-trust-next').value = '';
  document.getElementById('fb-needs-improve').value = '';
  document.getElementById('fb-follow-up').value = '';
  document.getElementById('fb-rating').value = '';
  document.getElementById('modal-fb-title').textContent = 'Give Feedback — ' + personName;

  // Name combobox
  const nameWrap = document.getElementById('fb-name-wrap');
  if (nameWrap) nameWrap.innerHTML = nameComboHtml('fb-submitted-by', 'Your name', currentManagerName || '');

  // Site / job number combobox
  const siteWrap = document.getElementById('fb-site-wrap');
  if (siteWrap) siteWrap.innerHTML = jobComboHtml('fb-site', 'Job number or site', '');

  // Competency dropdown
  let compHtml = '<option value="">— Optional: select a competency —</option>';
  competencies.forEach(c => { compHtml += '<option value="' + c.id + '">' + esc(c.name) + '</option>'; });
  document.getElementById('fb-competency').innerHTML = compHtml;

  openModal('modal-apprentice-feedback');
}

async function submitFeedback() {
  const profileId = parseInt(document.getElementById('fb-apprentice-id').value);
  const submittedBy = document.getElementById('fb-submitted-by').value.trim();
  const didWell = document.getElementById('fb-did-well').value.trim();
  const trustNext = document.getElementById('fb-trust-next').value.trim();
  const needsImprove = document.getElementById('fb-needs-improve').value.trim();
  const followUp = document.getElementById('fb-follow-up').value.trim();
  const site = document.getElementById('fb-site').value.trim();
  const competencyId = document.getElementById('fb-competency').value || null;
  const ratingVal = document.getElementById('fb-rating').value;

  if (!submittedBy) { showToast('Enter your name'); return; }
  if (!didWell && !trustNext && !needsImprove) { showToast('Fill in at least one feedback section'); return; }

  const row = {
    apprentice_id: profileId,
    org_id: TENANT.ORG_UUID,
    submitted_by: submittedBy,
    did_well: didWell || null,
    trust_next: trustNext || null,
    needs_improve: needsImprove || null,
    follow_up: followUp || null,
    project_site: site || null,
    competency_id: competencyId ? parseInt(competencyId) : null,
    rating: ratingVal ? parseInt(ratingVal) : null,
    feedback_date: new Date().toISOString().slice(0, 10),
  };

  try {
    await sbFetch('feedback_entries', 'POST', row, 'return=minimal');
    showToast('Feedback saved ✓');
    closeModal('modal-apprentice-feedback');
    await loadApprenticeData();
    renderApprenticeProfile(profileId);
  } catch(e) {
    showToast('Save failed — check connection');
  }
}

// ── Tradesman rating form ─────────────────────────────────────

function openTradesmanRatingForm(profileId, personName) {
  if (!isManager) { showToast('Supervision access required'); return; }
  const modal = document.getElementById('modal-apprentice-trade-rating');
  if (!modal) return;

  document.getElementById('tr-apprentice-id').value = profileId;
  document.getElementById('modal-tr-title').textContent = 'How are they actually going? 😎 — ' + (personName || getPersonNameById((apprenticeProfiles.find(p=>p.id===profileId)||{}).person_id));

  // Rater name combobox
  const raterWrap = document.getElementById('tr-rater-wrap');
  if (raterWrap) raterWrap.innerHTML = nameComboHtml('tr-rated-by', 'Your name', currentManagerName || '');

  // Period dropdown — matches self-assessment periods
  const periodWrap = document.getElementById('tr-period-wrap');
  if (periodWrap) periodWrap.innerHTML = periodSelectHtml('tr-period', getCurrentPeriod());

  // Build grid with existing tradesman ratings for selected period
  const buildGrid = (period) => {
    const existing = {};
    skillsRatings.filter(r => r.apprentice_id === profileId && r.rating_type === 'tradesman' && r.period === period).forEach(r => {
      existing[r.competency_id] = r.rating;
    });
    let gridHtml = '';
    competencies.forEach(comp => {
      const current = existing[comp.id] || 0;
      gridHtml += '<div style="padding:12px 0;border-bottom:1px solid var(--border)">';
      gridHtml += '<div style="font-size:13px;font-weight:600;color:var(--navy);margin-bottom:6px">' + esc(comp.name) + '</div>';
      gridHtml += '<div style="display:flex;gap:2px" data-comp-id="' + comp.id + '">';
      for (let i = 1; i <= 5; i++) {
        gridHtml += '<button class="tr-star" data-comp="' + comp.id + '" data-val="' + i + '" onclick="setTRStarRating(this,' + comp.id + ',' + i + ')" style="background:none;border:none;cursor:pointer;font-size:28px;padding:3px 5px;color:' + (i <= current ? '#F59E0B' : '#E5E7EB') + ';transition:color .1s;min-width:40px;min-height:40px;display:flex;align-items:center;justify-content:center">★</button>';
      }
      gridHtml += '</div></div>';
    });
    document.getElementById('tr-competencies-grid').innerHTML = gridHtml;
  };

  buildGrid(getCurrentPeriod());

  // Rebuild grid when period changes
  const periodEl = document.getElementById('tr-period');
  if (periodEl) periodEl.onchange = function() { buildGrid(this.value); };

  openModal('modal-apprentice-trade-rating');
}

function setTRStarRating(btn, compId, val) {
  const container = btn.closest('[data-comp-id="' + compId + '"]');
  if (!container) return;
  container.querySelectorAll('.tr-star[data-comp="' + compId + '"]').forEach((s, i) => {
    s.style.color = i < val ? '#F59E0B' : '#E5E7EB';
  });
}

async function submitTradesmanRating() {
  const profileId = parseInt(document.getElementById('tr-apprentice-id').value);
  const ratedBy = document.getElementById('tr-rated-by').value.trim();
  const period = document.getElementById('tr-period').value;
  if (!ratedBy) { showToast('Enter your name'); return; }
  if (!period) { showToast('Select a period'); return; }

  const ratingRows = [];
  competencies.forEach(comp => {
    const container = document.querySelector('#tr-competencies-grid [data-comp-id="' + comp.id + '"]');
    if (!container) return;
    const stars = container.querySelectorAll('.tr-star[data-comp="' + comp.id + '"]');
    let rating = 0;
    stars.forEach((s, i) => { if (s.style.color === 'rgb(245, 158, 11)') rating = i + 1; });
    if (rating > 0) ratingRows.push({ competency_id: comp.id, rating, period, rating_type: 'tradesman', rated_by: ratedBy, apprentice_id: profileId, org_id: TENANT.ORG_UUID });
  });

  if (!ratingRows.length) { showToast('Rate at least one competency'); return; }

  try {
    const res = await fetch(SB_URL + '/rest/v1/skills_ratings', {
      method: 'POST',
      headers: {
        'apikey': SB_KEY,
        'Authorization': 'Bearer ' + SB_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal',
      },
      credentials: 'omit',
      body: JSON.stringify(ratingRows),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    showToast('Ratings saved ✓');
    closeModal('modal-apprentice-trade-rating');
    await loadApprenticeData();
    renderApprenticeProfile(profileId);
  } catch(e) {
    showToast('Save failed — ' + (e.message || 'check connection'));
  }
}

// ── Add Rotation ──────────────────────────────────────────────

function openAddRotation(profileId, personName) {
  if (!isManager) { showToast('Supervision access required'); return; }
  const modal = document.getElementById('modal-apprentice-rotation');
  if (!modal) return;
  document.getElementById('rot-apprentice-id').value = profileId;
  document.getElementById('rot-type').value = 'Commercial';
  document.getElementById('rot-start').value = new Date().toISOString().slice(0, 10);
  document.getElementById('rot-end').value = '';
  document.getElementById('rot-main-work').value = '';
  document.getElementById('modal-rot-title').textContent = 'Add Rotation — ' + personName;

  // Site/job combobox
  const siteWrap = document.getElementById('rot-site-wrap');
  if (siteWrap) siteWrap.innerHTML = jobComboHtml('rot-site', 'Job number or site', '');

  // Supervisor combobox
  const supWrap = document.getElementById('rot-supervisor-wrap');
  if (supWrap) supWrap.innerHTML = nameComboHtml('rot-supervisor', 'Supervisor name', '');

  openModal('modal-apprentice-rotation');
}

async function saveRotation() {
  const profileId = parseInt(document.getElementById('rot-apprentice-id').value);
  const site = document.getElementById('rot-site').value.trim();
  const type = document.getElementById('rot-type').value;
  const start = document.getElementById('rot-start').value;
  const end = document.getElementById('rot-end').value || null;
  const supervisor = document.getElementById('rot-supervisor').value.trim();
  const mainWork = document.getElementById('rot-main-work').value.trim();

  if (!site) { showToast('Enter a site or job number'); return; }
  if (!start) { showToast('Enter a start date'); return; }

  const row = {
    apprentice_id: profileId,
    org_id: TENANT.ORG_UUID,
    project_site: site,
    project_type: type || 'Other',
    date_start: start,
    date_end: end,
    supervisor: supervisor || null,
    main_work: mainWork || null,
  };

  try {
    const res = await sbFetch('rotations', 'POST', row, 'return=representation');
    const newRot = res && res[0];
    if (newRot) apprenticeRotations.unshift(newRot);
    showToast('Rotation added ✓');
    closeModal('modal-apprentice-rotation');
    await loadApprenticeData();
    renderApprenticeProfile(profileId);
  } catch(e) {
    showToast('Save failed — check connection');
  }
}
