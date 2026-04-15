// ─────────────────────────────────────────────────────────────
// scripts/apprentices.js  —  EQ Solves Field
// Apprentice Management: profiles, Skills Passport,
// tradesman feedback, self-assessment, rotations.
// Depends on: app-state.js, utils.js, supabase.js
// ─────────────────────────────────────────────────────────────

let apprenticeProfiles = [];
let competencies = [];
let skillsRatings = [];
let feedbackEntries = [];
let apprenticeRotations = [];
let activeApprenticeId = null;
let activeApprenticeTab = 'overview';

// ── Data loading ──────────────────────────────────────────────

async function loadApprenticeData() {
  try {
    const [profiles, comps, ratings, feedback, rots] = await Promise.all([
      sbFetch('apprentice_profiles?order=id.asc'),
      // competencies has no org_id — fetch directly
      (async () => {
        if (!SB_URL) return [];
        const res = await fetch(SB_URL + '/rest/v1/competencies?order=sort_order.asc&active=eq.true', {
          headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY },
          credentials: 'omit'
        });
        return res.ok ? await res.json() : [];
      })(),
      sbFetch('skills_ratings?order=created_at.desc'),
      sbFetch('feedback_entries?order=feedback_date.desc'),
      sbFetch('rotations?order=date_start.desc'),
    ]);
    if (profiles) apprenticeProfiles = profiles;
    if (comps && comps.length) competencies = comps;
    if (ratings) skillsRatings = ratings;
    if (feedback) feedbackEntries = feedback;
    if (rots) apprenticeRotations = rots;
  } catch (e) {
    console.warn('EQ[apprentices] load failed:', e && e.message || e);
  }
}

// ── Helpers ───────────────────────────────────────────────────

function getPersonNameById(personId) {
  const p = (STATE.people || []).find(x => x.id === personId || String(x.id) === String(personId));
  return p ? p.name : 'Unknown';
}

