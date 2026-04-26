# v3.4.10 — Apprentice year: contacts as source of truth (demo drop)

**Release date:** 2026-04-19
**Branch:** `demo` (eq-solves-field.netlify.app)
**Tag line:** Pick a year when you add the apprentice — the rest of the app
just knows.

---

## What shipped

A small but load-bearing fix to how apprentice year flows through EQ Field.
Before this drop, the **Add Person** modal in v3.4.6 already exposed a year
dropdown when the group was Apprentice — but it only wrote to
`people.licence` (free text like `"2nd Year"`). The **Apprentices** page,
however, reads `people.year_level` (int 1..4). That mismatch let the two
fields drift, and we caught two of five EQ-demo apprentices with the wrong
year on the Apprentices page.

v3.4.10 closes the loop. Contacts is now the source of truth for apprentice
year, the Apprentices page reads it cleanly, and a year badge on the
Contacts page makes the value visible at a glance.

### 1. Add Person now writes both columns

`scripts/people.js#savePerson` now derives `year_level` (int 1..4) from the
`Licence` text whenever the group is Apprentice, and writes it alongside
`licence` on both insert and update. Existing UI is unchanged — the v3.4.6
year dropdown still shows for Apprentice and replaces the free-text Licence
field exactly as before. The PATCH/POST payload just gets one extra column.

### 2. Year badge on the Contacts page

A compact 🎓 badge ("1st Yr" / "2nd Yr" / "3rd Yr" / "4th Yr") appears
next to the group pill on Apprentice rows in the Contacts list — desktop
table and mobile cards both. Same colour-coded palette as the TAFE-day
badge, sits to the right of the group badge and to the left of TAFE day so
the row reads:

> `[Apprentice] [🎓 2nd Yr] [TAFE: Wed]   Indigo White`

Implementation lives in `scripts/people.js` as two helpers:
`yearFromLicence()` (used on save) and `contactsYearBadge()` (used on
render). Year resolves from `people.year_level` first, then falls back to
parsing `people.licence` for legacy rows that haven't been re-saved yet.

### 3. Apprentices page reads contacts directly

`scripts/apprentices.js` now selects `year_level, licence` from `people`
when it builds the `uuidToName` lookup, and falls back to parsing the
licence string when `year_level` is null. That fallback means the
Apprentices page renders the right year even before the backfill SQL has
been run.

The fallback also shields against the case where someone edits the
`apprentice_profiles.year_level` directly via a modal but the `people` row
isn't refreshed — the contacts year still shows as the resolved value.

### 4. EQ demo data backfill (already applied)

Two of five apprentices on EQ demo had `people.year_level` out of sync with
`people.licence`:

| Name | licence | year_level (before) |
|---|---|---|
| Indigo White | 3rd Year | 1 |
| Kai Martin | 1st Year | 3 |

Backfill ran on EQ demo (`ktmjmdzqrogauaevbktn`) immediately, taking
`licence` as authoritative since it's what the Add Person UI has been
writing since v3.4.6. SKS prod will need the same backfill when this drop
promotes — same SQL, swap the project ref:

```sql
UPDATE public.people
SET year_level = CASE
  WHEN licence ~* '^1st\s+Year' THEN 1
  WHEN licence ~* '^2nd\s+Year' THEN 2
  WHEN licence ~* '^3rd\s+Year' THEN 3
  WHEN licence ~* '^4th\s+Year' THEN 4
  ELSE year_level
END
WHERE "group" = 'Apprentice'
  AND licence ~* '^[1-4](st|nd|rd|th)\s+Year';
```

---

## Database

No new migrations. Both columns already exist on `public.people`:
`licence text` (since v3.4.0) and `year_level int` (since the apprentice
profiles work).

---

### 5. Year column on People + Contacts CSV export

`scripts/import-export.js#exportPeopleCSV` and `exportContactsCSV` now emit
a **`Year`** column between `Group` and `Phone`. Value is the resolved
apprentice year (1..4) for Apprentice rows, blank for everyone else. Same
resolution rule as the badge — `year_level` first, fall back to parsing
`licence`. Header order:

```
Name,Group,Year,Phone,Email,Licence,Agency
```

CSV import is unchanged — the new `Year` column is ignored on round-trip
import for backward compatibility (the year still derives from Licence on
import, then `savePerson` writes year_level on the next edit).

---

## File changes

* **Edited:** `scripts/people.js` — `yearFromLicence()` + `contactsYearBadge()` helpers, year-level write on save, year-pill render in `renderContacts()` (desktop table + mobile cards)
* **Edited:** `scripts/apprentices.js` — select `year_level, licence` from `people`, fallback parse, `uuidToYear` lookup feeds `_resolvedYear` on each apprentice profile
* **Edited:** `scripts/import-export.js` — `_resolveApprenticeYear()` helper, `Year` column added to People + Contacts CSV exports
* **Edited:** `index.html` — header changelog block + footer version stamp → v3.4.10
* **Edited:** `scripts/app-state.js` — `APP_VERSION` → `3.4.10`
* **Edited:** `sw.js` — comment + `CACHE` → `eq-field-v3.4.10`
* **New:** `CHANGELOG-v3.4.10.md` (this file)

---

## Not in this drop

* **Backfill SQL on SKS prod** — not run yet. Wait until v3.4.10 promotes
  to `nspbmirochztcjijmcrx`, then run the same UPDATE as above.
* **Audit log entry on year change** — `savePerson()` doesn't currently
  log the year_level change separately from the rest of the person update.
  Acceptable for now since contacts edits already write a person-level
  audit row.
* **Migration to drop `apprentice_profiles.year_level`** — not done. The
  apprentice profiles table still has its own `year_level` column. The
  Apprentices page now prefers the `people` value via `_resolvedYear`, but
  the profile column remains as a safety net. Cleanup deferred until we're
  confident contacts is fully authoritative across both apps.
