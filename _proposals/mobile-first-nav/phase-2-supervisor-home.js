/*! Property of EQ — all rights reserved. Unauthorised use prohibited. */
// ─────────────────────────────────────────────────────────────
// _proposals/mobile-first-nav/phase-2-supervisor-home.js
//
// ╔══════════════════════════════════════════════════════════╗
// ║  SHIPPED IN v3.5.1 — 2026-05-15                          ║
// ║                                                          ║
// ║  This draft was PROMOTED via Option A (extend            ║
// ║  scripts/home.js with a role branch). The live code      ║
// ║  lives in scripts/home.js. This file is kept on disk     ║
// ║  for reference / decision trail — DO NOT load it.        ║
// ║                                                          ║
// ║  Key differences between this draft and what shipped:    ║
// ║    - countPendingLeave() now calls                       ║
// ║      window.eqGetPendingLeaveCount() (added to           ║
// ║      scripts/leave.js) — draft's STATE.leaveRequests     ║
// ║      reference was wrong (leaveRequests is module-       ║
// ║      local, status is 'Pending' capital-P).              ║
// ║    - countPrestartsToSign() now calls                    ║
// ║      window.eqGetPrestartsDraftCount() — draft's         ║
// ║      STATE.prestarts + signed_by_supervisor_id was       ║
// ║      wrong (prestartCache is module-local, status is     ║
// ║      'draft', date column is briefing_date).             ║
// ║    - countTimesheetsToReview() DROPPED — timesheets      ║
// ║      have no review-state column in this app (they're    ║
// ║      auto-saved per cell), so the count had no source.   ║
// ║    - Drawer unified into one DOM node, rebuilt per       ║
// ║      open based on role (simpler than two nodes).        ║
// ╚══════════════════════════════════════════════════════════╝
//
// Original (pre-promotion) header below for reference.
// ─────────────────────────────────────────────────────────────
//
// Phase 2 scaffolding for the SUPERVISOR variant of the mobile home
// tile screen. Sibling to the staff home in scripts/home.js (shipped
// v3.5.0). Targets release v3.5.1.
//
// THIS FILE IS A DRAFT. Not loaded by index.html yet. Two paths to
// promotion when Phase 1 is verified in production:
//
//   Option A (recommended) — extend scripts/home.js with a role
//   branch. Single file, less surface area to maintain. Most helpers
//   (findCurrentPerson, escapeHtml, drawer scaffolding) are reused.
//
//   Option B — copy this file to scripts/home-supervisor.js and load
//   it after scripts/home.js. Cleaner separation but duplicates
//   helpers. Worth it only if the supervisor variant grows
//   significantly beyond staff (which it might once reports + team
//   tiles get rich).
//
// Decisions baked in (per MOBILE-FIRST-NAV-PROPOSAL.md v1.1):
//   A2 (deferred Phase 2) — supervisor mobile home shipped here.
//   G1 — action strip is the single "needs you today" hub. Tiles do
//        not carry count badges. Status badges (e.g. "New" on
//        Pre-starts) are kept since they communicate state, not
//        counts.
//   H1 — greeting once per day, then date string. Reuses the same
//        sessionStorage key as staff home ('eqh_last_greet_day')
//        because a supervisor seeing the date instead of "G'day"
//        after their morning staff-mode login is the same UX intent.
//
// Public API when promoted:
//   window.renderSupervisorHomeScreen()
//   window.eqhsTileTap(target)
//   window.eqhsOpenDrawer() / eqhsCloseDrawer() — supervisor drawer
//     with more items than the staff one (Editor, Apprentices admin,
//     Audit Log, Reports etc).
//
// Action strip data sources:
//   - Pending leave count   — STATE.leaveRequests where status==='pending'
//                             AND (assignee_supervisor === current
//                             supervisor OR no assignee yet)
//   - Timesheets to review  — STATE.timesheets where reviewed===false
//                             (or equivalent — schema check needed).
//   - Pre-starts to sign    — STATE.prestarts where signed_by_supervisor
//                             is null AND date >= today.
//
// Each count query must handle: empty STATE arrays, missing fields
// (old rows from pre-schema-change), and the SKS tenant gate
// (TENANT_DISABLED_TABLES.sks excludes some of these tables — count
// resolves to 0, not error).
// ─────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // ── Helpers ──────────────────────────────────────────────────
  // Same as staff home — repeated here for self-containment. When
  // promoted via Option A, delete these and use the originals.

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

  // ── Supervisor-specific data: action strip counts ────────────

  // Count of leave requests in 'pending' status. Phase 2 polish:
  // narrow to "leave requests this supervisor can action" once the
  // assignment model is final. For Phase 2 MVP, count all pending.
  function countPendingLeave() {
    try {
      const rows = (window.STATE && Array.isArray(STATE.leaveRequests)) ? STATE.leaveRequests : [];
      let n = 0;
      for (let i = 0; i < rows.length; i++) {
        const s = String(rows[i].status || '').toLowerCase();
        if (s === 'pending' || s === 'submitted') n++;
      }
      return n;
    } catch (e) { return 0; }
  }

  // Count of timesheets needing supervisor review. Schema check
  // pending — adjust the field name when wiring to live data.
  function countTimesheetsToReview() {
    try {
      const rows = (window.STATE && Array.isArray(STATE.timesheets)) ? STATE.timesheets : [];
      let n = 0;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        // Heuristic: submitted but not yet approved/reviewed.
        if (r && r.submitted_at && !r.reviewed_at && !r.approved_at) n++;
      }
      return n;
    } catch (e) { return 0; }
  }

  // Count of pre-starts (briefings) awaiting supervisor sign-off
  // today or later. Returns 0 on SKS where the table is gated.
  function countPrestartsToSign() {
    try {
      const slug = (window.TENANT && TENANT.ORG_SLUG) ? TENANT.ORG_SLUG : 'eq';
      const disabled = (window.TENANT_DISABLED_TABLES && TENANT_DISABLED_TABLES[slug]) || [];
      if (disabled.indexOf('prestarts') !== -1) return 0;
      const rows = (window.STATE && Array.isArray(STATE.prestarts)) ? STATE.prestarts : [];
      const today = new Date(); today.setHours(0, 0, 0, 0);
      let n = 0;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (r && !r.signed_by_supervisor_id) {
          const d = r.date ? new Date(r.date) : null;
          if (!d || d >= today) n++;
        }
      }
      return n;
    } catch (e) { return 0; }
  }

  // ── Schedule tile subtitle: distinct people + sites this week ──

  function describeScheduleThisWeek() {
    try {
      const wk = (window.STATE && STATE.currentWeek) ? STATE.currentWeek : null;
      const rows = (window.STATE && Array.isArray(STATE.schedule)) ? STATE.schedule : [];
      const ppl = new Set(); const sites = new Set();
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
      return p + (p === 1 ? ' staff' : ' staff') + ' · ' + s + (s === 1 ? ' site' : ' sites');
    } catch (e) { return 'Roster overview'; }
  }

  // ── Pre-starts visibility (SKS gating — same as staff home) ──

  function isPrestartsAllowed() {
    try {
      const slug = (window.TENANT && TENANT.ORG_SLUG) ? TENANT.ORG_SLUG : 'eq';
      if (slug !== 'sks') return true;
      const disabled = (window.TENANT_DISABLED_TABLES && TENANT_DISABLED_TABLES.sks) || [];
      return disabled.indexOf('prestarts') === -1;
    } catch (e) { return true; }
  }

  // ── Action strip composer ────────────────────────────────────

  function actionStripHTML() {
    const leave = countPendingLeave();
    const ts    = countTimesheetsToReview();
    const ps    = countPrestartsToSign();
    const total = leave + ts + ps;

    // Empty state — supervisor has nothing to action. Confirmation
    // copy, not error.
    if (total === 0) {
      return '<div class="eqh-shift" style="cursor:default">' +
               '<div class="eqh-shift-icon" style="background:var(--green-lt);color:var(--green)" aria-hidden="true">✓</div>' +
               '<div style="flex:1">' +
                 '<div class="eqh-shift-label">All clear</div>' +
                 '<div class="eqh-shift-value">Nothing waiting on you today</div>' +
               '</div>' +
             '</div>';
    }

    // Compose the "needs you today" line — only show counts > 0.
    const parts = [];
    if (leave > 0) parts.push(leave + ' leave to approve');
    if (ts > 0)    parts.push(ts + ' timesheets');
    if (ps > 0)    parts.push(ps + ' pre-starts');
    const line = parts.join(' · ');

    return '<button class="eqh-shift" onclick="eqhsActionStripTap()" aria-label="Needs your attention today">' +
             '<div class="eqh-shift-icon" style="background:var(--amber-lt);color:var(--amber)" aria-hidden="true">⚠</div>' +
             '<div style="flex:1;text-align:left">' +
               '<div class="eqh-shift-label">Needs you today</div>' +
               '<div class="eqh-shift-value">' + escapeHtml(line) + '</div>' +
             '</div>' +
             '<span class="eqh-shift-chev" aria-hidden="true">›</span>' +
           '</button>';
  }

  // Action-strip tap routing — picks the first non-zero queue.
  // If multiple, defaults to leave (most time-sensitive).
  function eqhsActionStripTap() {
    if (countPendingLeave() > 0) return window.showPage('leave');
    if (countTimesheetsToReview() > 0) return window.showPage('timesheets');
    if (countPrestartsToSign() > 0) return window.showPage('prestart');
  }

  // ── Render ───────────────────────────────────────────────────

  function renderSupervisorHomeScreen() {
    const mount = document.getElementById('page-home');
    if (!mount) return;

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
      ? '<button class="eqh-tile eqh-t-prestart" onclick="eqhsTileTap(\'prestart\')" aria-label="Pre-starts">' +
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
          '<div class="eqh-brand">EQ Field <span style="display:inline-block;margin-left:6px;font-size:9px;font-weight:700;color:var(--blue);background:var(--blue-lt);padding:2px 6px;border-radius:4px;letter-spacing:.4px;vertical-align:1px">SUPERVISOR</span></div>' +
          '<div class="eqh-greeting">' + greetingHTML + '</div>' +
        '</div>' +
        '<button class="eqh-cog" onclick="eqhsOpenDrawer()" aria-label="Settings and more">' +
          '<span aria-hidden="true">⚙</span>' +
        '</button>' +
      '</div>' +
      offlineBanner +
      actionStripHTML() +
      '<div class="eqh-tiles">' +
        '<button class="eqh-tile eqh-t-schedule" onclick="eqhsTileTap(\'roster\')" aria-label="Schedule">' +
          '<div class="eqh-tile-icon" aria-hidden="true">📅</div>' +
          '<div>' +
            '<div class="eqh-tile-title">Schedule</div>' +
            '<div class="eqh-tile-sub">' + escapeHtml(scheduleSub) + '</div>' +
          '</div>' +
        '</button>' +
        '<button class="eqh-tile eqh-t-time" onclick="eqhsTileTap(\'timesheets\')" aria-label="Timesheets">' +
          '<div class="eqh-tile-icon" aria-hidden="true">⏱</div>' +
          '<div>' +
            '<div class="eqh-tile-title">Timesheets</div>' +
            '<div class="eqh-tile-sub">Review &amp; approve</div>' +
          '</div>' +
        '</button>' +
        '<button class="eqh-tile eqh-t-leave" onclick="eqhsTileTap(\'leave\')" aria-label="Leave">' +
          '<div class="eqh-tile-icon" aria-hidden="true">✈</div>' +
          '<div>' +
            '<div class="eqh-tile-title">Leave</div>' +
            '<div class="eqh-tile-sub">Requests &amp; balance</div>' +
          '</div>' +
        '</button>' +
        prestartTile +
        '<button class="eqh-tile eqh-t-schedule" onclick="eqhsTileTap(\'contacts\')" aria-label="Team">' +
          '<div class="eqh-tile-icon" aria-hidden="true">👥</div>' +
          '<div>' +
            '<div class="eqh-tile-title">Team</div>' +
            '<div class="eqh-tile-sub">Roster &amp; contacts</div>' +
          '</div>' +
        '</button>' +
        '<button class="eqh-tile eqh-t-time" onclick="eqhsTileTap(\'dashboard\')" aria-label="Reports">' +
          '<div class="eqh-tile-icon" aria-hidden="true">📊</div>' +
          '<div>' +
            '<div class="eqh-tile-title">Reports</div>' +
            '<div class="eqh-tile-sub">Weekly hours &amp; site</div>' +
          '</div>' +
        '</button>' +
      '</div>' +
      '<div class="eqh-footer">EQ Field · v' + escapeHtml(version) + ' · Supervisor</div>';

    // Analytics — distinct event name so we can A/B compare to staff home.
    try {
      if (window.EQ_ANALYTICS && window.EQ_ANALYTICS.events && window.EQ_ANALYTICS.events.pageViewed) {
        window.EQ_ANALYTICS.events.pageViewed({ page: 'home-supervisor' });
      }
    } catch (e) { /* never break boot */ }
  }

  // ── Tile tap router (supervisor) ────────────────────────────

  function eqhsTileTap(target) {
    try {
      if (window.EQ_ANALYTICS && window.EQ_ANALYTICS.capture) {
        window.EQ_ANALYTICS.capture('home_supervisor_tile_tapped', { tile: target });
      }
    } catch (e) {}
    if (typeof window.showPage === 'function') window.showPage(target);
  }

  // ── Supervisor cog drawer (richer than staff drawer) ────────

  function buildSupervisorDrawer() {
    let host = document.getElementById('eqhs-drawer');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'eqhs-drawer';
    host.className = 'eqh-drawer';
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.setAttribute('aria-label', 'Supervisor options');
    host.innerHTML =
      '<div class="eqh-drawer-sheet" onclick="event.stopPropagation()">' +
        '<div class="eqh-drawer-handle"></div>' +
        '<div class="eqh-drawer-title">More</div>' +
        '<button class="eqh-drawer-item" onclick="eqhsCloseDrawer();showPage(\'editor\')"><span class="eqh-drawer-item-icon">✎</span> Edit roster</button>' +
        '<button class="eqh-drawer-item" onclick="eqhsCloseDrawer();showPage(\'contacts\')"><span class="eqh-drawer-item-icon">👥</span> Contacts</button>' +
        '<button class="eqh-drawer-item" onclick="eqhsCloseDrawer();showPage(\'sites\')"><span class="eqh-drawer-item-icon">📍</span> Sites</button>' +
        '<button class="eqh-drawer-item" onclick="eqhsCloseDrawer();showPage(\'jobnumbers\')"><span class="eqh-drawer-item-icon">#</span> Job numbers</button>' +
        '<button class="eqh-drawer-item" onclick="eqhsCloseDrawer();showPage(\'apprentices\')"><span class="eqh-drawer-item-icon">🎓</span> Apprentices</button>' +
        '<button class="eqh-drawer-item" onclick="eqhsCloseDrawer();showPage(\'managers\')"><span class="eqh-drawer-item-icon">🛡</span> Supervision</button>' +
        '<button class="eqh-drawer-item" onclick="eqhsCloseDrawer();showPage(\'data\')"><span class="eqh-drawer-item-icon">⇅</span> Import / Export</button>' +
        '<button class="eqh-drawer-item" onclick="eqhsCloseDrawer();showPage(\'help\')"><span class="eqh-drawer-item-icon">❓</span> Help</button>' +
        '<button class="eqh-drawer-item" onclick="eqhsCloseDrawer();if(typeof openAuditLog===\'function\')openAuditLog()"><span class="eqh-drawer-item-icon">📜</span> Audit log</button>' +
        '<button class="eqh-drawer-item" onclick="eqhsCloseDrawer();if(typeof openPrivacyNotice===\'function\')openPrivacyNotice()"><span class="eqh-drawer-item-icon">🔒</span> Privacy notice</button>' +
        '<button class="eqh-drawer-item" onclick="eqhsCloseDrawer();if(typeof logoutUser===\'function\')logoutUser()"><span class="eqh-drawer-item-icon">↪</span> Log out</button>' +
        '<button class="eqh-drawer-close" onclick="eqhsCloseDrawer()">Close</button>' +
      '</div>';
    host.addEventListener('click', function () { eqhsCloseDrawer(); });
    document.body.appendChild(host);
    return host;
  }

  function eqhsOpenDrawer() {
    const host = buildSupervisorDrawer();
    host.classList.add('open');
    try {
      if (window.EQ_ANALYTICS && window.EQ_ANALYTICS.capture) {
        window.EQ_ANALYTICS.capture('home_supervisor_cog_opened', {});
      }
    } catch (e) {}
  }

  function eqhsCloseDrawer() {
    const host = document.getElementById('eqhs-drawer');
    if (host) host.classList.remove('open');
  }

  // ── Online/offline re-render ────────────────────────────────

  window.addEventListener('online',  function () {
    if (typeof currentPage !== 'undefined' && currentPage === 'home' &&
        typeof isManager !== 'undefined' && isManager) renderSupervisorHomeScreen();
  });
  window.addEventListener('offline', function () {
    if (typeof currentPage !== 'undefined' && currentPage === 'home' &&
        typeof isManager !== 'undefined' && isManager) renderSupervisorHomeScreen();
  });

  // ── Expose ───────────────────────────────────────────────────
  window.renderSupervisorHomeScreen = renderSupervisorHomeScreen;
  window.eqhsTileTap                = eqhsTileTap;
  window.eqhsActionStripTap         = eqhsActionStripTap;
  window.eqhsOpenDrawer             = eqhsOpenDrawer;
  window.eqhsCloseDrawer            = eqhsCloseDrawer;
})();

