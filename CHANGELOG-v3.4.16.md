# v3.4.16 — Birthdays + Work Anniversaries

**Date:** 2026-04-21
**Scope:** EQ Solves Field (demo tenant ready; SKS promotion gated by `PROMOTE-v3.4.16-18-TO-MAIN.md`)

---

## What's new

- Staff records now capture **Birthday (day + month)** and **Start Date**.
  Year of birth is deliberately **not** stored — day + month only.
- Dashboard gains a **Birthdays & Anniversaries — next 30 days** card,
  sorted by days-until. Today's events are tinted.
- Contacts list shows inline **🎂 Today** and **🎉 N yrs** chips on the
  matching day, in both desktop table and mobile card views.
- People CSV export / import round-trips `Birthday` (DD-MMM) and
  `StartDate` (YYYY-MM-DD) columns. Import accepts DD-MMM, DD/MM,
  D Mon, and 5-March style entries.

## Schema

New nullable columns on `public.people`:

| column       | type     | notes                                                  |
|--------------|----------|--------------------------------------------------------|
| `dob_day`    | smallint | 1..31, CHECK constrained                               |
| `dob_month`  | smallint | 1..12, CHECK constrained                               |
| `start_date` | date     | used for anniversary year delta                        |

Indexes:

- `people_dob_month_day_idx` (partial, month+day not null)
- `people_start_date_idx` (partial, start_date not null)

Migration file: `migrations/2026-04-21_people_dob_start_date.sql`.
Applied to EQ demo Supabase (`ktmjmdzqrogauaevbktn`) on 2026-04-21.
SKS prod (`nspbmirochztcjijmcrx`) apply deferred — see
`PROMOTE-v3.4.16-18-TO-MAIN.md`.

## Files changed

- `scripts/app-state.js` — `APP_VERSION = '3.4.16'`; SEED people rows
  enriched with `dob_day`, `dob_month`, `start_date` for demo visibility.
- `scripts/people.js` — new helpers (`personHasDob`, `_daysUntilMD`,
  `personBirthdayLabel`, `personIsBirthdayToday`,
  `personAnniversaryYearsToday`). `openAddPerson`, `editPerson`,
  `savePerson` now read/write the three new fields.
  `renderContacts` gains `todayBadges(p)` inline chips.
- `scripts/dashboard.js` — new `renderAnniversariesWidget()` invoked
  at the end of `renderDashboard`. Early-return paths also trigger
  the widget so an empty pending-leave list doesn't hide it.
- `scripts/import-export.js` — `_fmtCsvBirthday`, `_parseCsvBirthday`
  helpers; People + Contacts CSV export add Birthday + StartDate
  columns; import parses them when present (backwards compatible).
- `scripts/supabase.js` — `savePersonToSB` and `importPeopleToSB`
  pass the new columns.
- `index.html` — new form fields in the Person modal (Day / Month
  selects + date input); `loadFromSupabase` maps the new columns
  in both demo and live paths; new `#dashboard-anniversaries`
  container on the Dashboard page; v3.4.16 header block.
- `sw.js` — cache bumped to `eq-field-v3.4.16`.
- `migrations/2026-04-21_people_dob_start_date.sql` — new.

## Compatibility notes

- Legacy rows without DOB / start_date render normally — the chip
  helpers, widget, and CSV formatters all null-safe.
- Partial DOB entries (day without month or vice versa) are cleared
  on save so the widget never sees a half-populated date.
- SKS group alias (`SKS Direct` ↔ `Direct`) is untouched by this
  change; the new columns are plain passthroughs.
- Analytics stripping on SKS tenant (v3.4.14) continues to apply —
  no new telemetry introduced.

## Verification checklist (demo)

- [ ] Open Contacts → Add Person → new Birthday + Start Date fields visible
- [ ] Save a person with today's DOB → 🎂 Today chip appears immediately
- [ ] Dashboard shows "Birthdays & Anniversaries — next 30 days" card
- [ ] Export People CSV → Birthday and StartDate columns populated
- [ ] Re-import the same CSV → values round-trip cleanly
- [ ] sw.js cache invalidates on reload (hard refresh clears old card)
