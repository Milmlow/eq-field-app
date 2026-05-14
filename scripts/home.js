/*! Property of EQ — all rights reserved. Unauthorised use prohibited. */
// ─────────────────────────────────────────────────────────────
// scripts/home.js  —  EQ Solves Field
// v3.5.0 — Mobile-first home tile screen for staff role.
// v3.5.1 — Role branch: same surface now renders a supervisor
//          variant (6 tiles + action strip) when isManager === true.
//
// Gated by:
//   - PostHog flag 'home_screen_v1' (default ON since v3.5.0).
//   - Viewport width < 768px (CSS media query in styles/home.css
//     also enforces this; the JS check belt-and-braces against
//     post-resize).
//   - Role:
//       staff      (!isManager) → renderStaffHomeScreen
//       supervisor (isManager)  → renderSupervisorHomeScreen
//
// Public API (called from index.html initApp() and PAGE_TITLES dispatch):
//   window.renderHomeScreen()    — top-level render; branches by role.
//   window.eqhTileTap(target)    — tile tap router (analytics + showPage).
//   window.eqhOpenDrawer()       — open cog drawer (builds the right one).
//   window.eqhCloseDrawer()      — close any open drawer.
//   window.eqhsActionStripTap()  — supervisor-only: tap the action strip.
//
// Load order: AFTER app-state.js (for STATE / TENANT), AFTER analytics.js
// (for EQ_ANALYTICS.events), AFTER flags.js (for EQ_FLAGS), AFTER auth.js,
// AFTER leave.js + site-reports.js (for window.eqGetPendingLeaveCount /
// eqGetPrestartsDraftCount accessors used by the supervisor variant).
// Plain JS, no bundler.
//
// Decisions baked in (see _proposals/mobile-first-nav/MOBILE-FIRST-NAV-PROPOSAL.md):
//   A1 — staff mobile (v3.5.0). A2 — supervisor mobile (this version).
//   B1 — Next-shift pill shown on staff. Supervisors get an action strip.
//   C1 — Pre-starts tile hidden on SKS via TENANT_DISABLED_TABLES.sks.
//   D  — Labels as proposed.
//   E  — Greeting "G'day, {name}" personality kept.
//   G1 — Supervisor tiles carry STATUS badges (e.g. "New") not COUNT
//        badges. Counts live only in the action strip.
//   H1 — Greeting shown once per day, then date line. Shared key
//        'eqh_last_greet_day' for both roles.
//   I1 — Live counts on Schedule + Timesheets (staff variant).
// ─────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // ── Shared helpers ───────────────────────────────────────────

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

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // isManager is a top-level let in auth.js; read it through window with
  // a defensive fallback so this module never crashes if auth hasn't
  // populated yet (cold-boot ordering).
  function isManagerSession() {
    try { return typeof window.isManager !== 'undefined' && window.isManager === true; }
    catch (e) { return false; }
  }

  function isPrestartsAllowed() {
    try {
      const slug = (window.TENANT && TENANT.ORG_SLUG) ? TENANT.ORG_SLUG : 'eq';
      if (slug !== 'sks') return true;
      const disabled = (window.TENANT_DISABLED_TABLES && TENANT_DISABLED_TABLES.sks) || [];
      return disabled.indexOf('prestarts') === -1;
    } catch (e) { return true; }
  }

  // ── Staff-only helpers (schedule lookup, next-shift pill) ────

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

  function isTimesheetDueSoon() {
    const today = new Date().getDay();
    return today >= 3 && today <= 5;
  }

  function findNextShift() {
    try {
      const all = getUserShifts();
      const wk = currentWeekKey();
      const dayOrder = ['mon','tue','wed','thu','fri','sat','sun'];
      const todayIdx = ((new Date().getDay() + 6) % 7);
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
          : 100 + dIdx;
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

  // ── Supervisor-only helpers (action strip + roster summary) ──

  function countPendingLeave() {
    try {
      if (typeof window.eqGetPendingLeaveCount === 'function') {
        return window.eqGetPendingLeaveCount();
      }
    } catch (e) {}
    return 0;
  }

  function countPrestartsToSign() {
    try {
      if (!isPrestartsAllowed()) return 0;
      if (typeof window.eqGetPrestartsDraftCount === 'function') {
        return window.eqGetPrestartsDraftCount();
      }
    } catch (e) {}
    return 0;
  }

  // Roster summary line for the supervisor's Schedule tile subtitle.
  function describeScheduleThisWeek() {
    try {
      const wk = (window.STATE && STATE.currentWeek) ? STATE.currentWeek : null;
      const rows = (window.STATE && Array.isArray(STATE.schedule)) ? STATE.schedule : [];
      const ppl = new Set(), sites = new Set();
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (wk && String(r.week) !== wk) continue;
        if (r.site && String(r.site).trim() !== '') {
          ppl.add(String(r.person_id));
          sites.add(String(r.site).trim());
        }
      }
      const p = ppl.size, s = sites.size;
      if (p === 0) return 'No-one rostered yet';
      return p + ' staff · ' + s + ' site' + (s === 1 ? '' : 's');
    } catch (e) { return 'Roster overview'; }
  }

  function actionStripHTML() {
    const leave = countPendingLeave();
    const ps    = countPrestartsToSign();
    const total = leave + ps;

    if (total === 0) {
      return '<div class="eqh-shift eqh-shift-allclear" aria-label="All clear">' +
               '<div class="eqh-shift-icon eqh-shift-icon-ok" aria-hidden="true">✓</div>' +
               '<div style="flex:1">' +
                 '<div class="eqh-shift-label">All clear</div>' +
                 '<div class="eqh-shift-value">Nothing waiting on you today</div>' +
               '</div>' +
             '</div>';
    }

    const parts = [];
    if (leave > 0) parts.push(leave + ' leave to approve');
    if (ps > 0)    parts.push(ps + ' pre-start' + (ps === 1 ? '' : 's'));
    const line = parts.join(' · ');

    return '<button class="eqh-shift eqh-shift-warn" onclick="eqhsActionStripTap()" aria-label="Needs your attention today">' +
             '<div class="eqh-shift-icon eqh-shift-icon-warn" aria-hidden="true">⚠</div>' +
             '<div style="flex:1;text-align:left">' +
               '<div class="eqh-shift-label">Needs you today</div>' +
               '<div class="eqh-shift-value">' + escapeHtml(line) + '</div>' +
             '</div>' +
             '<span class="eqh-shift-chev" aria-hidden="true">›</span>' +
           '</button>';
  }

  // Tap the action strip — open the most-pressing queue. Order:
  // leave (most time-sensitive) → pre-starts.
  function eqhsActionStripTap() {
    try {
      if (window.EQ_ANALYTICS && window.EQ_ANALYTICS.capture) {
        window.EQ_ANALYTICS.capture('home_supervisor_action_tapped', {});
      }
    } catch (e) {}
    if (countPendingLeave() > 0 && typeof window.showPage === 'function') return window.showPage('leave');
    if (countPrestartsToSign() > 0 && typeof window.showPage === 'function') return window.showPage('prestart');
  }

  // ── Render: staff (v3.5.0 body, unchanged) ──────────────────

  function renderStaffHomeScreen(mount) {
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

    try {
      if (window.EQ_ANALYTICS && window.EQ_ANALYTICS.events && window.EQ_ANALYTICS.events.pageViewed) {
        window.EQ_ANALYTICS.events.pageViewed({ page: 'home' });
      }
    } catch (e) { /* never break boot */ }
  }

  // ── Render: supervisor (v3.5.1) ──────────────────────────────

  function renderSupervisorHomeScreen(mount) {
    const name = getLoggedInName();
    const firstName = (name || 'boss').split(/\s+/)[0];
    const greetingHTML = isFirstSessionOfDay()
      ? "G'day, " + escapeHtml(firstName)
      : escapeHtml(formatToday());

    const offline = (typeof navigator !== 'undefined' && navigator.onLine === false);
    const offlineBanner = offline
      ? '<div class="eqh-offline" role="status"><span>⚠</span><span>You\'re offline — counts may be stale.</span></div>'
      : '';

    const scheduleSub = describeScheduleThisWeek();
    const showPrestart = isPrestartsAllowed();
    const version = (typeof APP_VERSION !== 'undefined') ? APP_VERSION : '?';

    const prestartTile = showPrestart
      ? '<button class="eqh-tile eqh-t-prestart" onclick="eqhTileTap(\'prestart\')" aria-label="Pre-starts">' +
          '<span class="eqh-badge eqh-badge-new">New</span>' +
          '<div class="eqh-tile-icon" aria-hidden="true">📋</div>' +
          '<div>' +
            '<div class="eqh-tile-title">Pre-starts</div>' +
            '<div class="eqh-tile-sub">Sign off today</div>' +
          '</div>' +
        '</button>'
      : '';

    mount.innerHTML =
      '<div class="eqh-header">' +
        '<div>' +
          '<div class="eqh-brand">EQ Field <span class="eqh-role-chip">SUPERVISOR</span></div>' +
          '<div class="eqh-greeting">' + greetingHTML + '</div>' +
        '</div>' +
        '<button class="eqh-cog" onclick="eqhOpenDrawer()" aria-label="Settings and more">' +
          '<span aria-hidden="true">⚙</span>' +
        '</button>' +
      '</div>' +
      offlineBanner +
      actionStripHTML() +
      '<div class="eqh-tiles">' +
        '<button class="eqh-tile eqh-t-schedule" onclick="eqhTileTap(\'roster\')" aria-label="Schedule">' +
          '<div class="eqh-tile-icon" aria-hidden="true">📅</div>' +
          '<div>' +
            '<div class="eqh-tile-title">Schedule</div>' +
            '<div class="eqh-tile-sub">' + escapeHtml(scheduleSub) + '</div>' +
          '</div>' +
        '</button>' +
        '<button class="eqh-tile eqh-t-time" onclick="eqhTileTap(\'timesheets\')" aria-label="Timesheets">' +
          '<div class="eqh-tile-icon" aria-hidden="true">⏱</div>' +
          '<div>' +
            '<div class="eqh-tile-title">Timesheets</div>' +
            '<div class="eqh-tile-sub">Review &amp; approve</div>' +
          '</div>' +
        '</button>' +
        '<button class="eqh-tile eqh-t-leave" onclick="eqhTileTap(\'leave\')" aria-label="Leave">' +
          '<div class="eqh-tile-icon" aria-hidden="true">✈</div>' +
          '<div>' +
            '<div class="eqh-tile-title">Leave</div>' +
            '<div class="eqh-tile-sub">Requests &amp; balance</div>' +
          '</div>' +
        '</button>' +
        prestartTile +
        '<button class="eqh-tile eqh-t-team" onclick="eqhTileTap(\'contacts\')" aria-label="Team">' +
          '<div class="eqh-tile-icon" aria-hidden="true">👥</div>' +
          '<div>' +
            '<div class="eqh-tile-title">Team</div>' +
            '<div class="eqh-tile-sub">Roster &amp; contacts</div>' +
          '</div>' +
        '</button>' +
        '<button class="eqh-tile eqh-t-reports" onclick="eqhTileTap(\'dashboard\')" aria-label="Reports">' +
          '<div class="eqh-tile-icon" aria-hidden="true">📊</div>' +
          '<div>' +
            '<div class="eqh-tile-title">Reports</div>' +
            '<div class="eqh-tile-sub">Weekly hours &amp; site</div>' +
          '</div>' +
        '</button>' +
      '</div>' +
      '<div class="eqh-footer">EQ Field · v' + escapeHtml(version) + ' · Supervisor</div>';

    try {
      if (window.EQ_ANALYTICS && window.EQ_ANALYTICS.events && window.EQ_ANALYTICS.events.pageViewed) {
        window.EQ_ANALYTICS.events.pageViewed({ page: 'home-supervisor' });
      }
    } catch (e) { /* never break boot */ }
  }

  // ── Top-level render: pick by role ───────────────────────────

  function renderHomeScreen() {
    const mount = document.getElementById('page-home');
    if (!mount) return;
    if (isManagerSession()) return renderSupervisorHomeScreen(mount);
    return renderStaffHomeScreen(mount);
  }

  // ── Tile tap router (shared) ────────────────────────────────

  function eqhTileTap(target) {
    try {
      if (window.EQ_ANALYTICS && window.EQ_ANALYTICS.capture) {
        const evt = isManagerSession() ? 'home_supervisor_tile_tapped' : 'home_tile_tapped';
        window.EQ_ANALYTICS.capture(evt, { tile: target });
      }
    } catch (e) { /* swallow */ }

    if (typeof window.showPage === 'function') {
      window.showPage(target);
    } else {
      window.location.hash = '#' + target;
    }
  }

  // ── Cog drawer (role-aware) ─────────────────────────────────
  // One DOM node, rebuilt per open based on role. The role can change
  // mid-session (PIN unlock), so we always recompute the content.

  function drawerContentForRole(role) {
    const close = role === 'supervisor' ? 'eqhCloseDrawer()' : 'eqhCloseDrawer()';
    if (role === 'supervisor') {
      return (
        '<div class="eqh-drawer-sheet" onclick="event.stopPropagation()">' +
          '<div class="eqh-drawer-handle"></div>' +
          '<div class="eqh-drawer-title">More</div>' +
          '<button class="eqh-drawer-item" onclick="' + close + ';showPage(\'editor\')"><span class="eqh-drawer-item-icon">✎</span> Edit roster</button>' +
          '<button class="eqh-drawer-item" onclick="' + close + ';showPage(\'contacts\')"><span class="eqh-drawer-item-icon">👥</span> Contacts</button>' +
          '<button class="eqh-drawer-item" onclick="' + close + ';showPage(\'sites\')"><span class="eqh-drawer-item-icon">📍</span> Sites</button>' +
          '<button class="eqh-drawer-item" onclick="' + close + ';showPage(\'jobnumbers\')"><span class="eqh-drawer-item-icon">#</span> Job numbers</button>' +
          '<button class="eqh-drawer-item" onclick="' + close + ';showPage(\'apprentices\')"><span class="eqh-drawer-item-icon">🎓</span> Apprentices</button>' +
          '<button class="eqh-drawer-item" onclick="' + close + ';showPage(\'managers\')"><span class="eqh-drawer-item-icon">🛡</span> Supervision</button>' +
          '<button class="eqh-drawer-item" onclick="' + close + ';showPage(\'data\')"><span class="eqh-drawer-item-icon">⇅</span> Import / Export</button>' +
          '<button class="eqh-drawer-item" onclick="' + close + ';showPage(\'help\')"><span class="eqh-drawer-item-icon">❓</span> Help</button>' +
          '<button class="eqh-drawer-item" onclick="' + close + ';if(typeof openAuditLog===\'function\')openAuditLog()"><span class="eqh-drawer-item-icon">📜</span> Audit log</button>' +
          '<button class="eqh-drawer-item" onclick="' + close + ';if(typeof openPrivacyNotice===\'function\')openPrivacyNotice()"><span class="eqh-drawer-item-icon">🔒</span> Privacy notice</button>' +
          '<button class="eqh-drawer-item" onclick="' + close + ';if(typeof logoutUser===\'function\')logoutUser()"><span class="eqh-drawer-item-icon">↪</span> Log out</button>' +
          '<button class="eqh-drawer-close" onclick="' + close + '">Close</button>' +
        '</div>'
      );
    }
    return (
      '<div class="eqh-drawer-sheet" onclick="event.stopPropagation()">' +
        '<div class="eqh-drawer-handle"></div>' +
        '<div class="eqh-drawer-title">More</div>' +
        '<button class="eqh-drawer-item" onclick="' + close + ';showPage(\'contacts\')"><span class="eqh-drawer-item-icon">👥</span> Contacts</button>' +
        '<button class="eqh-drawer-item" onclick="' + close + ';showPage(\'calendar\')"><span class="eqh-drawer-item-icon">🗓</span> Calendar</button>' +
        '<button class="eqh-drawer-item" onclick="' + close + ';showPage(\'help\')"><span class="eqh-drawer-item-icon">❓</span> Help</button>' +
        '<button class="eqh-drawer-item" onclick="' + close + ';if(typeof openPrivacyNotice===\'function\')openPrivacyNotice()"><span class="eqh-drawer-item-icon">🔒</span> Privacy notice</button>' +
        '<button class="eqh-drawer-item" onclick="' + close + ';if(typeof logoutUser===\'function\')logoutUser()"><span class="eqh-drawer-item-icon">↪</span> Log out</button>' +
        '<button class="eqh-drawer-close" onclick="' + close + '">Close</button>' +
      '</div>'
    );
  }

  function ensureDrawer() {
    let host = document.getElementById('eqh-drawer');
    if (!host) {
      host = document.createElement('div');
      host.id = 'eqh-drawer';
      host.className = 'eqh-drawer';
      host.setAttribute('role', 'dialog');
      host.setAttribute('aria-modal', 'true');
      host.setAttribute('aria-label', 'More options');
      host.addEventListener('click', function () { eqhCloseDrawer(); });
      document.body.appendChild(host);
    }
    return host;
  }

  function eqhOpenDrawer() {
    const role = isManagerSession() ? 'supervisor' : 'staff';
    const host = ensureDrawer();
    host.innerHTML = drawerContentForRole(role);
    host.classList.add('open');
    try {
      if (window.EQ_ANALYTICS && window.EQ_ANALYTICS.capture) {
        const evt = role === 'supervisor' ? 'home_supervisor_cog_opened' : 'home_cog_opened';
        window.EQ_ANALYTICS.capture(evt, {});
      }
    } catch (e) {}
  }

  function eqhCloseDrawer() {
    const host = document.getElementById('eqh-drawer');
    if (host) host.classList.remove('open');
  }

  // ── Online/offline re-render ────────────────────────────────
  window.addEventListener('online',  function () {
    if (typeof currentPage !== 'undefined' && currentPage === 'home') renderHomeScreen();
  });
  window.addEventListener('offline', function () {
    if (typeof currentPage !== 'undefined' && currentPage === 'home') renderHomeScreen();
  });

  // ── Expose ───────────────────────────────────────────────────
  window.renderHomeScreen   = renderHomeScreen;
  window.eqhTileTap         = eqhTileTap;
  window.eqhOpenDrawer      = eqhOpenDrawer;
  window.eqhCloseDrawer     = eqhCloseDrawer;
  window.eqhsActionStripTap = eqhsActionStripTap;
})();
