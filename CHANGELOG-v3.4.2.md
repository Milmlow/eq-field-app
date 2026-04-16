# EQ Field — v3.4.2

**Release date:** 16 April 2026
**Focus:** Supervisor leave · TAFE reclassification · TAFE day auto-fill

---

## 1. Supervisors can now apply for leave

- "Your Name" dropdown in the leave request modal now merges `STATE.people` and `STATE.managers`, deduped by name and sorted A–Z.
- Supervisors show a `— Supervisor` suffix in the list so it's obvious who is who.
- Approver dropdown stays as managers-only.
- Self-approval guard already existed (line 279 in `leave.js`) — unchanged.
- **Roster write-back skipped for supervisors.** Since supervisors are not on the roster (`STATE.people`), approving their leave no longer writes into the `schedule` table. The leave request itself is the record of record.

## 2. TAFE is education, not leave

- `TAFE` and `TRAINING` removed from `LEAVE_TERMS`.
- New `EDUCATION_TERMS = ['TAFE', 'TRAINING']` exported from `scripts/app-state.js`.
- New helper `isEducation(code)` in `scripts/roster.js`.
- `siteColor()` now returns **purple** for education codes (was amber/leave).
- `isAbsence()` now returns **false** for education — the leave & absence panels will no longer count TAFE as a person being absent.
- Dashboard, absence panel, and the AI assistant's system prompt all updated consistently.

## 3. Apprentice TAFE day — opt-in, never destructive

### Contacts
- New **TAFE Day** dropdown in the Add/Edit Person modal (None · Mon · Tue · Wed · Thu · Fri).
- Visible on all group types but labelled "apprentices" as a hint.
- New small purple badge on the Contacts table when a TAFE day is set: `🎓 Wed`.

### Editor
- New button: **🎓 Apply TAFE Day** (next to Copy Last Week).
- Only fills **empty** cells — never overwrites existing roster content.
- Only touches apprentices (`group === 'Apprentice'`) who have a nominated `tafe_day`.
- Skips any date that falls inside a configured TAFE holiday range.
- Toast summarises: `3 TAFE days filled · 1 skipped (cell not empty) · 2 skipped (holiday)`
- All writes go through the existing `saveCellToSB()` path — same audit and realtime as manual edits.

### TAFE holidays
- New button: **📆 TAFE Holidays** opens a config modal.
- Supports any number of date ranges with an optional label (e.g. "Term 2 break").
- Stored in `app_config` keyed `eq.tafe_holidays`, with localStorage fallback (same pattern as the existing leave CC list).

## 4. Schema change

Prepared migration: `migrations/2026-04-16_tafe_day_and_holidays.sql`

- Adds `people.tafe_day` (nullable text, CHECK constraint).
- Seeds `app_config.eq.tafe_holidays` row so PATCH works on first save.
- **Not applied to SKS prod — awaiting explicit approval.**

**Recommended rollout:**
1. Apply migration to demo (`ktmjmdzqrogauaevbktn`) first.
2. Deploy ZIP to `eq-solves-field.netlify.app` demo branch.
3. Test: supervisor leave, TAFE day fill, holiday skip.
4. Apply migration to SKS prod (`nspbmirochztcjijmcrx`).
5. Deploy ZIP to `sks-nsw-labour.netlify.app`.

## 5. Files changed

```
 index.html                         — script load order, editor toolbar, TAFE modal, people hydration, AI prompt
 scripts/app-state.js               — APP_VERSION 3.4.2, LEAVE_TERMS split, EDUCATION_TERMS, seed TAFE days
 scripts/roster.js                  — isEducation(), siteColor() purple branch, isAbsence() excludes ed
 scripts/leave.js                   — merged name dropdown, supervisor write-back guard
 scripts/people.js                  — tafe_day read/write, contact badge
 scripts/supabase.js                — tafe_day in save + import payloads
 scripts/tafe.js                    — NEW: holidays config, applyTafeDayForWeek()
 sw.js                              — cache bump v3.4.2 + tafe.js precache
 migrations/2026-04-16_*.sql        — NEW
 CHANGELOG-v3.4.2.md                — NEW (this file)
```

## 6. What was NOT changed (deliberate)

- No changes to existing leave request approval flow beyond the write-back guard.
- No auto-fill on roster open — "Apply TAFE Day" is a manual, explicit action (matches the "don't cause issues with live version" instruction).
- The `people.tafe_day` column is nullable — existing rows stay untouched until a supervisor edits a person.
- No mass backfill of TAFE across past weeks.
