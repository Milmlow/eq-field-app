# v3.4.83 — Pipeline: all buttons fixed + Dashboard + job info fields

## Critical bug fix
**All pipeline interactive buttons now work.** `JSON.stringify()` wrapped tender UUIDs in double-quotes that silently terminated every `onclick="..."` HTML attribute. Affected: kanban card open, Promote →, Open (review queue), Save pencillings, Mark as Won, Push to roster →, Confirm Curve Open tender. Fixed by using single-quoted JS string arguments in all onclick handlers.

## Promote → improved UX
If a won tender is missing enrichment (start date or duration), Promote → now opens the slide-over pre-loaded for that tender instead of landing on a dead-end "Enrichment missing" screen. After saving enrichment, it navigates directly to Confirm Curve.

## End Session button
Fortnightly Review now has an "End session" button visible when a session is active. Clears the session ID and re-renders.

## Job Number + Cost Code fields
Enrichment slide-over now has Job Number and Cost Code fields (top of the Enrichment section). Both fields save to DB (`tender_enrichment.job_number`, `tender_enrichment.cost_code`). Job Number pre-populates the Confirm Curve job number input. Both appear in the Pipeline Dashboard table.

## Pipeline Dashboard (new)
New screen, first item in the Pipeline nav section. Shows:
- 4 stat cards: active pipeline value, confirmed value, committed hours, active tender count
- Weekly hours forecast bar chart (next 26 weeks)
- Full tenders table with all stages: Job (+ job number), Client, Stage, Value, Prob%, Start, Finish, Duration, Hours, PM, Supervisor, Dept — click any row to open the enrichment slide-over

## Nav reorder (Pipeline section)
Dashboard → Pipeline → Fortnightly Review → Tender Sync

## DB migration (EQ demo)
`tender_enrichment`: added `job_number text`, `cost_code text` columns.
