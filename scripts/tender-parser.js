/*! Property of EQ — all rights reserved. Unauthorised use prohibited. */
// ─────────────────────────────────────────────────────────────
// scripts/tender-parser.js  —  EQ Solves Field
// SKS Smartsheet tender XLSX parser + DB diff helper.
//
// Parses an xlsx export from the SKS "Open 12m Tenders (State)"
// Smartsheet and returns a structured diff against the existing
// rows in the tenders table.
//
// Load order: AFTER SheetJS (window.XLSX). Currently eq-solves-field
// does NOT pull SheetJS — the tender pipeline import screen must add
// this tag to index.html BEFORE scripts/tender-parser.js:
//
//   <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.20.3/xlsx.full.min.js"></script>
//
// The parser tolerates window.XLSX being absent at load — only the
// async parseTenderXlsx() call will reject. All other helpers
// (probabilityToStage / parseProbability / diffAgainstExisting etc.)
// are pure and run independently. Tests exercise the pure helpers.
//
// Usage:
//   const { rows, errors } = await window.EQ_TENDER_PARSER.parseTenderXlsx(file);
//   const diff = window.EQ_TENDER_PARSER.diffAgainstExisting(rows, existingTenders);
//   const summary = window.EQ_TENDER_PARSER.summariseImport(diff, rows);
//
// Source: ported from eq-field-pipeline/src/lib/tender-parser.js
// (vitest-style ESM). Behaviour is identical — only the module
// boundary changes (ESM → IIFE / window-export).
//
// Plan ref: docs/cowork-prompt-v3.md §"Screens to build"
// ─────────────────────────────────────────────────────────────

