// ─────────────────────────────────────────────────────────────
// scripts/supabase.js  —  EQ Solves Field
// Supabase REST wrapper, write queue, health monitoring,
// and all per-table save/delete helpers.
// Depends on: app-state.js (TENANT, SB_URL, SB_KEY, ORG_TABLES, STATE)
// ─────────────────────────────────────────────────────────────

// ── Internals ────────────────────────────────────────────────
let _sbOnline = true;
const _writeQueue = [];
const _sbPendingRows = {}; // lock: concurrent POSTs for same name+week
const MAX_WRITE_RETRIES = 5;

function _baseTable(path) {
  return path.split('?')[0];
}

function _isOrgTable(path) {
  const base = _baseTable(path);
  return (typeof ORG_TABLES !== 'undefined') && ORG_TABLES.includes(base);
}

function _isDemoTenant() {
  return (typeof TENANT !== 'undefined') && (TENANT.ORG_SLUG === 'eq' || TENANT.ORG_SLUG === 'demo');
}

function _sbLog(level, stage, details) {
  // Central logger so errors can be surfaced consistently.
  // level: 'warn' | 'error' | 'info'
  const prefix = 'EQ[sb:' + stage + ']';
  if (level === 'error')       console.error(prefix, details);
  else if (level === 'warn')   console.warn(prefix, details);
  else                         console.info(prefix, details);
}

// ── Write queue indicator ────────────────────────────────────
let _pendingWriteCount = 0;
let _saveIndicatorTimer = null;

function _setSaveIndicator(state) {
  // state: 'saving' | 'saved' | 'error' | 'clear'
  const el = document.getElementById('sync-status');
  if (!el) return;
  clearTimeout(_saveIndicatorTimer);
  if (state === 'saving') {
    el.textContent = '↑ Saving…';
    el.style.display = '';
    el.style.background = 'var(--amber-lt)';
    el.style.color      = 'var(--amber)';
  } else if (state === 'saved') {
    el.textContent = '✓ Saved';
    el.style.display = '';
    el.style.background = 'var(--green-lt)';
    el.style.color      = 'var(--green)';
    _saveIndicatorTimer = setTimeout(() => { el.style.display = 'none'; }, 2500);
  } else if (state === 'error') {
    el.textContent = '⚠ Unsaved';
    el.style.display = '';
    el.style.background = 'var(--red-lt)';
    el.style.color      = 'var(--red)';
  } else {
    el.style.display = 'none';
  }
}

