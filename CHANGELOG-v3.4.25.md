# v3.4.25 — parseInt(uuid) cluster (audit follow-up N1)

**Date:** 2026-04-26
**Scope:** EQ Field demo (eq-solves-field.netlify.app). Closes the EQ-only
bulk-ops bug surfaced during the pre-merge audit (`AUDIT-REPORT-PR9-promotion.md`).

---

## Why

The pre-merge audit for the SKS promotion (PR #9) flagged an outstanding
`parseInt(<uuid string>)` cluster that the v3.4.22 sweep missed.

Eleven call sites across five files were calling `parseInt()` on values
that, on the EQ tenant, are uuid strings. `parseInt('5e6f-abc...')` returns
NaN, which silently broke every dependent operation:

- Bulk PIN ops on Contacts page never matched any rows.
- Batch fill from the schedule view selected 0 people.
- Apprentice self-assessment, feedback, recurring-feedback, training
  records, and rotation forms all loaded but couldn't find the profile.
- Staff timesheet gate (PIN login) couldn't look up the person.
- Journal entry submit couldn't find the apprentice profile.

SKS prod was unaffected because bigint ids parse cleanly through
`parseInt`. But the upcoming demo→main merge would have shipped this bug
to SKS in latent form (would fire the moment SKS migrated any table to
uuid PKs in future).

## What's in

### `scripts/people.js`

- Bulk PIN ops (`applyBulkPin`, `clearBulkPin`): drop `parseInt(cb.dataset.id)`.
- Both downstream `STATE.people.find(x => x.id === person.id)` calls
  coerced to `String(x.id) === String(person.id)`.

### `scripts/batch.js`

- `selectedIds = new Set(... .map(cb => parseInt(cb.value)))` becomes
  `new Set(... .map(cb => cb.value))`.
- Downstream `STATE.people.filter(p => selectedIds.has(p.id))` now uses
  `selectedIds.has(String(p.id))` so it works for both uuid and bigint.

### `scripts/apprentices.js`

- Five `parseInt(document.getElementById('XX-apprentice-id').value)` reads
  drop the parseInt across `submitSelfAssessment`, `submitFeedback`,
  `submitRecurringFeedback`, `submitTrainingRecord`, `submitRotation`.
- Three `parseInt(editId)` call sites in profile save flow dropped.
- `apprenticeProfiles.find/findIndex(p => p.id === <id>)` String-coerced
  (lines 346, 374, 540, 813, 1126, 1211, 1521, 1567).
- `renderApprenticeProfile(parseInt(editId))` now passes editId raw.

### `scripts/auth.js`

- `checkStaffTsLogin`: `personId = parseInt(sel.value)` becomes
  `personId = sel.value`. Downstream URL interpolation
  `people?id=eq.${personId}` works with string ids.

### `scripts/journal.js`

- `submitJournalEntry`: drop `parseInt` on `jn-apprentice-id` read.
  `apprenticeProfiles.find` String-coerced.

### `parseInt PRESERVED` where the value is genuinely an integer

- `parseInt(pinVal)` in `people.js:511` — PIN value, 4-digit integer.
- `parseInt(yearEl.value)` in `apprentices.js:188` — apprentice year 1–4.
- `parseInt(year)` in `apprentices.js:1507` — same.
- `parseInt(competencyId)` and `parseInt(ratingVal)` in
  `apprentices.js:1867–68` — competency id (integer in DB) and rating (1–5).

### Version bumps

- `sw.js` cache + header → `v3.4.25`.
- `scripts/app-state.js` `APP_VERSION` → `'3.4.25'`.
- `index.html` header comment, new changelog block, footer span → v3.4.25.

## Verification (on demo)

1. Footer shows v3.4.25.
2. Open Contacts → click "Bulk PIN" → select multiple staff →
   apply a PIN → confirm rows update in Supabase (no silent no-op).
3. Open Schedule → click "Batch Fill" → select people + days +
   site → apply → confirm cells fill across the matrix.
4. Open Apprentices (BETA) → edit an apprentice profile → save →
   confirm changes persist.
5. Submit a self-assessment, feedback entry, journal entry → confirm
   each writes to Supabase without error.
6. Open the staff timesheet gate (`/staff-ts` flow if exposed) →
   PIN login should resolve the person and accept correct PIN.
7. No console errors on any of the above.

## Unblocks

PR #9 (demo→main) audit-finding N1 closed. Merge can proceed via the
audit's recommended R1–R6 resolutions plus the B1 (TAFE migration) +
B2 (`EQ_SECRET_SALT`) blockers.