function yearBadge(year) {
  const labels = { 1: '1st Year', 2: '2nd Year', 3: '3rd Year', 4: '4th Year' };
  const colors = { 1: '#EFF4FF;color:#2563EB', 2: '#F0FDF4;color:#16A34A', 3: '#FFFBEB;color:#D97706', 4: '#EEEDF8;color:#7C77B9' };
  return '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:' + (colors[year] || '#F8FAFC;color:#64748B') + '">' + (labels[year] || year + 'th Year') + '</span>';
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

function starDisplay(rating, interactive, dataAttrs) {
  if (!interactive) {
    if (!rating) return '<span style="color:var(--ink-4);font-size:13px">—</span>';
    const full = Math.round(rating);
    return Array.from({ length: 5 }, (_, i) =>
      '<span style="color:' + (i < full ? '#F59E0B' : '#E5E7EB') + ';font-size:16px">★</span>'
    ).join('');
  }
  // Interactive star picker
  const id = dataAttrs || '';
  return Array.from({ length: 5 }, (_, i) =>
    '<button class="star-btn" ' + id + ' data-val="' + (i + 1) + '" onclick="setStarRating(this)" style="background:none;border:none;cursor:pointer;font-size:28px;padding:2px 4px;color:#E5E7EB;transition:color .1s" onmouseover="hoverStars(this,' + (i+1) + ')" onmouseout="resetStarHover(this)">★</button>'
  ).join('');
}

// ── Main render ───────────────────────────────────────────────

function renderApprentices() {
  const container = document.getElementById('apprentices-content');
  if (!container) return;

  if (activeApprenticeId) {
    renderApprenticeProfile(activeApprenticeId);
    return;
  }

  // List view
  const apprenticePeople = (STATE.people || []).filter(p => p.group === 'Apprentice');

  if (!apprenticePeople.length) {
    container.innerHTML = '<div class="empty"><div class="empty-icon">🎓</div><p>No apprentices on the roster yet</p></div>';
    return;
  }

  let html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">';
  html += '<div><div class="section-title">Apprentice Management</div><div style="font-size:12px;color:var(--ink-3);margin-top:3px">Skills tracking, feedback and development for your apprentices</div></div>';
  if (isManager) {
    html += '<button class="btn btn-primary btn-sm" onclick="openAddApprenticeProfile()">+ Add Profile</button>';
  }
  html += '</div>';

  html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px">';

  apprenticePeople.forEach(person => {
    const profile = apprenticeProfiles.find(p => String(p.person_id) === String(person.id));
    const selfAvg = profile ? avgRating(profile.id, 'self') : null;
    const tradeAvg = profile ? avgRating(profile.id, 'tradesman') : null;
    const recentFeedback = profile ? feedbackEntries.filter(f => f.apprentice_id === profile.id).slice(0, 1)[0] : null;
    const feedbackCount = profile ? feedbackEntries.filter(f => f.apprentice_id === profile.id).length : 0;

    html += '<div class="roster-card" style="padding:18px 20px;cursor:pointer;transition:box-shadow .15s" onclick="openApprenticeProfile(' + (profile ? profile.id : 'null') + ',\'' + esc(person.name) + '\')" onmouseover="this.style.boxShadow=\'0 4px 16px rgba(0,0,0,.12)\'" onmouseout="this.style.boxShadow=\'\'">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">';
    html += '<div><div style="font-size:15px;font-weight:700;color:var(--navy)">' + esc(person.name) + '</div>';
    html += '<div style="margin-top:4px">' + (profile ? yearBadge(profile.year_level) : '<span style="font-size:10px;color:var(--ink-4)">No profile yet</span>') + '</div></div>';
    html += '<div style="font-size:32px">🎓</div>';
    html += '</div>';

    if (profile) {
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">';
      html += '<div style="background:var(--surface-2);border-radius:8px;padding:8px 10px;text-align:center">';
      html += '<div style="font-size:10px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Self Rating</div>';
      html += '<div style="font-size:18px;font-weight:800;color:' + ratingColor(selfAvg) + '">' + (selfAvg || '—') + '</div></div>';
      html += '<div style="background:var(--surface-2);border-radius:8px;padding:8px 10px;text-align:center">';
      html += '<div style="font-size:10px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">Trade Rating</div>';
      html += '<div style="font-size:18px;font-weight:800;color:' + ratingColor(tradeAvg) + '">' + (tradeAvg || '—') + '</div></div>';
      html += '</div>';

      if (profile.current_site) {
        const site = (STATE.sites || []).find(s => s.abbr === profile.current_site);
        html += '<div style="font-size:11px;color:var(--ink-2);margin-bottom:8px">📍 ' + esc(site ? site.name : profile.current_site) + '</div>';
      }

      html += '<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--ink-3);padding-top:10px;border-top:1px solid var(--border)">';
      html += '<span>' + feedbackCount + ' feedback ' + (feedbackCount === 1 ? 'entry' : 'entries') + '</span>';
      html += '<span style="color:var(--purple);font-weight:600">View Profile →</span>';
      html += '</div>';
    } else {
      html += '<div style="font-size:12px;color:var(--ink-3);margin-bottom:8px">No skills data yet</div>';
      if (isManager) {
        html += '<div style="font-size:11px;color:var(--purple);font-weight:600">Click to set up profile →</div>';
      }
    }

    html += '</div>';
  });

  html += '</div>';
  container.innerHTML = html;
}

function openApprenticeProfile(profileId, personName) {
  if (!profileId) {
    // No profile — if manager, open add form
    if (isManager) {
      openAddApprenticeProfile(personName);
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

  const person = (STATE.people || []).find(p => String(p.id) === String(profile.person_id));
  const personName = person ? person.name : 'Unknown';
  const site = (STATE.sites || []).find(s => s.abbr === profile.current_site);

  let html = '<div style="margin-bottom:16px">';
  html += '<button class="btn btn-secondary btn-sm" onclick="closeApprenticeProfile()" style="margin-bottom:14px">← All Apprentices</button>';
  html += '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">';
  html += '<div style="font-size:40px">🎓</div>';
  html += '<div>';
  html += '<div style="font-size:20px;font-weight:800;color:var(--navy)">' + esc(personName) + '</div>';
  html += '<div style="display:flex;gap:8px;align-items:center;margin-top:4px;flex-wrap:wrap">';
  html += yearBadge(profile.year_level);
  if (profile.current_site) html += '<span style="font-size:11px;color:var(--ink-3)">📍 ' + esc(site ? site.name : profile.current_site) + '</span>';
  if (profile.start_date) html += '<span style="font-size:11px;color:var(--ink-3)">📅 Started ' + profile.start_date + '</span>';
  html += '</div></div>';
  html += '</div>';

  // Tabs
  const tabs = [
    { id: 'overview', label: '👤 Overview' },
    { id: 'passport', label: '🎯 Skills Passport' },
    { id: 'feedback', label: '💬 Feedback (' + feedbackEntries.filter(f => f.apprentice_id === profileId).length + ')' },
    { id: 'rotations', label: '🏗 Rotations' },
  ];
  html += '<div style="display:flex;gap:4px;margin-top:16px;border-bottom:2px solid var(--border);padding-bottom:0">';
  tabs.forEach(t => {
    const active = activeApprenticeTab === t.id;
    html += '<button onclick="setApprenticeTab(' + profileId + ',\'' + t.id + '\')" style="padding:9px 16px;border:none;background:none;font-family:inherit;font-size:12px;font-weight:' + (active ? '700' : '500') + ';color:' + (active ? 'var(--navy)' : 'var(--ink-3)') + ';cursor:pointer;border-bottom:2px solid ' + (active ? 'var(--navy)' : 'transparent') + ';margin-bottom:-2px">' + t.label + '</button>';
  });
  html += '</div>';
  html += '</div>';

  // Tab content
  if (activeApprenticeTab === 'overview') {
    html += renderApprenticeOverviewTab(profile, personName);
  } else if (activeApprenticeTab === 'passport') {
    html += renderSkillsPassportTab(profile);
  } else if (activeApprenticeTab === 'feedback') {
    html += renderFeedbackTab(profile, personName);
  } else if (activeApprenticeTab === 'rotations') {
    html += renderRotationsTab(profile);
  }

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

function renderApprenticeOverviewTab(profile, personName) {
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

  // Details card
  html += '<div class="roster-card" style="padding:18px 20px">';
  html += '<div style="font-size:13px;font-weight:700;color:var(--navy);margin-bottom:14px">Profile Details</div>';
  const details = [
    ['Year Level', yearBadge(profile.year_level)],
    ['Start Date', profile.start_date || '—'],
    ['Current Site', profile.current_site || '—'],
    ['Active', profile.active ? '✅ Yes' : '❌ No'],
  ];
  details.forEach(([label, val]) => {
    html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px">';
    html += '<span style="color:var(--ink-3)">' + label + '</span><span style="font-weight:600">' + val + '</span>';
    html += '</div>';
  });
  if (profile.notes) {
    html += '<div style="margin-top:12px;font-size:12px;color:var(--ink-2);background:var(--surface-2);padding:10px 12px;border-radius:6px;line-height:1.5">' + esc(profile.notes) + '</div>';
  }
  html += '</div>';

  // Quick stats card
  const selfAvg = avgRating(profile.id, 'self');
  const tradeAvg = avgRating(profile.id, 'tradesman');
  const fbCount = feedbackEntries.filter(f => f.apprentice_id === profile.id).length;
  const rotCount = apprenticeRotations.filter(r => r.apprentice_id === profile.id).length;

  html += '<div class="roster-card" style="padding:18px 20px">';
  html += '<div style="font-size:13px;font-weight:700;color:var(--navy);margin-bottom:14px">At a Glance</div>';
  const stats = [
    ['Self Rating', selfAvg ? selfAvg + ' / 5' : 'Not rated', ratingColor(selfAvg)],
    ['Trade Rating', tradeAvg ? tradeAvg + ' / 5' : 'Not rated', ratingColor(tradeAvg)],
    ['Feedback Entries', fbCount, 'var(--ink)'],
    ['Rotations', rotCount, 'var(--ink)'],
  ];
  stats.forEach(([label, val, col]) => {
    html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:12px">';
    html += '<span style="color:var(--ink-3)">' + label + '</span><span style="font-weight:700;color:' + col + '">' + val + '</span>';
    html += '</div>';
  });
  html += '</div>';

  html += '</div>'; // grid

  // Quick actions (manager only)
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

  // Period selector
  if (periods.length > 1) {
    html += '<div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap">';
    periods.forEach(p => {
      html += '<button onclick="renderPassportForPeriod(' + profile.id + ',\'' + esc(p) + '\')" class="btn btn-' + (p === latestPeriod ? '' : 'secondary ') + 'btn-sm">' + esc(p) + '</button>';
    });
    html += '</div>';
  }

  if (!latestPeriod) {
    html += '<div class="empty"><div class="empty-icon">🎯</div><p>No ratings yet. Tap \'Rate My Skills\' to get started — it takes 2 minutes.</p>';
    html += '<button class="btn btn-primary" style="margin-top:12px" onclick="openSelfAssessmentForm(' + profile.id + ')">Rate My Skills</button></div>';
    html += '</div>';
    return html;
  }

  // Build rating grid for latest period
  html += renderPassportGrid(profile.id, latestPeriod);

  // Actions
  html += '<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">';
  html += '<button class="btn btn-primary btn-sm" onclick="openSelfAssessmentForm(' + profile.id + ')">Rate My Skills</button>';
  if (isManager) {
    html += '<button class="btn btn-secondary btn-sm" onclick="openTradesmanRatingForm(' + profile.id + ', \'\')" >Rate as Tradesman</button>';
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
  html += '<span><span style="color:#DC2626;font-weight:700">● </span>Needs attention (1-2)</span>';
  html += '<span><span style="color:#D97706;font-weight:700">● </span>Progressing (3)</span>';
  html += '<span><span style="color:#16A34A;font-weight:700">● </span>Confident (4-5)</span>';
  html += '</div></div>';

  html += '<table style="width:100%;border-collapse:collapse;font-size:12px">';
  html += '<thead><tr style="background:var(--navy);color:white">';
  html += '<th style="padding:10px 14px;text-align:left;width:45%">Competency</th>';
  html += '<th style="padding:10px 10px;text-align:center">Self</th>';
  html += '<th style="padding:10px 10px;text-align:center">Tradesman</th>';
  html += '<th style="padding:10px 10px;text-align:center">Gap</th>';
  html += '<th style="padding:10px 14px;text-align:left">Notes</th>';
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

    // Self rating cell
    html += '<td style="padding:9px 10px;text-align:center">';
    if (selfR) {
      html += '<span style="font-size:15px;font-weight:800;color:' + ratingColor(selfR) + ';background:' + ratingBg(selfR) + ';padding:2px 8px;border-radius:6px">' + selfR + '</span>';
    } else {
      html += '<span style="color:var(--ink-4);font-size:11px">—</span>';
    }
    html += '</td>';

    // Tradesman rating cell
    html += '<td style="padding:9px 10px;text-align:center">';
    if (tradeR) {
      html += '<span style="font-size:15px;font-weight:800;color:' + ratingColor(tradeR) + ';background:' + ratingBg(tradeR) + ';padding:2px 8px;border-radius:6px">' + tradeR + '</span>';
    } else {
      html += '<span style="color:var(--ink-4);font-size:11px">—</span>';
    }
    html += '</td>';

    // Gap cell
    html += '<td style="padding:9px 10px;text-align:center">';
    if (gap !== null) {
      const gapColor = gap >= 2 ? '#D97706' : gap >= 1 ? '#6B7280' : '#16A34A';
      html += '<span style="font-size:12px;font-weight:700;color:' + gapColor + '">' + (gap === 0 ? '✓' : gap) + '</span>';
    } else {
      html += '<span style="color:var(--ink-4);font-size:11px">—</span>';
    }
    html += '</td>';

    // Notes
    const note = (self && self.note) || (trade && trade.note) || '';
    html += '<td style="padding:9px 14px;font-size:11px;color:var(--ink-3)">' + (note ? esc(note) : '') + '</td>';
    html += '</tr>';
  });

  html += '</tbody></table>';
  html += '<div style="padding:10px 14px;font-size:11px;color:var(--ink-3);background:var(--surface-2);border-top:1px solid var(--border)">Rating scale: 1 = Not confident · 2 = Need supervision · 3 = Can do with some help · 4 = Confident · 5 = Could teach others</div>';
  html += '</div>';
  return html;
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
    html += '<div class="empty"><div class="empty-icon">💬</div><p>No feedback entries yet. Be the first to give ' + esc(personName.split(' ')[0]) + ' some feedback.</p></div>';
    html += '</div>';
    return html;
  }

  entries.forEach(entry => {
    const comp = competencies.find(c => c.id === entry.competency_id);
    const dateStr = new Date(entry.feedback_date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

    html += '<div class="roster-card" style="padding:16px 18px;margin-bottom:10px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">';
    html += '<div>';
    html += '<div style="font-size:13px;font-weight:700;color:var(--navy)">' + esc(entry.submitted_by) + '</div>';
    html += '<div style="font-size:11px;color:var(--ink-3);margin-top:2px">' + dateStr + (entry.project_site ? ' · ' + esc(entry.project_site) : '') + '</div>';
    html += '</div>';
    if (entry.rating) {
      html += '<span style="font-size:18px;font-weight:800;color:' + ratingColor(entry.rating) + ';background:' + ratingBg(entry.rating) + ';padding:3px 10px;border-radius:8px">' + entry.rating + '/5</span>';
    }
    html += '</div>';

    if (comp) {
      html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--purple);background:var(--purple-lt);padding:2px 8px;border-radius:4px;display:inline-block;margin-bottom:10px">' + esc(comp.name) + '</div>';
    }

    const sections = [
      ['✅ What they did well', entry.did_well],
      ['⏭ Trust them next with', entry.trust_next],
      ['🔧 Needs to improve', entry.needs_improve],
      ['📌 Follow-up', entry.follow_up],
    ];
    sections.forEach(([label, val]) => {
      if (!val) return;
      html += '<div style="margin-bottom:8px">';
      html += '<div style="font-size:10px;font-weight:700;color:var(--ink-3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">' + label + '</div>';
      html += '<div style="font-size:12px;color:var(--ink-2);line-height:1.5;padding-left:8px;border-left:3px solid var(--border)">' + esc(val) + '</div>';
      html += '</div>';
    });
    html += '</div>';
  });

  html += '</div>';
  return html;
}

// ── Rotations tab ─────────────────────────────────────────────

function renderRotationsTab(profile) {
  const rots = apprenticeRotations.filter(r => r.apprentice_id === profile.id);

  let html = '<div style="margin-top:16px">';

  if (isManager) {
    html += '<div style="display:flex;justify-content:flex-end;margin-bottom:12px">';
    const personName = getPersonNameById(profile.person_id);
    html += '<button class="btn btn-primary btn-sm" onclick="openAddRotation(' + profile.id + ',\'' + esc(personName) + '\')">+ Add Rotation</button>';
    html += '</div>';
  }

  if (!rots.length) {
    html += '<div class="empty"><div class="empty-icon">🏗</div><p>No rotations recorded yet</p></div>';
    html += '</div>';
    return html;
  }

  // Group by project type
  const byType = {};
  rots.forEach(r => {
    if (!byType[r.project_type]) byType[r.project_type] = [];
    byType[r.project_type].push(r);
  });

  Object.entries(byType).forEach(([type, items]) => {
    html += '<div style="margin-bottom:16px">';
    html += '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--navy-3);margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid var(--border)">' + esc(type) + ' <span style="color:var(--ink-4);font-weight:500">(' + items.length + ')</span></div>';

    items.forEach(rot => {
      const start = new Date(rot.date_start + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
      const end = rot.date_end ? new Date(rot.date_end + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Ongoing';

      html += '<div class="roster-card" style="padding:12px 14px;margin-bottom:8px">';
      html += '<div style="display:flex;justify-content:space-between;align-items:flex-start">';
      html += '<div>';
      html += '<div style="font-size:13px;font-weight:700;color:var(--navy)">' + esc(rot.project_site) + '</div>';
      html += '<div style="font-size:11px;color:var(--ink-3);margin-top:2px">' + start + ' → ' + end + (rot.supervisor ? ' · ' + esc(rot.supervisor) : '') + '</div>';
      html += '</div>';
      if (!rot.date_end) html += '<span style="font-size:10px;font-weight:700;color:#16A34A;background:#F0FDF4;padding:2px 8px;border-radius:4px">Active</span>';
      html += '</div>';
      if (rot.main_work) html += '<div style="font-size:12px;color:var(--ink-2);margin-top:8px;line-height:1.5">' + esc(rot.main_work) + '</div>';
      html += '</div>';
    });

    html += '</div>';
  });

  html += '</div>';
  return html;
}

// ── Self-assessment form ──────────────────────────────────────

function openSelfAssessmentForm(profileId) {
  const profile = apprenticeProfiles.find(p => p.id === profileId);
  if (!profile) return;
  const personName = getPersonNameById(profile.person_id);

  const modal = document.getElementById('modal-apprentice-self');
  if (!modal) return;

  document.getElementById('sa-apprentice-id').value = profileId;
  document.getElementById('sa-period').value = getCurrentPeriod();
  document.getElementById('modal-sa-title').textContent = 'Rate My Skills — ' + personName;

  // Build competency rating grid
  const existing = {};
  skillsRatings.filter(r => r.apprentice_id === profileId && r.rating_type === 'self').forEach(r => {
    existing[r.competency_id] = r.rating;
  });

  let gridHtml = '';
  competencies.forEach(comp => {
    const current = existing[comp.id] || 0;
    gridHtml += '<div style="padding:14px 0;border-bottom:1px solid var(--border)">';
    gridHtml += '<div style="font-size:13px;font-weight:600;color:var(--navy);margin-bottom:8px">' + esc(comp.name) + '</div>';
    gridHtml += '<div style="display:flex;gap:2px" data-comp-id="' + comp.id + '">';
    for (let i = 1; i <= 5; i++) {
      gridHtml += '<button class="sa-star" data-comp="' + comp.id + '" data-val="' + i + '" onclick="setSAStarRating(this,' + comp.id + ',' + i + ')" style="background:none;border:none;cursor:pointer;font-size:36px;padding:4px 6px;color:' + (i <= current ? '#F59E0B' : '#E5E7EB') + ';transition:color .1s;min-width:44px;min-height:44px;display:flex;align-items:center;justify-content:center">★</button>';
    }
    gridHtml += '</div>';
    const scaleLabels = ['', 'Not confident', 'Need supervision', 'Some help', 'Confident', 'Could teach'];
    if (current > 0) gridHtml += '<div style="font-size:11px;color:var(--ink-3);margin-top:4px" id="sa-label-' + comp.id + '">' + scaleLabels[current] + '</div>';
    else gridHtml += '<div style="font-size:11px;color:var(--ink-4);margin-top:4px" id="sa-label-' + comp.id + '">Tap to rate</div>';
    gridHtml += '</div>';
  });

  document.getElementById('sa-competencies-grid').innerHTML = gridHtml;
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
  const period = document.getElementById('sa-period').value.trim();
  if (!period) { showToast('Enter a period (e.g. Q1 2026)'); return; }

  const profile = apprenticeProfiles.find(p => p.id === profileId);
  if (!profile) return;

  const ratingRows = [];
  competencies.forEach(comp => {
    const container = document.querySelector('[data-comp-id="' + comp.id + '"]');
    if (!container) return;
    const stars = container.querySelectorAll('.sa-star[data-comp="' + comp.id + '"]');
    let rating = 0;
    stars.forEach((s, i) => { if (s.style.color === 'rgb(245, 158, 11)') rating = i + 1; });
    if (rating > 0) ratingRows.push({ competency_id: comp.id, rating, period, rating_type: 'self', rated_by: getPersonNameById(profile.person_id), apprentice_id: profileId });
  });

  if (!ratingRows.length) { showToast('Rate at least one competency'); return; }

  try {
    for (const row of ratingRows) {
      await sbFetch('skills_ratings', 'POST', row, 'return=minimal');
    }
    showToast('Skills self-assessment saved ✓');
    closeModal('modal-apprentice-self');
    await loadApprenticeData();
    renderApprenticeProfile(profileId);
  } catch (e) {
    showToast('Save failed — check connection');
  }
}

// ── Feedback form ─────────────────────────────────────────────

function openFeedbackForm(profileId, personName) {
  if (!isManager) { showToast('Supervision access required'); return; }
  const modal = document.getElementById('modal-apprentice-feedback');
  if (!modal) return;

  document.getElementById('fb-apprentice-id').value = profileId;
  document.getElementById('fb-submitted-by').value = currentManagerName || '';
  document.getElementById('fb-site').value = '';
  document.getElementById('fb-did-well').value = '';
  document.getElementById('fb-trust-next').value = '';
  document.getElementById('fb-needs-improve').value = '';
  document.getElementById('fb-follow-up').value = '';
  document.getElementById('fb-rating').value = '';
  document.getElementById('modal-fb-title').textContent = 'Give Feedback — ' + personName;

  // Populate competency dropdown
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
  } catch (e) {
    showToast('Save failed — check connection');
  }
}

// ── Tradesman rating form ─────────────────────────────────────

function openTradesmanRatingForm(profileId, personName) {
  if (!isManager) { showToast('Supervision access required'); return; }
  const modal = document.getElementById('modal-apprentice-trade-rating');
  if (!modal) return;

  document.getElementById('tr-apprentice-id').value = profileId;
  document.getElementById('tr-rated-by').value = currentManagerName || '';
  document.getElementById('tr-period').value = getCurrentPeriod();
  document.getElementById('modal-tr-title').textContent = 'Rate Skills — ' + personName;

  // Build grid same as self-assessment
  const existing = {};
  skillsRatings.filter(r => r.apprentice_id === profileId && r.rating_type === 'tradesman').forEach(r => {
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
  const period = document.getElementById('tr-period').value.trim();
  if (!ratedBy) { showToast('Enter your name'); return; }
  if (!period) { showToast('Enter a period'); return; }

  const ratingRows = [];
  competencies.forEach(comp => {
    const container = document.querySelector('#tr-competencies-grid [data-comp-id="' + comp.id + '"]');
    if (!container) return;
    const stars = container.querySelectorAll('.tr-star[data-comp="' + comp.id + '"]');
    let rating = 0;
    stars.forEach((s, i) => { if (s.style.color === 'rgb(245, 158, 11)') rating = i + 1; });
    if (rating > 0) ratingRows.push({ competency_id: comp.id, rating, period, rating_type: 'tradesman', rated_by: ratedBy, apprentice_id: profileId });
  });

  if (!ratingRows.length) { showToast('Rate at least one competency'); return; }

  try {
    for (const row of ratingRows) {
      await sbFetch('skills_ratings', 'POST', row, 'return=minimal');
    }
    showToast('Ratings saved ✓');
    closeModal('modal-apprentice-trade-rating');
    await loadApprenticeData();
    renderApprenticeProfile(profileId);
  } catch (e) {
    showToast('Save failed — check connection');
  }
}

// ── Add Profile / Edit Goals ──────────────────────────────────

function openAddApprenticeProfile(presetName) {
  if (!isManager) { showToast('Supervision access required'); return; }
  const modal = document.getElementById('modal-apprentice-profile');
  if (!modal) return;

  document.getElementById('ap-edit-id').value = '';
  document.getElementById('ap-year').value = '1';
  document.getElementById('ap-start-date').value = '';
  document.getElementById('ap-notes').value = '';
  document.getElementById('ap-goal-tech').value = '';
  document.getElementById('ap-goal-prof').value = '';
  document.getElementById('ap-goal-personal').value = '';

  // Populate person dropdown
  const apprenticePeople = (STATE.people || []).filter(p => p.group === 'Apprentice');
  const takenIds = new Set(apprenticeProfiles.map(p => String(p.person_id)));
  let personHtml = '<option value="">— Select apprentice —</option>';
  apprenticePeople.forEach(p => {
    if (!takenIds.has(String(p.id))) {
      personHtml += '<option value="' + p.id + '"' + (presetName && p.name === presetName ? ' selected' : '') + '>' + esc(p.name) + '</option>';
    }
  });
  document.getElementById('ap-person').innerHTML = personHtml;

  // Current site dropdown
  let siteHtml = '<option value="">— None —</option>';
  (STATE.sites || []).forEach(s => { siteHtml += '<option value="' + esc(s.abbr) + '">' + esc(s.abbr) + ' — ' + esc(s.name) + '</option>'; });
  document.getElementById('ap-site').innerHTML = siteHtml;

  document.getElementById('modal-ap-title').textContent = 'Add Apprentice Profile';
  openModal('modal-apprentice-profile');
}

function openEditGoals(profileId) {
  if (!isManager) { showToast('Supervision access required'); return; }
  const profile = apprenticeProfiles.find(p => p.id === profileId);
  if (!profile) return;
  const modal = document.getElementById('modal-apprentice-profile');
  if (!modal) return;

  const personName = getPersonNameById(profile.person_id);
  document.getElementById('ap-edit-id').value = profileId;
  document.getElementById('ap-year').value = profile.year_level;
  document.getElementById('ap-start-date').value = profile.start_date || '';
  document.getElementById('ap-notes').value = profile.notes || '';
  document.getElementById('ap-goal-tech').value = profile.goal_technical || '';
  document.getElementById('ap-goal-prof').value = profile.goal_professional || '';
  document.getElementById('ap-goal-personal').value = profile.goal_personal || '';

  let personHtml = '<option value="' + profile.person_id + '">' + esc(personName) + '</option>';
  document.getElementById('ap-person').innerHTML = personHtml;
  document.getElementById('ap-person').disabled = true;

  let siteHtml = '<option value="">— None —</option>';
  (STATE.sites || []).forEach(s => {
    siteHtml += '<option value="' + esc(s.abbr) + '"' + (s.abbr === profile.current_site ? ' selected' : '') + '>' + esc(s.abbr) + ' — ' + esc(s.name) + '</option>';
  });
  document.getElementById('ap-site').innerHTML = siteHtml;

  document.getElementById('modal-ap-title').textContent = 'Edit Profile — ' + personName;
  openModal('modal-apprentice-profile');
}

async function saveApprenticeProfile() {
  if (!isManager) { showToast('Supervision access required'); return; }
  const editId = document.getElementById('ap-edit-id').value;
  const personId = document.getElementById('ap-person').value;
  const yearLevel = parseInt(document.getElementById('ap-year').value);
  const startDate = document.getElementById('ap-start-date').value || null;
  const notes = document.getElementById('ap-notes').value.trim();
  const goalTech = document.getElementById('ap-goal-tech').value.trim();
  const goalProf = document.getElementById('ap-goal-prof').value.trim();
  const goalPersonal = document.getElementById('ap-goal-personal').value.trim();
  const site = document.getElementById('ap-site').value || null;

  if (!editId && !personId) { showToast('Select an apprentice'); return; }

  const row = {
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
      await sbFetch('apprentice_profiles?id=eq.' + editId, 'PATCH', row);
      const idx = apprenticeProfiles.findIndex(p => p.id === parseInt(editId));
      if (idx >= 0) Object.assign(apprenticeProfiles[idx], row);
      showToast('Profile updated ✓');
      closeModal('modal-apprentice-profile');
      document.getElementById('ap-person').disabled = false;
      renderApprenticeProfile(parseInt(editId));
    } else {
      row.person_id = personId;
      const res = await sbFetch('apprentice_profiles', 'POST', row, 'return=representation');
      if (res && res[0]) {
        apprenticeProfiles.push(res[0]);
        showToast('Profile created ✓');
        closeModal('modal-apprentice-profile');
        openApprenticeProfile(res[0].id, getPersonNameById(personId));
      }
    }
    await loadApprenticeData();
  } catch (e) {
    showToast('Save failed — check connection');
  }
}

// ── Add Rotation ──────────────────────────────────────────────

function openAddRotation(profileId, personName) {
  if (!isManager) { showToast('Supervision access required'); return; }
  const modal = document.getElementById('modal-apprentice-rotation');
  if (!modal) return;

  document.getElementById('rot-apprentice-id').value = profileId;
  document.getElementById('rot-site').value = '';
  document.getElementById('rot-type').value = 'Commercial';
  document.getElementById('rot-start').value = '';
  document.getElementById('rot-end').value = '';
  document.getElementById('rot-supervisor').value = '';
  document.getElementById('rot-main-work').value = '';
  document.getElementById('modal-rot-title').textContent = 'Add Rotation — ' + personName;

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

  if (!site) { showToast('Enter a project / site'); return; }
  if (!start) { showToast('Enter a start date'); return; }

  const row = { apprentice_id: profileId, project_site: site, project_type: type, date_start: start, date_end: end, supervisor: supervisor || null, main_work: mainWork || null };

  try {
    const res = await sbFetch('rotations', 'POST', row, 'return=representation');
    if (res && res[0]) apprenticeRotations.push(res[0]);
    showToast('Rotation added ✓');
    closeModal('modal-apprentice-rotation');
    renderApprenticeProfile(profileId);
  } catch (e) {
    showToast('Save failed — check connection');
  }
}

// ── Utility ───────────────────────────────────────────────────

function getCurrentPeriod() {
  const now = new Date();
  const q = Math.ceil((now.getMonth() + 1) / 3);
  return 'Q' + q + ' ' + now.getFullYear();
}
