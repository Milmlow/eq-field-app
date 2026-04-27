/*! Property of EQ — all rights reserved. Unauthorised use prohibited. */
// ─────────────────────────────────────────────────────────────
// scripts/project-hours.js  —  EQ Solves Field
// "Project Hours" burn-down panel. Self-mounting — does nothing
// until two gates open:
//   1. PostHog flag feat_project_hours_v1 is enabled for this user
//   2. EQ_PERMS.can('ph.view_dashboard') is true
//
// Until both are true, the placeholder div stays hidden and no DB
// queries fire. Safe to ship before the migration is applied —
// graceful empty/coming-soon state on column-missing errors.
//
// Load order: AFTER flags.js, permissions.js, supabase.js, auth.js.
//
// Plan ref: MULTI-TENANCY-PLAN.md §Phase 1 — Step 1.2
// ─────────────────────────────────────────────────────────────

(function () {
  'use strict';

  var PANEL_ID   = 'project-hours-panel';
  var CONTENT_ID = 'project-hours-content';
  var FLAG_KEY   = 'feat_project_hours_v1';
  var PERM_KEY   = 'ph.view_dashboard';

  function gateOk() {
    if (!window.EQ_FLAGS || !window.EQ_FLAGS.isEnabled(FLAG_KEY)) return false;
    if (!window.EQ_PERMS || !window.EQ_PERMS.can(PERM_KEY))      return false;
    return true;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  function fmtNum(n, decimals) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toFixed(decimals == null ? 1 : decimals);
  }

  // Returns: { sites: [...] } | { error: string, kind: 'migration' | 'network' | 'unknown' }
  async function loadData() {
    if (typeof sbFetch !== 'function') {
      return { error: 'Supabase client not ready', kind: 'unknown' };
    }
    try {
      var sites = await sbFetch(
        'sites?select=id,name,track_hours,budget_hours&track_hours=eq.true&order=name'
      );
      if (!Array.isArray(sites)) {
        // sbFetch sometimes returns [] on disabled tables — treat as empty
        return { sites: [] };
      }

      // Aggregate timesheet hours per tracked site. Client-side for v1;
      // server-side view comes when the feature graduates from gated.
      var results = [];
      for (var i = 0; i < sites.length; i++) {
        var site = sites[i];
        var ts;
        try {
          ts = await sbFetch('timesheets?select=hours&site_id=eq.' + encodeURIComponent(site.id));
        } catch (_) { ts = []; }
        var used = 0;
        if (Array.isArray(ts)) {
          for (var j = 0; j < ts.length; j++) {
            var h = Number(ts[j].hours);
            if (!isNaN(h)) used += h;
          }
        }
        var budget = site.budget_hours == null ? null : Number(site.budget_hours);
        var remaining = budget == null ? null : budget - used;
        var pct = (budget && budget > 0) ? (used / budget) * 100 : null;
        results.push({
          id: site.id,
          name: site.name,
          budget: budget,
          used: used,
          remaining: remaining,
          percent: pct
        });
      }
      return { sites: results };
    } catch (e) {
      var msg = (e && e.message) || String(e);
      // Heuristic: if the error mentions track_hours, the migration
      // hasn't been applied yet. Show a graceful "coming soon" state.
      if (msg.indexOf('track_hours') !== -1 || msg.indexOf('budget_hours') !== -1) {
        return { error: msg, kind: 'migration' };
      }
      return { error: msg, kind: 'network' };
    }
  }

  function renderEmpty(content, message) {
    content.innerHTML =
      '<p style="color:#666666; padding:16px 0; font-size:14px">' +
      escapeHtml(message) +
      '</p>';
  }

  function renderTable(content, sites) {
    if (!sites || sites.length === 0) {
      renderEmpty(content,
        'No sites are currently tracking hours. Tick "Track hours" on a site (and set a budget) to see it here.'
      );
      return;
    }
    var html = '';
    html += '<table style="width:100%; border-collapse:collapse; font-size:14px">';
    html += '<thead><tr style="border-bottom:1px solid #e5e7eb">';
    html += '<th style="text-align:left; padding:10px 8px; font-weight:600">Site</th>';
    html += '<th style="text-align:right; padding:10px 8px; font-weight:600">Budget</th>';
    html += '<th style="text-align:right; padding:10px 8px; font-weight:600">Used</th>';
    html += '<th style="text-align:right; padding:10px 8px; font-weight:600">Remaining</th>';
    html += '<th style="text-align:right; padding:10px 8px; font-weight:600">% used</th>';
    html += '</tr></thead><tbody>';
    for (var i = 0; i < sites.length; i++) {
      var s = sites[i];
      var pctClass = '';
      if (s.percent != null) {
        if (s.percent >= 100)      pctClass = 'color:#c53030';   // over budget
        else if (s.percent >= 80)  pctClass = 'color:#dd6b20';   // warning
        else                       pctClass = 'color:#2986b4';   // under budget
      }
      html += '<tr style="border-bottom:1px solid #f0f0f0">';
      html += '<td style="padding:10px 8px">' + escapeHtml(s.name) + '</td>';
      html += '<td style="padding:10px 8px; text-align:right">' + fmtNum(s.budget) + '</td>';
      html += '<td style="padding:10px 8px; text-align:right">' + fmtNum(s.used) + '</td>';
      html += '<td style="padding:10px 8px; text-align:right">' + fmtNum(s.remaining) + '</td>';
      html += '<td style="padding:10px 8px; text-align:right; ' + pctClass + '">' +
              (s.percent == null ? '—' : fmtNum(s.percent, 1) + '%') + '</td>';
      html += '</tr>';
    }
    html += '</tbody></table>';
    content.innerHTML = html;
  }

  async function mount() {
    var panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    if (!gateOk()) {
      panel.hidden = true;
      return;
    }

    panel.hidden = false;
    var content = document.getElementById(CONTENT_ID);
    if (!content) return;

    renderEmpty(content, 'Loading project hours…');

    var result = await loadData();
    if (result.error) {
      if (result.kind === 'migration') {
        renderEmpty(content,
          'Project hours feature is being set up — the schema migration has not yet been applied. ' +
          'Check back shortly.'
        );
      } else {
        renderEmpty(content, 'Could not load project hours: ' + result.error);
      }
      return;
    }
    renderTable(content, result.sites);
  }

  function safeMount() {
    try { mount(); } catch (e) { console.warn('EQ[project-hours]', e); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', safeMount);
  } else {
    setTimeout(safeMount, 0);
  }

  // PostHog may resolve flags after page load. Re-mount when they arrive.
  if (window.posthog && typeof window.posthog.onFeatureFlags === 'function') {
    try { window.posthog.onFeatureFlags(safeMount); } catch (_) { /* noop */ }
  }

  // Public API for explicit re-render after relevant state changes
  // (e.g. after a user ticks track_hours on a site).
  window.EQ_PROJECT_HOURS = { render: safeMount };
})();