// ── Core fetch wrapper ────────────────────────────────────────
async function sbFetch(path, method = 'GET', body = null, prefer = 'return=minimal') {
  // Demo / EQ tenant short-circuit — no network, in-memory only.
  // Returns mocked success so callers (saveTsCell, batch fill, etc.) don't
  // surface "save failed" toasts when we never intended to hit a DB.
  if (_isDemoTenant() || !SB_URL) {
    if (method === 'POST' && prefer && prefer.indexOf('return=representation') !== -1) {
      // Mint a fake id so _upsertById can write it back to the entity.
      const mk = () => 'demo-' + Math.random().toString(36).slice(2, 10);
      if (Array.isArray(body)) return body.map(r => ({ ...r, id: mk() }));
      if (body && typeof body === 'object') return [{ ...body, id: mk() }];
      return [{ id: mk() }];
    }
    return [];
  }

  let resolvedPath = path;

  // Auto-filter GET/DELETE by org_id
  if ((method === 'GET' || method === 'DELETE') && _isOrgTable(path)) {
    const sep = path.includes('?') ? '&' : '?';
    resolvedPath = path + sep + 'org_id=eq.' + TENANT.ORG_UUID;
  }

  // Auto-stamp POST body with org_id
  let resolvedBody = body;
  if (method === 'POST' && body && _isOrgTable(path)) {
    if (Array.isArray(body)) {
      resolvedBody = body.map(r => ({ ...r, org_id: TENANT.ORG_UUID }));
    } else if (typeof body === 'object') {
      resolvedBody = { ...body, org_id: TENANT.ORG_UUID };
    }
  }

  const headers = {
    'apikey':        SB_KEY,
    'Authorization': 'Bearer ' + SB_KEY,
    'Content-Type':  'application/json',
    'Prefer':        prefer
  };
  const fetchOpts = { method, headers };
  if (resolvedBody) {
    fetchOpts.body = typeof resolvedBody === 'string'
      ? resolvedBody
      : JSON.stringify(resolvedBody);
  }

  // Show saving indicator for writes (not in demo mode)
  const isDemo = _isDemoTenant();
  if (method !== 'GET' && !isDemo) {
    _pendingWriteCount++;
    _setSaveIndicator('saving');
  }

  try {
    const res = await fetch(SB_URL + '/rest/v1/' + resolvedPath, fetchOpts);
    if (!res.ok) {
      const err = await res.text();
      _sbLog('error', method + ' ' + resolvedPath, res.status + ' ' + err);
      throw new Error(res.status + ': ' + err);
    }
    _sbOnline = true;
    if (method !== 'GET' && !isDemo) {
      _pendingWriteCount = Math.max(0, _pendingWriteCount - 1);
      if (_pendingWriteCount === 0) _setSaveIndicator('saved');
    }
    const text = await res.text();
    return text ? JSON.parse(text) : [];
  } catch (err) {
    // Queue writes for later if offline (but not 4xx client errors — those will keep failing)
    const msg = String(err && err.message || err);
    const isClientError = /^4\d\d:/.test(msg);
    if (method !== 'GET' && !isClientError) {
      _writeQueue.push({ path, method, body, prefer, retries: 0 });
      try { localStorage.setItem('eq_write_queue', JSON.stringify(_writeQueue)); } catch (e) {}
      _sbOnline = false;
      updateOnlineStatus();
      if (!isDemo) {
        _pendingWriteCount = Math.max(0, _pendingWriteCount - 1);
        _setSaveIndicator('error');
      }
      _sbLog('warn', 'queued', method + ' ' + path);
      return [];
    }
    throw err;
  }
}

// ── Write queue ───────────────────────────────────────────────
// Restore queued writes from a previous session
try {
  const saved = localStorage.getItem('eq_write_queue');
  if (saved) {
    const arr = JSON.parse(saved);
    if (Array.isArray(arr)) _writeQueue.push(...arr);
    localStorage.removeItem('eq_write_queue');
  }
} catch (e) {}

async function flushWriteQueue() {
  if (!_writeQueue.length) return;
  const pending = [..._writeQueue];
  _writeQueue.length = 0;
  for (const item of pending) {
    try {
      await sbFetch(item.path, item.method, item.body, item.prefer);
    } catch (e) {
      // BUG-011 FIX: 5-retry limit prevents infinite loop on invalid requests.
      // Exponential backoff between retries: 0.5s, 1s, 2s, 4s, 8s.
      const retries = (item.retries || 0) + 1;
      if (retries <= MAX_WRITE_RETRIES) {
        _writeQueue.push({ ...item, retries });
        const delay = 500 * Math.pow(2, retries - 1);
        await new Promise(r => setTimeout(r, delay));
      } else {
        _sbLog('warn', 'drop', 'after ' + MAX_WRITE_RETRIES + ' retries: ' + item.method + ' ' + item.path);
      }
    }
  }
  updateOnlineStatus();
  try { localStorage.setItem('eq_write_queue', JSON.stringify(_writeQueue)); } catch (e) {}
}

// ── Connection monitoring ─────────────────────────────────────
function updateOnlineStatus(forceOffline) {
  const banner    = document.getElementById('offline-banner');
  const syncBadge = document.getElementById('sync-status');
  if (!banner) return;
  const offline = forceOffline === true || !navigator.onLine || !_sbOnline;
  if (offline) {
    if (TENANT.ORG_SLUG === 'eq' || TENANT.ORG_SLUG === 'demo') {
      banner.classList.remove('show');
      return;
    }
    banner.classList.add('show');
    banner.textContent = !navigator.onLine
      ? '⚠ No internet connection — changes are queued locally.'
      : '⚠ Cannot reach server — changes are queued locally. Check your network.';
  } else {
    banner.classList.remove('show');
  }
  if (syncBadge) {
    if (_writeQueue.length > 0) {
      syncBadge.textContent = _writeQueue.length + ' pending';
      syncBadge.style.display = 'inline-block';
    } else {
      syncBadge.style.display = 'none';
    }
  }
}

