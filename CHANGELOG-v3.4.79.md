# v3.4.79 — Tender Pipeline module

Released to demo branch on 2026-05-14. Demo-only until SKS cutover.

**Note on the version number:** Originally built as v3.4.69 in an earlier session, but origin/demo had already shipped its own v3.4.69 (Site Reports / Prestart MVP) and moved on through v3.4.77 (Daily Site Diary). Rebased onto v3.4.77 head and re-stamped as **v3.4.79**, leaving **v3.4.78** reserved for the upcoming Weekly Report module (next CC piece of work absorbing from Ben's sks-field-reports v29).

## What shipped

The "before" layer of labour planning — bringing SKS Smartsheet tender data into EQ Field, supporting speculative pencilling of PMs and supervisors against likely jobs, surfacing double-bookings, and running the structured fortnightly review.

### Screens (5)

1. **`/pipeline/import` — Tender Sync.** Upload the SKS Smartsheet xlsx, see a diff against existing pipeline (new / stage-changed / value-changed / missing) before applying. Apply writes the changes in one pass and logs a `tender_import_runs` row. Missing rows bump `missing_import_count`; 2 consecutive misses auto-archives as `lost`.

2. **`/pipeline` — Kanban.** Four columns: Watch (50%), Likely (70–90%), Awaiting Promotion (100%), Confirmed (live). Filter by department, toggle to surface below-floor tenders. Cards show value, due date, probability, 90% high-confidence badge, clash badges (red / amber / yellow), and the current PM / supervisor pencillings. Click a card to open the slide-over.

3. **Tender slide-over — enrichment + nomination panel.** Edit hours_estimated, start_date_estimated (Monday-snapped on save), duration_weeks, peak_workers, confidence_notes. Pick PM (people.role='manager') and supervisor (people.role='supervisor'). Save flips `needs_review = false` and syncs nominations.

4. **`/pipeline/review` — Fortnightly Review.** Four panels (changed since last review / starting in next 8 weeks / clashes / stale) + Notes log. "Start Review Session" mints a session_id; every captured note is tagged with it. Quick decision buttons (Escalate / Kill / Hold) on stale rows. UI says "Notes"; DB table is still `tender_review_decisions` (implementation detail).

5. **`/pipeline/:id/confirm-curve` — Confirm Labour Curve.** Reached from Promote action on a Won tender. CM picks an existing site or types an abbr to create one inline, optionally enters a job number, edits the auto-generated weeks×people grid (placeholder rows must be assigned before push), then "Confirm and push to schedule" copies into the live `schedule` table, flips nominations to confirmed, sets `tenders.stage='confirmed'`. CM owns the friction.

### Parser

- `scripts/tender-parser.js` — ported from `eq-field-pipeline/src/lib/tender-parser.js` (vitest module) to an IIFE under `window.EQ_TENDER_PARSER`. Uses `window.XLSX` (SheetJS 0.20.3, loaded from cdnjs). All pure helpers + diff engine identical to the bundle source.
- `tests/tender-parser.test.html` — standalone harness, 45 assertions, no vitest, no bundler. Open the file in a browser to run.
- Discovered + fixed: the bundle test for Excel serial 46157 expected 2026-03-2X — that was a comment/regex mismatch. With the SheetJS-standard 1899-12-30 epoch, 46157 → 2026-05-15. Both the HTML harness and the headless verification now agree.

### Data layer

- **Migration `001_tender_pipeline`** — applied to `ktmjmdzqrogauaevbktn` in a prior session. Creates 6 tables, 4 enums, 2 trigger functions, 1 view (`nomination_clashes`).
- **Migration `002_tender_pipeline_rls_anon`** — applied this session. Permissive anon-role policies matching the existing people/sites/schedule shape (SELECT `using (true)`, INSERT/UPDATE `with check (org_id IS NOT NULL)`, DELETE `using (true)`). `tender_enrichment` and `nominations` skip the org_id write-check because they're tender-scoped (no org_id column). SELECT granted on `nomination_clashes` view to anon.
- **Seed cleanup** — 3 demo-org collisions resolved. Dan / Tara / Chris (UUIDs `b0000001-…-001/002/003`) were sitting in org `a0000000-…-001` with different names; their supervisor nominations against demo tenders pointed cross-org. Deleted the 6 bad nominations, minted fresh UUIDs in `demo-trades`, re-inserted the noms against the right people. Post-cleanup the `nomination_clashes` view returns 7 yellow + 3 amber clashes — all from within-org data, all matching the seed design once PM-overlap and Dan's T7 nomination are accounted for.

### Analytics

8 new PostHog events under `EQ_ANALYTICS.events.*`:

- `tender_imported` — fires when an import applies
- `tender_enriched` — slide-over save
- `nomination_added` — new nomination row
- `clash_detected` — kept for v1.5 when the kanban detects a new clash since last paint (not wired yet)
- `review_session_started` — Start Review Session click
- `decision_logged` — note captured
- `tender_promoted` — won → confirmed
- `labour_curve_confirmed` — push to schedule

### Files touched

- `scripts/tender-parser.js` *(new, ~280 lines)*
- `scripts/tender-pipeline.js` *(new, ~830 lines)*
- `tests/tender-parser.test.html` *(new)*
- `scripts/app-state.js` — APP_VERSION 3.4.68 → 3.4.69, pipeline tables in ORG_TABLES, pipeline tables in TENANT_DISABLED_TABLES.sks, STATE cache fields
- `scripts/analytics.js` — 8 tender pipeline events
- `index.html` — Pipeline nav section, 4 page divs, slide-over host, SheetJS CDN tag, PAGE_TITLES + renderCurrentPage dispatch, top-of-file changelog banner, favicon cache-buster bump
- `sw.js` — CACHE bump
- `_headers` *(new — first _headers file in the repo)*
- `CHANGELOG-v3.4.79.md` *(this file)*
- `eq-context/sessions/2026-05-14.md` *(new — session log)*

## Known limitations / flag-backs

- **Visibility rules can't be enforced via RLS yet.** The cowork-prompt-v3 spec asks for "nominations visible to managers only until tender is confirmed, then visible to nominees." That needs per-user JWT identities, which eq-solves-field doesn't have (PIN gate + anon Supabase). Enforced client-side in tender-pipeline.js for v1; a proper per-user auth refactor is the prereq for a real fix. See session log §"RLS flag-back".
- **`clash_detected` event isn't wired yet.** Will fire on kanban diff with previous load. Deferred — needs delta tracking that's nicer to wire after a session of real use.
- **SheetJS adds ~250KB to first load.** Only used by the Import screen. Worth lazy-loading via dynamic import if the bundle becomes a problem. Not urgent at v3.4.79.
- **`pending_schedule` is written but then bypassed.** Currently the Confirm Curve screen writes pending_schedule rows AND directly into schedule. Spec calls for pending_schedule as a staging table the CM edits before push; the screen is doing both. Fine for v1 ("friction is the feature" — the CM is the gate), but pending_schedule could be reduced to a log of confirmations.
- **No nomination history (intentional).** Per design: pencillings are mutable straight updates so people can be moved on/off without an audit trail. Don't add a history table without a conversation.

## Verification before deploy

- Headless parser tests pass (45/45).
- `tender-pipeline.js` parses + loads cleanly in a sandboxed Node vm with mocked `window`/`STATE`/`sbFetch`. All 16 exports present. Helper math (Monday snap, ISO week key, money format) verified.
- Demo Supabase: tenders / nominations / enrichment / clashes queryable via anon key after migration 002.

## To run before merging demo → main

1. Eyeball each of the 5 screens on `eq-solves-field.netlify.app`.
2. Run the standalone test harness in a real browser (`/tests/tender-parser.test.html`) — should be all green.
3. Once SKS is ready for the pipeline, drop the pipeline-table entries from `TENANT_DISABLED_TABLES.sks` in `scripts/app-state.js` AND apply migrations `001` and `002` to `nspbmirochztcjijmcrx`. Do NOT promote demo → main with SKS still pointing at a missing schema.
