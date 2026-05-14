/*! Property of EQ — all rights reserved. Unauthorised use prohibited. */
// ─────────────────────────────────────────────────────────────
// scripts/home.js  —  EQ Solves Field
// v3.5.0 — Mobile-first home tile screen for staff role.
//
// Gated by:
//   - PostHog flag 'home_screen_v1' (default OFF, see scripts/flags.js)
//   - role === 'staff' (i.e. !isManager)
//   - viewport width < 768px (CSS media query in styles/home.css also
//     enforces this; the JS check belt-and-braces against post-resize)
//
// Public API (called from index.html initApp() and PAGE_TITLES dispatch):
//   window.renderHomeScreen()  — main render
//   window.eqhTileTap(target)  — tile tap router (analytics + showPage)
//   window.eqhOpenDrawer()     — open cog drawer
//   window.eqhCloseDrawer()    — close cog drawer
//
// Load order: AFTER app-state.js (for STATE / TENANT), AFTER analytics.js
// (for EQ_ANALYTICS.events), AFTER flags.js (for EQ_FLAGS), AFTER auth.js.
// Plain JS, no bundler.
//
// Decisions baked in (see _proposals/mobile-first-nav/MOBILE-FIRST-NAV-PROPOSAL.md):
//   A1 — staff mobile only (this file). Supervisor variant = Phase 2.
//   B1 — Next-shift pill shown.
//   C1 — Pre-starts tile hidden on SKS via TENANT_DISABLED_TABLES.sks.
//   D  — Labels as proposed ("My schedule", "Timesheets", "Leave", "Pre-starts").
//   E  — Greeting "G'day, {name}" personality kept.
//   H1 — Greeting shown once per day, then date line.
//   I1 — Live counts on Schedule + Timesheets only.
// ─────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // ── Helpers ──────────────────────────────────────────────────

  function getLoggedInName() {
    try { return sessionStorage.getItem('eq_logged_in_name') || ''; } catch (e) { return ''; }
  }

  function getTodayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function isFirstSessionOfDay() {
    try {
      const last = sessionStorage.getItem('eqh_last_greet_day');
      const today = getTodayKey();
      if (last === today) return false;
      sessionStorage.setItem('eqh_last_greet_day', today);
      return true;
    } catch (e) { return true; }
  }

  function formatToday() {
    const d = new Date();
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return days[d.getDay()] + ' ' + d.getDate() + ' ' + months[d.getMonth()];
  }

  // Find this user's person row by case-insensitive name match. STATE.people is
  // the source of truth; falls back to empty if it isn't loaded yet (loading
  // state covers that).
  function findCurrentPerson() {
    try {
      const name = (getLoggedInName() || '').toLowerCase().trim();
      if (!name) return null;
      const people = (window.STATE && Array.isArray(STATE.people)) ? STATE.people : [];
      for (let i = 0; i < people.length; i++) {
        const pn = String(people[i].name || '').toLowerCase().trim();
        if (pn === name) return people[i];
      }
    } catch (e) { /* fall through */ }
    return null;
  }

  // Pull this user's upcoming shifts from STATE.schedule. STATE.schedule rows
  // are roster cells keyed by person_id + week + day. We coerce ids via
  // String() per the project-wide bigint/uuid drift rule.
  function getUserShifts() {
    try {
      const person = findCurrentPerson();
      if (!person) return [];
      const pid = String(person.id);
      const rows = (window.STATE && Array.isArray(STATE.schedule)) ? STATE.schedule : [];
      const out = [];
      for (let i = 0; i < rows.length; i++) {
        if (String(rows[i].person_id) === pid) out.push(rows[i]);
      }
      return out;
    } catch (e) { return []; }
  }

  // Returns the Monday-format string ('DD.MM.YY') for the current week,
  // matching STATE.currentWeek's format used elsewhere.
  function currentWeekKey() {
    if (window.STATE && STATE.currentWeek) return STATE.currentWeek;
    const d = new Date(), mon = new Date(d);
    mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return String(mon.getDate()).padStart(2, '0') + '.' + String(mon.getMonth() + 1).padStart(2, '0') + '.' + String(mon.getFullYear()).slice(-2);
  }

  function countShiftsThisWeek() {
    const wk = currentWeekKey();
    const all = getUserShifts();
    let n = 0;
    for (let i = 0; i < all.length; i++) {
      if (String(all[i].week) === wk && all[i].site && String(all[i].site).trim() !== '') n++;
    }
    return n;
  }

  // Friday-of-current-week awareness for the Timesheets "Due Fri" badge.
  function isTimesheetDueSoon() {
    const today = new Date().getDay(); // 0=Sun, 5=Fri
    return today >= 3 && today <= 5;   // Wed-Fri shows the badge
  }

  // Best-effort "next shift" — the soonest shift this week or next week.
  // Returns { site, day, week } or null. Day strings are 'mon'..'sun'.
  function findNextShift() {
    try {
      const all = getUserShifts();
      const wk = currentWeekKey();
      const dayOrder = ['mon','tue','wed','thu','fri','sat','sun'];
      const todayIdx = ((new Date().getDay() + 6) % 7); // mon=0..sun=6
      let best = null;
      let bestScore = 1e9;
      for (let i = 0; i < all.length; i++) {
        const r = all[i];
        if (!r.site || String(r.site).trim() === '') continue;
        const dIdx = dayOrder.indexOf(String(r.day || '').toLowerCase());
        if (dIdx < 0) continue;
        const sameWeek = String(r.week) === wk;
        const score = sameWeek
          ? (dIdx < todayIdx ? 1e6 : dIdx)
          : 100 + dIdx; // next week, push behind this week's remaining
        if (score < bestScore) { bestScore = score; best = r; }
      }
      return best;
    } catch (e) { return null; }
  }

  function formatShiftDay(shift) {
    if (!shift) return '';
    const dayMap = { mon:'Monday', tue:'Tuesday', wed:'Wednesday', thu:'Thursday', fri:'Friday', sat:'Saturday', sun:'Sunday' };
    const d = dayMap[String(shift.day || '').toLowerCase()] || shift.day || '';
    return d + ' · ' + (shift.site || '');
  }

  // Pre-starts visibility — hidden on SKS until module ships there (decision C1).
  function isPrestartsAllowed() {
    try {
      const slug = (window.TENANT && TENANT.ORG_SLUG) ? TENANT.ORG_SLUG : 'eq';
      if (slug !== 'sks') return true;
      // SKS — check if prestart table is gated off
      const disabled = (window.TENANT_DISABLED_TABLES && TENANT_DISABLED_TABLES.sks) || [];
      return disabled.indexOf('prestarts') === -1;
    } catch (e) { return true; }
  }

  // ── Render ───────────────────────────────────────────────────

  function renderHomeScreen() {
    const mount = document.getElementById('page-home');
    if (!mount) return; // guard against missing mount

    const name = getLoggedInName();
    const firstName = (name || 'mate').split(/\s+/)[0];
    const showGreeting = isFirstSessionOfDay();
    const greetingHTML = showGreeting
      ? "G'day, " + escapeHtml(firstName)
      : escapeHtml(formatToday());

    const offline = (typeof navigator !== 'undefined' && navigator.onLine === false);
    const shiftCount = countShiftsThisWeek();
    const nextShift = findNextShift();
    const tsDueSoon = isTimesheetDueSoon();
    const showPrestart = isPrestartsAllowed();

    const offlineBanner = offline
      ? '<div class="eqh-offline" role="status"><span>⚠</span><span>You\'re offline — showing last synced data.</span></div>'
      : '';

    const shiftPill = nextShift
      ? '<button class="eqh-shift" onclick="eqhTileTap(\'schedule\')" aria-label="Next shift — open schedule">' +
          '<span class="eqh-shift-icon" aria-hidden="true">📍</span>' +
          '<div style="flex:1;text-align:left">' +
            '<div class="eqh-shift-label">Next shift</div>' +
            '<div class="eqh-shift-value">' + escapeHtml(formatShiftDay(nextShift)) + '</div>' +
          '</div>' +
          '<span class="eqh-shift-chev" aria-hidden="true">›</span>' +
        '</button>'
      : '<button class="eqh-shift" onclick="eqhTileTap(\'schedule\')" aria-label="Open schedule">' +
          '<span class="eqh-shift-icon" aria-hidden="true">📅</span>' +
          '<div style="flex:1;text-align:left">' +
            '<div class="eqh-shift-label">No upcoming shifts</div>' +
            '<div class="eqh-shift-value">Tap to view schedule</div>' +
          '</div>' +
          '<span class="eqh-shift-chev" aria-hidden="true">›</span>' +
        '</button>';

    const scheduleSubtitle = shiftCount === 0
      ? 'Nothing this week'
      : shiftCount === 1
        ? '1 shift this week'
        : shiftCount + ' shifts this week';

    const timesheetBadge = tsDueSoon
      ? '<span class="eqh-badge eqh-badge-warn">Due Fri</span>'
      : '';

    const prestartTile = showPrestart
      ? '<button class="eqh-tile eqh-t-prestart" onclick="eqhTileTap(\'prestart\')" aria-label="Pre-starts and toolboxes">' +
          '<span class="eqh-badge eqh-badge-new">New</span>' +
          '<div class="eqh-tile-icon" aria-hidden="true">📋</div>' +
          '<div>' +
            '<div class="eqh-tile-title">Pre-starts</div>' +
            '<div class="eqh-tile-sub">Toolboxes &amp; SWMS</div>' +
          '</div>' +
        '</button>'
      : '';

    const version = (typeof APP_VERSION !== 'undefined') ? APP_VERSION : '?';

    mount.innerHTML =
      '<div class="eqh-header">' +
        '<div>' +
          '<div class="eqh-brand">EQ Field</div>' +
          '<div class="eqh-greeting">' + greetingHTML + '</div>' +
        '</div>' +
        '<button class="eqh-cog" onclick="eqhOpenDrawer()" aria-label="Settings and more">' +
          '<span aria-hidden="true">⚙</span>' +
        '</button>' +
      '</div>' +
      offlineBanner +
      shiftPill +
      '<div class="eqh-tiles">' +
        '<button class="eqh-tile eqh-t-schedule" onclick="eqhTileTap(\'schedule\')" aria-label="My schedule">' +
          '<div class="eqh-tile-icon" aria-hidden="true">📅</div>' +
          '<div>' +
            '<div class="eqh-tile-title">My schedule</div>' +
            '<div class="eqh-tile-sub">' + escapeHtml(scheduleSubtitle) + '</div>' +
          '</div>' +
        '</button>' +
        '<button class="eqh-tile eqh-t-time" onclick="eqhTileTap(\'staff-ts\')" aria-label="Timesheets">' +
          timesheetBadge +
          '<div class="eqh-tile-icon" aria-hidden="true">⏱</div>' +
          '<div>' +
            '<div class="eqh-tile-title">Timesheets</div>' +
            '<div class="eqh-tile-sub">Submit this week</div>' +
          '</div>' +
        '</button>' +
        '<button class="eqh-tile eqh-t-leave" onclick="eqhTileTap(\'leave\')" aria-label="Leave">' +
          '<div class="eqh-tile-icon" aria-hidden="true">✈</div>' +
          '<div>' +
            '<div class="eqh-tile-title">Leave</div>' +
            '<div class="eqh-tile-sub">Request time off</div>' +
          '</div>' +
        '</button>' +
        prestartTile +
      '</div>' +
      '<div class="eqh-footer">EQ Field · v' + escapeHtml(version) + '</div>';

    // PostHog page view (matches the showPage() pattern)
    try {
      if (window.EQ_ANALYTICS && window.EQ_ANALYTICS.events && window.EQ_ANALYTICS.events.pageViewed) {
        window.EQ_ANALYTICS.events.pageViewed({ page: 'home' });
      }
    } catch (e) { /* never break boot */ }
  }

  // ── Tile tap router ─────────────────────────────────────────

  function eqhTileTap(target) {
    // Fire analytics first so we capture tile engagement even if the
    // destination function throws.
    try {
      if (window.EQ_ANALYTICS && window.EQ_ANALYTICS.capture) {
        window.EQ_ANALYTICS.capture('home_tile_tapped', { tile: target });
      }
    } catch (e) { /* swallow */ }

    if (typeof window.showPage === 'function') {
      window.showPage(target);
    } else {
      // Last-resort fallback — should never fire in production.
      window.location.hash = '#' + target;
    }
  }

  // ── Cog drawer (slide-up sheet) ─────────────────────────────

  function buildDrawer() {
    let host = document.getElementById('eqh-drawer');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'eqh-drawer';
    host.className = 'eqh-drawer';
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.setAttribute('aria-label', 'More options');
    host.innerHTML =
      '<div class="eqh-drawer-sheet" onclick="event.stopPropagation()">' +
        '<div class="eqh-drawer-handle"></div>' +
        '<div class="eqh-drawer-title">More</div>' +
        '<button class="eqh-drawer-item" onclick="eqhCloseDrawer();showPage(\'contacts\')"><span class="eqh-drawer-item-icon">👥</span> Contacts</button>' +
        '<button class="eqh-drawer-item" onclick="eqhCloseDrawer();showPage(\'calendar\')"><span class="eqh-drawer-item-icon">🗓</span> Calendar</button>' +
        '<button class="eqh-drawer-item" onclick="eqhCloseDrawer();showPage(\'help\')"><span class="eqh-drawer-item-icon">❓</span> Help</button>' +
        '<button class="eqh-drawer-item" onclick="eqhCloseDrawer();if(typeof openPrivacyNotice===\'function\')openPrivacyNotice()"><span class="eqh-drawer-item-icon">🔒</span> Privacy notice</button>' +
        '<button class="eqh-drawer-item" onclick="eqhCloseDrawer();if(typeof logoutUser===\'function\')logoutUser()"><span class="eqh-drawer-item-icon">↪</span> Log out</button>' +
        '<button class="eqh-drawer-close" onclick="eqhCloseDrawer()">Close</button>' +
      '</div>';
    host.addEventListener('click', function () { eqhCloseDrawer(); });
    document.body.appendChild(host);
    return host;
  }

  function eqhOpenDrawer() {
    const host = buildDrawer();
    host.classList.add('open');
    try {
      if (window.EQ_ANALYTICS && window.EQ_ANALYTICS.capture) {
        window.EQ_ANALYTICS.capture('home_cog_opened', {});
      }
    } catch (e) {}
  }

  function eqhCloseDrawer() {
    const host = document.getElementById('eqh-drawer');
    if (host) host.classList.remove('open');
  }

  // ── Util ─────────────────────────────────────────────────────

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── Online/offline re-render ────────────────────────────────
  // Re-render on connectivity flip so the banner appears/disappears
  // without the user having to navigate away and back.
  window.addEventListener('online',  function () {
    if (typeof currentPage !== 'undefined' && currentPage === 'home') renderHomeScreen();
  });
  window.addEventListener('offline', function () {
    if (typeof currentPage !== 'undefined' && currentPage === 'home') renderHomeScreen();
  });

  // ── Expose ───────────────────────────────────────────────────
  window.renderHomeScreen = renderHomeScreen;
  window.eqhTileTap      = eqhTileTap;
  window.eqhOpenDrawer   = eqhOpenDrawer;
  window.eqhCloseDrawer  = eqhCloseDrawer;
})();