async function checkSupabaseHealth() {
  try {
    const resp = await fetch(SB_URL + '/rest/v1/', {
      method: 'HEAD',
      headers: { 'apikey': SB_KEY },
      signal: AbortSignal.timeout(5000)
    });
    _sbOnline = resp.ok;
  } catch (e) {
    _sbOnline = false;
  }
  updateOnlineStatus();
}

window.addEventListener('online',  () => { _sbOnline = true; flushWriteQueue(); updateOnlineStatus(); });
window.addEventListener('offline', () => updateOnlineStatus());

setInterval(checkSupabaseHealth, 30000);
setInterval(() => refreshData(true), 5 * 60 * 1000);

// ── Generic upsert-by-id ──────────────────────────────────────
// Matches the legacy pattern: if entity.id exists in the DB, PATCH it;
// otherwise POST a new row and write the generated id back onto `entity`.
// `temp*` ids (client-side placeholders) always POST.
async function _upsertById(table, entity, row) {
  const isTempId = !entity.id || String(entity.id).startsWith('temp');
  try {
    if (!isTempId) {
      const existing = await sbFetch(`${table}?id=eq.${entity.id}&select=id`);
      if (existing && existing.length > 0) {
        await sbFetch(`${table}?id=eq.${entity.id}`, 'PATCH', row);
        return;
      }
    }
    const res = await sbFetch(table, 'POST', row, 'return=representation');
    if (res && res[0]) entity.id = res[0].id;
  } catch (e) {
    // Fallback: if PATCH path failed (e.g. id no longer exists), POST a fresh row.
    _sbLog('warn', 'upsert-fallback', table + ' id=' + entity.id);
    const res = await sbFetch(table, 'POST', row, 'return=representation');
    if (res && res[0]) entity.id = res[0].id;
  }
}

// ── Per-table save helpers ────────────────────────────────────

async function savePersonToSB(person) {
  return _upsertById('people', person, {
    name:    person.name,
    phone:   person.phone   || null,
    group:   (typeof denormaliseGroupForDb === 'function' ? denormaliseGroupForDb(person.group) : person.group),
    licence: person.licence || null,
    agency:  person.agency  || null,
    email:   person.email   || null,
    pin:     person.pin     || null
  });
}

async function deletePersonFromSB(id) {
  await sbFetch(`people?id=eq.${id}`, 'DELETE');
}

async function saveSiteToSB(site) {
  return _upsertById('sites', site, {
    name:            site.name,
    abbr:            site.abbr,
    address:         site.address         || null,
    site_lead:       site.site_lead       || null,
    site_lead_phone: site.site_lead_phone || null
  });
}

async function deleteSiteFromSB(id) {
  await sbFetch(`sites?id=eq.${id}`, 'DELETE');
}

async function saveCellToSB(name, week, day, val) {
  const existing = STATE.schedule.find(r => r.name === name && r.week === week);

  // Conflict detection — check if row was modified by someone else
  if (existing && existing.id && existing.updated_at) {
    try {
      const current = await sbFetch('schedule?id=eq.' + existing.id + '&select=updated_at');
      if (current && current[0] && current[0].updated_at !== existing.updated_at) {
        showToast('⚠ This row was modified by someone else. Syncing latest data…');
        await refreshData();
        return;
      }
    } catch (e) { /* non-blocking */ }
  }

  if (existing && existing.id && !String(existing.id).startsWith('temp')) {
    // True upsert — UNIQUE (name, week, org_id) constraint exists
    const patch = {}; patch[day] = val || null;
    await sbFetch(`schedule?id=eq.${existing.id}`, 'PATCH', patch);
  } else {
    // No DB row yet — lock to prevent duplicate POSTs for same name+week
    const lockKey = `${name}||${week}`;
    if (_sbPendingRows[lockKey]) {
      await _sbPendingRows[lockKey];
      const entry = STATE.schedule.find(r => r.name === name && r.week === week);
      if (entry && entry.id) {
        const patch = {}; patch[day] = val || null;
        await sbFetch(`schedule?id=eq.${entry.id}`, 'PATCH', patch);
      }
      return;
    }
    const row = {
      name, week,
      mon: null, tue: null, wed: null, thu: null,
      fri: null, sat: null, sun: null
    };
    if (existing) {
      Object.assign(row, {
        mon: existing.mon || null, tue: existing.tue || null,
        wed: existing.wed || null, thu: existing.thu || null,
        fri: existing.fri || null, sat: existing.sat || null,
        sun: existing.sun || null
      });
    }
    row[day] = val || null;
    const postPromise = sbFetch('schedule', 'POST', row, 'return=representation');
    _sbPendingRows[lockKey] = postPromise;
    try {
      const res = await postPromise;
      if (existing && res && res[0]) {
        existing.id         = res[0].id;
        existing.updated_at = res[0].updated_at;
      }
      // Update index
      if (STATE.scheduleIndex) STATE.scheduleIndex[`${name}||${week}`] = existing || res[0];
    } finally {
      delete _sbPendingRows[lockKey];
    }
  }
}

