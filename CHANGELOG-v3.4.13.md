# v3.4.13 — Schedule PATCH fix (integer SEED IDs)

Hotfix: silences the `invalid input syntax for type uuid: "306"`
400 flood that appeared in the browser console whenever the demo
tenant touched the schedule table.

## Root cause

All our primary keys (`schedule`, `people`, `sites`, `managers`) are
`uuid` in Postgres. `scripts/app-state.js` still seeds demo data with
integer IDs:

```js
STATE.schedule = SEED.schedule.map(r => ({ id: r.id || Math.random(), ... }));
// SEED.schedule rows are 101..118, 201..218, 301..318
```

Five save-path call sites guarded the PATCH-vs-POST branch with:

```js
if (entity.id && !String(entity.id).startsWith('temp')) { /* PATCH */ }
```

That guard happily lets `306` through. PostgREST then rejects the
URL `?id=eq.306` with a 400. 18 rows × every schedule interaction =
the console flood Royce screenshotted.

## Fix

- `scripts/supabase.js` — new `_isRealDbId()` helper. Returns `true`
  only when the value matches a real UUID (`^[0-9a-f]{8}-…$`).
  Rejects `null`, `undefined`, `temp_*` offline-mint IDs, and the
  integer SEED IDs.
- `scripts/supabase.js` — 3 call sites swapped to `_isRealDbId()`:
  - line 321 (`saveEntity` temp-ID branch)
  - line 376 (`sbUpsertSchedule` existing-row branch)
  - line 483 (`sbUpsertPeople` existing-row branch)
- `scripts/batch.js` — 2 call sites swapped to `_isRealDbId()`:
  - line 156 (`applyBatch` PATCH-or-POST branch)
  - line 269 (`savePromises` PATCH-or-POST branch)

Net effect: integer-ID rows now POST on first save (server mints a
real UUID, client state updated), then PATCH thereafter — same path
as a temp-ID row.

## Not changed

- No schema changes. No RLS changes. No event changes.
- Non-demo tenants (SKS) are unaffected — they never carried integer
  IDs in the first place.
- Analytics pipeline (v3.4.11/v3.4.12) unchanged.

## Verify after deploy

1. Hard-reload `https://eq-solves-field.netlify.app` in incognito.
2. Open the schedule view. Touch any schedule row (drag, assign,
   re-assign).
3. Console should show no `invalid input syntax for type uuid` 400s.
   First edit per row is a POST to `/schedule` (201); subsequent
   edits are PATCHes against the returned uuid.
4. Supabase `schedule` table — new rows should appear with proper
   uuid primary keys.

## Ops notes

- `sw.js` cache bumped to `eq-field-v3.4.13` so existing clients
  invalidate and pick up patched supabase.js + batch.js.
- `scripts/app-state.js` `APP_VERSION = '3.4.13'`.
- `index.html` — header banner + sidebar footer span updated.
