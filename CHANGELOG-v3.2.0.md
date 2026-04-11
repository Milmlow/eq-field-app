# EQ Solves — Field  ·  v3.2.0 Clean-up

**Date:** 2026-04-10
**Scope:** Code hygiene, mobile drawer sync, Supabase data layer hardening.
**Breaking changes:** None — pure refactor + bug fixes. All page IDs, function names, and DB shapes unchanged.

---

## 1. Mobile drawer & nav sync

### Bug fixed — active state on bottom nav
`MOBILE_NAV_PAGES` was `['roster','schedule','contacts','managers']` but the actual bottom bar shows **roster, schedule, contacts, dashboard, leave**. Result: tapping Dashboard or Leave from the bottom bar incorrectly highlighted the "More" button instead.
Now matches the rendered bar exactly. Added `DRAWER_NAV_PAGES` as a named constant instead of an inline array.

### Drawer reorganised to match sidebar
Previously the mobile drawer was a flat 10-item list. Now grouped into three labelled sections mirroring the desktop sidebar:

- **Forecast** — Dashboard · Calendar · Sites · Supervision
- **Manage** — Edit Roster · Add Person · Import / Export · Help
- **Testing** — Job Numbers · Leave · Timesheets  (all marked `BETA`)

### CSS additions (`styles/mobile.css`)
- `.drawer-label` — section header, uppercase, muted
- `.drawer-item .beta-tag` — amber pill, pushed to right with `margin-left: auto`

### Discoverability fix
Leave is now also reachable from the drawer (previously only from the bottom bar). Timesheets and Job Numbers now carry BETA badges in the drawer, consistent with the sidebar.

---

## 2. Supabase data layer hardening  (`scripts/supabase.js`)

### Refactor — generic upsert
Three near-identical `save*ToSB` helpers (people, sites, managers — each ~20 lines with the same PATCH-or-POST dance, including a fallback POST on catch) are replaced by a single `_upsertById(table, entity, row)`. Per-table helpers are now 7 lines each. **~60 lines removed, zero behaviour change.**

### Client-error vs network-error distinction
Previously, any failing write (including 4xx validation errors like a missing column) was pushed onto the offline queue, then retried 5 times, then dropped silently. Now:
- 4xx responses (`/^4\d\d:/` on the error message) propagate to the caller instead of being queued — they will never succeed on retry, so queueing is harmful.
- 5xx and network errors still queue as before.

### Exponential backoff on queue flush
`flushWriteQueue()` now sleeps 0.5s → 1s → 2s → 4s → 8s between successive retries of a failing write, instead of slamming the server immediately. Prevents retry storms when Supabase is briefly unhealthy.
Constant `MAX_WRITE_RETRIES = 5` named at the top of the file.

### Silent DELETE swallow — fixed
`importPeopleToSB`, `importSitesToSB`, `importManagersToSB` used to write the exact line `try { ... DELETE ... } catch (e) {}` — meaning a failed purge would silently proceed to INSERT, duplicating the tenant's data. Replaced with `_purgeTenantRows(table)` which logs the failure and rethrows; the caller now bails out on purge failure instead of doubling rows.

`importScheduleToSB` now logs week-delete failures with context instead of a bare `console.warn`.

### Central structured logger
New `_sbLog(level, stage, details)` replaces ad-hoc `console.error`/`console.warn` calls. All messages prefixed with `EQ[sb:<stage>]` so they're filterable in the browser devtools:

```
EQ[sb:GET people?select=name] 403 permission denied
EQ[sb:queued] POST schedule
EQ[sb:drop] after 5 retries: PATCH schedule?id=eq.42
EQ[sb:upsert-fallback] sites id=temp-17
EQ[sb:purge] managers: 403 insufficient_privilege
```

### `_isDemoTenant()` helper
The magic string check `TENANT.ORG_SLUG === 'eq' || TENANT.ORG_SLUG === 'demo'` appeared in three places. Extracted.

---

## 3. Dead code removal

- **`_isOrgTable` duplicated** in both `scripts/app-state.js` and `scripts/supabase.js`. The app-state copy was unreferenced (supabase.js declares its own and shadows the global via script order). Removed from app-state.js; kept a comment pointing readers to supabase.js.
- **`sanitizeHTML`** in `scripts/utils.js` — defined but never called anywhere in the codebase. Removed. Header comment in `index.html` updated to list `escHtml` (which is actually used in `scripts/leave.js` for email templates) instead.
- **Stale `console.log` calls** in `scripts/auth.js` and `scripts/jobnumbers.js` promoted to `console.warn` with structured prefixes and the underlying error message. The SW registration log in `index.html` was left in place — it's useful on first deploy and fires once.

---

## 4. Version bump

- `scripts/app-state.js` → `APP_VERSION = '3.2.0'`
- `sw.js` → `CACHE = 'eq-field-v3.2.0'`  (forces refresh on next load)
- `index.html` header comment and sidebar footer updated to `v3.2.0`

---

## What was NOT changed (deferred, noted for later)

1. **Client-side tenancy is still a defence-in-depth problem.** The anon key + `org_id=eq.<uuid>` pattern means any technically curious user can spoof their org. The only real fix is JWT-scoped RLS (Supabase Auth). Same story as `sks-nsw-labour`; call it v4.0.
2. **`saveCellToSB` conflict-detection** is best-effort and has a race — two clients editing the same cell can both win their pre-write check then race the PATCH. Low priority until we see it happen in the wild.
3. **Write queue persistence** uses `localStorage` which is per-device. If a user's device dies with queued writes, they're gone. Could be moved to IndexedDB for resilience, but complexity vs. payoff is poor.
4. **Rate-limit policies** on the DB side were already tightened in the Supabase clean-up earlier today; no app-side change needed.
5. **Supabase health check interval** (30s) and **auto-refresh** (5min) are hardcoded. Could move to `app_config` but not urgent.

---

## Files touched

```
index.html                   (header, version footer, drawer markup, MOBILE_NAV_PAGES bug, utils comment)
sw.js                        (version + cache name bump)
scripts/app-state.js         (APP_VERSION, removed duplicate _isOrgTable)
scripts/supabase.js          (major refactor: upsert helper, logger, backoff, error handling)
scripts/utils.js             (removed unused sanitizeHTML)
scripts/auth.js              (console.log → console.warn with context)
scripts/jobnumbers.js        (console.log → console.warn with context)
styles/mobile.css            (new .drawer-label and .drawer-item .beta-tag rules)
```

Rough line-count delta:
- `scripts/supabase.js`: **−28 lines** (408 → 380) despite adding the logger, backoff, and comments — the upsert consolidation is the win.
- Total JS: unchanged structure, materially less duplication.
