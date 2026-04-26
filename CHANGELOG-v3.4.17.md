# v3.4.17 — Timesheet Completion Clarity

**Date:** 2026-04-21
**Scope:** EQ Solves Field (demo tenant ready; SKS promotion gated by `PROMOTE-v3.4.16-18-TO-MAIN.md`)

---

## What's new

- **Inline progress bar** above the timesheet grid — shows
  `X of Y complete (Z%)` for the current week with a colour-coded
  fill (red < 60, amber 60–99, green at 100).
- **"N pending" toggle** next to the bar. Clicking it expands a list
  of staff whose timesheets aren't complete for the selected week,
  tagged Partial vs No Data so supervisors can see at a glance where
  to chase.
- **Row tint + left border** on the timesheet grid are now aligned
  with the same day-based completeness rule the stat cards use:
  - Red tint + red left border when no `_job` cell is populated
  - Amber tint + amber left border when some but not all Mon–Fri cells
    are populated
  - Green left border (no tint) when Mon–Fri are all populated
  The previous tint keyed off hours (< 40h = amber) which disagreed
  with the Complete/Partial count above the grid.
- **Friday supervisor digest** — Section 4 now lists per-name missing
  day counts ("Alex Mitchell · 3 days missing") rather than a bare
  name list. The edge function change is backwards compatible — older
  callers passing `string[]` still render correctly.

## Files changed

- `scripts/app-state.js` — `APP_VERSION = '3.4.17'`.
- `scripts/timesheets.js` — row-tint logic rewritten to match stat
  cards; `updateTsStats()` now renders the progress bar into
  `#ts-progress-bar` and builds the pending-list popover;
  `_togglePendingPopover()` helper added.
- `index.html` — new `#ts-progress-bar` container above the existing
  completion tracker; v3.4.17 header block; footer version stamp.
- `supabase/functions/supervisor-digest/index.ts` — `missing` is
  emitted as `{ name, days }[]`; `buildDigestHtml` accepts either
  shape and appends the day count when present.
- `sw.js` — cache bumped to `eq-field-v3.4.17`.

## Compatibility notes

- No schema changes.
- Edge function deployment required to pick up per-day-count changes
  in the digest; the JS UI change takes effect on next page render.
- SKS prod supervisor-digest function is not yet deployed
  (v3.4.9 deploy tracked for demo only) — so this change doesn't
  affect SKS digests until the SKS promotion path runs.

## Verification checklist (demo)

- [ ] Open Timesheets → current-week progress bar visible, reads the
      correct count for `Apprentice + Labour Hire` staff
- [ ] Click "N pending" → popover lists names with Partial / No Data tag
- [ ] Populate one day for an empty staff member → row goes red → amber,
      border + tint update on next render
- [ ] Fill Mon–Fri → row shows green left border only, total reads green
- [ ] Dry-run supervisor-digest → HTML now lists "… · N days missing"
- [ ] sw.js cache invalidates on reload
