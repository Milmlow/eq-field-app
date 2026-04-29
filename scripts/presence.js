/*! Property of EQ — all rights reserved. Unauthorised use prohibited. */
// ─────────────────────────────────────────────────────────────
// scripts/presence.js  —  EQ Solves Field
// "X is editing cell Y" indicators on the roster editor.
// v3.4.47 — first cut.
//
// Lifecycle:
//   • renderEditor() attaches focus/blur handlers via inline
//     onfocus/onblur on the cell <input>s. Those call
//     presenceFocus(name, week, day) and presenceBlur(name, week, day).
//   • presenceFocus upserts a row into roster_presence and starts
//     a 10s heartbeat to refresh focused_at while the cell is held.
//   • presenceBlur deletes the row and stops the heartbeat.
//   • Postgres realtime delivers INSERT/UPDATE/DELETE events on
//     roster_presence to scripts/realtime.js, which forwards them
//     to _presenceApplyChange below.
//   • _presenceApplyChange maintains _activePresence (Map keyed
//     by `week||name||day`) and calls _presenceRender to outline
//     affected cells.
//   • Stale rows (focused_at < now - 15s) are filtered visually
//     so a tab close before blur fires doesn't leave a phantom.
//
// Depends on: app-state.js (TENANT, currentManagerName), supabase.js (sbFetch)
// ─────────────────────────────────────────────────────────────

const _activePresence = new Map();    // `${week}||${name}||${day}` -> { manager, focused_at, ts }
let _presenceHeartbeat = null;
let _presenceCurrent   = null;        // { name, week, day } currently held by THIS client
const _PRESENCE_FRESH_MS = 15000;     // outline shown only while focused_at is within last 15s

function _presenceKey(week, name, day) {
  return `${week}||${name}||${day}`;
}

function _isOwnPresence(record) {
  if (!record) return false;
  if (typeof currentManagerName === 'undefined' || !currentManagerName) return false;
  return String(record.manager_name) === String(currentManagerName);
}

// ── Outbound: track THIS client's focus ──────────────────────
async function presenceFocus(name, week, day) {
  if (typeof TENANT === 'undefined' || !TENANT.ORG_UUID) return;
  if (!currentManagerName) return;                  // require an unlocked supervisor
  if (typeof sbFetch !== 'function') return;
  if (typeof SB_URL !== 'undefined' && !SB_URL) return; // demo tenant — no DB

  _presenceCurrent = { name, week, day };
  // Upsert via POST with merge-duplicates so a focus → blur → focus on
  // the same cell refreshes focused_at instead of conflicting.
  const row = {
    manager_name: currentManagerName,
    week, cell_name: name, cell_day: day,
    focused_at: new Date().toISOString()
  };
  try {
    await sbFetch(
      'roster_presence?on_conflict=org_id,manager_name,week,cell_name,cell_day',
      'POST', row, 'resolution=merge-duplicates,return=minimal'
    );
  } catch (e) { /* non-blocking */ }

  // Heartbeat: refresh focused_at every 10s while held so a slow editor
  // doesn't drop below the 15s freshness threshold on other clients.
  clearInterval(_presenceHeartbeat);
  _presenceHeartbeat = setInterval(async () => {
    if (!_presenceCurrent) return;
    const heartbeat = {
      manager_name: currentManagerName,
      week:         _presenceCurrent.week,
      cell_name:    _presenceCurrent.name,
      cell_day:     _presenceCurrent.day,
      focused_at:   new Date().toISOString()
    };
    try {
      await sbFetch(
        'roster_presence?on_conflict=org_id,manager_name,week,cell_name,cell_day',
        'POST', heartbeat, 'resolution=merge-duplicates,return=minimal'
      );
    } catch (e) { /* non-blocking */ }
  }, 10000);
}

