# v3.4.22 — SKS-promotion blockers: id handling

**Date:** 2026-04-26
**Scope:** EQ Field demo (eq-solves-field.netlify.app). Prerequisite for the
demo→main promotion (`PROMOTE-v3.4.9-to-v3.4.21-TO-SKS.md` — superseded by
`PROMOTE-v3.4.9-to-v3.4.22-TO-SKS.md` once written).

---

## Why

Two id-handling problems were found while writing the demo→main promotion runbook:

1. **`_isRealDbId` (scripts/supabase.js) was uuid-only since v3.4.13.** SKS
   uses `bigint` PKs. Running the demo branch as-is on SKS would have made
   `_isRealDbId(12345)` return `false`, treating every real row as a tempId.
   Every `_upsertById`, `saveCellToSB`, `saveRowToSB`, and batch rollup would
   have fallen through to `POST` — duplicating rows on every edit.

2. **Latent uuid-in-onclick bug** in `people.js` / `managers.js` / `sites.js`
   / `roster.js` — flagged in v3.4.21's changelog as deferred. On `eq` tenant
   these handlers receive uuid ids from the live Supabase (not SEED data)
   and the same `editPerson(${p.id})` raw interpolation that broke leave
   would silently break Edit/Remove on every Person/Manager/Site row.

Neither blocker manifests on demo today (demo SEED ids are integers; remove
buttons currently work because `parseInt` succeeds on integers) — but both
would fire on prod the moment the merge ships.

## What's in

### `scripts/supabase.js` — `_isRealDbId` tenant-gated

```js
const _UUID_RE   = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const _BIGINT_RE = /^[1-9][0-9]{0,18}$/;
function _isRealDbId(id) {
  if (id === null || id === undefined) return false;
  const s = String(id);
  if (typeof TENANT !== 'undefined' && TENANT.ORG_SLUG === 'sks') {
    return _BIGINT_RE.test(s);
  }
  return _UUID_RE.test(s);
}
```

The `eq` demo SEED-id rejection (101..318 → fails uuid regex) is preserved
because the `sks` branch only fires on the SKS tenant.

### `scripts/people.js`

- Two `editPerson(${p.id})` onclick sites quoted to `editPerson('${p.id}')`.
- Two `confirmRemove(parseInt(this.dataset.pid), …)` calls drop the
  `parseInt` (was producing NaN on uuid).
- Three `STATE.people.find(x => x.id === id)` / `=== parseInt(id)` calls
  coerced to `String(x.id) === String(id)`.

### `scripts/managers.js`

- Two `openEditManager(${m.id})` onclick sites quoted.
- Two `confirmRemoveManager(parseInt(this.dataset.mid), …)` calls drop
  `parseInt`.
- `find()` in `openEditManager` and `saveManager` (existing-row check + the
  duplicate-name guard) coerced to `String()`.

### `scripts/sites.js`

- One `openEditSite(${site.id})` onclick site quoted.
- One `confirmDeleteSite(parseInt(this.dataset.sid), …)` drops `parseInt`.
- `find()` in `openEditSite` and `saveSite` (existing-row check + the
  duplicate-abbr guard) coerced to `String()`.

### `scripts/roster.js`

- One `editPerson(${p.id})` onclick site quoted (the per-row Edit icon in
  the editor view).

### Version bumps

- `sw.js`: header comment + CACHE name → `v3.4.22`.
- `scripts/app-state.js`: `APP_VERSION` `'3.4.20'` → `'3.4.22'` (was lagging
  since v3.4.21 didn't touch app-state).
- `index.html`: header comment, new changelog block, footer span → v3.4.22.

## What's NOT in

- Any schema change. No migrations needed for v3.4.22.
- Any change to leave/dashboard/jobnumbers — those were closed in v3.4.21.

## Verification (on demo)

1. Footer shows `v3.4.22`.
2. Open Contacts (people) → click ✎ on any row → modal opens with that
   person's data. Save → row updates without duplicating.
3. Open Contacts → click ✕ → confirm dialog shows the right name → confirm →
   row removes.
4. Open Supervision (managers) → ✎ + ✕ same checks.
5. Open Sites → ✎ + ✕ same checks.
6. Open Roster → click ✎ next to a name in the editor → person modal opens.
7. No console errors on any of the above.

## Unblocks

The demo→main promotion can now proceed safely. SKS will receive working
PATCHes on edits (not duplicate inserts) and working Edit/Remove buttons on
Contacts/Supervision/Sites/Roster despite SKS having different id types.
