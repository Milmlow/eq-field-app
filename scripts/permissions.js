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

  // Resolve current role. Order of preference:
  //   1. JWT app_metadata.eq_role  (Phase 2 onward — not yet present)
  //   2. sessionStorage.eq_auto_admin === '1'  (today: supervisor)
  //   3. sessionStorage.eq_session_token present (today: employee)
  //   4. Otherwise null (logged out — no permissions)
  function getRole() {
    // Phase 2 path — read from a parsed JWT if auth.js exposes one.
    try {
      if (window.EQ_SESSION && window.EQ_SESSION.app_metadata
          && window.EQ_SESSION.app_metadata.eq_role) {
        return window.EQ_SESSION.app_metadata.eq_role;
      }
    } catch (_) { /* noop */ }

    // Today path — derive from existing sessionStorage flags.
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
    can:  can,
    role: getRole,
    list: list
  };
})();