async function presenceBlur(name, week, day) {
  if (typeof TENANT === 'undefined' || !TENANT.ORG_UUID) return;
  if (!currentManagerName) return;
  if (typeof sbFetch !== 'function') return;
  if (typeof SB_URL !== 'undefined' && !SB_URL) return;

  clearInterval(_presenceHeartbeat); _presenceHeartbeat = null;
  _presenceCurrent = null;

  const m = encodeURIComponent(currentManagerName);
  const w = encodeURIComponent(week);
  const n = encodeURIComponent(name);
  const d = encodeURIComponent(day);
  try {
    await sbFetch(
      `roster_presence?manager_name=eq.${m}&week=eq.${w}&cell_name=eq.${n}&cell_day=eq.${d}`,
      'DELETE'
    );
  } catch (e) { /* non-blocking */ }
}

// Best-effort cleanup if the user closes the tab while a cell is held.
window.addEventListener('beforeunload', () => {
  if (_presenceCurrent && currentManagerName) {
    // Use sendBeacon for survivable cleanup. Falls back to noop if not supported.
    try {
      const m = encodeURIComponent(currentManagerName);
      const w = encodeURIComponent(_presenceCurrent.week);
      const n = encodeURIComponent(_presenceCurrent.name);
      const d = encodeURIComponent(_presenceCurrent.day);
      // No sendBeacon for DELETE in PostgREST without auth headers — best
      // effort only. The pg_cron 5-minute cleanup mops up anything we miss.
      navigator.sendBeacon &&
        navigator.sendBeacon(
          `${SB_URL}/rest/v1/roster_presence?manager_name=eq.${m}&week=eq.${w}&cell_name=eq.${n}&cell_day=eq.${d}`,
          new Blob([''], { type: 'application/x-www-form-urlencoded' })
        );
    } catch (e) {}
  }
});

// ── Inbound: realtime → maintain _activePresence + render ────
function _presenceApplyChange(evType, record, oldRec) {
  if (evType === 'DELETE') {
    if (oldRec) {
      const k = _presenceKey(oldRec.week, oldRec.cell_name, oldRec.cell_day);
      const v = _activePresence.get(k);
      if (v && v.manager === oldRec.manager_name) _activePresence.delete(k);
    }
    _presenceRender();
    return;
  }
  if (!record) return;
  // Skip our own presence — we don't outline our own focused cell.
  if (_isOwnPresence(record)) return;

  const k = _presenceKey(record.week, record.cell_name, record.cell_day);
  _activePresence.set(k, {
    manager:    record.manager_name,
    focused_at: record.focused_at,
    ts:         Date.now()
  });
  _presenceRender();
}
window._presenceApplyChange = _presenceApplyChange;

// ── Render: outline cells with active presence ───────────────
function _presenceRender() {
  // Only run on pages with editor cells visible.
  if (typeof currentPage === 'undefined' || currentPage !== 'editor') return;

  // Clear all existing outlines first — cheap; presence is rare.
  document.querySelectorAll('#editor-content .presence-outline').forEach(el => {
    el.classList.remove('presence-outline');
    el.removeAttribute('data-presence-by');
  });

  // Apply outlines for fresh presence rows.
  const cutoff = Date.now() - _PRESENCE_FRESH_MS;
  const week = (typeof STATE !== 'undefined' && STATE.currentWeek) || '';
  for (const [key, v] of _activePresence) {
    // Stale ones get reaped at next render or when realtime delivers
    // a fresh update; for now we simply don't render them.
    const ageMs = Date.now() - new Date(v.focused_at).getTime();
    if (ageMs > _PRESENCE_FRESH_MS) continue;

    const [pWeek, pName, pDay] = key.split('||');
    if (pWeek !== week) continue;   // viewing a different week — ignore
    const sel = `#editor-content input[data-name="${CSS.escape(pName)}"][data-week="${CSS.escape(pWeek)}"][data-day="${pDay}"]`;
    const inp = document.querySelector(sel);
    if (!inp) continue;
    const wrapper = inp.closest('.editor-day') || inp.parentElement;
    if (!wrapper) continue;
    wrapper.classList.add('presence-outline');
    wrapper.setAttribute('data-presence-by', v.manager + ' is editing');
  }
}
window._presenceRender = _presenceRender;

// Re-render on a low-frequency tick so stale rows fade out without
// requiring a fresh realtime delivery.
setInterval(_presenceRender, 5000);
