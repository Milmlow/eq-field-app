/*! Property of EQ — all rights reserved. Unauthorised use prohibited. */
// ─────────────────────────────────────────────────────────────
// scripts/flags.js  —  EQ Solves Field
// PostHog feature-flag wrapper. Lets new / risky code paths ship
// behind a kill switch instead of forking the live and demo trees.
// Plain JS, no bundler. Matches load style of analytics.js.
//
// Load order: AFTER analytics.js (depends on window.posthog being
// initialised), BEFORE any script that calls window.EQ_FLAGS.*.
//
// Plan ref: MULTI-TENANCY-PLAN.md §Phase 1 — Step 1.1
// ─────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // Safe defaults applied when PostHog hasn't loaded yet, returns
  // undefined for an unknown flag, or the SDK throws. Default = false
  // means "feature does not exist for this user" — the safe failure
  // mode for any flag that gates new UI or DB queries.
  var DEFAULTS = {
    // 2026-04-27 — flipped on by default while PostHog is unconfigured.
    // EQ_PERMS.can('ph.view_dashboard') still gates visibility to
    // supervisors only, so this is not "everyone sees it" — it's
    // "supervisors see it without needing a PostHog flag". When PostHog
    // is wired up, set this back to false and rely on the flag.
    'feat_project_hours_v1': true,
    // Forward-looking — stay false until Phase 2 fires:
    'mt_tenant_resolver_v2': false,
    'mt_rls_strict':         false,
    'mt_self_serve_signup':  false
  };

  function isEnabled(flagKey) {
    try {
      if (window.posthog && typeof window.posthog.isFeatureEnabled === 'function') {
        var v = window.posthog.isFeatureEnabled(flagKey);
        if (typeof v === 'boolean') return v;
      }
    } catch (_) { /* noop — fall through to default */ }
    return !!DEFAULTS[flagKey];
  }

  // For multivariate flags. fallback used when PostHog hasn't
  // loaded or the flag returns undefined.
  function variant(flagKey, fallback) {
    try {
      if (window.posthog && typeof window.posthog.getFeatureFlag === 'function') {
        var v = window.posthog.getFeatureFlag(flagKey);
        if (v !== undefined) return v;
      }
    } catch (_) { /* noop */ }
    return fallback;
  }

  window.EQ_FLAGS = {
    isEnabled: isEnabled,
    variant:   variant
  };
})();