// ─────────────────────────────────────────────────────────────
// PROMOTION CHECKLIST (when ready to ship as v3.5.1)
// ─────────────────────────────────────────────────────────────
//
// Option A — extend scripts/home.js (recommended):
//   1. Move the helpers from this file into scripts/home.js (most
//      already exist there — only the supervisor-specific ones move:
//      countPendingLeave, countTimesheetsToReview, countPrestartsToSign,
//      describeScheduleThisWeek, actionStripHTML, buildSupervisorDrawer).
//   2. Rename renderSupervisorHomeScreen → make renderHomeScreen() do
//      `if (isManager) renderSupervisorBody(); else renderStaffBody();`.
//   3. Same approach for cog drawer — one function, role branch.
//   4. Update the initApp() routing in index.html to allow isManager
//      to take the home path too (currently restricted to !isManager).
//   5. Add a 'home_screen_v1' supervisor variant in PostHog OR a
//      second flag 'home_screen_supervisor_v1' for staged rollout.
//
// Option B — separate file scripts/home-supervisor.js:
//   1. Copy this file to scripts/home-supervisor.js (drop the
//      promotion checklist comment).
//   2. Add <script src="scripts/home-supervisor.js"> to index.html
//      after home.js.
//   3. Add /scripts/home-supervisor.js to sw.js PRECACHE.
//   4. Update initApp() routing: if (isManager && mobile && flag)
//      showPage('home') then renderSupervisorHomeScreen via the
//      renderCurrentPage dispatch.
//   5. Update renderCurrentPage to branch on isManager when
//      currentPage === 'home'.
//
// Data schema confirmation needed before either path:
//   - STATE.leaveRequests row shape — confirm `status` field values
//     ('pending' vs 'submitted' vs 'awaiting_approval').
//   - STATE.timesheets row shape — confirm review fields
//     (submitted_at / reviewed_at / approved_at exist; if not, fall
//     back to a heuristic like `total_hours_set_at && !reviewed_at`).
//   - STATE.prestarts row shape — confirm the signed_by_supervisor_id
//     field name (might be signed_by, supervisor_sig_id, etc).
//
// Version bump plan: v3.5.0 → v3.5.1.
// ─────────────────────────────────────────────────────────────
