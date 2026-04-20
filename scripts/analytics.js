// ─────────────────────────────────────────────────────────────
// scripts/analytics.js  —  EQ Solves Field
// PostHog (events, funnels, cohorts) + Microsoft Clarity (session
// replay, heatmaps). Plain JS, no bundler. Matches load style of
// app-state.js / leave.js / people.js.
//
// Load order: AFTER app-state.js (needs APP_VERSION and _detectTenantSlug
// helpers from there), BEFORE any other script that may want to
// call window.EQ_ANALYTICS.*.
//
// Plan ref: eq-context/docs/EQ_Analytics_Install_Plan_v2.md §3.1, §5.1
// ─────────────────────────────────────────────────────────────

// ── Per-hostname config ───────────────────────────────────────
// PostHog + Clarity keys are public (safe to embed in frontend).
// Kept as real-file config here to mirror TENANT_SUPABASE in
// app-state.js — demo vs prod switches automatically by hostname.
//
// REPLACE the phc_... and 10-char Clarity IDs once the accounts
// are created (see eq-analytics-v2/README.md).
const _ANALYTICS_CONFIG = {
  // EQ demo — posthog project `eq-development`, clarity `eq-field-demo`
  eq: {
    posthogKey:  'phc_zXpRxm6QUbLBZKLcSXd5CvtPJCipQkuMELRZzyDgxFB7',
    posthogHost: 'https://eu.i.posthog.com',
    clarityId:   'wek7yeida5',
    appEnv:      'demo',
  },
  // SKS prod — posthog project `eq-production`, clarity `eq-field-sks`
  sks: {
    posthogKey:  'phc_vM4Hrh7QhjsUqHRb2xC7LbqSqMsB5tLQqwSApkpEVPnU',
    posthogHost: 'https://eu.i.posthog.com',
    clarityId:   'wek8dmtbuu',
    appEnv:      'production',
  },
};

// ── Module state ──────────────────────────────────────────────
let _initialised = false;
let _identified  = false;
let _config      = null;

