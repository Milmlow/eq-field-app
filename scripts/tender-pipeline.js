/*! Property of EQ — all rights reserved. Unauthorised use prohibited. */
// ─────────────────────────────────────────────────────────────
// scripts/tender-pipeline.js  —  EQ Solves Field
// Tender Pipeline module — 5 screens:
//   1. /pipeline/import         renderImport()
//   2. /pipeline (kanban)       renderKanban()
//   3. enrichment slide-over    openTenderPanel(tenderId)
//   4. /pipeline/review         renderReview()
//   5. /pipeline/:id/confirm    renderConfirmCurve()
//
// Depends on: app-state.js (TENANT, STATE, sbFetch ORG_TABLES),
//             supabase.js (sbFetch wrapper), analytics.js (events),
//             tender-parser.js (window.EQ_TENDER_PARSER), and
//             SheetJS (window.XLSX) for xlsx parsing.
//
// Plan ref: docs/cowork-prompt-v3.md §"Screens to build"
// Design ref: docs/handover-and-abandonment.md, docs/fortnightly-review-script.md
//
// Versioning: this whole module landed in v3.4.69.
//
// Conventions in this file:
//   - All DB id comparisons use String() coercion (per CLAUDE.md "Don't
//     write === between id fields without String() coercion" — id types
//     drift between SKS bigint and EQ uuid; the pipeline only ships on
//     EQ for now but the coercion habit stays).
//   - Demo tenant ('demo' slug) short-circuits — no network, in-memory.
//     (The actual eq-solves-field tenant is 'eq', NOT 'demo'.)
//   - SKS tenant is opted out via TENANT_DISABLED_TABLES (app-state.js).
//
// ─────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // =====================================================================
  // Config
  // =====================================================================

  var DEPT_VALUE_FLOORS = {
    'Projects - Elec': 100000,
    'Projects - AV':    25000
  };
  var DEFAULT_VALUE_FLOOR = 100000;

  var STAGE_COLUMNS = [
    { key: 'watch',  label: 'Watch (50%)',           accent: '#3DA8D8' },
    { key: 'likely', label: 'Likely (70–90%)',       accent: '#7C3AED' },
    { key: 'won',    label: 'Awaiting Promotion',    accent: '#10B981' },
    { key: 'confirmed', label: 'Confirmed (live)',   accent: '#0EA5E9' }
  ];

  var CLASH_SEVERITY_STYLE = {
    yellow: { bg: '#FEF9C3', fg: '#854D0E', label: 'Yellow' }, // neutral — design says NOT a warning
    amber:  { bg: '#FED7AA', fg: '#9A3412', label: 'Amber'  },
    red:    { bg: '#FECACA', fg: '#7F1D1D', label: 'Red'    }
  };

  // =====================================================================
  // Helpers — id coercion, money formatting, week alignment
  // =====================================================================

  function S(v) { return v === null || v === undefined ? '' : String(v); }
  function sameId(a, b) { return S(a) === S(b) && S(a) !== ''; }
  function escapeHtml(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function fmtMoney(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    if (n >= 1000000) return '$' + (n / 1000000).toFixed(n >= 10000000 ? 1 : 2).replace(/\.?0+$/, '') + 'M';
    if (n >= 1000) return '$' + Math.round(n / 1000) + 'k';
    return '$' + n;
  }
  function fmtDate(d) {
    if (!d) return '—';
    var s = String(d).slice(0, 10);
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return s;
    return m[3] + '/' + m[2] + '/' + m[1];
  }
  function toMonday(dateLike) {
    if (!dateLike) return null;
    var d = new Date(dateLike);
    if (isNaN(d)) return null;
    var dow = d.getUTCDay(); // 0=Sun..6=Sat
    var diff = (dow === 0) ? -6 : (1 - dow);
    var monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
    return monday.toISOString().slice(0, 10);
  }
  function addWeeks(isoDate, weeks) {
    var d = new Date(isoDate);
    if (isNaN(d)) return null;
    d.setUTCDate(d.getUTCDate() + (weeks * 7));
    return d.toISOString().slice(0, 10);
  }
  function isoWeekKey(isoDate) {
    // Returns "YYYY-Www" matching schedule.week format.
    var d = new Date(isoDate);
    if (isNaN(d)) return null;
    d.setUTCHours(0, 0, 0, 0);
    // Thursday-of-week (ISO 8601)
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    var weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return d.getUTCFullYear() + '-W' + (weekNo < 10 ? '0' + weekNo : weekNo);
  }
  function deptValueFloor(department) {
    if (department && DEPT_VALUE_FLOORS[department]) return DEPT_VALUE_FLOORS[department];
    return DEFAULT_VALUE_FLOOR;
  }
  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    // RFC4122 v4 fallback
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0, v = (c === 'x') ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
  function toast(msg, kind) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, kind);
    } else {
      console.log('[EQ_TENDER_PIPELINE]', msg);
    }
  }
  function ev(name, props) {
    try {
      var fn = window.EQ_ANALYTICS && window.EQ_ANALYTICS.events && window.EQ_ANALYTICS.events[name];
      if (typeof fn === 'function') fn(props || {});
    } catch (_) { /* analytics must never break the screen */ }
  }
  function tenantDisabled() {
    // SKS doesn't have the pipeline tables yet — keep the module quiet there.
    return (typeof TENANT !== 'undefined') && TENANT.ORG_SLUG === 'sks';
  }

  // =====================================================================
  // Data loaders — keep STATE.tenders / STATE.tenderEnrichment etc fresh
  // =====================================================================

  function loadAll() {
    if (tenantDisabled()) return Promise.resolve();
    return Promise.all([
      sbFetch('tenders?select=*&order=due_date.asc.nullslast'),
      sbFetch('tender_enrichment?select=*'),
      sbFetch('nominations?select=*'),
      sbFetch('nomination_clashes?select=*'),
      sbFetch('tender_import_runs?select=*&order=imported_at.desc&limit=10'),
      sbFetch('tender_review_decisions?select=*&order=reviewed_at.desc&limit=200')
    ]).then(function (results) {
      STATE.tenders           = results[0] || [];
      STATE.tenderEnrichment  = {};
      (results[1] || []).forEach(function (e) { STATE.tenderEnrichment[S(e.tender_id)] = e; });
      STATE.nominations       = results[2] || [];
      // Filter clashes to the current org via people lookup (view has no org_id)
      var personIdSet = new Set(STATE.people.map(function (p) { return S(p.id); }));
      STATE.nominationClashes = (results[3] || []).filter(function (c) {
        return personIdSet.has(S(c.person_id));
      });
      STATE.tenderImportRuns  = results[4] || [];
      STATE.tenderReviewDecisions = results[5] || [];
      updateClashBadge();
      return STATE;
    }).catch(function (err) {
      console.error('EQ[pipeline] loadAll failed', err);
      throw err;
    });
  }

  function updateClashBadge() {
    var badge = document.getElementById('badge-pipeline-clash');
    if (!badge) return;
    var n = (STATE.nominationClashes || []).length;
    if (n === 0) { badge.style.display = 'none'; return; }
    badge.textContent = String(n);
    badge.style.display = '';
  }

  // =====================================================================
  // Shared CSS — injected once per page lifecycle
  // =====================================================================

  function ensureStyles() {
    if (document.getElementById('eq-pipeline-styles')) return;
    var css = ''
      + '.pl-wrap{padding:20px;font-family:inherit;color:var(--ink-1,#1a1a1a)}'
      + '.pl-section-title{font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:var(--ink-3,#666);font-weight:700;margin:0 0 8px}'
      + '.pl-card{background:#fff;border:1px solid var(--border,#e5e7eb);border-radius:8px;padding:14px;margin-bottom:12px;box-shadow:0 1px 2px rgba(0,0,0,.04)}'
      + '.pl-btn{font-family:inherit;border:1px solid var(--border,#e5e7eb);background:#fff;color:var(--ink-1,#1a1a1a);padding:6px 12px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600}'
      + '.pl-btn:hover{background:#f3f4f6}'
      + '.pl-btn-primary{background:var(--navy,#1e3a8a);color:#fff;border-color:var(--navy,#1e3a8a)}'
      + '.pl-btn-primary:hover{background:var(--navy-2,#1e40af)}'
      + '.pl-btn-danger{background:#dc2626;color:#fff;border-color:#dc2626}'
      + '.pl-btn-danger:hover{background:#b91c1c}'
      + '.pl-input,.pl-select,.pl-textarea{font-family:inherit;width:100%;border:1px solid var(--border,#e5e7eb);border-radius:6px;padding:6px 10px;font-size:13px;background:#fff;color:var(--ink-1,#1a1a1a)}'
      + '.pl-textarea{min-height:60px;resize:vertical}'
      + '.pl-row{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px}'
      + '.pl-row > *{flex:1;min-width:160px}'
      + '.pl-label{font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--ink-3,#666);font-weight:700;margin-bottom:3px;display:block}'
      + '.pl-kanban{display:grid;grid-template-columns:repeat(4,minmax(220px,1fr));gap:12px;margin-top:14px}'
      + '.pl-col{background:#f9fafb;border:1px solid var(--border,#e5e7eb);border-radius:8px;padding:10px;min-height:140px}'
      + '.pl-col-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid var(--border,#e5e7eb)}'
      + '.pl-col-title{font-weight:700;font-size:12.5px;color:var(--ink-1,#1a1a1a)}'
      + '.pl-col-count{background:#fff;border-radius:10px;padding:1px 7px;font-size:11px;font-weight:600;color:var(--ink-3,#666)}'
      + '.pl-tender{background:#fff;border:1px solid var(--border,#e5e7eb);border-radius:6px;padding:10px;margin-bottom:8px;cursor:pointer;transition:box-shadow .15s,border-color .15s}'
      + '.pl-tender:hover{box-shadow:0 2px 6px rgba(0,0,0,.08);border-color:#bfdbfe}'
      + '.pl-tender-title{font-weight:600;font-size:13px;color:var(--ink-1,#1a1a1a);margin-bottom:3px;line-height:1.3}'
      + '.pl-tender-meta{font-size:11.5px;color:var(--ink-3,#666);margin-bottom:6px}'
      + '.pl-tender-value{font-size:12.5px;font-weight:700;color:var(--ink-1,#1a1a1a)}'
      + '.pl-tag{display:inline-block;padding:1px 7px;border-radius:10px;font-size:10.5px;font-weight:700;margin-right:4px;margin-top:3px}'
      + '.pl-tag-confidence{background:#dcfce7;color:#15803d}'
      + '.pl-tag-clash-yellow{background:#fef9c3;color:#854d0e}'   /* neutral per design */
      + '.pl-tag-clash-amber{background:#fed7aa;color:#9a3412}'
      + '.pl-tag-clash-red{background:#fecaca;color:#7f1d1d}'
      + '.pl-tag-low{background:#f3f4f6;color:#4b5563}'
      + '.pl-panel{position:fixed;top:0;right:0;bottom:0;width:520px;max-width:95vw;background:#fff;box-shadow:-8px 0 24px rgba(0,0,0,.15);z-index:9000;display:flex;flex-direction:column}'
      + '.pl-panel-header{padding:14px 18px;border-bottom:1px solid var(--border,#e5e7eb);display:flex;justify-content:space-between;align-items:center}'
      + '.pl-panel-body{padding:14px 18px;overflow-y:auto;flex:1}'
      + '.pl-panel-footer{padding:12px 18px;border-top:1px solid var(--border,#e5e7eb);display:flex;gap:8px;justify-content:flex-end;background:#f9fafb}'
      + '.pl-overlay{position:fixed;inset:0;background:rgba(0,0,0,.18);z-index:8999}'
      + '.pl-diff-table{width:100%;border-collapse:collapse;font-size:12.5px}'
      + '.pl-diff-table th,.pl-diff-table td{padding:6px 10px;border-bottom:1px solid var(--border,#e5e7eb);text-align:left;vertical-align:top}'
      + '.pl-diff-table th{background:#f9fafb;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--ink-3,#666)}'
      + '.pl-empty{padding:20px;text-align:center;color:var(--ink-3,#666);font-size:13px}'
      + '.pl-pill{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:#eef2ff;color:#3730a3;margin-left:6px}'
      + '.pl-curve-grid{width:100%;border-collapse:collapse;font-size:12px;margin-top:10px}'
      + '.pl-curve-grid th,.pl-curve-grid td{border:1px solid var(--border,#e5e7eb);padding:4px;text-align:center}'
      + '.pl-curve-grid th{background:#f9fafb;font-weight:700}'
      + '.pl-curve-grid input{width:48px;border:none;text-align:center;font-family:inherit;font-size:11.5px}'
      + '.pl-curve-grid input:focus{outline:1px solid var(--navy,#1e3a8a);outline-offset:-1px}'
      // v3.4.82 — drag-and-drop visuals
      + '.pl-tender[draggable="true"]{cursor:grab}'
      + '.pl-tender.pl-tender-dragging{opacity:.4;cursor:grabbing}'
      + '.pl-col.pl-col-dragover{background:#dbeafe;outline:2px dashed #3b82f6;outline-offset:-2px}'
      // v3.4.82 — decision queue (Review screen restructure)
      + '.pl-queue{display:grid;grid-template-columns:1fr 320px;gap:14px;margin-top:14px;align-items:start}'
      + '.pl-q-row{background:#fff;border:1px solid var(--border,#e5e7eb);border-radius:8px;padding:12px;margin-bottom:10px;box-shadow:0 1px 2px rgba(0,0,0,.04)}'
      + '.pl-q-row-urgent{border-left:4px solid #dc2626}'
      + '.pl-q-row-soon{border-left:4px solid #f59e0b}'
      + '.pl-q-row-norm{border-left:4px solid #3b82f6}'
      + '.pl-q-head{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px}'
      + '.pl-q-title{font-weight:700;font-size:14px;color:var(--ink-1,#1a1a1a);line-height:1.3}'
      + '.pl-q-meta{font-size:11.5px;color:var(--ink-3,#666);margin-bottom:4px}'
      + '.pl-q-tags{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0 8px}'
      + '.pl-q-controls{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}'
      + '.pl-q-actions{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end;border-top:1px solid var(--border,#e5e7eb);padding-top:8px}'
      + '.pl-side{position:sticky;top:14px;background:#fff;border:1px solid var(--border,#e5e7eb);border-radius:8px;padding:12px;max-height:calc(100vh - 100px);overflow-y:auto}'
      + '.pl-side h4{margin:0 0 8px;font-size:11.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--ink-3,#666);font-weight:700}'
      + '.pl-q-empty{padding:30px;text-align:center;color:var(--ink-3,#666);font-size:14px;background:#f9fafb;border-radius:8px;border:1px dashed var(--border,#e5e7eb)}'
      + '@media(max-width:900px){.pl-kanban{grid-template-columns:1fr 1fr}.pl-queue{grid-template-columns:1fr}.pl-side{position:static;max-height:none}}'
      + '@media(max-width:600px){.pl-kanban{grid-template-columns:1fr}.pl-panel{width:100%}}'
      // v3.4.82 — Pipeline Dashboard
      + '.pl-dash-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}'
      + '.pl-stat-card{background:#fff;border:1px solid var(--border,#e5e7eb);border-radius:8px;padding:14px 16px;box-shadow:0 1px 2px rgba(0,0,0,.04)}'
      + '.pl-stat-val{font-size:22px;font-weight:700;color:var(--navy,#1e3a8a);margin-bottom:2px}'
      + '.pl-stat-lbl{font-size:11.5px;color:var(--ink-3,#666);text-transform:uppercase;letter-spacing:.4px;font-weight:600}'
      + '.pl-dash-table{width:100%;border-collapse:collapse;font-size:12.5px}'
      + '.pl-dash-table th{background:#f9fafb;font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--ink-3,#666);font-weight:700;padding:8px 10px;border-bottom:2px solid var(--border,#e5e7eb);white-space:nowrap;text-align:left}'
      + '.pl-dash-table td{padding:8px 10px;border-bottom:1px solid var(--border,#e5e7eb);vertical-align:top}'
      + '.pl-dash-table tbody tr:hover{background:#f0f7ff}'
      + '@media(max-width:900px){.pl-dash-stats{grid-template-columns:1fr 1fr}}';
    var s = document.createElement('style');
    s.id = 'eq-pipeline-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }

  // =====================================================================
  // Screen 1 — /pipeline/import
  // =====================================================================

  var _pendingImport = null; // { rows, diff, summary, fileName }

  function renderImport() {
    ensureStyles();
    var host = document.getElementById('pipeline-import-content');
    if (!host) return;
    if (tenantDisabled()) {
      host.innerHTML = '<div class="pl-wrap"><div class="pl-card">'
        + '<h3 style="margin:0 0 8px">Tender Pipeline unavailable on this tenant.</h3>'
        + '<p style="color:var(--ink-3);font-size:13px;margin:0">The pipeline tables haven\'t been migrated onto this Supabase project yet. '
        + 'Module is live on the EQ demo tenant only for now.</p></div></div>';
      return;
    }
    loadAll().then(function () {
      var lastRun = STATE.tenderImportRuns && STATE.tenderImportRuns[0];
      var lastInfo = lastRun
        ? 'Last import: ' + fmtDate(lastRun.imported_at) + ' — ' + (lastRun.file_name || 'unnamed') + ' — '
            + lastRun.rows_total + ' rows (' + lastRun.rows_new + ' new, ' + lastRun.rows_stage_changed + ' stage changed, '
            + lastRun.rows_value_changed + ' value changed, ' + lastRun.rows_missing + ' missing).'
        : 'No prior imports recorded.';

      host.innerHTML = ''
        + '<div class="pl-wrap">'
        + '  <h2 style="margin:0 0 12px">Tender Sync</h2>'
        + '  <p style="font-size:13px;color:var(--ink-3);margin:0 0 16px;max-width:680px">'
        + '    Upload the latest SKS Smartsheet xlsx export ("Open 12m Tenders (State)"). The parser will diff against what\'s in the pipeline now and show you what will change before anything is written.'
        + '  </p>'
        + '  <div class="pl-card">'
        + '    <div class="pl-label">Last import</div>'
        + '    <div style="font-size:13px;color:var(--ink-2)">' + escapeHtml(lastInfo) + '</div>'
        + '  </div>'
        + '  <div class="pl-card">'
        + '    <div class="pl-label">Upload xlsx</div>'
        + '    <input type="file" id="pl-import-file" accept=".xlsx,.xls" style="font-family:inherit;font-size:13px;margin-top:4px">'
        + '    <div style="font-size:11.5px;color:var(--ink-3);margin-top:4px">Required columns: SITE / JOB NAME, SKS Quote No, Due Date, Status, Project $ Amount, SKS Estimator, Builder/Client Name, Market Vertical, SKS Dept, Site Address, SKS Entity, Probability.</div>'
        + '  </div>'
        + '  <div id="pl-import-result"></div>'
        + '</div>';

      var input = document.getElementById('pl-import-file');
      if (input) input.addEventListener('change', _onImportFile);
    });
  }

  function _onImportFile(evnt) {
    var file = evnt.target.files && evnt.target.files[0];
    if (!file) return;
    var result = document.getElementById('pl-import-result');
    if (!result) return;
    result.innerHTML = '<div class="pl-card"><em>Parsing ' + escapeHtml(file.name) + '…</em></div>';

    window.EQ_TENDER_PARSER.parseTenderXlsx(file).then(function (parsed) {
      if (!parsed.rows.length && parsed.errors.length) {
        var fatal = parsed.errors.filter(function (e) { return e.severity === 'fatal'; });
        result.innerHTML = '<div class="pl-card" style="border-color:#dc2626">'
          + '<h3 style="margin:0 0 6px;color:#7f1d1d">Couldn\'t read the file</h3>'
          + fatal.map(function (e) { return '<div style="font-size:12.5px">' + escapeHtml(e.message) + '</div>'; }).join('')
          + '</div>';
        return;
      }
      var existing = STATE.tenders.map(function (t) {
        return { external_ref: t.external_ref, probability_pct: t.probability_pct, quote_value: t.quote_value };
      });
      var diff = window.EQ_TENDER_PARSER.diffAgainstExisting(parsed.rows, existing);
      var summary = window.EQ_TENDER_PARSER.summariseImport(diff, parsed.rows);
      _pendingImport = { rows: parsed.rows, diff: diff, summary: summary, fileName: file.name, warnings: parsed.errors };
      _renderImportPreview();
    });
  }

  function _renderImportPreview() {
    var result = document.getElementById('pl-import-result');
    var imp = _pendingImport;
    if (!result || !imp) return;
    var s = imp.summary;
    var warnHtml = (imp.warnings || []).filter(function (w) { return w.severity === 'warning'; }).map(function (w) {
      return '<div style="font-size:11.5px;color:#9a3412">⚠ ' + escapeHtml(w.message) + '</div>';
    }).join('');

    function diffTable(title, rows, cols) {
      if (!rows || !rows.length) return '';
      var head = cols.map(function (c) { return '<th>' + escapeHtml(c.label) + '</th>'; }).join('');
      var body = rows.map(function (r) {
        return '<tr>' + cols.map(function (c) {
          return '<td>' + escapeHtml(c.fn(r)) + '</td>';
        }).join('') + '</tr>';
      }).join('');
      return '<div class="pl-card"><h4 style="margin:0 0 8px">' + escapeHtml(title) + ' <span class="pl-pill">' + rows.length + '</span></h4>'
        + '<table class="pl-diff-table"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
    }

    var newCols = [
      { label: 'Quote', fn: function (r) { return r.external_ref; } },
      { label: 'Job',   fn: function (r) { return r.job_name || '—'; } },
      { label: 'Value', fn: function (r) { return fmtMoney(r.quote_value); } },
      { label: 'Prob',  fn: function (r) { return (r.probability_pct == null ? '—' : r.probability_pct + '%'); } },
      { label: 'Stage', fn: function (r) { return r.stage; } },
      { label: 'Below floor', fn: function (r) { return r.below_threshold ? 'Yes' : 'No'; } }
    ];
    var stageCols = [
      { label: 'Quote', fn: function (r) { return r.external_ref; } },
      { label: 'Job',   fn: function (r) { return r.job_name || '—'; } },
      { label: 'Prev %',fn: function (r) { return r.previous && r.previous.probability_pct != null ? r.previous.probability_pct + '%' : '—'; } },
      { label: 'New %', fn: function (r) { return r.probability_pct == null ? '—' : r.probability_pct + '%'; } }
    ];
    var valueCols = [
      { label: 'Quote', fn: function (r) { return r.external_ref; } },
      { label: 'Job',   fn: function (r) { return r.job_name || '—'; } },
      { label: 'Prev',  fn: function (r) { return fmtMoney(r.previous && r.previous.quote_value); } },
      { label: 'New',   fn: function (r) { return fmtMoney(r.quote_value); } }
    ];
    var missCols = [
      { label: 'Quote', fn: function (r) { return r.external_ref; } }
    ];

    result.innerHTML = ''
      + '<div class="pl-card" style="border-color:#10b981">'
      + '  <h3 style="margin:0 0 8px">Preview — ' + escapeHtml(imp.fileName) + '</h3>'
      + '  <div style="font-size:13px;color:var(--ink-2);margin-bottom:8px">'
      + '    Total <strong>' + s.rows_total + '</strong> · '
      + '    New <strong>' + s.rows_new + '</strong> · '
      + '    Stage changes <strong>' + s.rows_stage_changed + '</strong> · '
      + '    Value changes <strong>' + s.rows_value_changed + '</strong> · '
      + '    Missing <strong>' + s.rows_missing + '</strong> · '
      + '    Below floor <strong>' + s.rows_below_threshold + '</strong>'
      + '  </div>'
      + warnHtml
      + '  <div style="display:flex;gap:8px;margin-top:10px">'
      + '    <button class="pl-btn pl-btn-primary" onclick="window.EQ_TENDER_PIPELINE._applyImport()">Apply to pipeline</button>'
      + '    <button class="pl-btn" onclick="window.EQ_TENDER_PIPELINE._cancelImport()">Cancel</button>'
      + '  </div>'
      + '</div>'
      + diffTable('New tenders', imp.diff['new'],   newCols)
      + diffTable('Stage changed', imp.diff.stageChanged, stageCols)
      + diffTable('Value changed', imp.diff.valueChanged, valueCols)
      + diffTable('Missing from this import', imp.diff.missing, missCols);
  }

  function _cancelImport() {
    _pendingImport = null;
    var result = document.getElementById('pl-import-result');
    if (result) result.innerHTML = '';
    var input = document.getElementById('pl-import-file');
    if (input) input.value = '';
  }

  function _applyImport() {
    var imp = _pendingImport;
    if (!imp) { toast('Nothing to apply'); return; }
    var s = imp.summary;
    var btn = event && event.target;
    if (btn) { btn.disabled = true; btn.textContent = 'Applying…'; }

    // Build the work:
    //  - INSERT new rows (POST tenders[])
    //  - PATCH existing rows on stageChanged + valueChanged (probability_pct + quote_value)
    //  - bump missing_import_count on missing rows
    //  - POST tender_import_runs row

    function persistNew() {
      var newRows = imp.diff['new'].map(function (r) {
        var copy = Object.assign({}, r);
        delete copy._row_index;
        copy.first_imported_at = new Date().toISOString();
        copy.last_imported_at = new Date().toISOString();
        return copy;
      });
      if (!newRows.length) return Promise.resolve();
      return sbFetch('tenders', 'POST', newRows, 'return=minimal');
    }

    function persistChanges(rows) {
      // PATCH each one individually keyed by external_ref (we don't have id here).
      var promises = rows.map(function (r) {
        var payload = {
          probability_pct:   r.probability_pct,
          probability_label: r.probability_label,
          quote_value:       r.quote_value,
          stage:             r.stage,
          below_threshold:   r.below_threshold,
          tender_status:     r.tender_status,
          due_date:          r.due_date,
          last_imported_at:  new Date().toISOString()
        };
        var ref = encodeURIComponent(r.external_ref);
        return sbFetch('tenders?external_ref=eq.' + ref, 'PATCH', payload, 'return=minimal');
      });
      return Promise.all(promises);
    }

    function bumpMissing() {
      // RPC-less: fetch existing missing_import_count per row, bump, PATCH.
      // Cheap because the missing list is usually short.
      var promises = imp.diff.missing.map(function (m) {
        var ref = encodeURIComponent(m.external_ref);
        return sbFetch('tenders?external_ref=eq.' + ref + '&select=id,missing_import_count,stage').then(function (rows) {
          var row = (rows || [])[0];
          if (!row) return null;
          var next = (row.missing_import_count || 0) + 1;
          var patch = { missing_import_count: next };
          if (next >= 2 && row.stage !== 'lost') {
            patch.stage = 'lost';
            patch.archived_at = new Date().toISOString();
          }
          return sbFetch('tenders?external_ref=eq.' + ref, 'PATCH', patch, 'return=minimal');
        });
      });
      return Promise.all(promises);
    }

    function persistImportRun() {
      return sbFetch('tender_import_runs', 'POST', {
        imported_at:          new Date().toISOString(),
        file_name:            imp.fileName,
        rows_total:           s.rows_total,
        rows_new:             s.rows_new,
        rows_stage_changed:   s.rows_stage_changed,
        rows_value_changed:   s.rows_value_changed,
        rows_missing:         s.rows_missing,
        rows_below_threshold: s.rows_below_threshold,
        notes:                null
      }, 'return=minimal');
    }

    persistNew()
      .then(function () { return persistChanges(imp.diff.stageChanged); })
      .then(function () {
        // Skip valueChanged rows already covered by stageChanged (parser duplicates them).
        var stageRefs = new Set(imp.diff.stageChanged.map(function (r) { return r.external_ref; }));
        var valueOnly = imp.diff.valueChanged.filter(function (r) { return !stageRefs.has(r.external_ref); });
        return persistChanges(valueOnly);
      })
      .then(bumpMissing)
      .then(persistImportRun)
      .then(function () {
        ev('tenderImported', {
          rows_total:           s.rows_total,
          rows_new:             s.rows_new,
          rows_stage_changed:   s.rows_stage_changed,
          rows_value_changed:   s.rows_value_changed,
          rows_missing:         s.rows_missing,
          rows_below_threshold: s.rows_below_threshold
        });
        toast('Import applied — ' + s.rows_new + ' new, ' + (s.rows_stage_changed + s.rows_value_changed) + ' updated', 'success');
        _pendingImport = null;
        renderImport();
      })
      .catch(function (err) {
        console.error('EQ[pipeline] applyImport failed', err);
        toast('Import failed — see console', 'error');
        if (btn) { btn.disabled = false; btn.textContent = 'Apply to pipeline'; }
      });
  }

  // =====================================================================
  // Screen 2 — /pipeline (kanban)
  // =====================================================================

  var _kanbanShowBelowFloor = false;
  var _kanbanDeptFilter = ''; // '' = all depts

  // v3.4.84 — Dashboard filter state
  var _dashStageFilter = ''; // '' = all non-archived
  var _dashDeptFilter  = ''; // '' = all depts

  // v3.4.84 — Review stage filter: 'action' (likely+won) or 'all'
  var _reviewStageFilter = 'action';

  function renderKanban() {
    ensureStyles();
    var host = document.getElementById('pipeline-content');
    if (!host) return;
    if (tenantDisabled()) {
      host.innerHTML = '<div class="pl-wrap"><div class="pl-card">Pipeline unavailable on this tenant.</div></div>';
      return;
    }
    loadAll().then(function () {
      var deptOptions = (function () {
        var set = new Set();
        STATE.tenders.forEach(function (t) { if (t.department) set.add(t.department); });
        var opts = ['<option value="">All departments</option>'];
        Array.from(set).sort().forEach(function (d) {
          opts.push('<option value="' + escapeHtml(d) + '"' + (d === _kanbanDeptFilter ? ' selected' : '') + '>' + escapeHtml(d) + '</option>');
        });
        return opts.join('');
      })();

      host.innerHTML = ''
        + '<div class="pl-wrap">'
        + '  <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:8px">'
        + '    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">'
        + '      <h2 style="margin:0">Pipeline</h2>'
        + '      <select class="pl-select" id="pl-kanban-dept" style="max-width:240px">' + deptOptions + '</select>'
        + '      <label style="font-size:13px;color:var(--ink-2);display:flex;align-items:center;gap:6px;cursor:pointer">'
        + '        <input type="checkbox" id="pl-kanban-below"' + (_kanbanShowBelowFloor ? ' checked' : '') + '> Show below floor'
        + '      </label>'
        + '    </div>'
        + '    <div style="font-size:12px;color:var(--ink-3)">' + STATE.tenders.length + ' tenders · ' + STATE.nominationClashes.length + ' clashes</div>'
        + '  </div>'
        + '  <div id="pl-kanban-grid"></div>'
        + '</div>';
      document.getElementById('pl-kanban-dept').addEventListener('change', function () {
        _kanbanDeptFilter = this.value;
        _renderKanbanGrid();
      });
      document.getElementById('pl-kanban-below').addEventListener('change', function () {
        _kanbanShowBelowFloor = !!this.checked;
        _renderKanbanGrid();
      });
      _renderKanbanGrid();
    });
  }

  function _renderKanbanGrid() {
    var grid = document.getElementById('pl-kanban-grid');
    if (!grid) return;
    var tenders = STATE.tenders.filter(function (t) {
      if (t.archived_at) return false;
      if (!_kanbanShowBelowFloor && t.below_threshold) return false;
      if (_kanbanDeptFilter && t.department !== _kanbanDeptFilter) return false;
      return STAGE_COLUMNS.some(function (c) { return c.key === t.stage; });
    });

    var byStage = {};
    STAGE_COLUMNS.forEach(function (c) { byStage[c.key] = []; });
    tenders.forEach(function (t) { byStage[t.stage].push(t); });

    // Sort each column per spec
    if (byStage.watch)     byStage.watch.sort(_sortDueDate);
    if (byStage.likely)    byStage.likely.sort(_sortStartDateThenDue);
    if (byStage.won)       byStage.won.sort(_sortDueDate);
    if (byStage.confirmed) byStage.confirmed.sort(_sortStartDateThenDue);

    var html = '<div class="pl-kanban">';
    STAGE_COLUMNS.forEach(function (col) {
      var rows = byStage[col.key] || [];
      html += '<div class="pl-col" data-stage="' + escapeHtml(col.key) + '">'
        + '<div class="pl-col-header"><div class="pl-col-title" style="color:' + col.accent + '">' + col.label + '</div>'
        + '<div class="pl-col-count">' + rows.length + '</div></div>'
        + (rows.length ? rows.map(_renderTenderCard).join('') : '<div class="pl-empty">Nothing here.</div>')
        + '</div>';
    });
    html += '</div>';
    grid.innerHTML = html;
    _attachKanbanDnd();
  }

  // v3.4.82 — drag-and-drop wiring for the kanban
  function _attachKanbanDnd() {
    var cards = document.querySelectorAll('#pl-kanban-grid .pl-tender[draggable="true"]');
    cards.forEach(function (c) {
      c.addEventListener('dragstart', function (e) {
        var id = c.getAttribute('data-tender-id');
        var stage = c.getAttribute('data-stage');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', JSON.stringify({ id: id, from: stage }));
        c.classList.add('pl-tender-dragging');
      });
      c.addEventListener('dragend', function () {
        c.classList.remove('pl-tender-dragging');
      });
    });
    var cols = document.querySelectorAll('#pl-kanban-grid .pl-col');
    cols.forEach(function (col) {
      col.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        col.classList.add('pl-col-dragover');
      });
      col.addEventListener('dragleave', function (e) {
        // Only clear when leaving the column for real (not when entering a child)
        if (e.currentTarget === col && !col.contains(e.relatedTarget)) {
          col.classList.remove('pl-col-dragover');
        }
      });
      col.addEventListener('drop', function (e) {
        e.preventDefault();
        col.classList.remove('pl-col-dragover');
        var raw;
        try { raw = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (_) { return; }
        if (!raw || !raw.id) return;
        var toStage = col.getAttribute('data-stage');
        _handleStageDrop(raw.id, raw.from, toStage);
      });
    });
  }

  function _handleStageDrop(tenderId, fromStage, toStage) {
    if (!toStage || fromStage === toStage) return;
    if (toStage === 'confirmed') {
      if (fromStage !== 'won') {
        toast('Move to "Awaiting Promotion" first — only Won tenders can confirm', 'error');
        return;
      }
      // Auto-route to Confirm Curve (preserves the labour-curve gate)
      ev('tenderStageDragged', { tender_id: tenderId, from_stage: fromStage, to_stage: toStage, routed_to_confirm_curve: true });
      _goConfirmCurve(tenderId);
      return;
    }
    _saveTenderStage(tenderId, toStage, fromStage);
  }

  function _saveTenderStage(tenderId, newStage, fromStage) {
    sbFetch('tenders?id=eq.' + encodeURIComponent(tenderId), 'PATCH', {
      stage:      newStage,
      updated_at: new Date().toISOString()
    }, 'return=minimal').then(function () {
      var t = STATE.tenders.find(function (x) { return sameId(x.id, tenderId); });
      if (t) t.stage = newStage;
      ev('tenderStageDragged', { tender_id: tenderId, from_stage: fromStage, to_stage: newStage, routed_to_confirm_curve: false });
      toast('Moved to ' + newStage, 'success');
      _renderKanbanGrid();
    }).catch(function (err) {
      console.error('EQ[pipeline] stage drop failed', err);
      toast('Move failed', 'error');
      renderKanban();
    });
  }

  function _sortDueDate(a, b) {
    var ad = a.due_date || '9999-12-31';
    var bd = b.due_date || '9999-12-31';
    return ad < bd ? -1 : ad > bd ? 1 : 0;
  }
  function _sortStartDateThenDue(a, b) {
    var ae = STATE.tenderEnrichment[S(a.id)];
    var be = STATE.tenderEnrichment[S(b.id)];
    var as = (ae && ae.start_date_estimated) || a.due_date || '9999-12-31';
    var bs = (be && be.start_date_estimated) || b.due_date || '9999-12-31';
    return as < bs ? -1 : as > bs ? 1 : 0;
  }

  function _renderTenderCard(t) {
    var enrich = STATE.tenderEnrichment[S(t.id)];
    var noms = STATE.nominations.filter(function (n) { return sameId(n.tender_id, t.id); });
    var nomNames = noms.map(function (n) {
      var p = (STATE.people || []).find(function (q) { return sameId(q.id, n.person_id); })
           || (STATE.managers || []).find(function (q) { return sameId(q.id, n.person_id); });
      var name = p ? p.name : (n.capacity_tag || '?');
      return '<span style="font-size:11px;color:var(--ink-2)">' + escapeHtml(name) + (n.role === 'pm' ? ' (PM)' : ' (Sup)') + '</span>';
    }).join(' · ');
    var clashes = STATE.nominationClashes.filter(function (c) {
      return sameId(c.tender_a_id, t.id) || sameId(c.tender_b_id, t.id);
    });
    var clashTag = '';
    if (clashes.length) {
      var worst = clashes.reduce(function (acc, c) {
        var rank = { red: 3, amber: 2, yellow: 1 };
        return rank[c.severity] > rank[acc] ? c.severity : acc;
      }, 'yellow');
      clashTag = '<span class="pl-tag pl-tag-clash-' + worst + '">' + clashes.length + ' clash' + (clashes.length > 1 ? 'es' : '') + '</span>';
    }
    var highConf = t.is_high_confidence ? '<span class="pl-tag pl-tag-confidence">90% high confidence</span>' : '';
    var belowFloor = t.below_threshold ? '<span class="pl-tag pl-tag-low">Below floor</span>' : '';
    var promote = t.stage === 'won'
      ? '<button class="pl-btn pl-btn-primary" style="margin-top:6px;padding:4px 10px;font-size:11.5px" onclick="event.stopPropagation();window.EQ_TENDER_PIPELINE._goConfirmCurve(\'' + S(t.id) + '\')">Promote →</button>'
      : '';
    return '<div class="pl-tender" draggable="true"'
      + ' data-tender-id="' + escapeHtml(S(t.id)) + '" data-stage="' + escapeHtml(t.stage) + '"'
      + ' onclick="window.EQ_TENDER_PIPELINE.openTenderPanel(\'' + S(t.id) + '\')">'
      + '<div class="pl-tender-title">' + escapeHtml(t.job_name || '(no name)') + '</div>'
      + '<div class="pl-tender-meta">' + escapeHtml(t.client || '—')
      + ' · Due ' + fmtDate(t.due_date) + ' · ' + (t.probability_pct == null ? '—' : t.probability_pct + '%') + '</div>'
      + '<div class="pl-tender-value">' + fmtMoney(t.quote_value) + '</div>'
      + (enrich && enrich.start_date_estimated ? '<div style="font-size:11px;color:var(--ink-3);margin-top:3px">Start ' + fmtDate(enrich.start_date_estimated) + (enrich.duration_weeks ? ' · ' + enrich.duration_weeks + 'w' : '') + '</div>' : '')
      + (nomNames ? '<div style="margin-top:4px">' + nomNames + '</div>' : '')
      + '<div>' + highConf + clashTag + belowFloor + '</div>'
      + promote
      + '</div>';
  }

  // =====================================================================
  // Screen 3 — Enrichment + nomination slide-over panel
  // =====================================================================

  var _panelOpenTenderId = null;
  var _afterPanelSave   = null; // 'confirmCurve' → navigate there after a successful save

  function openTenderPanel(tenderId) {
    var tender = STATE.tenders.find(function (t) { return sameId(t.id, tenderId); });
    if (!tender) { toast('Tender not found'); return; }
    _panelOpenTenderId = S(tender.id);
    ensureStyles();
    var enrich = STATE.tenderEnrichment[_panelOpenTenderId] || {};
    var noms = STATE.nominations.filter(function (n) { return sameId(n.tender_id, tender.id); });
    var pmNoms = noms.filter(function (n) { return n.role === 'pm'; });
    var supNoms = noms.filter(function (n) { return n.role === 'supervisor'; });

    // v3.4.84 — use managers table (Contacts/Supervision) not people roster.
    // PM → category 'Project Management'; Supervisor → category 'Supervisor'.
    // Falls back to all non-archived contacts if the category bucket is empty.
    var _allContacts = (STATE.managers || []).filter(function (m) { return !m.archived; });
    var managers = _allContacts.filter(function (m) { return m.category === 'Project Management'; });
    if (!managers.length) managers = _allContacts;
    var supervisors = _allContacts.filter(function (m) { return m.category === 'Supervisor'; });
    if (!supervisors.length) supervisors = _allContacts;

    function personOptions(list, selected) {
      return ['<option value="">— pick —</option>'].concat(list.map(function (p) {
        return '<option value="' + escapeHtml(p.id) + '"' + (sameId(p.id, selected) ? ' selected' : '') + '>' + escapeHtml(p.name) + '</option>';
      })).join('');
    }
    var pmSelected = (pmNoms[0] && pmNoms[0].person_id) || '';
    var supSelected = (supNoms[0] && supNoms[0].person_id) || '';

    var host = document.getElementById('tender-panel');
    host.style.display = '';
    host.innerHTML = ''
      + '<div class="pl-overlay" onclick="window.EQ_TENDER_PIPELINE.closeTenderPanel()"></div>'
      + '<aside class="pl-panel" role="dialog" aria-modal="true">'
      + '  <div class="pl-panel-header">'
      + '    <div>'
      + '      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--ink-3)">'
      +          escapeHtml(tender.external_ref || '') + ' · ' + escapeHtml(tender.stage)
      + (tender.is_high_confidence ? ' <span class="pl-tag pl-tag-confidence">90%</span>' : '')
      + '      </div>'
      + '      <div style="font-weight:700;font-size:15px;margin-top:2px">' + escapeHtml(tender.job_name || '(no name)') + '</div>'
      + '    </div>'
      + '    <button class="pl-btn" onclick="window.EQ_TENDER_PIPELINE.closeTenderPanel()">Close</button>'
      + '  </div>'
      + '  <div class="pl-panel-body">'
      + '    <div class="pl-row">'
      + '      <div><span class="pl-label">Client</span><div style="font-size:13px">' + escapeHtml(tender.client || '—') + '</div></div>'
      + '      <div><span class="pl-label">Value</span><div style="font-size:13px">' + fmtMoney(tender.quote_value) + '</div></div>'
      + '      <div><span class="pl-label">Probability</span><div style="font-size:13px">' + escapeHtml(tender.probability_label || '—') + '</div></div>'
      + '    </div>'
      + '    <div class="pl-row">'
      + '      <div><span class="pl-label">Department</span><div style="font-size:13px">' + escapeHtml(tender.department || '—') + '</div></div>'
      + '      <div><span class="pl-label">Estimator</span><div style="font-size:13px">' + escapeHtml(tender.estimator || '—') + '</div></div>'
      + '      <div><span class="pl-label">Due</span><div style="font-size:13px">' + fmtDate(tender.due_date) + '</div></div>'
      + '    </div>'
      + '    <hr style="border:0;border-top:1px solid var(--border);margin:14px 0">'
      + '    <div class="pl-section-title">Enrichment</div>'
      + '    <div class="pl-row">'
      + '      <div><span class="pl-label">Job Number</span><input class="pl-input" type="text" id="pl-pn-jobnum" placeholder="e.g. SKS-2026-042" value="' + escapeHtml(enrich.job_number || '') + '"></div>'
      + '      <div><span class="pl-label">Cost Code</span><input class="pl-input" type="text" id="pl-pn-costcode" placeholder="e.g. 5100.002" value="' + escapeHtml(enrich.cost_code || '') + '"></div>'
      + '    </div>'
      + '    <div class="pl-row">'
      + '      <div><span class="pl-label">Hours estimated</span><input class="pl-input" type="number" id="pl-pn-hours" value="' + escapeHtml(enrich.hours_estimated || '') + '"></div>'
      + '      <div><span class="pl-label">Peak workers</span><input class="pl-input" type="number" id="pl-pn-peak" value="' + escapeHtml(enrich.peak_workers || '') + '"></div>'
      + '    </div>'
      + '    <div class="pl-row">'
      + '      <div><span class="pl-label">Start date (Monday)</span><input class="pl-input" type="date" id="pl-pn-start" value="' + escapeHtml(enrich.start_date_estimated || '') + '"></div>'
      + '      <div><span class="pl-label">Duration (weeks)</span><input class="pl-input" type="number" id="pl-pn-weeks" value="' + escapeHtml(enrich.duration_weeks || '') + '"></div>'
      + '    </div>'
      + '    <div class="pl-row">'
      + '      <div style="flex:1 1 100%"><span class="pl-label">Confidence notes</span><textarea class="pl-textarea" id="pl-pn-notes">' + escapeHtml(enrich.confidence_notes || '') + '</textarea></div>'
      + '    </div>'
      + (enrich.needs_review ? '<div style="background:#fef9c3;border:1px solid #fde68a;color:#854d0e;font-size:12px;padding:6px 10px;border-radius:6px;margin:6px 0">Underlying tender changed since last enrichment — eyeball and resave.</div>' : '')
      + '    <hr style="border:0;border-top:1px solid var(--border);margin:14px 0">'
      + '    <div class="pl-section-title">Nominations</div>'
      + '    <div class="pl-row">'
      + '      <div><span class="pl-label">PM (manager)</span><select class="pl-select" id="pl-pn-pm">' + personOptions(managers, pmSelected) + '</select></div>'
      + '      <div><span class="pl-label">Supervisor</span><select class="pl-select" id="pl-pn-sup">' + personOptions(supervisors, supSelected) + '</select></div>'
      + '    </div>'
      + '    <div style="font-size:11.5px;color:var(--ink-3);margin-top:4px">Nominations are pencilled by default. They flip to confirmed only when the tender is promoted via Confirm Labour Curve.</div>'
      + '  </div>'
      + '  <div class="pl-panel-footer">'
      + '    <button class="pl-btn" onclick="window.EQ_TENDER_PIPELINE.closeTenderPanel()">Cancel</button>'
      + '    <button class="pl-btn pl-btn-primary" onclick="window.EQ_TENDER_PIPELINE._savePanel()">Save</button>'
      + '  </div>'
      + '</aside>';
  }

  function closeTenderPanel() {
    var host = document.getElementById('tender-panel');
    if (host) { host.style.display = 'none'; host.innerHTML = ''; }
    _panelOpenTenderId = null;
  }

  function _savePanel() {
    var tid = _panelOpenTenderId;
    if (!tid) return;
    var tender = STATE.tenders.find(function (t) { return sameId(t.id, tid); });
    if (!tender) return;
    var prev = STATE.tenderEnrichment[tid] || {};
    var hours    = parseFloat(document.getElementById('pl-pn-hours').value) || null;
    var peak     = parseInt(document.getElementById('pl-pn-peak').value, 10);    if (isNaN(peak)) peak = null;
    var weeks    = parseInt(document.getElementById('pl-pn-weeks').value, 10);   if (isNaN(weeks)) weeks = null;
    var startRaw = document.getElementById('pl-pn-start').value || null;
    var start    = startRaw ? toMonday(startRaw) : null;
    var notes    = document.getElementById('pl-pn-notes').value || '';
    var jobNum   = (document.getElementById('pl-pn-jobnum').value || '').trim() || null;
    var costCode = (document.getElementById('pl-pn-costcode').value || '').trim() || null;
    var pmId     = document.getElementById('pl-pn-pm').value || null;
    var supId    = document.getElementById('pl-pn-sup').value || null;

    var endWeek = (start && weeks) ? toMonday(addWeeks(start, weeks - 1)) : null;

    var fieldsChanged = [];
    ['hours_estimated', 'peak_workers', 'duration_weeks', 'start_date_estimated', 'confidence_notes', 'job_number', 'cost_code'].forEach(function (k) {
      var nv;
      if (k === 'hours_estimated') nv = hours;
      else if (k === 'peak_workers') nv = peak;
      else if (k === 'duration_weeks') nv = weeks;
      else if (k === 'start_date_estimated') nv = start;
      else if (k === 'job_number') nv = jobNum;
      else if (k === 'cost_code') nv = costCode;
      else nv = notes;
      if ((prev[k] || null) !== (nv || null)) fieldsChanged.push(k);
    });

    var enrichPayload = {
      tender_id:             tid,
      hours_estimated:       hours,
      peak_workers:          peak,
      duration_weeks:        weeks,
      start_date_estimated:  start,
      confidence_notes:      notes,
      job_number:            jobNum,
      cost_code:             costCode,
      needs_review:          false,
      updated_at:            new Date().toISOString()
    };

    // tender_enrichment is keyed by tender_id (PK). UPSERT-ish: PATCH if exists, else POST.
    var enrichOp;
    if (STATE.tenderEnrichment[tid]) {
      enrichOp = sbFetch('tender_enrichment?tender_id=eq.' + encodeURIComponent(tid), 'PATCH', enrichPayload, 'return=minimal');
    } else {
      enrichOp = sbFetch('tender_enrichment', 'POST', enrichPayload, 'return=minimal');
    }

    // Nominations — naive sync. Remove existing per role, re-insert.
    function syncNomination(role, personId) {
      var existing = STATE.nominations.filter(function (n) { return sameId(n.tender_id, tid) && n.role === role; });
      var promises = [];
      // Delete existing rows whose person doesn't match the new pick (and aren't 'confirmed' — leave confirmed alone).
      existing.forEach(function (n) {
        if (n.status === 'confirmed') return; // can't remove confirmed nominations from the panel
        if (!sameId(n.person_id, personId)) {
          promises.push(sbFetch('nominations?id=eq.' + encodeURIComponent(n.id), 'DELETE', null, 'return=minimal'));
        }
      });
      // Insert new if no current match.
      if (personId) {
        var already = existing.some(function (n) { return sameId(n.person_id, personId); });
        if (!already) {
          var payload = {
            tender_id:  tid,
            person_id:  personId,
            role:       role,
            is_primary: true,
            status:     'pencilled',
            start_week: start,
            end_week:   endWeek
          };
          promises.push(sbFetch('nominations', 'POST', payload, 'return=minimal').then(function () {
            ev('nominationAdded', { tender_id: tid, role: role, status: 'pencilled' });
          }));
        }
      }
      return Promise.all(promises);
    }

    Promise.all([enrichOp, syncNomination('pm', pmId), syncNomination('supervisor', supId)])
      .then(function () {
        ev('tenderEnriched', { tender_id: tid, fields_changed: fieldsChanged });
        toast('Saved', 'success');
        closeTenderPanel();
        var afterAction = _afterPanelSave;
        _afterPanelSave = null;
        return loadAll().then(function () {
          if (afterAction === 'confirmCurve') {
            _confirmCurveTenderId = S(tid);
            _confirmCurveDraft = null;
            showPage('pipeline-confirm-curve');
          } else {
            _renderKanbanGrid();
          }
        });
      })
      .catch(function (err) {
        console.error('EQ[pipeline] panel save failed', err);
        toast('Save failed', 'error');
      });
  }

  // =====================================================================
  // Screen 4 — /pipeline/review  (v3.4.82: rebuilt as decision queue)
  // =====================================================================
  // Was: 4 read-only panels + Notes log. Every actionable row said "Open"
  // and bounced the user to the slide-over.
  // Now: one ranked queue. Each row has inline PM + Supervisor pickers.
  // Won-stage tenders with full enrichment + nominees can be pushed
  // straight to the schedule (skipping Confirm Curve) — placeholder rows
  // for the rest of the team can still be filled later via Confirm Curve.
  // Notes log moves to a side rail.

  function renderReview() {
    ensureStyles();
    var host = document.getElementById('pipeline-review-content');
    if (!host) return;
    if (tenantDisabled()) {
      host.innerHTML = '<div class="pl-wrap"><div class="pl-card">Pipeline unavailable on this tenant.</div></div>';
      return;
    }
    loadAll().then(function () {
      var queue = _buildDecisionQueue();
      var sessionPill = STATE.reviewSessionId
        ? '<span class="pl-pill">Session active</span> <button class="pl-btn" style="font-size:11.5px;padding:3px 8px" onclick="window.EQ_TENDER_PIPELINE._endSession()">End session</button>'
        : '<button class="pl-btn pl-btn-primary" onclick="window.EQ_TENDER_PIPELINE._startSession()">Start Review Session</button>';

      // v3.4.84 — stage filter for review queue
      var reviewFilterOptions = [
        { v: 'action', l: 'Likely + Won (action items)' },
        { v: 'all',    l: 'All active stages' }
      ].map(function (o) {
        return '<option value="' + o.v + '"' + (o.v === _reviewStageFilter ? ' selected' : '') + '>' + o.l + '</option>';
      }).join('');

      host.innerHTML = ''
        + '<div class="pl-wrap">'
        + '  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;flex-wrap:wrap;gap:12px">'
        + '    <div>'
        + '      <h2 style="margin:0">Review &amp; act</h2>'
        + '      <p style="font-size:13px;color:var(--ink-3);margin:2px 0 0;max-width:680px">'
        + '        Ranked queue. Pencil PM and Supervisor inline. Push fully-enriched Won tenders straight to the roster — no full Confirm Curve trip required.'
        + '      </p>'
        + '    </div>'
        + '    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
        + '      <select class="pl-select" id="pl-review-stage-filter" style="max-width:240px">' + reviewFilterOptions + '</select>'
        + '      ' + sessionPill
        + '    </div>'
        + '  </div>'
        + '  <div class="pl-queue">'
        + '    <div>'
        + (queue.length
            ? '<div style="font-size:11.5px;color:var(--ink-3);margin:8px 0">' + queue.length + ' item' + (queue.length === 1 ? '' : 's') + ' needing attention</div>'
              + queue.map(_renderQueueRow).join('')
            : '<div class="pl-q-empty">Nothing in the queue. Pipeline is healthy.</div>')
        + '    </div>'
        + '    <aside class="pl-side">' + _renderNotesSiderail() + '</aside>'
        + '  </div>'
        + '</div>';

      // Wire stage filter
      var rfEl = document.getElementById('pl-review-stage-filter');
      if (rfEl) rfEl.addEventListener('change', function () {
        _reviewStageFilter = this.value;
        renderReview();
      });
    });
  }

  function _startSession() {
    STATE.reviewSessionId = uuid();
    ev('reviewSessionStarted', { session_id: STATE.reviewSessionId });
    toast('Review session started', 'success');
    renderReview();
  }

  function _endSession() {
    ev('reviewSessionEnded', { session_id: STATE.reviewSessionId });
    STATE.reviewSessionId = null;
    toast('Session ended', 'success');
    renderReview();
  }

  // -- Decision queue ----------------------------------------------------
  // Pure ranking pass over STATE. Returns items with { tender, enrichment,
  // pmNom, supNom, reasons[], score }. Higher score = higher priority.

  function _buildDecisionQueue() {
    var now = new Date();
    var soonish      = new Date(now.getTime() + (2 * 7 * 86400000));
    var horizon      = new Date(now.getTime() + (8 * 7 * 86400000));
    var fourWeeksAgo = new Date(now.getTime() - (4 * 7 * 86400000));
    var lastRun = STATE.tenderImportRuns && STATE.tenderImportRuns[0];
    var lastRunAt = lastRun ? new Date(lastRun.imported_at) : null;

    var clashByTender = {};
    STATE.nominationClashes.forEach(function (c) {
      [c.tender_a_id, c.tender_b_id].forEach(function (tid) {
        var k = S(tid);
        (clashByTender[k] = clashByTender[k] || []).push(c);
      });
    });

    var items = [];
    STATE.tenders.forEach(function (t) {
      if (t.archived_at) return;
      if (t.stage !== 'watch' && t.stage !== 'likely' && t.stage !== 'won' && t.stage !== 'confirmed') return;
      // v3.4.84 — apply stage filter. 'action' = likely + won only (default; reduces watch/confirmed noise)
      if (_reviewStageFilter === 'action' && t.stage !== 'likely' && t.stage !== 'won') return;

      var enr  = STATE.tenderEnrichment[S(t.id)] || null;
      var noms = STATE.nominations.filter(function (n) { return sameId(n.tender_id, t.id); });
      var pmNom  = noms.find(function (n) { return n.role === 'pm'; });
      var supNom = noms.find(function (n) { return n.role === 'supervisor'; });
      var clashes = clashByTender[S(t.id)] || [];
      var startDate = (enr && enr.start_date_estimated) ? new Date(enr.start_date_estimated) : null;

      var reasons = [];
      var score = 0;

      var redClash    = clashes.find(function (c) { return c.severity === 'red'; });
      var amberClash  = clashes.find(function (c) { return c.severity === 'amber'; });
      var yellowClash = clashes.find(function (c) { return c.severity === 'yellow'; });

      if (redClash) { reasons.push({ kind: 'clash', sev: 'red', text: 'Red clash' }); score += 1000; }

      if (t.stage === 'won' && startDate && startDate < soonish && (!pmNom || !supNom)) {
        reasons.push({ kind: 'urgent', text: 'Won + starts <2w + nominee missing' }); score += 800;
      }

      var readyToPush = t.stage === 'won' && enr
        && enr.start_date_estimated && enr.duration_weeks && enr.peak_workers
        && pmNom && pmNom.person_id && supNom && supNom.person_id;
      if (readyToPush) { reasons.push({ kind: 'ready', text: 'Ready to push to roster' }); score += 600; }

      if (startDate && startDate >= now && startDate < soonish) {
        reasons.push({ kind: 'soon', text: 'Starts in <2w' }); score += 400;
      } else if ((t.stage === 'likely' || t.stage === 'won') && startDate && startDate >= soonish && startDate <= horizon) {
        reasons.push({ kind: 'horizon', text: 'Starts in 2–8w' }); score += 200;
      }

      if (amberClash) { reasons.push({ kind: 'clash', sev: 'amber', text: 'Amber clash' }); score += 150; }

      if (lastRunAt && t.first_imported_at && new Date(t.first_imported_at) > lastRunAt
        && (t.probability_pct == null || t.probability_pct >= 50)) {
        reasons.push({ kind: 'new', text: 'New since last review' }); score += 100;
      }

      if (enr && enr.needs_review) { reasons.push({ kind: 'enrich', text: 'Needs re-enrich' }); score += 80; }

      if (t.stage === 'likely') {
        var lastTouch = enr && enr.updated_at ? new Date(enr.updated_at) : (t.updated_at ? new Date(t.updated_at) : null);
        if (lastTouch && lastTouch < fourWeeksAgo) { reasons.push({ kind: 'stale', text: 'Stale 4w+' }); score += 50; }
      }

      if (yellowClash && !redClash && !amberClash) {
        reasons.push({ kind: 'clash', sev: 'yellow', text: 'Yellow clash' }); score += 20;
      }

      if (reasons.length === 0) return; // nothing to act on
      items.push({ tender: t, enrichment: enr, pmNom: pmNom, supNom: supNom, reasons: reasons, score: score });
    });

    items.sort(function (a, b) { return b.score - a.score; });
    return items;
  }

  function _renderQueueRow(item) {
    var t = item.tender, enr = item.enrichment;
    // v3.4.84 — managers table (same logic as openTenderPanel)
    var _allContacts   = (STATE.managers || []).filter(function (m) { return !m.archived; });
    var managers    = _allContacts.filter(function (m) { return m.category === 'Project Management'; });
    if (!managers.length) managers = _allContacts;
    var supervisors = _allContacts.filter(function (m) { return m.category === 'Supervisor'; });
    if (!supervisors.length) supervisors = _allContacts;

    function personOptions(list, selected) {
      return ['<option value="">— pick —</option>'].concat(list.map(function (p) {
        return '<option value="' + escapeHtml(p.id) + '"' + (sameId(p.id, selected) ? ' selected' : '') + '>' + escapeHtml(p.name) + '</option>';
      })).join('');
    }
    var pmId  = (item.pmNom  && item.pmNom.person_id)  || '';
    var supId = (item.supNom && item.supNom.person_id) || '';

    var urgency = item.reasons.some(function (r) { return (r.kind === 'clash' && r.sev === 'red') || r.kind === 'urgent'; })
      ? 'urgent'
      : (item.reasons.some(function (r) { return r.kind === 'soon' || r.kind === 'ready'; }) ? 'soon' : 'norm');

    var tagHtml = item.reasons.map(function (r) {
      if (r.kind === 'clash')  return '<span class="pl-tag pl-tag-clash-' + r.sev + '">' + escapeHtml(r.text) + '</span>';
      if (r.kind === 'ready')  return '<span class="pl-tag" style="background:#dcfce7;color:#15803d">' + escapeHtml(r.text) + '</span>';
      if (r.kind === 'urgent') return '<span class="pl-tag" style="background:#fee2e2;color:#991b1b">' + escapeHtml(r.text) + '</span>';
      if (r.kind === 'soon')   return '<span class="pl-tag" style="background:#fef3c7;color:#92400e">' + escapeHtml(r.text) + '</span>';
      return '<span class="pl-tag pl-tag-low">' + escapeHtml(r.text) + '</span>';
    }).join('');

    var enrichSummary = enr && enr.start_date_estimated
      ? 'Start ' + fmtDate(enr.start_date_estimated)
        + (enr.duration_weeks ? ' · ' + enr.duration_weeks + 'w' : '')
        + (enr.peak_workers ? ' · ' + enr.peak_workers + 'pp' : '')
      : '<em style="color:#dc2626">no enrichment yet</em>';

    var canPush = t.stage === 'won' && enr
      && enr.start_date_estimated && enr.duration_weeks && enr.peak_workers
      && pmId && supId;

    return '<div class="pl-q-row pl-q-row-' + urgency + '" data-tender-id="' + escapeHtml(S(t.id)) + '">'
      + '  <div class="pl-q-head">'
      + '    <div>'
      + '      <div class="pl-q-title">' + escapeHtml(t.job_name || '(no name)') + '</div>'
      + '      <div class="pl-q-meta">' + escapeHtml(t.external_ref || '—') + ' · ' + escapeHtml(t.stage) + ' · ' + escapeHtml(t.client || '—') + ' · ' + fmtMoney(t.quote_value) + '</div>'
      + '      <div class="pl-q-meta">' + enrichSummary + '</div>'
      + '    </div>'
      + '  </div>'
      + (tagHtml ? '<div class="pl-q-tags">' + tagHtml + '</div>' : '')
      + '  <div class="pl-q-controls">'
      + '    <div><span class="pl-label">PM (manager)</span><select class="pl-select" data-row-pm="' + escapeHtml(S(t.id)) + '">' + personOptions(managers, pmId) + '</select></div>'
      + '    <div><span class="pl-label">Supervisor</span><select class="pl-select" data-row-sup="' + escapeHtml(S(t.id)) + '">' + personOptions(supervisors, supId) + '</select></div>'
      + '  </div>'
      + '  <div class="pl-q-actions">'
      + '    <button class="pl-btn" onclick="window.EQ_TENDER_PIPELINE.openTenderPanel(\'' + S(t.id) + '\')">Open</button>'
      + '    <button class="pl-btn" onclick="window.EQ_TENDER_PIPELINE._saveRowPencillings(\'' + S(t.id) + '\')">Save pencillings</button>'
      + (t.stage === 'likely'
          ? '<button class="pl-btn" onclick="window.EQ_TENDER_PIPELINE._advanceStage(\'' + S(t.id) + '\',\'won\')">Mark as Won</button>'
          : '')
      + '    <button class="pl-btn pl-btn-primary"'
      +        (canPush ? '' : ' disabled style="opacity:.5;cursor:not-allowed" title="Needs Won stage + start date + duration + peak workers + PM + Supervisor"')
      +        ' onclick="window.EQ_TENDER_PIPELINE._quickPushToSchedule(\'' + S(t.id) + '\')">Push to roster →</button>'
      + '  </div>'
      + '</div>';
  }

  // Save inline PM + Supervisor pickers from a queue row. Mirrors the
  // syncNomination logic in _savePanel — extracted here to avoid forcing
  // users back into the slide-over for the most common review action.
  function _saveRowPencillings(tenderId) {
    var pmEl  = document.querySelector('[data-row-pm="' + S(tenderId) + '"]');
    var supEl = document.querySelector('[data-row-sup="' + S(tenderId) + '"]');
    if (!pmEl || !supEl) { toast('Row not found'); return; }
    var pmId  = pmEl.value  || null;
    var supId = supEl.value || null;
    var enr   = STATE.tenderEnrichment[S(tenderId)] || {};
    var start = enr.start_date_estimated || null;
    var endWeek = (start && enr.duration_weeks) ? toMonday(addWeeks(start, enr.duration_weeks - 1)) : null;

    function syncNomination(role, personId) {
      var existing = STATE.nominations.filter(function (n) { return sameId(n.tender_id, tenderId) && n.role === role; });
      var promises = [];
      existing.forEach(function (n) {
        if (n.status === 'confirmed') return; // can't remove confirmed nominations from review
        if (!sameId(n.person_id, personId)) {
          promises.push(sbFetch('nominations?id=eq.' + encodeURIComponent(n.id), 'DELETE', null, 'return=minimal'));
        }
      });
      if (personId) {
        var already = existing.some(function (n) { return sameId(n.person_id, personId); });
        if (!already) {
          promises.push(sbFetch('nominations', 'POST', {
            tender_id:  tenderId,
            person_id:  personId,
            role:       role,
            is_primary: true,
            status:     'pencilled',
            start_week: start,
            end_week:   endWeek
          }, 'return=minimal').then(function () {
            ev('nominationAdded', { tender_id: tenderId, role: role, status: 'pencilled' });
          }));
        }
      }
      return Promise.all(promises);
    }

    Promise.all([syncNomination('pm', pmId), syncNomination('supervisor', supId)])
      .then(function () {
        ev('pencillingsSavedReview', { tender_id: tenderId, pm_set: !!pmId, sup_set: !!supId });
        toast('Pencillings saved', 'success');
        return loadAll();
      })
      .then(renderReview)
      .catch(function (err) {
        console.error('EQ[pipeline] pencillings save failed', err);
        toast('Save failed', 'error');
      });
  }

  // Stage-advance shortcut from the Review queue (e.g. "Mark as Won").
  // For Likely → Won the user can always go to the kanban and drag, but
  // having a button keeps the meeting flow uninterrupted.
  function _advanceStage(tenderId, toStage) {
    var t = STATE.tenders.find(function (x) { return sameId(x.id, tenderId); });
    if (!t) return;
    var fromStage = t.stage;
    sbFetch('tenders?id=eq.' + encodeURIComponent(tenderId), 'PATCH', {
      stage:      toStage,
      updated_at: new Date().toISOString()
    }, 'return=minimal').then(function () {
      t.stage = toStage;
      ev('tenderStageDragged', { tender_id: tenderId, from_stage: fromStage, to_stage: toStage, source: 'review_button' });
      toast('Stage updated to ' + toStage, 'success');
      renderReview();
    }).catch(function (err) {
      console.error('EQ[pipeline] advanceStage failed', err);
      toast('Stage update failed', 'error');
    });
  }

  // Fast-path Confirm Curve: write PM + Supervisor onto the schedule for
  // the full duration, flip the tender to confirmed, mark nominations
  // confirmed. The remaining (peak_workers - 2) team slots stay open and
  // can be filled later via the full Confirm Curve grid.
  function _quickPushToSchedule(tenderId) {
    var t = STATE.tenders.find(function (x) { return sameId(x.id, tenderId); });
    if (!t)             { toast('Tender not found', 'error');  return; }
    if (t.stage !== 'won') { toast('Only Won tenders can push to roster', 'error'); return; }

    var enr = STATE.tenderEnrichment[S(tenderId)];
    if (!enr || !enr.start_date_estimated || !enr.duration_weeks || !enr.peak_workers) {
      toast('Add start date + duration + peak workers in the slide-over first', 'error');
      return;
    }

    var noms = STATE.nominations.filter(function (n) { return sameId(n.tender_id, tenderId); });
    var pmNom  = noms.find(function (n) { return n.role === 'pm'; });
    var supNom = noms.find(function (n) { return n.role === 'supervisor'; });
    if (!pmNom || !pmNom.person_id || !supNom || !supNom.person_id) {
      toast('Pick PM and Supervisor first, then Save pencillings', 'error');
      return;
    }

    if (!t.site_id) {
      toast('Tender needs a site linked. Use Open → set site, or use Confirm Curve to create one.', 'error');
      return;
    }

    var msg = 'Push "' + (t.job_name || 'this tender') + '" to the roster?\n\n'
      + 'This will write ' + enr.duration_weeks + ' weeks of schedule for the PM and Supervisor.\n'
      + 'Remaining ' + Math.max(0, enr.peak_workers - 2) + ' worker slot(s) can be filled later via Confirm Curve.';
    if (!window.confirm(msg)) return;

    var start = toMonday(enr.start_date_estimated);
    var weeks = [];
    for (var i = 0; i < enr.duration_weeks; i++) {
      weeks.push({ monday: addWeeks(start, i), label: isoWeekKey(addWeeks(start, i)) });
    }
    var existingSite = STATE.sites.find(function (s) { return sameId(s.id, t.site_id); });
    var fillAbbr = (existingSite && existingSite.abbr) || (t.external_ref || '').slice(0, 8);

    var personIds = [pmNom.person_id, supNom.person_id];
    var scheduleRows = [];
    var pendingRows = [];
    personIds.forEach(function (pid) {
      weeks.forEach(function (w) {
        scheduleRows.push({
          person_id: pid,
          week:      w.label,
          mon: fillAbbr, tue: fillAbbr, wed: fillAbbr, thu: fillAbbr, fri: fillAbbr,
          sat: null, sun: null
        });
        pendingRows.push({
          tender_id:    tenderId,
          person_id:    pid,
          week:         w.label,
          mon: fillAbbr, tue: fillAbbr, wed: fillAbbr, thu: fillAbbr, fri: fillAbbr,
          sat: null, sun: null,
          confirmed_at: new Date().toISOString()
        });
      });
    });

    Promise.all([
      sbFetch('pending_schedule', 'POST', pendingRows, 'return=minimal'),
      sbFetch('schedule', 'POST', scheduleRows, 'return=minimal'),
      sbFetch('tenders?id=eq.' + encodeURIComponent(tenderId), 'PATCH', {
        stage: 'confirmed', updated_at: new Date().toISOString()
      }, 'return=minimal'),
      sbFetch('nominations?tender_id=eq.' + encodeURIComponent(tenderId), 'PATCH', {
        status: 'confirmed'
      }, 'return=minimal')
    ]).then(function () {
      ev('tenderPromoted',        { tender_id: tenderId, from_stage: 'won', path: 'review_quick_push' });
      ev('labourCurveConfirmed',  { tender_id: tenderId, rows_pushed: scheduleRows.length, path: 'review_quick_push' });
      toast('Pushed to roster — PM + Supervisor scheduled for ' + enr.duration_weeks + 'w', 'success');
      return loadAll();
    }).then(renderReview).catch(function (err) {
      console.error('EQ[pipeline] quick push failed', err);
      toast('Push failed — see console', 'error');
    });
  }

  // -- Notes side rail (was the "Capture a note" panel at the bottom) ---

  function _renderNotesSiderail() {
    var decisions = STATE.tenderReviewDecisions || [];
    var recent = decisions.slice(0, 8);
    var tendersById = {};
    STATE.tenders.forEach(function (t) { tendersById[S(t.id)] = t; });
    var tenderOptions = ['<option value="">— pick tender —</option>'].concat(STATE.tenders.map(function (t) {
      return '<option value="' + escapeHtml(t.id) + '">' + escapeHtml((t.external_ref || '') + ' · ' + (t.job_name || '')) + '</option>';
    })).join('');

    var rows = recent.map(function (d) {
      var t = tendersById[S(d.tender_id)];
      return '<div style="padding:8px 0;border-top:1px solid var(--border,#e5e7eb);font-size:12px">'
        + '<div style="color:var(--ink-3);font-size:10.5px;letter-spacing:.3px;text-transform:uppercase">' + fmtDate(d.reviewed_at) + ' · ' + escapeHtml(d.decision) + '</div>'
        + '<div style="font-weight:600;margin-top:1px">' + escapeHtml((t && t.job_name) || d.tender_id) + '</div>'
        + (d.notes ? '<div style="color:var(--ink-2);margin-top:2px">' + escapeHtml(d.notes) + '</div>' : '')
        + '</div>';
    }).join('');

    return '<h4>Capture decision</h4>'
      + '<div style="margin-bottom:6px"><select class="pl-select" id="pl-note-tender">' + tenderOptions + '</select></div>'
      + '<div style="margin-bottom:6px"><select class="pl-select" id="pl-note-decision">'
      + '  <option value="escalate">Escalate</option>'
      + '  <option value="kill">Kill</option>'
      + '  <option value="promote">Promote</option>'
      + '  <option value="hold">Hold</option>'
      + '  <option value="resolve_clash">Resolve clash</option>'
      + '</select></div>'
      + '<div style="margin-bottom:8px"><input class="pl-input" type="text" id="pl-note-text" placeholder="Note (optional)"></div>'
      + '<div style="margin-bottom:14px"><button class="pl-btn pl-btn-primary" style="width:100%" onclick="window.EQ_TENDER_PIPELINE._logDecision()">Capture</button></div>'
      + '<h4>Recent notes <span class="pl-pill">' + recent.length + '</span></h4>'
      + (recent.length ? rows : '<div style="color:var(--ink-3);font-size:12px;padding:8px 0">No notes logged yet.</div>');
  }

  function _logDecision() {
    var tid = document.getElementById('pl-note-tender').value;
    var decision = document.getElementById('pl-note-decision').value;
    var notes = document.getElementById('pl-note-text').value;
    if (!tid) { toast('Pick a tender first'); return; }
    var session = STATE.reviewSessionId || null;
    sbFetch('tender_review_decisions', 'POST', {
      session_id:  session,
      reviewed_at: new Date().toISOString(),
      tender_id:   tid,
      decision:    decision,
      notes:       notes || null
    }, 'return=minimal').then(function () {
      ev('decisionLogged', { tender_id: tid, decision: decision, session_id: session });
      toast('Note captured', 'success');
      renderReview();
    }).catch(function (err) {
      console.error('EQ[pipeline] decision log failed', err);
      toast('Note failed', 'error');
    });
  }

  function _quickDecision(tid, decision) {
    // Capture as a Notes row with an empty body — the framing is "captured", not "decided".
    if (!STATE.reviewSessionId) {
      _startSession();
    }
    sbFetch('tender_review_decisions', 'POST', {
      session_id:  STATE.reviewSessionId,
      reviewed_at: new Date().toISOString(),
      tender_id:   tid,
      decision:    decision,
      notes:       null
    }, 'return=minimal').then(function () {
      ev('decisionLogged', { tender_id: tid, decision: decision, session_id: STATE.reviewSessionId });
      // For kill, also archive the tender.
      if (decision === 'kill') {
        return sbFetch('tenders?id=eq.' + encodeURIComponent(tid), 'PATCH', {
          stage:       'lost',
          archived_at: new Date().toISOString()
        }, 'return=minimal');
      }
    }).then(function () {
      toast('Captured', 'success');
      renderReview();
    }).catch(function (err) {
      console.error('EQ[pipeline] quick decision failed', err);
      toast('Capture failed', 'error');
    });
  }

  // =====================================================================
  // Screen 5 — /pipeline/:tender_id/confirm-curve
  // =====================================================================

  var _confirmCurveTenderId = null;
  var _confirmCurveDraft = null; // { siteId, jobNumberId, weeks: [...], people: [...] }


  // =====================================================================
  // Screen 5 — /pipeline/:tender_id/confirm-curve
  // =====================================================================

  var _confirmCurveTenderId = null;
  var _confirmCurveDraft = null;

  function _goConfirmCurve(tenderId) {
    // v3.4.82: if enrichment is incomplete, open the slide-over first so the
    // user can fill in start date + duration before landing on Confirm Curve.
    var enr = STATE.tenderEnrichment[S(tenderId)] || {};
    if (!enr.start_date_estimated || !enr.duration_weeks) {
      toast('Fill in start date + duration first, then Promote →', 'info');
      _afterPanelSave = 'confirmCurve';
      openTenderPanel(tenderId);
      return;
    }
    _afterPanelSave = null;
    _confirmCurveTenderId = S(tenderId);
    _confirmCurveDraft = null;
    showPage('pipeline-confirm-curve');
  }

  function renderConfirmCurve() {
    ensureStyles();
    var host = document.getElementById('pipeline-confirm-curve-content');
    if (!host) return;
    if (!_confirmCurveTenderId) {
      host.innerHTML = '<div class="pl-wrap"><div class="pl-empty">No tender selected. Open one from the Pipeline kanban.</div></div>';
      return;
    }
    if (tenantDisabled()) {
      host.innerHTML = '<div class="pl-wrap"><div class="pl-card">Pipeline unavailable on this tenant.</div></div>';
      return;
    }
    loadAll().then(function () {
      var tender = STATE.tenders.find(function (t) { return sameId(t.id, _confirmCurveTenderId); });
      if (!tender) {
        host.innerHTML = '<div class="pl-wrap"><div class="pl-empty">Tender not found.</div></div>';
        return;
      }
      if (tender.stage !== 'won' && tender.stage !== 'confirmed') {
        host.innerHTML = '<div class="pl-wrap"><div class="pl-card">'
          + '<h3 style="margin:0 0 6px">Not ready to promote</h3>'
          + '<div style="font-size:13px">This tender is in stage <strong>' + escapeHtml(tender.stage) + '</strong>. Only <em>won</em> tenders can be promoted.</div>'
          + '</div></div>';
        return;
      }
      var enr = STATE.tenderEnrichment[S(tender.id)] || {};
      if (!enr.start_date_estimated || !enr.duration_weeks) {
        host.innerHTML = '<div class="pl-wrap"><div class="pl-card">'
          + '<h3 style="margin:0 0 6px">Enrichment missing</h3>'
          + '<div style="font-size:13px">Add a Start date and Duration in the tender panel before promoting.</div>'
          + '<button class="pl-btn pl-btn-primary" style="margin-top:8px" onclick="window.EQ_TENDER_PIPELINE.openTenderPanel(\'' + S(tender.id) + '\')">Open tender</button>'
          + '</div></div>';
        return;
      }

      if (!_confirmCurveDraft) _confirmCurveDraft = _buildCurveDraft(tender, enr);

      var sites = (STATE.sites || []).filter(function (s) { return !s.archived; });
      var siteOpts = ['<option value="">— pick or create —</option>'].concat(sites.map(function (s) {
        return '<option value="' + escapeHtml(s.id) + '"' + (sameId(s.id, _confirmCurveDraft.siteId) ? ' selected' : '') + '>' + escapeHtml(s.abbr || s.name) + ' — ' + escapeHtml(s.name) + '</option>';
      })).join('');

      host.innerHTML = ''
        + '<div class="pl-wrap">'
        + '  <h2 style="margin:0 0 4px">Confirm labour curve</h2>'
        + '  <div style="font-size:13px;color:var(--ink-3);margin-bottom:14px">' + escapeHtml(tender.external_ref || '') + ' · ' + escapeHtml(tender.job_name || '') + '</div>'
        + '  <div class="pl-card">'
        + '    <div class="pl-row">'
        + '      <div><span class="pl-label">Site</span><select class="pl-select" id="pl-cc-site">' + siteOpts + '</select></div>'
        + '      <div><span class="pl-label">Or create new site (abbr)</span><input class="pl-input" id="pl-cc-newsite" placeholder="e.g. DDCB" maxlength="12"></div>'
        + '      <div><span class="pl-label">Job number</span><input class="pl-input" id="pl-cc-jobno" placeholder="e.g. 16404" value="' + escapeHtml(enr.job_number || '') + '"></div>'
        + '    </div>'
        + '    <div style="font-size:11.5px;color:var(--ink-3);margin-top:4px">Pick an existing site OR type an abbr to create a new one on confirm. Job number is optional.</div>'
        + '  </div>'
        + '  <div class="pl-card">'
        + '    <h4 style="margin:0 0 6px">Draft curve — ' + _confirmCurveDraft.weeks.length + ' weeks × ' + _confirmCurveDraft.rows.length + ' people</h4>'
        + '    <div style="font-size:11.5px;color:var(--ink-3);margin-bottom:6px">Each cell holds the site abbr written into the live schedule. Blank cells stay blank. Placeholder rows need a real person assigned before push.</div>'
        + _renderCurveGrid()
        + '  </div>'
        + '  <div style="display:flex;gap:8px;justify-content:flex-end">'
        + '    <button class="pl-btn" onclick="showPage(\'pipeline\')">Cancel</button>'
        + '    <button class="pl-btn pl-btn-primary" onclick="window.EQ_TENDER_PIPELINE._confirmCurveSubmit()">Confirm and push to schedule</button>'
        + '  </div>'
        + '</div>';

      document.getElementById('pl-cc-site').addEventListener('change', function () {
        _confirmCurveDraft.siteId = this.value || null;
        _refreshCurveAbbr();
      });
    });
  }

  function _buildCurveDraft(tender, enr) {
    var start = toMonday(enr.start_date_estimated);
    var weeks = [];
    for (var i = 0; i < enr.duration_weeks; i++) {
      weeks.push({ monday: addWeeks(start, i), label: isoWeekKey(addWeeks(start, i)) });
    }
    var noms = STATE.nominations.filter(function (n) { return sameId(n.tender_id, tender.id); });
    var peopleRows = [];
    noms.forEach(function (n) {
      if (!n.person_id) return;
      var p = STATE.people.find(function (q) { return sameId(q.id, n.person_id); });
      if (!p) return;
      peopleRows.push({
        personId: p.id,
        name:     p.name,
        cells:    weeks.map(function () { return { mon: '', tue: '', wed: '', thu: '', fri: '', sat: '', sun: '' }; })
      });
    });
    var peak = enr.peak_workers || 0;
    var extras = Math.max(0, peak - peopleRows.length);
    for (var k = 0; k < extras; k++) {
      peopleRows.push({
        personId: null,
        name:     'Worker ' + (k + 1) + ' (placeholder)',
        placeholder: true,
        cells:    weeks.map(function () { return { mon: '', tue: '', wed: '', thu: '', fri: '', sat: '', sun: '' }; })
      });
    }
    var existingSite = STATE.sites.find(function (s) { return sameId(s.id, tender.site_id); });
    var fillAbbr = (existingSite && existingSite.abbr) || (tender.external_ref || '').slice(0, 8);
    peopleRows.forEach(function (r) {
      r.cells.forEach(function (c) {
        c.mon = c.tue = c.wed = c.thu = c.fri = fillAbbr;
      });
    });
    return {
      siteId:      tender.site_id || null,
      newSiteAbbr: '',
      newSiteName: tender.job_name || '',
      jobNumber:   enr.job_number || '',
      weeks:       weeks,
      rows:        peopleRows,
      fillAbbr:    fillAbbr
    };
  }

  function _refreshCurveAbbr() {
    var draft = _confirmCurveDraft;
    if (!draft) return;
    var site = STATE.sites.find(function (s) { return sameId(s.id, draft.siteId); });
    if (site && site.abbr) {
      draft.fillAbbr = site.abbr;
      draft.rows.forEach(function (r) {
        r.cells.forEach(function (c) {
          c.mon = c.tue = c.wed = c.thu = c.fri = draft.fillAbbr;
        });
      });
      var content = document.getElementById('pipeline-confirm-curve-content');
      var grid = content && content.querySelector('.pl-curve-grid');
      if (grid) grid.outerHTML = _renderCurveGrid();
    }
  }

  function _renderCurveGrid() {
    var draft = _confirmCurveDraft;
    if (!draft) return '';
    var supervisors = (STATE.people || []).filter(function (p) { return p.role === 'supervisor' && !p.archived; });
    var employees   = (STATE.people || []).filter(function (p) { return (p.role === 'employee' || p.role === 'apprentice') && !p.archived; });
    var all = supervisors.concat(employees);

    var header = '<th>Person</th>' + draft.weeks.map(function (w) {
      return '<th>' + escapeHtml(w.label) + '</th>';
    }).join('');
    var rows = draft.rows.map(function (r, ri) {
      var cells = r.cells.map(function (c, ci) {
        return '<td><input class="pl-curve-cell" data-r="' + ri + '" data-c="' + ci + '" value="' + escapeHtml(c.mon || '') + '"></td>';
      }).join('');
      var personCell;
      if (r.placeholder) {
        var opts = ['<option value="">— assign person —</option>'].concat(all.map(function (p) {
          return '<option value="' + escapeHtml(p.id) + '">' + escapeHtml(p.name) + '</option>';
        })).join('');
        personCell = '<select class="pl-select" data-placeholder="' + ri + '">' + opts + '</select>';
      } else {
        personCell = escapeHtml(r.name);
      }
      return '<tr><td>' + personCell + '</td>' + cells + '</tr>';
    }).join('');
    var html = '<table class="pl-curve-grid"><thead><tr>' + header + '</tr></thead><tbody>' + rows + '</tbody></table>';
    setTimeout(function () {
      document.querySelectorAll('.pl-curve-cell').forEach(function (el) {
        el.addEventListener('input', function () {
          var ri = parseInt(this.getAttribute('data-r'), 10);
          var ci = parseInt(this.getAttribute('data-c'), 10);
          var cell = _confirmCurveDraft.rows[ri].cells[ci];
          cell.mon = cell.tue = cell.wed = cell.thu = cell.fri = this.value;
        });
      });
      document.querySelectorAll('[data-placeholder]').forEach(function (el) {
        el.addEventListener('change', function () {
          var ri = parseInt(this.getAttribute('data-placeholder'), 10);
          var pid = this.value;
          if (!pid) return;
          var p = STATE.people.find(function (q) { return sameId(q.id, pid); });
          if (!p) return;
          _confirmCurveDraft.rows[ri].personId = p.id;
          _confirmCurveDraft.rows[ri].name = p.name;
          _confirmCurveDraft.rows[ri].placeholder = false;
          renderConfirmCurve();
        });
      });
    }, 0);
    return html;
  }

  function _confirmCurveSubmit() {
    var draft = _confirmCurveDraft;
    if (!draft) return;
    var tender = STATE.tenders.find(function (t) { return sameId(t.id, _confirmCurveTenderId); });
    if (!tender) return;
    var newSiteAbbr = (document.getElementById('pl-cc-newsite').value || '').trim();
    var jobNo = (document.getElementById('pl-cc-jobno').value || '').trim();

    var unassigned = draft.rows.some(function (r) { return r.placeholder; });
    if (unassigned) { toast('Assign all placeholder rows before confirming'); return; }

    function ensureSite() {
      if (draft.siteId) return Promise.resolve(draft.siteId);
      if (!newSiteAbbr) {
        toast('Pick a site or provide a new abbr');
        return Promise.reject(new Error('no site'));
      }
      return sbFetch('sites', 'POST', {
        name:         draft.newSiteName || tender.job_name || newSiteAbbr,
        abbr:         newSiteAbbr.toUpperCase(),
        address:      tender.site_address || null,
        track_hours:  true,
        budget_hours: 0
      }, 'return=representation').then(function (rows) {
        var row = rows && rows[0];
        return row && row.id;
      });
    }

    ensureSite().then(function (siteId) {
      if (!siteId) throw new Error('site creation failed');

      var pendingRows = [];
      draft.rows.forEach(function (r) {
        r.cells.forEach(function (c, ci) {
          if (!r.personId) return;
          pendingRows.push({
            tender_id: tender.id,
            person_id: r.personId,
            week:      draft.weeks[ci].label,
            mon: c.mon || null, tue: c.tue || null, wed: c.wed || null,
            thu: c.thu || null, fri: c.fri || null, sat: c.sat || null, sun: c.sun || null,
            confirmed_at: new Date().toISOString()
          });
        });
      });

      var pendingPromise = pendingRows.length
        ? sbFetch('pending_schedule', 'POST', pendingRows, 'return=minimal')
        : Promise.resolve();

      var scheduleRows = pendingRows.map(function (r) {
        return {
          person_id: r.person_id,
          week:      r.week,
          mon: r.mon, tue: r.tue, wed: r.wed, thu: r.thu, fri: r.fri, sat: r.sat, sun: r.sun
        };
      });
      var schedulePromise = scheduleRows.length
        ? sbFetch('schedule', 'POST', scheduleRows, 'return=minimal')
        : Promise.resolve();

      var jobNumberPromise = jobNo
        ? sbFetch('job_numbers', 'POST', { number: jobNo, client: tender.client || null, site_name: tender.job_name || null, status: 'active' }, 'return=representation').then(function (jr) { return jr && jr[0] && jr[0].id; })
        : Promise.resolve(null);

      return Promise.all([pendingPromise, schedulePromise, jobNumberPromise]).then(function (results) {
        var jobNumberId = results[2];
        var patch = { stage: 'confirmed', site_id: siteId };
        if (jobNumberId) patch.job_number_id = jobNumberId;
        return Promise.all([
          sbFetch('tenders?id=eq.' + encodeURIComponent(tender.id), 'PATCH', patch, 'return=minimal'),
          sbFetch('nominations?tender_id=eq.' + encodeURIComponent(tender.id), 'PATCH', { status: 'confirmed' }, 'return=minimal')
        ]).then(function () {
          ev('tenderPromoted', { tender_id: tender.id, from_stage: tender.stage });
          ev('labourCurveConfirmed', { tender_id: tender.id, rows_pushed: scheduleRows.length });
          toast('Confirmed — labour curve pushed to schedule', 'success');
          _confirmCurveDraft = null;
          _confirmCurveTenderId = null;
          showPage('pipeline');
        });
      });
    }).catch(function (err) {
      console.error('EQ[pipeline] confirmCurve failed', err);
      if (err && err.message !== 'no site') toast('Confirm failed — see console', 'error');
    });
  }

  // =====================================================================
  // Screen 6 — /pipeline/dashboard  (v3.4.82 new)
  // =====================================================================

  function renderPipelineDashboard() {
    ensureStyles();
    var host = document.getElementById('pipeline-dashboard-content');
    if (!host) return;
    if (tenantDisabled()) {
      host.innerHTML = '<div class="pl-wrap"><div class="pl-card">Pipeline unavailable on this tenant.</div></div>';
      return;
    }
    loadAll().then(function () {
      // v3.4.84 — build dept options for filter
      var _allNonArchived = STATE.tenders.filter(function (t) { return !t.archived_at; });
      var deptSet = new Set();
      _allNonArchived.forEach(function (t) { if (t.department) deptSet.add(t.department); });
      var deptOptions = ['<option value="">All depts</option>'];
      Array.from(deptSet).sort().forEach(function (d) {
        deptOptions.push('<option value="' + escapeHtml(d) + '"' + (d === _dashDeptFilter ? ' selected' : '') + '>' + escapeHtml(d) + '</option>');
      });
      var stageOptions = [
        { v: '', l: 'All stages' }, { v: 'watch', l: 'Watch (50%)' },
        { v: 'likely', l: 'Likely (70–90%)' }, { v: 'won', l: 'Awaiting Promotion' },
        { v: 'confirmed', l: 'Confirmed' }
      ].map(function (o) {
        return '<option value="' + o.v + '"' + (o.v === _dashStageFilter ? ' selected' : '') + '>' + o.l + '</option>';
      }).join('');

      // Apply filters
      var tenders = _allNonArchived.filter(function (t) {
        if (t.stage === 'lost') return false;
        if (_dashStageFilter && t.stage !== _dashStageFilter) return false;
        if (_dashDeptFilter  && t.department !== _dashDeptFilter) return false;
        return true;
      });

      var confirmed = tenders.filter(function (t) { return t.stage === 'confirmed'; });
      var active = tenders.filter(function (t) { return t.stage !== 'confirmed'; });

      var totalPipelineValue = active.reduce(function (s, t) { return s + (t.quote_value || 0); }, 0);
      var confirmedValue = confirmed.reduce(function (s, t) { return s + (t.quote_value || 0); }, 0);
      var confirmedHours = confirmed.reduce(function (s, t) {
        var e = STATE.tenderEnrichment[S(t.id)];
        return s + (e && e.hours_estimated ? Number(e.hours_estimated) : 0);
      }, 0);

      // Weekly hours forecast: spread each tender's hours evenly over its duration
      var weekBuckets = {};
      tenders.forEach(function (t) {
        if (t.stage === 'lost') return;
        var enr = STATE.tenderEnrichment[S(t.id)];
        if (!enr || !enr.start_date_estimated || !enr.duration_weeks || !enr.hours_estimated) return;
        var hoursPerWeek = Number(enr.hours_estimated) / enr.duration_weeks;
        var start = toMonday(enr.start_date_estimated);
        for (var w = 0; w < enr.duration_weeks; w++) {
          var wk = isoWeekKey(addWeeks(start, w));
          weekBuckets[wk] = (weekBuckets[wk] || 0) + hoursPerWeek;
        }
      });
      var sortedWeeks = Object.keys(weekBuckets).sort().slice(0, 26);
      var maxHours = sortedWeeks.reduce(function (m, k) { return Math.max(m, weekBuckets[k]); }, 1);

      // Build bar chart SVG
      var barW = 20, gap = 4, svgH = 100, labelH = 18;
      var svgW = sortedWeeks.length * (barW + gap);
      var bars = sortedWeeks.map(function (wk, i) {
        var h = Math.round((weekBuckets[wk] / maxHours) * (svgH - labelH));
        var x = i * (barW + gap);
        var y = svgH - labelH - h;
        var label = wk.slice(5); // "W18"
        var hrs = Math.round(weekBuckets[wk]);
        return '<rect x="' + x + '" y="' + y + '" width="' + barW + '" height="' + h + '" fill="var(--navy,#1e3a8a)" rx="2" opacity=".8"><title>' + escapeHtml(wk) + ': ' + hrs + 'h</title></rect>'
          + '<text x="' + (x + barW / 2) + '" y="' + (svgH - 2) + '" text-anchor="middle" font-size="7" fill="var(--ink-3,#666)">' + escapeHtml(label) + '</text>';
      }).join('');
      var chartHtml = sortedWeeks.length
        ? '<svg width="' + svgW + '" height="' + svgH + '" style="display:block;overflow:visible">' + bars + '</svg>'
        : '<div style="color:var(--ink-3);font-size:13px;padding:12px 0">No enriched tenders with start dates yet.</div>';

      // Stage order + colours
      var stageOrder = ['watch', 'likely', 'won', 'confirmed', 'lost'];
      var stageColour = { watch: '#6b7280', likely: '#2563eb', won: '#d97706', confirmed: '#16a34a', lost: '#dc2626' };
      var stageLabel  = { watch: 'Watch (50%)', likely: 'Likely (70–90%)', won: 'Awaiting Promotion', confirmed: 'Confirmed', lost: 'Lost' };

      var tableRows = tenders.slice().sort(function (a, b) {
        return stageOrder.indexOf(a.stage) - stageOrder.indexOf(b.stage) || _sortDueDate(a, b);
      }).map(function (t) {
        var enr = STATE.tenderEnrichment[S(t.id)] || {};
        var noms = STATE.nominations.filter(function (n) { return sameId(n.tender_id, t.id); });
        var pmNom = noms.find(function (n) { return n.role === 'pm'; });
        var supNom = noms.find(function (n) { return n.role === 'supervisor'; });
        // v3.4.84 — nominations now reference managers table; keep people fallback for old rows
        var pmPerson = pmNom && (
          (STATE.managers || []).find(function (m) { return sameId(m.id, pmNom.person_id); }) ||
          (STATE.people   || []).find(function (p) { return sameId(p.id, pmNom.person_id); })
        );
        var supPerson = supNom && (
          (STATE.managers || []).find(function (m) { return sameId(m.id, supNom.person_id); }) ||
          (STATE.people   || []).find(function (p) { return sameId(p.id, supNom.person_id); })
        );
        var finishDate = (enr.start_date_estimated && enr.duration_weeks)
          ? addWeeks(enr.start_date_estimated, enr.duration_weeks)
          : null;
        var dot = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + (stageColour[t.stage] || '#999') + ';margin-right:4px"></span>';
        return '<tr style="cursor:pointer" onclick="window.EQ_TENDER_PIPELINE.openTenderPanel(\'' + S(t.id) + '\')">'
          + '<td style="font-weight:600">' + escapeHtml(t.job_name || '—') + (enr.job_number ? '<div style="font-size:10px;color:var(--ink-3)">' + escapeHtml(enr.job_number) + '</div>' : '') + '</td>'
          + '<td>' + escapeHtml(t.client || '—') + '</td>'
          + '<td>' + dot + escapeHtml(stageLabel[t.stage] || t.stage) + '</td>'
          + '<td style="text-align:right;font-weight:600">' + fmtMoney(t.quote_value) + '</td>'
          + '<td style="text-align:center">' + (t.probability_pct != null ? t.probability_pct + '%' : '—') + '</td>'
          + '<td>' + fmtDate(en