/*! Property of EQ — all rights reserved. Unauthorised use prohibited. */
// ─────────────────────────────────────────────────────────────
// scripts/permissions.js  —  EQ Solves Field
// Per-role permission gate. Reads matrix from window.EQ_PERMISSIONS
// (loaded by scripts/permission-matrix.js) and current role from the
// session.
//
// Today (pre-Phase-2): role is binary (supervisor / non-supervisor)
// inferred from auth.js's sessionStorage flag `eq_auto_admin`.
// Future (post-Phase-2): role comes from the JWT's
// app_metadata.eq_role claim. Both paths are supported here so the
// helper keeps working through the migration.
//
// Load order: AFTER permission-matrix.js. No hard dep on auth.js
// load order — getRole() reads sessionStorage lazily on each call.
//
// Usage:
//   if (window.EQ_PERMS.can('ph.view_dashboard')) { ... }
//
// Plan ref: MULTI-TENANCY-PLAN.md §Phase 1 — Step 1.5
// ─────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // ── Phase C role resolution (v3.4.67) ─────────────────────
  // Resolve the current user's full role tier from the `people.role`
  // column (populated by the eq_role enum migration applied to both
  // EQ + SKS Supabase on 2026-05-13). Falls back gracefully if:
  //   • the user's name doesn't match a people row (e.g. demo SEED
  //     names that don't exist in DB)
  //   • Supabase isn't reachable
  //   • we're on the SEED-only EQ demo tenant
  //   • the role column doesn't exist yet (pre-migration safety)
  //
  // PIN-unlock-wins rule: if isManager is true (the supervisor PIN
  // has been entered), role is forced to 'supervisor'. This preserves
  // today's behaviour — anyone who knows the PIN gets supervisor view.
  // Phase D will tighten this when server-side enforcement ships.
  function resolveSessionRole() {
    try {
      // Read name from auth state.
      var name = (typeof currentManagerName !== 'undefined' && currentManagerName)
        ? currentManagerName
        : ((typeof sessionStorage !== 'undefined' && sessionStorage.getItem('eq_logged_in_name')) || '');
      if (!name) return null;

      // PIN-unlock wins — always supervisor when unlocked.
      var pinUnlocked = (typeof isManager !== 'undefined' && isManager === true);

      var slug = (typeof TENANT !== 'undefined' && TENANT.ORG_SLUG) || 'eq';
      var role = null;
      var source = null;

      // Path 1 — real tenant with Supabase: look up people.role by name.
      // STATE.people is populated by loadFromSupabase before initApp
      // calls us, so a synchronous lookup here is correct.
      if (typeof STATE !== 'undefined' && Array.isArray(STATE.people)) {
        for (var i = 0; i < STATE.people.length; i++) {
          var p = STATE.people[i];
          if (p && p.name === name) {
            if (p.role) { role = p.role; source = 'db'; }
            // Fallback derive from group when role column is absent
            // (SEED data, or tenants where the migration hasn't run yet).
            else if (p.group === 'Apprentice')    { role = 'apprentice';  source = 'group'; }
            else if (p.group === 'Labour Hire')   { role = 'labour_hire'; source = 'group'; }
            else                                  { role = 'employee';    source = 'group'; }
            break;
          }
        }
      }

      // Path 2 — name not in people (likely a supervisor-only profile, or
      // a SEED demo manager). Fall back based on PIN state.
      if (!role) {
        role = pinUnlocked ? 'supervisor' : 'employee';
        source = 'fallback';
      }

      // PIN-unlock-wins override.
      if (pinUnlocked && role !== 'manager') {
        role = 'supervisor';
        source = source + '+pin';
      }

      window.EQ_SESSION = window.EQ_SESSION || {};
      window.EQ_SESSION.role = role;
      window.EQ_SESSION.role_source = source;
      window.EQ_SESSION.name = name;
      window.EQ_SESSION.tenant = slug;
      console.info('[EQ_PERMS] role resolved', { role: role, source: source, name: name, tenant: slug });
      return role;
    } catch (e) {
      console.warn('[EQ_PERMS] resolveSessionRole failed:', e && e.message || e);
      return null;
    }
  }

  // Resolve current role. Order of preference:
  //   1. EQ_SESSION.role  (v3.4.67 — set by resolveSessionRole after login)
  //   2. JWT app_metadata.eq_role  (Phase D — not yet present)
  //   3. window.isManager === true  (today's fallback: supervisor PIN-unlocked)
  //   4. sessionStorage.eq_auto_admin === '1'  (one-shot login window)
  //   5. sessionStorage.eq_session_token present  (logged-in employee)
  //   6. Otherwise null (logged out — no permissions)
  function getRole() {
    // Phase C path — set by resolveSessionRole after login completes.
    try {
      if (window.EQ_SESSION && window.EQ_SESSION.role) {
        return window.EQ_SESSION.role;
      }
    } catch (_) { /* noop */ }

    // Phase D path — read from a parsed JWT if auth.js exposes one.
    try {
      if (window.EQ_SESSION && window.EQ_SESSION.app_metadata
          && window.EQ_SESSION.app_metadata.eq_role) {
        return window.EQ_SESSION.app_metadata.eq_role;
      }
    } catch (_) { /* noop */ }

    // Today path — primary check is the `isManager` global declared in
    // app-state.js and flipped true by index.html after a supervisor
    // PIN entry. Persists for the page lifetime, so EQ_PERMS.can() stays
    // accurate after the one-shot eq_auto_admin flag is consumed.
    try {
      if (typeof isManager !== 'undefined' && isManager === true) return 'supervisor';
    } catch (_) { /* isManager may be temporal-dead-zone if loaded too early */ }

    // Login moment, before isManager is set.
    try {
      if (sessionStorage.getItem('eq_auto_admin') === '1') return 'supervisor';
      if (sessionStorage.getItem('eq_session_token'))      return 'employee';
    } catch (_) { /* sessionStorage may throw in private mode */ }

    return null;
  }

  function can(permKey) {
    var role = getRole();
    if (!role) return false;
    var matrix = window.EQ_PERMISSIONS || {};
    var allowed = matrix[role] || [];
    for (var i = 0; i < allowed.length; i++) {
      if (allowed[i] === permKey) return true;
    }
    return false;
  }

  // List all permission keys for the current role — useful for debugging
  // or for batch-rendering a settings screen.
  function list() {
    var role = getRole();
    if (!role) return [];
    var matrix = window.EQ_PERMISSIONS || {};
    return (matrix[role] || []).slice();
  }

  window.EQ_PERMS = {
    can:     can,
    role:    getRole,
    list:    list,
    resolve: resolveSessionRole
  };
})();