async function saveManagerToSB(mgr) {
  return _upsertById('managers', mgr, {
    name:     mgr.name,
    role:     mgr.role     || null,
    category: mgr.category || null,
    phone:    mgr.phone    || null,
    email:    mgr.email    || null
  });
}

async function deleteManagerFromSB(id) {
  await sbFetch(`managers?id=eq.${id}`, 'DELETE');
}

// ── Bulk import helpers ───────────────────────────────────────

// Bulk import helpers — wipe-and-replace the tenant's rows for a table.
// DELETE errors are logged (not silently swallowed) so we can catch bad
// policy/schema drift early instead of ending up with duplicated rows.

async function _purgeTenantRows(table) {
  try {
    await sbFetch(`${table}?org_id=eq.${TENANT.ORG_UUID}`, 'DELETE');
  } catch (e) {
    _sbLog('warn', 'purge', table + ': ' + (e && e.message || e));
    throw e; // let caller decide whether to continue
  }
}

async function importPeopleToSB(people) {
  try { await _purgeTenantRows('people'); } catch (e) { return; }
  if (!people.length) return;
  const rows = people.map(p => ({
    name:    p.name,
    phone:   p.phone   || null,
    group:   (typeof denormaliseGroupForDb === 'function' ? denormaliseGroupForDb(p.group) : p.group),
    email:   p.email   || null,
    licence: p.licence || null,
    agency:  p.agency  || null
  }));
  await sbFetch('people', 'POST', rows);
}

async function importSitesToSB(sites) {
  if (!sites.length) return;
  try { await _purgeTenantRows('sites'); } catch (e) { return; }
  await new Promise(r => setTimeout(r, 300));
  const rows = sites.map(s => ({ name: s.name, abbr: s.abbr, address: s.address || null }));
  await sbFetch('sites', 'POST', rows);
}

async function importScheduleToSB(schedule, weeks) {
  if (!schedule.length) return;
  const weeksToDelete = weeks && weeks.length
    ? weeks
    : [...new Set(schedule.map(r => r.week))];
  for (const w of weeksToDelete) {
    try {
      await sbFetch('schedule?week=eq.' + encodeURIComponent(w), 'DELETE');
    } catch (e) {
      _sbLog('warn', 'delete-week', w + ': ' + (e && e.message || e));
    }
  }
  await new Promise(r => setTimeout(r, 500));
  const rows = schedule.map(r => ({
    name: r.name, week: r.week,
    mon: r.mon || null, tue: r.tue || null, wed: r.wed || null,
    thu: r.thu || null, fri: r.fri || null, sat: r.sat || null, sun: r.sun || null
  }));
  for (let i = 0; i < rows.length; i += 100) {
    await sbFetch('schedule', 'POST', rows.slice(i, i + 100));
    await new Promise(r => setTimeout(r, 300));
  }
}

async function importManagersToSB(managers) {
  try { await _purgeTenantRows('managers'); } catch (e) { return; }
  if (!managers.length) return;
  const rows = managers.map(m => ({
    name:     m.name,
    role:     m.role     || null,
    category: m.category || null,
    phone:    m.phone    || null,
    email:    m.email    || null
  }));
  await sbFetch('managers', 'POST', rows);
}