// ── Init ──────────────────────────────────────────────────────
function _initAnalytics() {
  if (_initialised) return;

  // Resolve tenant slug using the same detection helper as Supabase.
  // Falls back to 'eq' (demo) if the helper isn't available.
  const slug = (typeof _detectTenantSlug === 'function')
    ? _detectTenantSlug()
    : 'eq';

  _config = _ANALYTICS_CONFIG[slug] || _ANALYTICS_CONFIG.eq;

  // Guard: skip init if keys are still placeholders. Avoids posting
  // junk to a nonexistent PostHog project before keys are filled in.
  if (String(_config.posthogKey).indexOf('REPLACE_ME') !== -1) {
    console.warn('[analytics] placeholder keys — skipping init (fill in scripts/analytics.js)');
    return;
  }

  // ── PostHog array.js snippet (standard official loader) ─────
  // See https://posthog.com/docs/libraries/js — minified form.
  (function (t, e) {
    var o, n, p, r;
    if (!e.__SV) {
      window.posthog = e; e._i = [];
      e.init = function (i, s, a) {
        function g(t, e) {
          var o = e.split('.');
          2 == o.length && (t = t[o[0]], e = o[1]);
          t[e] = function () { t.push([e].concat(Array.prototype.slice.call(arguments, 0))); };
        }
        p = t.createElement('script'); p.type = 'text/javascript'; p.async = !0;
        p.src = s.api_host.replace('.i.posthog.com', '-assets.i.posthog.com') + '/static/array.js';
        r = t.getElementsByTagName('script')[0]; r.parentNode.insertBefore(p, r);
        var u = e; for (void 0 !== a ? u = e[a] = [] : a = 'posthog', u.people = u.people || [],
          u.toString = function (t) {
            var e = 'posthog'; return 'posthog' !== a && (e += '.' + a), t || (e += ' (stub)'), e;
          }, u.people.toString = function () { return u.toString(1) + '.people (stub)'; },
          o = 'init me ws ys ps bs capture je Di ks register register_once register_for_session unregister unregister_for_session Ps getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty Es $s createPersonProfile Is opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing Ss debug I As getPageViewId captureTraceFeedback captureTraceMetric'.split(' '),
          n = 0; n < o.length; n++) g(u, o[n]);
        e._i.push([i, s, a]);
      };
      e.__SV = 1;
    }
  })(document, window.posthog || []);

  // Read persisted distinct ID so anonymous → identified link survives
  // offline/reconnect cycles (PWA behaviour). PostHog merges the anonymous
  // ID into the identified profile when it reconnects.
  var bootstrapDistinctId = null;
  try { bootstrapDistinctId = localStorage.getItem('eq:analytics:userId'); } catch (e) {}

  window.posthog.init(_config.posthogKey, {
    api_host:                      _config.posthogHost,
    person_profiles:               'identified_only',
    capture_pageview:              true,
    capture_pageleave:             true,
    autocapture:                   true,
    disable_session_recording:     false,
    mask_all_text:                 false,
    mask_all_element_attributes:   false,
    bootstrap: bootstrapDistinctId
      ? { distinctID: bootstrapDistinctId, token: _config.posthogKey }
      : undefined,
  });

  window.posthog.register({
    app:        'eq-field',
    app_env:    _config.appEnv,
    tenant:     slug,
    app_version: (typeof APP_VERSION !== 'undefined' ? APP_VERSION : null),
  });

  // ── Microsoft Clarity loader ───────────────────────────────
  // Skip if Clarity ID is still a placeholder (accounts not created yet).
  // PostHog stays active — Clarity is optional.
  if (String(_config.clarityId).indexOf('REPLACE_ME') === -1) {
    (function (c, l, a, r, i) {
      c[a] = c[a] || function () { (c[a].q = c[a].q || []).push(arguments); };
      var t = l.createElement(r); t.async = 1; t.src = 'https://www.clarity.ms/tag/' + i;
      var y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
    })(window, document, 'clarity', 'script', _config.clarityId);
  } else {
    console.info('[analytics] Clarity ID is a placeholder — skipping Clarity init (PostHog active)');
  }

  // ── Global error hooks — covers render errors AND async failures ──
  // Safe to register here since analytics.js loads early. Only fires
  // error_thrown when analytics is initialised to keep the before-init
  // window silent.
  window.addEventListener('error', function (ev) {
    _track('error_thrown', {
      context:  'window_error',
      message:  (ev && ev.message) || String(ev),
      filename: ev && ev.filename,
      lineno:   ev && ev.lineno,
      colno:    ev && ev.colno,
    });
  });
  window.addEventListener('unhandledrejection', function (ev) {
    _track('error_thrown', {
      context: 'unhandled_promise',
      message: (ev && ev.reason && (ev.reason.message || String(ev.reason))) || 'unknown',
    });
  });

  _initialised = true;
}

// ── Identify ──────────────────────────────────────────────────
// Call after PIN login succeeds. Props:
//   userId       — tenant:handle, e.g. 'sks:royce.milmlow'
//   tenantId     — Supabase UUID from TENANT.ORG_UUID (or slug as fallback)
//   role         — 'tradie' | 'supervisor' | 'admin'
//   appVersion   — APP_VERSION global
//   analyticsEnabled — optional; pass false to opt-out this user
function _identify(props) {
  if (!_initialised) return;
  props = props || {};

  // Tenant / user opt-out — disable capture in both tools and stop here.
  if (props.analyticsEnabled === false) {
    if (window.posthog && window.posthog.opt_out_capturing) window.posthog.opt_out_capturing();
    if (typeof window.clarity === 'function') window.clarity('consent', false);
    return;
  }

  // Persist for PWA bootstrap on next cold load.
  try { localStorage.setItem('eq:analytics:userId', props.userId); } catch (e) {}

  if (window.posthog && window.posthog.identify) {
    window.posthog.identify(props.userId, {
      tenant_id:   props.tenantId,
      role:        props.role,
      app_version: props.appVersion || (typeof APP_VERSION !== 'undefined' ? APP_VERSION : null),
    });
    if (window.posthog.group) window.posthog.group('tenant', props.tenantId);
  }

  if (typeof window.clarity === 'function') {
    window.clarity('identify', props.userId, undefined, undefined, props.tenantId);
    window.clarity('set', 'role',        props.role);
    window.clarity('set', 'tenant',      props.tenantId);
    window.clarity('set', 'app_version', props.appVersion || (typeof APP_VERSION !== 'undefined' ? APP_VERSION : null));
  }

  _identified = true;
}

