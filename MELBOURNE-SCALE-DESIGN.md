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

(Sections 2-7 added in subsequent loop iterations.)
