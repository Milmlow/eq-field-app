# v3.4.84 — Pipeline UI polish: dropdowns, filters

**Released:** 2026-05-14  
**Scope:** `eq` demo tenant only — Tender Pipeline module

## What changed

### PM + Supervisor dropdowns fixed (enrichment slide-over + review queue)
The dropdowns now pull from `STATE.managers` (Contacts / Supervision screen) instead of the labour-hire roster (`STATE.people`). The two lists are different things:

- `managers` table = named PM and supervisor contacts (Equinix leads, SKS internal PMs, etc.)
- `people` table = labour-hire roster staff on the weekly schedule

Filtering logic:
- PM dropdown → `managers` where `category === 'Project Management'`; falls back to all non-archived contacts if that bucket is empty
- Supervisor dropdown → `managers` where `category === 'Supervisor'`; same fallback

This fix applies to:
1. Enrichment slide-over (`openTenderPanel`)
2. Review queue inline pickers (`_renderQueueRow`)

### Nomination name lookups updated
`_renderTenderCard` (kanban card) and `renderPipelineDashboard` (dashboard table) now search `STATE.managers` first, then `STATE.people`, when resolving a `person_id` to a display name. This gives correct names for new nominations and preserves any existing rows that still reference old people IDs.

### Pipeline Dashboard — Stage + Dept filters
Filter bar added at the top of the Dashboard. Stage filter defaults to "All stages"; Dept filter defaults to "All depts". Filtered tender count shown inline. "Lost" tenders are always excluded. Selections persist within the session.

### Review queue — Stage filter
Dropdown added to the Review header. Default: **Likely + Won (action items)** — removes Watch-stage tenders from the queue since they're rarely actionable in a fortnightly review. Switch to "All active stages" to include Watch and Confirmed if needed.

## Files touched
- `scripts/tender-pipeline.js` — dropdowns, lookups, filter state, filter UI, event wiring
- `scripts/app-state.js` — `APP_VERSION` 3.4.83 → 3.4.84
- `sw.js` — comment + `CACHE` bump
- `index.html` — changelog comment, favicon cache-buster `var v`
- `CHANGELOG-v3.4.84.md` — this file