// ── Track ────────────────────────────────────────────────────
function _track(event, props) {
  if (!_initialised) return;
  try {
    if (window.posthog && window.posthog.capture) {
      window.posthog.capture(event, props || {});
    }
  } catch (e) {
    // Never let analytics errors break the host app.
    if (window.console) console.warn('[analytics] capture failed', e);
  }
}

// ── Reset (on logout) ─────────────────────────────────────────
function _reset() {
  try { localStorage.removeItem('eq:analytics:userId'); } catch (e) {}
  if (window.posthog && window.posthog.reset) window.posthog.reset();
  _identified = false;
}

// ── Day-one event helpers ─────────────────────────────────────
// See plan §5.1. Keep the taxonomy tight: 11 events. Don't add more
// without updating the doc. Call sites fire via EQ_ANALYTICS.events.*.
const _events = {
  sessionStarted: function (p) {
    _track('session_started', {
      device_type:   (p && p.device_type)   || _deviceTypeGuess(),
      pwa_installed: (p && p.pwa_installed) || _isPwaInstalled(),
    });
  },

  timesheetViewed: function (p) {
    _track('timesheet_viewed', {
      week_of:           p && p.week_of,
      entries_existing:  (p && p.entries_existing) || 0,
    });
  },

  timesheetEntryCreated: function (p) {
    _track('timesheet_entry_created', {
      hours:         p && p.hours,
      has_job_code:  !!(p && p.has_job_code),
      entry_method:  (p && p.entry_method) || 'manual',
    });
  },

  leaveRequestSubmitted: function (p) {
    _track('leave_request_submitted', {
      leave_type:     p && p.leave_type,
      days_requested: p && p.days_requested,
    });
  },

  rosterViewed: function (p) {
    _track('roster_viewed', {
      week_of:      p && p.week_of,
      people_count: (p && p.people_count) || 0,
    });
  },

  peopleModalOpened: function (p) {
    _track('people_modal_opened', { mode: (p && p.mode) || 'add' });
  },

  peopleModalSaved: function (p) {
    _track('people_modal_saved', {
      mode:                (p && p.mode) || 'add',
      has_apprentice_year: !!(p && p.has_apprentice_year),
    });
  },

  csvExported: function (p) {
    _track('csv_exported', { export_type: p && p.export_type });
  },

  pinLoginSucceeded: function (p) {
    _track('pin_login_succeeded', { role: p && p.role });
  },

  pinLoginFailed: function (p) {
    _track('pin_login_failed', { attempt_count: (p && p.attempt_count) || 1 });
  },
};

// ── Small helpers ─────────────────────────────────────────────
function _deviceTypeGuess() {
  try {
    var ua = navigator.userAgent || '';
    if (/iPad|Android(?!.*Mobile)|Tablet/i.test(ua)) return 'tablet';
    if (/Mobi|Android/i.test(ua)) return 'mobile';
    return 'desktop';
  } catch (e) { return 'unknown'; }
}

function _isPwaInstalled() {
  try {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
           (window.navigator && window.navigator.standalone === true);
  } catch (e) { return false; }
}

// ── Public namespace ──────────────────────────────────────────
window.EQ_ANALYTICS = {
  init:     _initAnalytics,
  identify: _identify,
  track:    _track,
  reset:    _reset,
  events:   _events,
};

// Auto-init on script load. Safe — guarded by _initialised flag, and
// the inner guard skips when placeholder keys are still in place.
_initAnalytics();
