# EQ Field at Melbourne scale — design document

**Purpose**: a phased design path from today's ~50-person SMB shape (SKS NSW Labour) to Melbourne-size (~577 people, 12+ projects, 52-week forecast), incorporating the v3.4.50 finding that the EQ tenant is currently a SEED demo (not a real Supabase-backed tenant). Companion to `BATTLE-TEST-2026-04-29.md` "Tier analysis" section.

**Reading order**: Section 7 (Open questions) is the most decision-load-bearing — read first if you only have 5 minutes. The other sections describe HOW; section 7 asks what you actually want.

**Sources**:
- Live EQ Supabase schema (queried via MCP, project `ktmjmdzqrogauaevbktn`)
- Melbourne reference workbook `2025 VIC Construction Labour Program V1.xlsm`
- BATTLE-TEST-2026-04-29.md tier-analysis entries

---

## Section 1 — Data-model diff

### What's there today

The relevant tables on EQ Supabase right now (sample columns; uuid PKs throughout):

```
people          (id, org_id, name, phone, email, group, licence,
                 agency, pin, year_level, tafe_day, deleted_at, …)
sites           (id, org_id, name, abbr, address, site_lead,
                 site_lead_phone, site_lead_email,
                 track_hours, budget_hours, deleted_at, …)
schedule        (id, org_id, person_id, name, week,
                 mon, tue, wed, thu, fri, sat, sun, deleted_at, …)
managers        (id, org_id, name, role, category, phone, email,
                 digest_opt_in, deleted_at, …)
organisations   (id, slug, name, primary_colour, accent_colour,
                 logo_url, worker_groups[], active, …)
leave_requests  (id, org_id, requester_name, leave_type,
                 date_start, date_end, individual_days, note,
                 approver_name, status, response_note,
                 responded_by, responded_at, archived, …)
```

Two surprises worth flagging up-front:

1. **`schedule.person_id uuid` already exists** — nullable, no FK constraint, no code references. Looks like a half-finished migration from a previous architectural iteration. Free to wire it up properly without adding a column.
2. **`organisations.worker_groups text[]`** with default `{Direct, Apprentice, Labour Hire}` — there's already a per-org "what groups exist" knob. Tenant-customisable employment categories are partly built.

### What Melbourne needs that's missing

Per the spreadsheet inspection (BATTLE-TEST doc "Reference: Melbourne VIC labour program"):

| Need | Today | Melbourne example |
|---|---|---|
| Project hierarchy above sites | Flat sites only | Airtrunk Shell L (345 ppl), NEXTDC M3S4, MEL02 STACK… |
| Employment-type beyond `group` | `group` is single-purpose | FT, PT, Casual, FT Apprentice, LH Apprentice, FT App On Loan, LH (7+ types) |
| Apprentice training org (RTO/GTO) | None | NECA, Yanda, AGA, MAG, G-Force, MAXIM, Frontline |
| Multi-region | One org_id per tenant | NSW + VIC + QLD + WA as siblings under one parent |
| Schedule keyed by person identity | Keyed by `name` text | Two "John Smith" entries can't coexist |

### Proposed schema diff (concrete SQL)

#### 1. `projects` table (new)

```sql
CREATE TABLE public.projects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  region_id     uuid     REFERENCES public.regions(id),     -- see §2
  name          text NOT NULL,                              -- "Airtrunk Shell L"
  abbr          text NOT NULL,                              -- "AIRTL", short code on roster
  client_name   text,                                       -- "Airtrunk", for grouping
  status        text NOT NULL DEFAULT 'Active'              -- Active / Won / Tendering / Complete
                CHECK (status IN ('Active','Won','Tendering','Complete','Lost','OnHold')),
  start_date    date,
  expected_end  date,
  budget_hours  numeric,                                    -- forecast headcount × 38h × weeks
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  deleted_at    timestamptz,
  UNIQUE (org_id, abbr)                                     -- abbr unique within an org
);

-- Sites belong to projects (1 project : N sites). Add nullable FK first
-- (so existing sites without a project keep working).
ALTER TABLE public.sites
  ADD COLUMN project_id uuid REFERENCES public.projects(id);
CREATE INDEX ON public.sites (project_id);
```

**Why a separate `projects` table** instead of just adding columns to `sites`:

- Melbourne's spreadsheet has projects at the top of the forecast (rows) and weeks across (columns). Sites are sub-units of projects (e.g. "Airtrunk Shell L" is the project, "AIRTL-DC1" / "AIRTL-DC2" are sites within it).
- Headcount targets and budgets live at the project level, not the site level. A 345-person project might have 8 sites; managing that on the site rows would be 8 places to update.
- Reporting roll-ups (project × week → headcount) become trivial JOINs.

#### 2. `regions` table (new) + `region_id` on people, sites, projects

```sql
CREATE TABLE public.regions (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id    uuid NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
  code      text NOT NULL,                                  -- "NSW", "VIC", "QLD"
  name      text NOT NULL,                                  -- "New South Wales"
  timezone  text NOT NULL DEFAULT 'Australia/Sydney',       -- Used by audit display + leave calendar
  created_at timestamptz DEFAULT now(),
  UNIQUE (org_id, code)
);

ALTER TABLE public.people  ADD COLUMN region_id uuid REFERENCES public.regions(id);
ALTER TABLE public.sites   ADD COLUMN region_id uuid REFERENCES public.regions(id);
-- (projects.region_id added in §1 above)

CREATE INDEX ON public.people  (region_id);
CREATE INDEX ON public.sites   (region_id);
CREATE INDEX ON public.projects(region_id);
```

**Why a `regions` table** rather than just a `region text` column on each row:

- Per-region timezone (already flagged in BATTLE-TEST #32 — audit log groups by browser locale today; tenant timezone is a foundation feature).
- Per-region holiday calendars (TAFE seeds today are NSW-specific — `migrations/2026-04-16_tafe_day_and_holidays.sql`).
- Per-region pricing (tier-analysis open question — recommended: keep one tenant, regions are sub-units; per-region pricing as a v2).
- Per-region managers (a NSW supervisor approves NSW leave; a VIC supervisor approves VIC leave).

#### 3. `employment_type` on `people`

```sql
-- Today: people.group ∈ {Direct, Apprentice, Labour Hire}
-- Promote `group` to "what they DO" (Direct/Apprentice/Labour Hire stays) and add
-- a separate "how they're ENGAGED" axis.
ALTER TABLE public.people
  ADD COLUMN employment_type text DEFAULT 'FT'
    CHECK (employment_type IN ('FT','PT','Casual','LH','FTApprentice',
                               'PTApprentice','LHApprentice',
                               'FTApprenticeOnLoan','Contractor'));

-- Backfill: most existing people are FT. Apprentices get FTApprentice unless
-- their `agency` field is set, in which case LHApprentice.
UPDATE public.people
SET employment_type = CASE
  WHEN "group" = 'Apprentice' AND agency IS NOT NULL THEN 'LHApprentice'
  WHEN "group" = 'Apprentice'                         THEN 'FTApprentice'
  WHEN "group" = 'Labour Hire'                        THEN 'LH'
  ELSE 'FT'
END
WHERE employment_type IS NULL OR employment_type = 'FT';
```

**Why** keep `group` AND add `employment_type` rather than collapsing them: today's `group` is the renderer's category for the roster grid (apprentices have a 🎓 strip, labour hire has a 🔧 strip). Don't break that. `employment_type` is the HR/payroll axis — it intersects but doesn't replace.

#### 4. RTO/GTO field on `people`

```sql
ALTER TABLE public.people
  ADD COLUMN rto text                                       -- 'NECA' | 'AGA' | 'GForce' | …
    CHECK (rto IS NULL OR rto IN
      ('NECA','AGA','Yanda','MAG','GForce','MAXIM','Frontline','Other'));
ALTER TABLE public.people
  ADD COLUMN hire_company text;                             -- free text — "Core", "Atom" etc.
                                                            -- For LH employment_type, this
                                                            -- duplicates `agency` — see migration
                                                            -- path in §3.

CREATE INDEX ON public.people (rto) WHERE rto IS NOT NULL;
```

`hire_company` overlaps with the existing `agency` field. Migration path: rename `agency` → `hire_company` (one ALTER), update the form labels, done. Existing data preserved.

#### 5. Wire up `schedule.person_id` (use the column that's already there)

```sql
-- 5a. Backfill schedule.person_id from name match.
UPDATE public.schedule s
   SET person_id = p.id
  FROM public.people p
 WHERE s.org_id = p.org_id
   AND s.name   = p.name
   AND s.person_id IS NULL;

-- 5b. After backfill stabilises, add the FK constraint + a not-null guard
-- (in a separate migration, after the app code is updated to write person_id
-- on every schedule row insert/update).
ALTER TABLE public.schedule
  ADD CONSTRAINT schedule_person_id_fkey
    FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE;

-- 5c. Eventually deprecate schedule.name (it's denormalised from people.name).
-- Done as a v3 migration once the code base no longer references s.name.
```

This solves BATTLE-TEST #29 (schedule keyed by name → namesake collision risk at scale).

### How the SEED-demo path coexists

The v3.4.50 finding (BATTLE-TEST #11): the EQ tenant runs from `SEED.*` in-memory data, ignoring its Supabase project for reads. Adding new tables / columns to EQ Supabase doesn't break the SEED demo because the SEED short-circuit at `index.html:1810` doesn't query Supabase.

For the design's coexistence story:

- **Starter tier = SEED-demo extended.** Today's EQ tenant becomes the "Starter" tier — pre-canned data, instant access, no real persistence. SEED is updated to include sample `projects`, sample `regions`, sample `employment_type` so demo users can SEE the new shape. Writes still go to Supabase (audit log) but reads stay in-memory.
- **Paid tiers = real Supabase reads.** A `TENANT.IS_SEED_DEMO` flag (read from `organisations` row) controls whether `loadFromSupabase` short-circuits or actually queries. Default `true` for the EQ tenant; flip to `false` per paying tenant during onboarding.
- **One code path serves both.** All UI shapes (project hierarchy, forecast view, multi-region) gate behind `TENANT.IS_SEED_DEMO === false` AND tier-feature flags. Starter sees a stripped UI; paid tenants see the full surface.

Concrete schema for the flag:

```sql
ALTER TABLE public.organisations
  ADD COLUMN is_seed_demo boolean NOT NULL DEFAULT false,
  ADD COLUMN tier         text    NOT NULL DEFAULT 'Starter'
    CHECK (tier IN ('Starter','SMB','Enterprise'));

-- EQ tenant gets the SEED flag flipped on; SKS stays off.
UPDATE public.organisations SET is_seed_demo = true,  tier = 'Starter' WHERE slug = 'eq';
UPDATE public.organisations SET is_seed_demo = false, tier = 'SMB'     WHERE slug = 'sks';
```

### What this unlocks (the practical "after" picture)

After all five additions land:

- **Project × week aggregation** — `SELECT project_id, week, count(*) FROM schedule JOIN sites USING (id) … GROUP BY 1,2` produces the Melbourne-style forecast table. Section 2 expands.
- **Headcount roll-ups by employment_type, by region, by project** — direct GROUP BY queries.
- **Apprentice ratio compliance** — `count(employment_type LIKE '%Apprentice%') / count(employment_type IN ('FT','PT'))` per region per week. Tier-analysis enterprise feature surfaced in Pass 4 / 11.
- **Namesake collision fixed** — schedule rows FK person_id, not match name.
- **Multi-region tenant** — one organisations row, multiple regions, supervisors scoped per region (RLS extension covered in §3).

### What this does NOT do

- **Doesn't introduce SSO** — auth surface stays as-is (PIN + tenant code). SSO is a parallel workstream (§7 open question).
- **Doesn't introduce sub-org admin** — a "VIC office admin" who can edit VIC people but not NSW people requires per-region role grants. RLS extension only; no schema change beyond region_id which is enough to write the policies.
- **Doesn't enforce ratios server-side** — apprentice ratio compliance is a query / dashboard widget, not a constraint. Soft signal, not hard block. (Per Australian state rules, hard-block would need legal review per state — out of scope here.)

### Effort estimate

S = small (under a day)  ·  M = medium (1-3 days)  ·  L = large (1+ week)

| Step | Effort | Risk |
|---|---|---|
| Add `projects` table + `sites.project_id` | S | Low — additive |
| Add `regions` table + `region_id` cols | M | Low — additive, but per-region RLS needs care |
| Add `employment_type` + backfill | S | Medium — backfill is data-dependent, run on staging first |
| Add `rto` / rename `agency`→`hire_company` | S | Low — text col + label rename |
| Wire up `schedule.person_id` (backfill, FK, deprecate name) | M | Medium — denormalisation removal needs code path updates |
| `is_seed_demo` flag + UI gating | M | Low — additive flag, gating is feature-flag work |

Total: ~2 weeks of focused engineering for the schema migration alone. UI work to expose the new shape is Section 5; performance work is Section 6.

---

## Section 2 — Forecast view design

### Why this is the headline feature

Today EQ Field answers "where are my people THIS week?". Melbourne's spreadsheet (per the Reference table in BATTLE-TEST-2026-04-29.md) answers "where will my 577 people be deployed across 12+ projects over the next 12 months?". That's not a bigger version of the roster — it's a different shape of product. Adding the data-model from Section 1 without exposing it via a forecast UI gets you compliance gains (apprentice ratios) and that's it. The forecast view IS what makes the schema change earn its keep.

### Wireframe (boxes-and-arrows, ASCII)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Forecast · VIC Construction · 52 weeks ahead          [⇐ This week] [⇒ Roster]│
├──────────────────────────────────────────────────────────────────────────────┤
│ Region [VIC ▼]  Status [Active ▼]  Employment [All ▼]  ⏳ Showing wks 18-30  │
├──────────────────────────────────────────────────────────────────────────────┤
│ Project              │ Wk18 │ Wk19 │ Wk20 │ Wk21 │ Wk22 │ Wk23 │ Wk24 │ … │
│                      │ 04/05│ 11/05│ 18/05│ 25/05│ 01/06│ 08/06│ 15/06│   │
├──────────────────────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┼───┤
│ ▶ Airtrunk Shell L   │ 283  │ 305  │ 322  │ 322  │ 330  │ 345  │ 359  │ … │
│    target            │ 300  │ 300  │ 330  │ 340  │ 340  │ 350  │ 360  │ … │
│    delta             │ ⚠-17 │  +5  │  -8  │ ⚠-18 │ -10  │  -5  │  -1  │ … │
├──────────────────────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┼───┤
│ ▶ NEXTDC M3S4        │   0  │   0  │   0  │   0  │   0  │  12  │  18  │ … │
│ ▶ MEL02 STACK        │  20  │  20  │  20  │  20  │  25  │  25  │  25  │ … │
│ ▶ Darwin DC1 (D1S2)  │   0  │   0  │   8  │  15  │  20  │  20  │  20  │ … │
│ ▶ DES (Design Office)│  15  │  15  │  16  │  16  │  16  │  16  │  18  │ … │
├──────────────────────┼──────┼──────┼──────┼──────┼──────┼──────┼──────┼───┤
│ TOTAL deployed       │ 318  │ 340  │ 366  │ 373  │ 391  │ 418  │ 440  │ … │
│ Total target         │ 350  │ 350  │ 380  │ 395  │ 395  │ 425  │ 450  │ … │
│ Available pool       │ 410  │ 410  │ 410  │ 410  │ 410  │ 415  │ 415  │ … │
│ Apprentice ratio     │ 3.4  │ 3.5  │ 3.6  │ 3.6  │ 3.5  │ 3.5  │ 3.4  │ … │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Key elements**:

- **Top bar** — region / status / employment filters (multi-select), week range nav (default: current + 12 ahead, expand on demand to 52).
- **Project rows** with collapsed/expanded state. Expanded reveals `target` row (editable inline) and `delta` row (computed). Sites under each project nest inside the expand — clicking ▶ on Airtrunk shows its constituent sites (AIRTL-DC1, AIRTL-DC2, …).
- **Cells** are the actual deployed headcount derived from `schedule` rows (count of distinct `person_id` whose schedule cell for the week names a site that belongs to this project).
- **Delta row** highlights gaps with ⚠ when |delta| ≥ 10% of target — these are the "you'll be short next week" signals.
- **Bottom rail** — TOTAL deployed, TOTAL target, available pool (people whose `employment_type` allows them to be deployed but who are not assigned this week), apprentice ratio (compliance number, surfaces here as well as on its own dashboard).
- **Top right buttons** — "⇐ This week" jumps back to the current-week roster editor; "⇒ Roster" stays on a project to show its current-week roster filtered to that project's sites only.

### Aggregation queries

#### Actuals: project × week → headcount

The schedule cells store a SITE abbreviation per day (e.g. `AIRT` in mon column means "this person is on Airtrunk on Monday"). A person is "deployed to a project this week" if ANY of their mon-fri cells reference a site that belongs to that project. Implemented as a CTE:

```sql
-- Helper view: unnest the 5-day cell array into one row per (person, week, day, site_abbr).
-- Materialise this if the un-cached query is slow at scale; refresh on schedule writes.
CREATE OR REPLACE VIEW v_schedule_cells AS
  SELECT s.org_id, s.person_id, s.name, s.week,
         day, abbr
    FROM public.schedule s,
         LATERAL (VALUES
           ('mon', s.mon), ('tue', s.tue), ('wed', s.wed),
           ('thu', s.thu), ('fri', s.fri))
         AS d(day, abbr)
   WHERE s.deleted_at IS NULL
     AND abbr IS NOT NULL
     AND abbr <> '';

-- Forecast: project × week → distinct headcount
SELECT
  c.week,
  p.id        AS project_id,
  p.name      AS project_name,
  count(DISTINCT c.person_id) AS actual_headcount
FROM v_schedule_cells c
JOIN public.sites si
  ON si.org_id = c.org_id AND si.abbr = c.abbr AND si.deleted_at IS NULL
JOIN public.projects p
  ON p.id = si.project_id AND p.deleted_at IS NULL
WHERE c.org_id = $1
  AND c.week = ANY($2)              -- array of week keys e.g. ARRAY['04.05.26','11.05.26',…]
GROUP BY 1, 2, 3
ORDER BY p.name, c.week;
```

At Melbourne scale (~577 people × 52 weeks × ~12 projects) the un-cached query touches ~150k cell rows — fast (<200ms) on indexed columns, but every page load doing this is wasteful. Materialise:

```sql
CREATE MATERIALIZED VIEW mv_project_week_actuals AS
  SELECT … (same SELECT as above without WHERE org_id) …;
CREATE INDEX ON mv_project_week_actuals (org_id, week, project_id);

-- Refresh after schedule writes via trigger OR every 5 min via pg_cron.
-- Trigger is more responsive but expensive at write scale; cron is simpler.
SELECT cron.schedule('refresh_project_week_actuals', '*/5 * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY mv_project_week_actuals;$$);
```

#### Targets: new table

Forecast targets per project per week are user input (project manager sets them); they're not derived. New table:

```sql
CREATE TABLE public.project_targets (
  project_id     uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  week           text NOT NULL,                  -- 'DD.MM.YY' to match schedule.week
  target_headcount integer NOT NULL CHECK (target_headcount >= 0),
  notes          text,
  set_by         text,                           -- manager_name who entered it
  set_at         timestamptz DEFAULT now(),
  PRIMARY KEY (project_id, week)
);

-- RLS: same shape as schedule — anon role read/write within own org.
ALTER TABLE public.project_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "targets_select_org" ON public.project_targets
  FOR SELECT USING (project_id IN (SELECT id FROM public.projects WHERE org_id = current_setting('request.jwt.claim.org_id', true)::uuid));
-- (similar for INSERT/UPDATE/DELETE — see §3 for the org-scoping pattern)
```

#### The forecast cell value (target + actual + delta)

Combined in one query for the UI:

```sql
SELECT
  p.id                                 AS project_id,
  p.name                               AS project_name,
  weeks.week                           AS week,
  COALESCE(a.actual_headcount, 0)      AS actual,
  COALESCE(t.target_headcount, NULL)   AS target,
  CASE WHEN t.target_headcount IS NULL THEN NULL
       ELSE COALESCE(a.actual_headcount, 0) - t.target_headcount
  END                                  AS delta
FROM public.projects p
CROSS JOIN unnest($2::text[]) AS weeks(week)        -- e.g. ARRAY['04.05.26','11.05.26',…]
LEFT JOIN mv_project_week_actuals a
       ON a.project_id = p.id AND a.week = weeks.week AND a.org_id = $1
LEFT JOIN public.project_targets t
       ON t.project_id = p.id AND t.week = weeks.week
WHERE p.org_id = $1
  AND p.status IN ('Active','Won','Tendering')
  AND p.deleted_at IS NULL
ORDER BY p.name, weeks.week;
```

Returns a row per (project, week) with NULL targets where none have been entered yet.

### Empty-state UX

A starter / SMB tenant just installing the upgrade will have:
- 0 projects (haven't created any)
- 0 targets

Forecast view should NOT show an empty grid — that's user-hostile. Instead:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Forecast — get a 52-week view of your labour deployment                     │
│                                                                              │
│   Step 1: Create your first project                          [+ New project]│
│   Step 2: Group your sites under a project                                  │
│   Step 3: Set headcount targets for the next 12 weeks                       │
│                                                                              │
│   Why use this? Your roster shows "this week"; the forecast shows           │
│   "where will I need 50 people in 6 months." Useful when you're tendering   │
│   for a project that needs 30 sparkies in August — does my pool have that?  │
│                                                                              │
│  [Watch 90-second walkthrough]   [Skip — I'll do this later]                │
└──────────────────────────────────────────────────────────────────────────────┘
```

After Step 1 (one project exists), the forecast grid renders with that project as the only row. After Step 3 (targets entered), the grid is fully populated. Each step removes itself from the empty-state checklist as it completes.

### Navigation between current-week roster and forecast

Today: roster page IS the current-week editor. There's no "future weeks" affordance beyond clicking ⟨ ⟩ to step a week at a time.

After this lands, navigation looks like:

```
   Sidebar                     Current view
   ┌────────────┐              ┌──────────────────────────┐
   │ Dashboard  │              │ ROSTER                   │
   │ My Schedule│              │ (week-by-week editor)    │
   │ Calendar   │              │ ⟨ ⟩ to step weeks         │
   │ Forecast ✨│ ─── click ──> [⇒ Forecast] zooms out    │
   │ Contacts   │              └──────────────────────────┘
   │ Supervision│                            ↑
   │ Sites      │                            │ click a project row
   │ Roster     │                            │
   │ Timesheets │              ┌──────────────────────────┐
   │ …          │              │ FORECAST                 │
   └────────────┘              │ (project × week grid)    │
                               │ filters, totals,         │
                               │ apprentice ratio         │
                               │ [⇐ This week] zooms back │
                               └──────────────────────────┘
```

- New "Forecast" sidebar entry; ✨ badge on first introduction (clear after first visit).
- Bidirectional zoom: ⇒ Forecast zooms out from current week, ⇐ This week zooms in.
- Project row click → "current-week roster filtered to this project's sites" — same roster page, narrowed lens.
- Cell click → drill-down panel showing the actual people deployed that week to that project.

### Editing forecast targets inline

Cells in the `target` row are editable:

- Click cell → number input replaces the value.
- Enter / blur → save target via PATCH on `project_targets`.
- Tab → move to next week's target on the same project.
- Shift+click range → "fill range with this value".
- Right-click cell → context menu: "copy to all weeks", "extrapolate from last 4 weeks" (linear), "lock target" (prevents future edits without unlocking — nice for finalised contracts).

### Mobile

The 52-week grid does not fit on mobile. Mobile forecast view collapses to:

```
┌──────────────────────┐
│ Forecast · VIC       │
│ ⇄ Wk24 (15/06)       │ ← swipe left/right to change week
├──────────────────────┤
│ Airtrunk Shell L     │
│   359 / target 360   │ ← red if delta ≥ 10%
│   ─1                 │
├──────────────────────┤
│ NEXTDC M3S4          │
│   18 / target 25     │
│   ⚠ -7               │
├──────────────────────┤
│ TOTAL  402 / 425     │
│ Apprentice ratio 3.4 │
└──────────────────────┘
```

One week at a time, swipe to navigate. Same data, mobile-friendly density. Project supervisors on iPad / phone get the headline picture without horizontal scroll.

### Effort

| Step | Effort | Risk |
|---|---|---|
| `v_schedule_cells` view + `mv_project_week_actuals` | S | Low — one query, indexed |
| `project_targets` table + RLS | S | Low — additive |
| Forecast page React-equivalent (vanilla JS in this stack) | L | Medium — new render path, edit interactions |
| Aggregation refresh strategy (cron vs trigger) | S | Low — cron simpler, latency 5 min |
| Mobile layout | M | Low — separate small renderer |
| Empty-state walkthrough | S | Low — static content |
| Sidebar entry + navigation wiring | S | Low — additive |

Total Section 2 surface: ~1-2 weeks of UI work + a few hours of SQL + materialised view setup.


