# v3.4.82 — Pipeline drag-and-drop + Review = decision queue

**Date:** 2026-05-14
**Branch:** demo (not promoted to main; SKS Supabase still missing pipeline schema)
**Risk:** medium — Review screen fully restructured. Kanban gains drag-and-drop. No DB schema changes; only `tenders.stage` PATCH paths added.

## What shipped

Two related features Royce asked for after v3.4.81 made Tender Sync actually work:

### 1. Kanban drag-and-drop

Tender cards are now draggable. Drop into Watch / Likely / Awaiting Promotion → one PATCH on `tenders.stage`, optimistic UI update, toast confirmation. Drop into Confirmed → auto-routes to the Confirm Labour Curve screen (preserves the "friction is the feature" gate; the CM still has to fill the weeks×people grid and click Confirm). Drop from a non-Won stage onto Confirmed → toast: "Move to Awaiting Promotion first".

Visual: dashed-blue outline on the drop target column, faded source card while dragging, grab/grabbing cursors.

### 2. Review screen rebuilt as a decision queue

Was 4 read-only panels (Changed since last review / Starting in 8w / Clashes / Stale) + a Notes log at the bottom. Every actionable row said "Open" and bounced you to the slide-over to actually do anything. Royce called this out — "isn't adding much value, this is where we want to be choosing staff and pushing decisions into the roster."

Now: one ranked queue. Each row has:

- **Inline PM (manager) + Supervisor pickers** — change the dropdown, click Save pencillings, nomination is written/updated in place. No slide-over round trip.
- **Reason tags** — Red clash, Amber clash, Yellow clash, Starts <2w, Starts 2–8w, Won + nominee missing, Ready to push, New since last review, Needs re-enrich, Stale 4w+. Multiple tags per row when applicable.
- **Urgency stripe on the left edge** — red / orange / blue based on the most urgent reason.
- **Open** (slide-over for full edit), **Save pencillings**, **Mark as Won** (Likely-stage only), and **Push to roster →** (Won + fully enriched + PM + Sup chosen).

Notes log moved to a sticky right rail (320px) with the Capture form on top and the 8 most recent notes underneath. Mobile (≤900px) collapses both columns to single-column stacked.

### 3. Push to roster (fast-path Confirm Curve)

The "Push to roster →" button on Won-stage rows skips the full Confirm Curve grid. It writes the PM + Supervisor onto the live `schedule` table for the entire duration (using the linked site's abbr or the tender's external_ref), flips nominations to `confirmed`, sets `tenders.stage='confirmed'`. The remaining (peak_workers - 2) team slots can be filled later via the full Confirm Curve grid.

Guards (toasted to the user if missing):
- `tenders.stage` must be `won`
- enrichment must have `start_date_estimated`, `duration_weeks`, `peak_workers`
- a PM and Supervisor nomination must exist (with person_id)
- `tenders.site_id` must be set (otherwise: open the slide-over to set it, OR use the full Confirm Curve which can create a site inline)

Native `confirm()` shows the duration + remaining-slot count before writing.

## Decision queue ranking (transparent)

Higher score = higher in the queue. Composable — a single tender can hit several reasons.

| Score | Reason |
|---|---|
| 1000 | Red clash |
| 800 | Won + starts <2w + nominee missing |
| 600 | Ready to push (Won + full enrichment + PM + Sup) |
| 400 | Starts in <2w |
| 200 | Starts in 2–8w (Likely or Won) |
| 150 | Amber clash |
| 100 | New since last review (probability ≥50%) |
| 80 | Needs re-enrich (Smartsheet row changed) |
| 50 | Stale 4w+ (Likely only) |
| 20 | Yellow clash (informational, only shown if no red/amber) |

Items with score 0 are excluded from the queue.

## Analytics

- `tender_stage_dragged` (NEW) — `{ tender_id, from_stage, to_stage, routed_to_confirm_curve, source }`. Source is `drag` for the kanban, `review_button` for the Review queue's Mark-as-Won.
- `pencillings_saved_review` (NEW) — `{ tender_id, pm_set, sup_set }`. Fires from the inline Save pencillings button.
- `tender_promoted` and `labour_curve_confirmed` (UPDATED) — both gain a `path` property (`confirm_curve` or `review_quick_push`) so the funnel separates the two confirmation routes.

## Files touched

- `scripts/tender-pipeline.js` — ~+450 / -180 lines. Review screen rebuilt; 9 new functions (`_attachKanbanDnd`, `_handleStageDrop`, `_saveTenderStage`, `_buildDecisionQueue`, `_renderQueueRow`, `_saveRowPencillings`, `_quickPushToSchedule`, `_advanceStage`, `_renderNotesSiderail`); 5 old functions removed (`_renderPanel1..4`, `_renderNotesLog`). Card render gets `draggable="true"` + data attrs; column render gets `data-stage` attr. CSS additions: `.pl-tender-dragging`, `.pl-col-dragover`, `.pl-queue`, `.pl-q-row` + variants, `.pl-side`, `.pl-q-empty`. Window export gains 5 new internals.
- `scripts/analytics.js` — 2 new events; `path` field added to 2 existing.
- `scripts/app-state.js` — APP_VERSION 3.4.81 → 3.4.82.
- `sw.js` — CACHE bump.
- `index.html` — favicon cache-buster + new v3.4.82 banner block at the top.
- `CHANGELOG-v3.4.82.md` — this file.

## Known limitations / flag-backs

- **Push-to-roster requires a linked site** — if `tenders.site_id` is null, the button toasts an error. Fix: either set the site via the slide-over before pushing, OR use the full Confirm Curve (which has inline site creation). Could be smoothed later by adding a "create site abbr" input to the Push prompt.
- **Drag-and-drop is desktop-only in practice** — HTML5 DnD doesn't work on touch devices without polyfill. Mobile users will need to keep using the slide-over to change stage. Acceptable for v1; the kanban is a desktop-first surface anyway.
- **No undo on stage drag** — drop persists immediately. Mistakes need a second drag back. Could add a 5s toast undo later if it becomes a complaint.
- **Quick push doesn't set job_number_id** — the full Confirm Curve allows entering a job number which gets created and linked. The Review push skips this. If you want the job number on the tender, use the full Confirm Curve.
- **Decision queue ranking weights are hardcoded** — no per-tenant tuning yet. If different teams want different urgency criteria, the score weights move into a config block.

## To run after deploy

1. Hard refresh (Ctrl+Shift+R) on `eq-solves-field.netlify.app` to clear the SW.
2. Pipeline → drag a Watch card to Likely → expect toast "Moved to likely", card lands in Likely column.
3. Pipeline → drag a Won card to Confirmed → expect Confirm Labour Curve screen to open.
4. Review → confirm queue renders with reason tags + urgency stripes, ranked by score.
5. Review → pick a PM and Supervisor on any row → click Save pencillings → expect toast "Pencillings saved".
6. Review → on a Won-stage row with full enrichment + PM + Sup chosen → click "Push to roster →" → confirm → tender disappears (now `confirmed`), schedule has new rows.

## Not promoted to main

SKS Supabase still has no pipeline schema (migrations 001 + 002 only applied to `ktmjmdzqrogauaevbktn`). Pipeline tables remain in `TENANT_DISABLED_TABLES.sks` in `app-state.js`. This release stays demo-only until that prereq lands.
