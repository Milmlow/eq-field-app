/*! Property of EQ — all rights reserved. Unauthorised use prohibited. */
// ─────────────────────────────────────────────────────────────
// scripts/site-reports-hub.js  —  EQ Solves Field
// v3.5.2 — Site Reports HUB landing page.
//
// Collapses the three sibling sidebar entries (Prestart, Toolbox,
// Diary) into one "Site Reports" entry. Tap the entry → land on a
// status-card grid showing today/week activity per workflow. Each
// card taps through into that workflow's existing list view.
//
// Cards (per the v3.5.0 mobile-first brief):
//   - Prestart · N today
//   - Toolbox  · N this week
//   - Diary    · N today
//
// Counts come from small accessors added to each workflow module:
//   window.eqGetPrestartsTodayCount()
//   window.eqGetToolboxWeekCount()
//   window.eqGetDiariesTodayCount()
//
// The cards always render. The underlying pages enforce their own
// permission gate (reports.{prestart,toolbox,diary}.view), so an
// unprivileged user tapping a card just lands on the workflow's
// existing "Supervision access required" empty state.
//
// SKS tenant gating: prestarts may be hidden via
// TENANT_DISABLED_TABLES.sks. When that's the case the Prestart
// card is suppressed; Toolbox + Diary still render.
//
// Public API:
//   window.renderSiteReportsHub()   — main render
//   window.eqhubTileTap(target)     — card tap router
//
// Load order: AFTER site-reports.js, toolbox.js, diary.js (so the
// count accessors exist). Plain JS, no bundler.
// ─────────────────────────────────────────────────────────────

(function () {
  'use strict';

  function isPrestartAllowedHere() {
    try {
      const slug = (window.TENANT && TENANT.ORG_SLUG) ? TENANT.ORG_SLUG : 'eq';
      if (slug !== 'sks') return true;
      const disabled = (window.TENANT_DISABLED_TABLES && TENANT_DISABLED_TABLES.sks) || [];
      return disabled.indexOf('prestarts') === -1;
    } catch (e) { return true; }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeCount(fnName) {
    try {
      if (typeof window[fnName] === 'function') return window[fnName]();
    } catch (e) { /* swallow */ }
    return 0;
  }

  // Inject the HUB-only style block once. Scoped to #page-site-reports
  // so nothing leaks into the rest of the app.
  function injectStyleOnce() {
    if (document.getElementById('eq-site-reports-hub-style')) return;
    const css = '' +
      '#page-site-reports .eqhub-header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border);background:var(--surface)}' +
      '#page-site-reports .eqhub-title{font-size:14px;font-weight:700;color:var(--ink)}' +
      '#page-site-reports .eqhub-sub{font-size:11px;color:var(--ink-3);margin-top:2px}' +
      '#page-site-reports .eqhub-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;padding:14px 18px}' +
      '#page-site-reports .eqhub-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px;cursor:pointer;text-align:left;font-family:inherit;display:flex;flex-direction:column;gap:8px;min-height:120px;transition:transform .1s;box-shadow:var(--shadow-sm)}' +
      '#page-site-reports .eqhub-card:active{transform:scale(.99)}' +
      '#page-site-reports .eqhub-card:focus-visible{outline:2px solid var(--blue);outline-offset:2px}' +
      '#page-site-reports .eqhub-card-head{display:flex;align-items:center;gap:10px}' +
      '#page-site-reports .eqhub-card-icon{width:36px;height:36px;border-radius:var(--radius);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}' +
      '#page-site-reports .eqhub-card-icon.prestart{background:var(--amber-lt);color:var(--amber)}' +
      '#page-site-reports .eqhub-card-icon.toolbox {background:var(--purple-lt);color:var(--purple)}' +
      '#page-site-reports .eqhub-card-icon.diary   {background:var(--blue-lt);color:var(--blue)}' +
      '#page-site-reports .eqhub-card-name{font-size:14px;font-weight:600;color:var(--ink)}' +
      '#page-site-reports .eqhub-card-count{font-size:28px;font-weight:700;color:var(--ink);letter-spacing:-.5px;line-height:1}' +
      '#page-site-reports .eqhub-card-when{font-size:11px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.4px;margin-top:2px}' +
      '#page-site-reports .eqhub-card-chev{margin-left:auto;color:var(--ink-4);font-size:18px}' +
      '#page-site-reports .eqhub-empty{padding:24px 18px;color:var(--ink-3);font-size:13px;text-align:center}' +
      '';
    const tag = document.createElement('style');
    tag.id = 'eq-site-reports-hub-style';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  function cardHTML(opts) {
    return '<button class="eqhub-card" onclick="eqhubTileTap(\'' + opts.target + '\')" aria-label="' + escapeHtml(opts.name) + ' — ' + escapeHtml(opts.whenLabel) + '">' +
             '<div class="eqhub-card-head">' +
               '<div class="eqhub-card-icon ' + opts.iconClass + '" aria-hidden="true">' + opts.icon + '</div>' +
               '<div class="eqhub-card-name">' + escapeHtml(opts.name) + '</div>' +
               '<span class="eqhub-card-chev" aria-hidden="true">›</span>' +
             '</div>' +
             '<div>' +
               '<div class="eqhub-card-count">' + opts.count + '</div>' +
               '<div class="eqhub-card-when">' + escapeHtml(opts.whenLabel) + '</div>' +
             '</div>' +
           '</button>';
  }

  function renderSiteReportsHub() {
    const el = document.getElementById('page-site-reports');
    if (!el) return;

    injectStyleOnce();

    const prestartToday = safeCount('eqGetPrestartsTodayCount');
    const toolboxWeek   = safeCount('eqGetToolboxWeekCount');
    const diaryToday    = safeCount('eqGetDiariesTodayCount');
    const showPrestart  = isPrestartAllowedHere();

    const cards = [];
    if (showPrestart) {
      cards.push(cardHTML({
        target:    'prestart',
        name:      'Prestart',
        icon:      '⚠',
        iconClass: 'prestart',
        count:     prestartToday,
        whenLabel: prestartToday === 1 ? 'briefing today' : 'briefings today',
      }));
    }
    cards.push(cardHTML({
      target:    'toolbox',
      name:      'Toolbox',
      icon:      '🔧',
      iconClass: 'toolbox',
      count:     toolboxWeek,
      whenLabel: toolboxWeek === 1 ? 'talk this week' : 'talks this week',
    }));
    cards.push(cardHTML({
      target:    'diary',
      name:      'Diary',
      icon:      '📔',
      iconClass: 'diary',
      count:     diaryToday,
      whenLabel: diaryToday === 1 ? 'entry today' : 'entries today',
    }));

    el.innerHTML =
      '<div class="eqhub-header">' +
        '<div>' +
          '<div class="eqhub-title">Site Reports</div>' +
          '<div class="eqhub-sub">Prestart briefings, toolbox talks, and daily site diaries</div>' +
        '</div>' +
      '</div>' +
      '<div class="eqhub-grid">' + cards.join('') + '</div>';
  }

  function eqhubTileTap(target) {
    try {
      if (window.EQ_ANALYTICS && window.EQ_ANALYTICS.capture) {
        window.EQ_ANALYTICS.capture('site_reports_hub_card_tapped', { target: target });
      }
    } catch (e) { /* swallow */ }
    if (typeof window.showPage === 'function') window.showPage(target);
  }

  window.renderSiteReportsHub = renderSiteReportsHub;
  window.eqhubTileTap         = eqhubTileTap;
})();