(function () {
  'use strict';

  // =====================================================================
  // Column mapping — column header → tender field
  // Error if any required column missing.
  // =====================================================================

  var COLUMN_MAP = {
    'SITE / JOB NAME':      'job_name',
    'SKS Quote No':         'external_ref',
    'Due Date':             'due_date',
    'Status':               'tender_status',
    'Project $ Amount':     'quote_value',
    'SKS Estimator':        'estimator',
    'Builder/Client Name':  'client',
    'Market Vertical':      'vertical',
    'SKS Dept':             'department',
    'Site Address':         'site_address',
    'SKS Entity':           'entity',
    'Probability':          '_probability_raw' // parsed into pct + label below
  };

  var REQUIRED_COLUMNS = Object.keys(COLUMN_MAP);

  // =====================================================================
  // probabilityToStage — probability % → pipeline_stage enum value
  // =====================================================================

  function probabilityToStage(pct) {
    if (pct === null || pct === undefined) return 'tracked';
    if (pct === 100) return 'won';
    if (pct >= 70)   return 'likely';
    if (pct >= 50)   return 'watch';
    return 'tracked'; // 0%, 25%, anything below 50%
  }

  // =====================================================================
  // parseProbability — "70% - In Negotiation" → { pct: 70, label: "..." }
  // Handles blanks, malformed strings, and edge cases.
  // =====================================================================

  function parseProbability(raw) {
    if (raw === null || raw === undefined || raw === '') {
      return { pct: null, label: null };
    }
    var str = String(raw).trim();
    var match = str.match(/^(\d{1,3})\s*%/);
    if (!match) return { pct: null, label: str };
    var pct = parseInt(match[1], 10);
    if (pct < 0 || pct > 100) return { pct: null, label: str };
    return { pct: pct, label: str };
  }

  // =====================================================================
  // excelSerialToIsoDate — Excel serial / Date / ISO string → "YYYY-MM-DD"
  // Excel epoch is 1899-12-30 (accounts for the 1900 leap-year bug).
  // SheetJS with cellDates:true returns Date objects, but Smartsheet
  // exports often arrive as raw serial numbers — handle both.
  // =====================================================================

  function excelSerialToIsoDate(serial) {
    if (serial === null || serial === undefined || serial === '') return null;
    if (serial instanceof Date && !isNaN(serial)) {
      return serial.toISOString().slice(0, 10);
    }
    if (typeof serial === 'string') {
      var d = new Date(serial);
      if (!isNaN(d)) return d.toISOString().slice(0, 10);
      return null;
    }
    if (typeof serial === 'number' && serial > 0) {
      var epoch = Date.UTC(1899, 11, 30);
      var ms = epoch + serial * 86400 * 1000;
      var d2 = new Date(ms);
      if (!isNaN(d2)) return d2.toISOString().slice(0, 10);
    }
    return null;
  }

  // =====================================================================
  // parseQuoteValue — handles blanks, "0", "$65,000", numeric strings
  // =====================================================================

  function parseQuoteValue(raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    if (typeof raw === 'number') return raw === 0 ? null : raw;
    if (typeof raw === 'string') {
      var cleaned = raw.replace(/[$,\s]/g, '');
      if (cleaned === '' || cleaned === '0') return null;
      var n = parseFloat(cleaned);
      return isNaN(n) ? null : n;
    }
    return null;
  }

  // =====================================================================
  // normaliseExternalRef — "SKS - 16404" → "SKS-16404"
  // Strip whitespace, uppercase, single dash. Idempotent join key.
  // =====================================================================

  function normaliseExternalRef(raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    return String(raw).trim().toUpperCase().replace(/\s*-\s*/g, '-');
  }

  // =====================================================================
  // parseTenderXlsx — xlsx file (or ArrayBuffer) → { rows, errors }
  // Requires window.XLSX (SheetJS) to be loaded.
  // =====================================================================

  function parseTenderXlsx(file, options) {
    var opts = options || {};
    var valueFloor = (typeof opts.valueFloor === 'number') ? opts.valueFloor : 100000;

    if (!window.XLSX) {
      return Promise.resolve({
        rows: [],
        errors: [{ severity: 'fatal', message: 'SheetJS (window.XLSX) not loaded. Add the CDN tag to index.html.' }]
      });
    }

    // Accept File / Blob (has .arrayBuffer()) or raw ArrayBuffer.
    var bufferPromise;
    if (file && typeof file.arrayBuffer === 'function') {
      bufferPromise = file.arrayBuffer();
    } else if (file instanceof ArrayBuffer) {
      bufferPromise = Promise.resolve(file);
    } else {
      return Promise.resolve({
        rows: [],
        errors: [{ severity: 'fatal', message: 'parseTenderXlsx expected a File, Blob, or ArrayBuffer.' }]
      });
    }

    return bufferPromise.then(function (buffer) {
      var errors = [];
      var rows = [];

      var workbook;
      try {
        workbook = window.XLSX.read(buffer, { cellDates: true });
      } catch (e) {
        errors.push({ severity: 'fatal', message: 'Could not read xlsx: ' + e.message });
        return { rows: [], errors: errors };
      }

      var sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        errors.push({ severity: 'fatal', message: 'No sheets found in file' });
        return { rows: [], errors: errors };
      }
      var sheet = workbook.Sheets[sheetName];
      var jsonRows = window.XLSX.utils.sheet_to_json(sheet, {
        defval: null,
        raw: false,
        dateNF: 'yyyy-mm-dd'
      });

      if (jsonRows.length === 0) {
        errors.push({ severity: 'fatal', message: 'Sheet is empty' });
        return { rows: [], errors: errors };
      }

      // Validate required columns exist
      var firstRow = jsonRows[0];
      var presentColumns = Object.keys(firstRow);
      var missingColumns = REQUIRED_COLUMNS.filter(function (c) {
        return presentColumns.indexOf(c) === -1;
      });
      if (missingColumns.length > 0) {
        errors.push({
          severity: 'fatal',
          message: 'Missing required columns: ' + missingColumns.join(', ')
        });
        return { rows: [], errors: errors };
      }

      jsonRows.forEach(function (row, index) {
        var externalRef = normaliseExternalRef(row['SKS Quote No']);
        if (!externalRef) {
          errors.push({
            severity: 'warning',
            rowIndex: index,
            message: 'Row ' + (index + 2) + ': missing SKS Quote No, skipping'
          });
          return;
        }

        var prob = parseProbability(row['Probability']);
        var quoteValue = parseQuoteValue(row['Project $ Amount']);
        var dueDate = excelSerialToIsoDate(row['Due Date']);

        function trimOrNull(v) {
          if (v === null || v === undefined) return null;
          var s = String(v).trim();
          return s === '' ? null : s;
        }

        rows.push({
          external_ref:      externalRef,
          job_name:          trimOrNull(row['SITE / JOB NAME']),
          client:            trimOrNull(row['Builder/Client Name']),
          estimator:         trimOrNull(row['SKS Estimator']),
          vertical:          trimOrNull(row['Market Vertical']),
          department:        trimOrNull(row['SKS Dept']),
          entity:            trimOrNull(row['SKS Entity']),
          site_address:      trimOrNull(row['Site Address']),
          quote_value:       quoteValue,
          due_date:          dueDate,
          tender_status:     trimOrNull(row['Status']),
          probability_pct:   prob.pct,
          probability_label: prob.label,
          stage:             probabilityToStage(prob.pct),
          below_threshold:   quoteValue === null || quoteValue < valueFloor,
          _row_index:        index + 2 // xlsx is 1-indexed + header
        });
      });

      return { rows: rows, errors: errors };
    });
  }

  // =====================================================================
  // diffAgainstExisting — parsed rows vs DB rows → { new, stageChanged,
  // valueChanged, unchanged, missing }
  //
  // `existing` should be an array of objects with at least
  // { external_ref, probability_pct, quote_value }.
  // =====================================================================

  function diffAgainstExisting(parsedRows, existing) {
    var existingByRef = new Map();
    existing.forEach(function (e) { existingByRef.set(e.external_ref, e); });

    var parsedRefs = new Set();
    parsedRows.forEach(function (r) { parsedRefs.add(r.external_ref); });

    var diff = {
      'new':         [],
      stageChanged:  [],
      valueChanged:  [],
      unchanged:     [],
      missing:       [] // in DB but not in parsed
    };

    parsedRows.forEach(function (row) {
      var prev = existingByRef.get(row.external_ref);
      if (!prev) { diff['new'].push(row); return; }

      var prevPct = (prev.probability_pct === undefined) ? null : prev.probability_pct;
      var rowPct  = (row.probability_pct  === undefined) ? null : row.probability_pct;
      var prevVal = (prev.quote_value     === undefined) ? null : prev.quote_value;
      var rowVal  = (row.quote_value      === undefined) ? null : row.quote_value;

      var stageChanged = prevPct !== rowPct;
      var valueChanged = prevVal !== rowVal;

      if (stageChanged && valueChanged) {
        diff.stageChanged.push(Object.assign({}, row, { previous: prev }));
        diff.valueChanged.push(Object.assign({}, row, { previous: prev }));
      } else if (stageChanged) {
        diff.stageChanged.push(Object.assign({}, row, { previous: prev }));
      } else if (valueChanged) {
        diff.valueChanged.push(Object.assign({}, row, { previous: prev }));
      } else {
        diff.unchanged.push(row);
      }
    });

    existing.forEach(function (prev) {
      if (!parsedRefs.has(prev.external_ref)) {
        diff.missing.push(prev);
      }
    });

    return diff;
  }

  // =====================================================================
  // summariseImport — what to write into tender_import_runs row
  // =====================================================================

  function summariseImport(diff, parsedRows) {
    return {
      rows_total:            parsedRows.length,
      rows_new:              diff['new'].length,
      rows_stage_changed:    diff.stageChanged.length,
      rows_value_changed:    diff.valueChanged.length,
      rows_missing:          diff.missing.length,
      rows_below_threshold:  parsedRows.filter(function (r) { return r.below_threshold; }).length
    };
  }

  // ---------------------------------------------------------------------
  // Exports
  // ---------------------------------------------------------------------

  window.EQ_TENDER_PARSER = {
    // Constants (exposed for the import screen + tests)
    COLUMN_MAP:          COLUMN_MAP,
    REQUIRED_COLUMNS:    REQUIRED_COLUMNS,
    // Pure helpers
    probabilityToStage:  probabilityToStage,
    parseProbability:    parseProbability,
    excelSerialToIsoDate: excelSerialToIsoDate,
    parseQuoteValue:     parseQuoteValue,
    normaliseExternalRef: normaliseExternalRef,
    // I/O + diff
    parseTenderXlsx:     parseTenderXlsx,
    diffAgainstExisting: diffAgainstExisting,
    summariseImport:     summariseImport
  };
})();
