---
title: EQ Field — Multi-Tenancy & Dev Workflow Plan
owner: Royce Milmlow
last_updated: 2026-04-27
scope: Plan for moving EQ Field from single-org tool to multi-tenant SaaS on the eq-solves-field Supabase project
read_priority: standard
status: draft
---

# EQ Field — Multi-Tenancy & Dev Workflow Plan

Plan for the migration described in the 2026-04 roadmap. Grounded in an audit
of the current `demo` branch (worktree `hopeful-wright-058c8b`).

---

## TL;DR

- **Good news:** the database is already mostly tenant-shaped. `org_id uuid` exists on every core
  table; `organisations` is the tenancy root. We do **not** need a new `tenants` table — we need
  to rename our mental model and lock down what already exists.
- **The real work** is RLS, JWT, and demo-mode behaviour, not a schema rewrite.
- **Smallest reversible win** = PostHog feature flags (Phase 1). We can ship that this week.
- **Three strategic decisions locked 2026-04-27** — see "Locked decisions" below.

---

## Locked decisions (2026-04-27)

Settled in walkthrough on 2026-04-27. Each entry shows the choice and the trigger
to revisit.

### Decision 1 — Scope: Phase 1 only this sprint

**Choice:** Ship Phase 1 (PostHog feature flags + dev workflow win, ~1–2 days).
**Defer:** Phase 2 (multi-tenancy foundation).
**Trigger to start Phase 2:** first self-serve trial signup is on a calendar, OR
~3 customers manually provisioned and the operational cost is biting.
**Why:** `state/pending.md` GTM-priority rule. No external customer queued today,
so Phase 2 is preparing for a customer who doesn't exist yet.

### Decision 2 — Tenancy boundary: shared eq-solves-field project

**Choice:** When Phase 2 fires, multi-tenancy lives inside `ktmjmdzqrogauaevbktn`
(eq-solves-field) only. All EQ Field customers become tenants in that one project.
**SKS Labour:** untouched, stays on `nspbmirochztcjijmcrx`.
**Future enterprise customers:** handled case-by-case — own Supabase project if
they ask + pay for it (same model as SKS).
**Why:** Preserves `knowledge/architecture.md` three-Supabase risk-segmentation
rule. Standard SaaS pattern for the small-account tier.

### Decision 3 — Auth surface: Supabase-native JWT, PIN UX preserved

**Choice:** `verify-pin.js` mints a JWT signed with the **Supabase JWT secret**,
with `app_metadata.tenant_id` in the payload. Supabase recognises it natively;
RLS uses the standard pattern `((auth.jwt() -> 'app_metadata') ->> 'tenant_id')::uuid`.
**Code delta:** one extra env var (`SUPABASE_JWT_SECRET` on Netlify), one extra
signing step in `verify-pin.js`. PIN UX preserved; no re-login.
**Why:** Matches the roadmap's stated `app_metadata` directive, matches the
EQ Solves Service pattern (already shipped). Off-pattern alternatives (custom
header, `request.headers` GUC) would force every future maintainer to learn
non-standard RLS.
**SKS impact:** none. `SUPABASE_JWT_SECRET` is added to the eq-solves-field
Netlify site only. SKS Labour env vars and Supabase project are untouched.

---

## Audit summary — current state

| Area | Status | Notes |
|------|--------|-------|
| Tenancy column | exists | `org_id uuid` on people, sites, schedule, managers, timesheets, leave_requests, app_config, apprentice_profiles, leave_balances, checkins, ts_reminders_sent, +more |
| `organisations` table | exists | id (uuid PK), slug, name. Already the FK target for `ts_reminders_sent` |
| `tenants` table | not needed | `organisations` already plays this role. Don't create a duplicate |
| RLS enabled | partial | `leave_balances`, `checkins`, `ts_reminders_sent` only. Other tables have RLS **disabled** |
| RLS policy quality | weak | Most policies are `USING (true)` or `WITH CHECK (org_id IS NOT NULL)` — anti-tenant-leak guarantees are app-side, not DB-side |
| Service-role usage | controlled | Only `supervisor-digest` and `ts-reminder` edge functions |
| Tenant detection | hostname + `?tenant=` | `scripts/app-state.js:31–42` |
| Demo mode | bypasses Supabase | Hardcoded SEED data; `?tenant=demo` slug. **Will need to change for self-serve trials** |
| JWT shape | custom HMAC | `netlify/functions/verify-pin.js:147` — payload is `{name, role, exp}`. No tenant claim |
| Auth | PIN, plaintext compare | `verify-pin.js:137–138` (`STAFF_CODE`/`MANAGER_CODE` env vars). Per memory: deliberate, do not propose hashing |
| PostHog | initialized but unused for flags | `scripts/analytics.js:127`. Flag API exposed at line 112, never called |
| Feature flag wrapper | none | No `isFeatureEnabled()` in app code |
| TypeScript | none | No `tsconfig.json`, no build tool, plain script tags |

Three takeaways:

1. We're not adding tenancy from scratch — we're closing the gap between "the column exists"
   and "the database enforces it".
2. RLS work is the security-critical path. Everything else is plumbing.
3. Demo mode (currently SEED-only) is the highest-friction piece for self-serve trials.

---

## Phase 1 — Dev workflow + first feature + role system

**Original scope** was just the PostHog feature-flag wrapper. Expanded 2026-04-27
during walkthrough to include:

- The first real feature wrapped in a flag — **project-hours tracking** (Step 1.2)
- A **5-tier role system** to replace today's 2-role split (staff/supervisor),
  needed because the project-hours UI must be supervisor-or-above-only and the
  existing role enum doesn't have the granularity (Step 1.5)

This is genuinely more than "a single sitting" — closer to 1–2 weeks of focused
work depending on how much UI gets built. Royce's call (2026-04-27) on accepting
the scope expansion: yes, because the role system is a hard prerequisite for
shipping the project-hours feature cleanly.

**Goal:** stop maintaining live/demo divergence (flags), ship the first new
feature behind a flag (project-hours), and lay the role enum that every
subsequent feature gates on.

### Step 1.1 — Add a flag wrapper

Create `scripts/flags.js` (loaded after `scripts/analytics.js` in `index.html`):

```javascript
(function () {
  'use strict';
  var DEFAULTS = {
    // Add safe defaults here. If PostHog hasn't loaded or returned, this wins.
    // Default = false means "feature does not exist for this user" — the safe failure mode.
    'feat_project_hours_v1': false,
    // Forward-looking — set when Phase 2 fires:
    'mt_tenant_resolver_v2': false,
    'mt_rls_strict': false,
    'mt_self_serve_signup': false
  };

  function isEnabled(flagKey) {
    try {
      if (window.posthog && typeof window.posthog.isFeatureEnabled === 'function') {
        var v = window.posthog.isFeatureEnabled(flagKey);
        if (typeof v === 'boolean') return v;
      }
    } catch (_) { /* noop */ }
    return !!DEFAULTS[flagKey];
  }

  function variant(flagKey, fallback) {
    try {
      if (window.posthog && typeof window.posthog.getFeatureFlag === 'function') {
        var v = window.posthog.getFeatureFlag(flagKey);
        if (v !== undefined) return v;
      }
    } catch (_) { /* noop */ }
    return fallback;
  }

  window.EQ_FLAGS = { isEnabled: isEnabled, variant: variant };
})();
```

### Step 1.2 — Wrap the new project-hours feature behind `feat_project_hours_v1`

The first real flag gates a new feature being built: **opt-in hours tracking on
selected sites, with an initial hour budget and a burn-down view** ("how long to
go"). Most sites are noise (small jobs, no tracking). A handful of major projects
get ticked for tracking, get a budget set at kickoff, and roll up actual hours
worked by the people on site so you can see burn-down at a glance.

The flag wraps every new code path so the feature can be built incrementally on
the demo branch without exposing it, tested by Royce (cohort: `tenant=eq`,
`eq_role=supervisor`) before wider rollout, and flipped off instantly if it
regresses.

**Feature shape:**

| Question | Default |
|----------|---------|
| How is a site marked for tracking? | New `track_hours boolean default false` on `sites` — simple checkbox in the site edit UI |
| Initial budget | New `budget_hours numeric(10,2) null` on `sites` — set when tracking is turned on, editable later |
| Aggregation source | Sum `timesheets.hours` (or computed from start/end times) joined to `sites` where `sites.track_hours = true`, grouped by `site_id` and optionally `person_id` |
| Per-project view | One card / row per tracked site: budget, hours used, hours remaining, % consumed, list of people contributing hours |
| Aggregation period | Project-to-date is the primary view (matches "how long to go"). Day/week filters are nice-to-have, not v1 |
| Who sees it | Supervisor role only |
| Who can tick `track_hours` and edit `budget_hours` | Supervisors (open question — confirm) |
| Project tier (`small` / `medium` / `major`) | **Deferred.** Royce's note: tier "might be helpful" but for v1 just a tick is enough. Add later if categorisation pays its way |

**Flag pattern at every entry point:**

```javascript
// In whatever file renders the supervisor nav / dashboard
if (window.EQ_FLAGS && window.EQ_FLAGS.isEnabled('feat_project_hours_v1')) {
  renderProjectHoursTab();   // new code — does not exist yet
}

// In any new query/aggregation module (e.g. scripts/project-hours.js)
function loadProjectHours(orgId) {
  if (!window.EQ_FLAGS || !window.EQ_FLAGS.isEnabled('feat_project_hours_v1')) {
    return Promise.resolve(null);
  }
  // ...implementation
}
```

**Migration that ships in lockstep with the flag (safe to apply on demo and live —
columns have defaults / are nullable, and nothing reads them until the flag is on):**

```sql
-- migrations/2026-04-28_sites_track_hours.sql
alter table public.sites
  add column if not exists track_hours    boolean       not null default false,
  add column if not exists budget_hours   numeric(10,2) null;

-- Index for the aggregation query — only the tracked subset matters
create index if not exists idx_sites_track_hours
  on public.sites (org_id, track_hours)
  where track_hours = true;

comment on column public.sites.track_hours  is 'Opt site into project hours tracking. Default false.';
comment on column public.sites.budget_hours is 'Initial hour budget set at kickoff. Editable. Null = no budget set.';
```

**Aggregation query (the heart of the burn-down view):**

```sql
-- Returns one row per tracked site for the supervisor's tenant
select
  s.id                                    as site_id,
  s.name                                  as site_name,
  s.budget_hours,
  coalesce(sum(t.hours), 0)               as hours_used,
  s.budget_hours - coalesce(sum(t.hours), 0)
                                          as hours_remaining,
  case
    when s.budget_hours is null or s.budget_hours = 0 then null
    else round((coalesce(sum(t.hours), 0) / s.budget_hours) * 100, 1)
  end                                     as percent_consumed
from public.sites s
left join public.timesheets t on t.site_id = s.id
where s.org_id = $1
  and s.track_hours = true
group by s.id, s.name, s.budget_hours
order by s.name;
```

(Adjust `t.hours` to whatever the timesheets column is actually called — verify
against the live schema before writing the query.)

**Rollout path:**

1. Build feature on demo branch with flag default = `false` (no user sees it).
2. PostHog: turn flag on for Royce only (`distinct_id` or supervisor cohort).
3. Mark 2–3 real major projects via the new toggle, verify totals match expectations.
4. Cohort expand: turn on for all supervisors in `tenant=eq`. (See note in Step 1.3
   about cross-PostHog-project caveat for SKS.)
5. Once stable, remove the flag check (or leave it as a kill switch indefinitely).

This is the safe pattern — every new code path is opt-in via flag, rolls back
to "feature does not exist" with a single PostHog toggle. Future features follow
this same shape.

### Step 1.3 — Wire flag identity, with a cross-project caveat

`scripts/analytics.js:192–223` (`_identify()`) is already called post-PIN-login and
passes `tenant_id` in person properties. PostHog targeting can then route flags by
cohort *within a single PostHog project*.

**Caveat:** EQ and SKS hit **different PostHog projects** (audit found EQ uses
`phc_zXpRxm6Q…` development project, SKS uses `phc_vM4Hrh7Q…` production project).
A flag created on EQ does **not exist** on SKS until you create it manually there
too. For tenant-scoped rollouts:

| Rollout target | Where to set flag |
|----------------|-------------------|
| EQ tenants only (incl. demo) | EQ PostHog project only — done |
| SKS only | SKS PostHog project only |
| Both | Set in **both** projects — same key, configured independently |

Document this in the runbook so nobody forgets the second project on a wide
rollout.

### Step 1.4 — CSP

`netlify.toml:51` already allows `https://*.posthog.com` in script-src. No CSP change needed.

### Step 1.5 — Role system (5-tier)

Added 2026-04-27 to support project-hours and every future per-role feature.

**Role enum (top → bottom):**

| Tier | Role key | Label | Notes |
|------|----------|-------|-------|
| 1 | `manager` | Manager | Full control. Owns the tenant. New role |
| 2 | `supervisor` | Supervisor | Existing role. Team-level ops, approvals |
| 3 | `employee` | Employee | Renamed from existing `staff` |
| 4 | `apprentice` | Apprentice | New role. Inherits employee + apprentice features |
| 5 | `labour_hire` | Labour Hire | New role. Minimal access (own roster, own timesheet) |

**Permission matrix (live working doc):**
[`drafts/eq-field-roles-2026-04-27/permission-matrix.html`](../../../eq-context/drafts/eq-field-roles-2026-04-27/permission-matrix.html)
in eq-context. Royce ticks per-role permissions, exports as JSON or markdown.
Output drives the implementation in this step.

**Matrix v1 captured 2026-04-27** —
[`drafts/eq-field-roles-2026-04-27/permissions-by-role-v1.json`](../../../eq-context/drafts/eq-field-roles-2026-04-27/permissions-by-role-v1.json).
Counts: manager 56, supervisor 36, employee 13, apprentice 17, labour_hire 5.
Iterate by re-opening the matrix HTML and exporting again — bump the suffix
(`-v2`, `-v3`) when committing a new version so old matrices stay auditable.

**Schema migration** — add a roles enum and a column on `people`:

```sql
-- migrations/2026-04-28_role_enum.sql
do $$
begin
  if not exists (select 1 from pg_type where typname = 'eq_role') then
    create type public.eq_role as enum (
      'manager', 'supervisor', 'employee', 'apprentice', 'labour_hire'
    );
  end if;
end $$;

alter table public.people
  add column if not exists role public.eq_role;

-- Backfill existing people from any current role marker.
-- Adjust the source column based on real schema (might be people.role text,
-- people.is_supervisor boolean, or live in app_config).
update public.people
  set role = case
    when role::text = 'supervisor' then 'supervisor'::public.eq_role
    when role::text = 'staff'      then 'employee'::public.eq_role
    else 'employee'::public.eq_role
  end
  where role is null;

alter table public.people
  alter column role set not null,
  alter column role set default 'employee';
```

**`verify-pin.js` change (resolved 2026-04-27 — single PIN per tenant, role from data):**

The current STAFF_CODE / MANAGER_CODE env-var pattern doesn't scale past 2 tenants.
With path-based tenant resolution (see "Tenant URL convention" in Phase 2), the
flow becomes:

1. Frontend posts `{ tenant_slug, name, pin }` to `verify-pin.js`
2. Function looks up `organisations` by slug → resolves `tenant_id` and the
   tenant's stored PIN
3. PIN compare (plaintext, per memory rule — no hashing)
4. Function looks up `people` by `(org_id, name)` → reads `role` from the row
5. Function mints Supabase JWT with `app_metadata.tenant_id` + `app_metadata.eq_role`

**Migration to add a tenant PIN column:**

```sql
-- migrations/2026-04-28_organisations_tenant_pin.sql
alter table public.organisations
  add column if not exists tenant_pin text null;

comment on column public.organisations.tenant_pin is
  'Shared PIN that gates entry to the tenant. Plaintext (per security model — gate is shared secret, role is data-driven via people.role).';
```

For the EQ tenant (existing), backfill `tenant_pin` from current `STAFF_CODE` env
var as a one-shot. The old `STAFF_CODE` / `MANAGER_CODE` env vars get deleted in
the next Netlify env cleanup (already pending in
`state/pending.md` — ties two tasks together cleanly).

The token's `app_metadata.eq_role` (per Decision 3) carries the role into the
JWT, where RLS and the frontend can read it.

**Frontend permission check** — single helper consumed by every gate:

```javascript
// scripts/core/permissions.js
(function () {
  'use strict';
  // Loaded from the matrix export — JSON shape: { manager: ['perm.key', ...], ... }
  var MATRIX = window.EQ_PERMISSIONS || {};

  function can(permKey) {
    var session = window.readSession && window.readSession();
    if (!session || !session.role) return false;
    var allowed = MATRIX[session.role] || [];
    return allowed.indexOf(permKey) !== -1;
  }

  window.EQ_PERMS = { can: can };
})();
```

Usage at every UI gate:

```javascript
if (window.EQ_PERMS && window.EQ_PERMS.can('ph.view_dashboard')) {
  renderProjectHoursTab();
}
```

**Where the matrix lives in code** — once Royce exports the JSON from the
permission matrix HTML, drop it into a single file: `scripts/core/permission-matrix.js`
(window-attached). Editing roles becomes a one-file change.

**Open question to settle before coding:** the matrix HTML lets you assign
permissions arbitrarily. The plan assumes role inheritance is *not* enforced at
the data layer — Manager only "has" everything because the matrix lists everything
under Manager, not because of any inheritance rule. That keeps it explicit and
auditable. Confirm this is the model you want.

### Phase 1 deliverable checklist

- [ ] `scripts/flags.js` added and loaded after `analytics.js`
**Flags & feature gating**
- [ ] `scripts/flags.js` added and loaded after `analytics.js`
- [ ] `feat_project_hours_v1` flag created in EQ PostHog project, default off,
      targeted at Royce's `distinct_id` only for first cohort

**Project-hours feature**
- [ ] `sites.track_hours` + `sites.budget_hours` column migration applied to
      eq-solves-field Supabase (defaults safe, no rows currently tracking)
- [ ] Aggregation query verified against real timesheet data — column names
      confirmed, hours sum matches manual calculation on a test site
- [ ] Project-hours UI gated by both `EQ_FLAGS.isEnabled('feat_project_hours_v1')`
      *and* `EQ_PERMS.can('ph.view_dashboard')`

**Role system (5-tier)**
- [ ] Permission matrix completed in
      `eq-context/drafts/eq-field-roles-2026-04-27/permission-matrix.html`,
      JSON exported
- [ ] `eq_role` enum + `people.role` column migration applied; existing rows
      backfilled to `employee` or `supervisor` based on current state
- [ ] Per-role PIN env var pattern decided (shared PIN vs per-role PIN);
      env vars added on eq-solves-field Netlify site only
- [ ] `verify-pin.js` issues Supabase-native JWT with `app_metadata.eq_role`
      and `app_metadata.tenant_id`
- [ ] `scripts/core/permission-matrix.js` (matrix export) + `scripts/core/permissions.js`
      (`EQ_PERMS.can()` helper) shipped
- [ ] Existing `isManager` global **stays** — `EQ_PERMS` reads it as the
      primary today-path role signal. New code uses `EQ_PERMS.can(...)` directly.
      Legacy `isManager` checks migrate opportunistically (when touching a
      file for other reasons), **not** as a sweep — there are 97 occurrences
      across `scripts/` + `index.html`, more than the rest of Phase 1 combined

**Verification**
- [ ] Manually verified per role: log in as each of the 5 roles, confirm only
      permitted UI surfaces appear
- [ ] Flag off → no project-hours UI; flag on + correct role → visible; flag on +
      wrong role → still hidden (defence in depth)
- [ ] Documented in `changelog/EQ-FIELD.md`

**Backout plan:** flip `feat_project_hours_v1` to off in PostHog (instant). Migration
is additive (columns nullable / default false), no rollback needed unless schema
becomes unwanted — in which case
`alter table public.sites drop column track_hours, drop column budget_hours;`.

---

## Phase 2 — Multi-tenancy foundation

**Scope:** make `ktmjmdzqrogauaevbktn` (eq-solves-field Supabase) safe for multiple paying
customers. Do **not** touch `nspbmirochztcjijmcrx` (SKS live).

**Order matters.** Each step is independently shippable and reversible.

### Tenant URL convention (locked 2026-04-27)

**Production URL shape:** `eq.solutions/field/<slug>/`

| Component | Source | Notes |
|-----------|--------|-------|
| `eq.solutions` | Cloudflare Pages site (already live, royce@ account) | Root serves the EQ Solutions homepage — incidental cross-sell when users land at `/` |
| `/field/` | Path prefix | Routes to the EQ Field app |
| `<slug>` | `organisations.slug` | Resolves to `tenant_id` on app load |

**App-side resolution:** extend `_detectTenantSlug()` ([scripts/app-state.js:31](scripts/app-state.js:31))
to read the URL path before falling back to hostname / query string. Path takes
precedence so a future bookmarked URL "just works" regardless of which subdomain
or query string was used historically.

**PIN storage:** moves from Netlify env vars (`STAFF_CODE`, `MANAGER_CODE`, etc.)
to a single `tenant_pin` column on `organisations` (or a row in `app_config`).
One PIN per tenant. Role is derived from `people.role`, not from which PIN
matched. Per-role PINs are dropped — security model becomes "shared PIN gates
entry, claimed name + DB-recorded role determines authority".

**Self-serve signup (Phase 4 trigger):** create `organisations` row, generate
PIN, return URL like `eq.solutions/field/acme/`. The customer bookmarks it.
No DNS work, no Netlify subdomain provisioning, no per-customer SSL certs.

**Routing infrastructure (deferred until Phase 2 trigger):** today
`eq-solves-field.netlify.app` is the live host. To make `eq.solutions/field/*`
serve the EQ Field app, options at the time:

1. Cloudflare Worker on `eq.solutions` proxies `/field/*` to Netlify origin —
   keeps eq.solutions on Cloudflare Pages, adds one Worker route
2. Subdomain `field.eq.solutions` pointed at Netlify via custom domain — URL
   becomes `field.eq.solutions/<slug>/`, slightly off-spec but cleanest
3. Stay on `eq-solves-field.netlify.app/<slug>/` until customer count justifies
   the routing work

**Until then:** the path-based slug resolution can ship and be tested on
`eq-solves-field.netlify.app/<slug>/` — domain change is independent.

### Step 2.1 — Lock the `organisations` table as the tenancy root

Inventory + add constraints to every business table:

- [ ] Confirm every business table has `org_id uuid not null` (audit found most do — verify)
- [ ] Add FK constraints where missing: `<table>.org_id → organisations.id` (with
      `on delete restrict` — never cascade tenant deletion silently)
- [ ] Add `not null` constraint where it's currently nullable
- [ ] Add CHECK constraint: tenant_id must match the row's org_id (defence against bad
      writes)

**Batch sequence (locked 2026-04-27):** lowest write-traffic / lowest blast-radius
first. Each batch ships as one migration; verify nothing broke before the next.

| Batch | Tables | Rationale |
|-------|--------|-----------|
| 1 | `apprentice_profiles`, `skills_ratings`, `feedback_entries`, `rotations`, `buddy_checkins`, `quarterly_reviews`, `engagement_log` | Apprentice-feature tables. Low write traffic. Safe sandbox to validate the migration shape and rollback flow |
| 2 | `leave_balances`, `leave_requests`, `checkins` | Already have RLS enabled (different policy shape). Medium traffic |
| 3 | `people`, `sites`, `app_config`, `managers` | Core tables. Read-heavy, write-bursty. Confidence should be high after batches 1–2 |
| 4 | `schedule`, `timesheets` | Highest write traffic (daily timesheet submissions, weekly roster updates). Last for the smallest blast radius if anything regresses |

Sample migration (Batch 1, abbreviated):

```sql
-- migrations/2026-04-28_org_id_constraints_batch1.sql
alter table public.apprentice_profiles
  alter column org_id set not null,
  add constraint apprentice_profiles_org_id_fk
    foreign key (org_id) references public.organisations(id) on delete restrict;

alter table public.skills_ratings
  alter column org_id set not null,
  add constraint skills_ratings_org_id_fk
    foreign key (org_id) references public.organisations(id) on delete restrict;

-- ... repeat for the remaining 5 tables in this batch.
```

### Step 2.2 — Mint a Supabase-native JWT in `verify-pin.js` (Decision 3, Option C)

Replace the custom-HMAC token with a Supabase-recognised JWT signed with the
project's JWT secret. PIN UX stays identical — only the token shape changes.

**One new env var on the eq-solves-field Netlify site only:**

| Var | Source | Notes |
|-----|--------|-------|
| `SUPABASE_JWT_SECRET` | Supabase dashboard → Project settings → API → JWT Secret (eq-solves-field project) | Treat as production secret. Never commit. Never reuse from SKS Labour project |

**Code in [netlify/functions/verify-pin.js](netlify/functions/verify-pin.js):**

```javascript
// verify-pin.js — replace signToken() with Supabase-compatible JWT mint
const jwt = require('jsonwebtoken'); // add to package.json

function mintSupabaseToken(name, role, tenantId) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: 'authenticated',
    role: 'authenticated',
    sub: name,                           // stable identifier per session
    exp: now + (7 * 24 * 60 * 60),       // 7 days
    iat: now,
    app_metadata: {
      tenant_id: tenantId,               // <-- this is what RLS reads
      eq_role: role                      // staff | supervisor (custom claim)
    }
  };
  return jwt.sign(payload, process.env.SUPABASE_JWT_SECRET, { algorithm: 'HS256' });
}

// In the success path, replace existing signToken() call:
const sessionToken = mintSupabaseToken(name, role, tenantId);
```

`tenantId` is resolved server-side from the URL path (per "Tenant URL convention"
above) — never from client-supplied JSON. The PIN compare logic stays exactly as
it is — per memory, no salt+hash theatre.

**Stale tokens after the JWT shape change (operational):** today's localStorage
holds custom-HMAC tokens with payload `{name, role, exp}`. Once the new mint
ships, those won't validate against `SUPABASE_JWT_SECRET`. Frontend handles this
gracefully:

```javascript
// scripts/auth.js — addition to readSession()
function readSession() {
  var raw = localStorage.getItem(ACCESS_KEY);
  if (!raw) return null;
  try {
    var parsed = JSON.parse(raw);
    // Old shape: no app_metadata wrapper. Treat as logged out.
    if (!parsed.app_metadata || !parsed.app_metadata.tenant_id) {
      localStorage.removeItem(ACCESS_KEY);
      return null;
    }
    return parsed;
  } catch (_) {
    localStorage.removeItem(ACCESS_KEY);
    return null;
  }
}
```

A logged-out state simply re-prompts the PIN gate — same UX as a 7-day expiry.
No crash, no half-authenticated state.

### Step 2.3 — Tenant-aware Supabase wrapper

`scripts/supabase.js` already wraps the REST API. Switch the `Authorization` header from
the public anon key to the user's session JWT — Supabase reads `app_metadata.tenant_id`
from that token, no custom headers needed.

```javascript
// scripts/supabase.js — sbFetch() change
function sbFetch(path, opts) {
  opts = opts || {};
  opts.headers = opts.headers || {};
  opts.headers['apikey'] = SB_KEY;             // anon key stays as apikey
  // CHANGE: Authorization is now the user's JWT (was: Bearer SB_KEY)
  var session = readSession();
  var bearer = (session && session.token) ? session.token : SB_KEY;
  opts.headers['Authorization'] = 'Bearer ' + bearer;
  return fetch(SB_URL + '/rest/v1' + path, opts);
}
```

If `session.token` is absent (logged out) the request goes as anon and RLS rejects it
(no tenant claim). That's the correct failure mode.

### Step 2.4 — RLS policies, table by table, behind a kill switch

For each table, the migration:

1. Drops permissive policies (`USING (true)`)
2. Adds a strict tenant policy
3. Stays behind a feature flag so we can flip back fast

Pattern uses the standard Supabase RLS shape — `auth.jwt()` reads the JWT minted in
Step 2.2, and `app_metadata.tenant_id` is the claim:

```sql
-- migrations/2026-04-28_rls_people.sql
alter table public.people enable row level security;

drop policy if exists anon_select_people on public.people;
drop policy if exists anon_insert_people on public.people;
drop policy if exists anon_update_people on public.people;

-- Reusable helper — keeps policies short and consistent across tables
create or replace function public.eq_current_tenant()
returns uuid language sql stable as $$
  select ((auth.jwt() -> 'app_metadata') ->> 'tenant_id')::uuid;
$$;

-- Reads: tenant must match
create policy people_tenant_select on public.people
  for select to authenticated
  using (org_id = public.eq_current_tenant());

-- Writes: tenant must match AND row's org_id must match
create policy people_tenant_insert on public.people
  for insert to authenticated
  with check (org_id = public.eq_current_tenant());

create policy people_tenant_update on public.people
  for update to authenticated
  using (org_id = public.eq_current_tenant())
  with check (org_id = public.eq_current_tenant());

-- Service role keeps full access (for edge functions)
create policy people_service_role on public.people
  for all to service_role using (true) with check (true);
```

Note `to authenticated` not `to anon` — the JWT minted in Step 2.2 carries
`role: authenticated`, so all logged-in users hit these policies. Logged-out
clients still send the anon key, which gets no rows (no policy grants `anon` access).

**Roll out one table at a time** — start with the lowest-traffic table (`apprentice_profiles`
or `engagement_log`), watch logs, then proceed. Estimated 14–18 tables across 4–6 batches.

### Step 2.5 — Edge & Netlify function hardening (full defence in depth — locked 2026-04-27)

**The gotcha:** service-role bypasses RLS. A future query that forgets
`.eq('org_id', orgId)` silently leaks data across tenants — RLS isn't there
to catch it. With multiple paying customers this is a real exposure.

**Locked mitigation: A + B + C (all three).** Bigger upfront cost, structurally
prevents the failure mode.

#### Step 2.5.A — Audit checklist + PR review rule

- [ ] Document the rule in `rules/non-negotiables.md`: every service-role
      query in `supabase/functions/**` MUST include an explicit `.eq('org_id', orgId)`
      filter (or equivalent SQL `where org_id = $1`)
- [ ] Add this check to the security-review skill prompt
- [ ] Audit existing edge functions line-by-line:
  - [ ] `supabase/functions/supervisor-digest/index.ts` — verify every query
        scopes by `org_id`
  - [ ] `supabase/functions/ts-reminder/index.ts` — verify every query
        scopes by `org_id`
- [ ] `netlify/functions/send-email.js` — confirm it stays out of the DB
- [ ] `netlify/functions/eq-agent.js` — confirm it stays out of the DB
- [ ] `netlify/functions/verify-pin.js` — uses anon key + DB writes; covered
      by Step 2.2 changes

#### Step 2.5.B — Tenant-wrapper helper

A thin module that injects the `org_id` filter for every query, so forgetting
it becomes structurally impossible.

```typescript
// supabase/functions/_shared/tenantClient.ts
import { createClient } from 'jsr:@supabase/supabase-js@2';

export function tenantClient(supabaseUrl: string, serviceRoleKey: string, orgId: string) {
  const sb = createClient(supabaseUrl, serviceRoleKey);
  // Proxy that auto-injects org_id on every from() call
  return new Proxy(sb, {
    get(target, prop) {
      if (prop === 'from') {
        return (table: string) => {
          const builder = target.from(table);
          // Wrap select/update/delete to always include the org_id predicate
          const original = { select: builder.select.bind(builder), update: builder.update.bind(builder), delete: builder.delete.bind(builder) };
          builder.select = (...args: any[]) => original.select(...args).eq('org_id', orgId);
          builder.update = (vals: any) => original.update(vals).eq('org_id', orgId);
          builder.delete = () => original.delete().eq('org_id', orgId);
          // insert needs the org_id baked into the row, not a where filter:
          const originalInsert = builder.insert.bind(builder);
          builder.insert = (vals: any) => {
            const withOrg = Array.isArray(vals)
              ? vals.map(v => ({ ...v, org_id: orgId }))
              : { ...vals, org_id: orgId };
            return originalInsert(withOrg);
          };
          return builder;
        };
      }
      return (target as any)[prop];
    }
  });
}
```

(Sketch — verify against current Supabase JS SDK shape before shipping.)

Edge functions then use it:

```typescript
// supabase/functions/supervisor-digest/index.ts
const tenantSb = tenantClient(SUPABASE_URL, SERVICE_ROLE_KEY, orgId);
// Every call from here is automatically org-scoped
const people = await tenantSb.from('people').select('id, name');  // safe
```

- [ ] `supabase/functions/_shared/tenantClient.ts` written + tested
- [ ] `supervisor-digest` migrated to use it
- [ ] `ts-reminder` migrated to use it

#### Step 2.5.C — Tenant-impersonation JWT (defence in depth)

Service-role stays only at the explicit cross-tenant orchestration boundary
(enumerating `organisations`). Per-tenant data fetches use a JWT minted with
that tenant's `app_metadata.tenant_id`, so RLS catches missing filters even
if the wrapper from Step 2.5.B is bypassed somehow.

```typescript
// supabase/functions/_shared/tenantImpersonation.ts
import { create as createJWT } from 'jsr:@djwt';

export async function mintTenantJWT(orgId: string, jwtSecret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: 'authenticated',
    role: 'authenticated',
    sub: 'edge-function:' + orgId,
    exp: now + 300,                 // short-lived: 5 minutes is plenty
    iat: now,
    app_metadata: { tenant_id: orgId, eq_role: 'manager' }  // edge fn acts as manager
  };
  return await createJWT({ alg: 'HS256', typ: 'JWT' }, payload, jwtSecret);
}

export function tenantImpersonationClient(url: string, jwt: string) {
  return createClient(url, jwt);  // anon key not needed when using a real JWT
}
```

Pattern in edge function:

```typescript
// Top of supervisor-digest
const sbServiceRole = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const { data: tenants } = await sbServiceRole
  .from('organisations')
  .select('id, slug, name');

for (const tenant of tenants) {
  // Mint short-lived tenant JWT — RLS now enforces tenant scope
  const tenantJWT = await mintTenantJWT(tenant.id, SUPABASE_JWT_SECRET);
  const tenantSb = tenantImpersonationClient(SUPABASE_URL, tenantJWT);

  // All queries from here run under RLS as that tenant's manager
  const people = await tenantSb.from('people').select('id, name');
  // ... build digest, send email
}
```

- [ ] `supabase/functions/_shared/tenantImpersonation.ts` written + tested
- [ ] `SUPABASE_JWT_SECRET` available to edge functions (via Supabase secrets)
- [ ] `supervisor-digest` orchestration refactored: service-role only for
      `organisations` enumeration, tenant-impersonation JWT for everything else
- [ ] `ts-reminder` same refactor
- [ ] Test: an edge function query that "forgets" `.eq('org_id', ...)` returns
      zero rows (RLS catches it) — proof that the defence-in-depth works

### Step 2.6 — Demo-mode redesign

Currently `tenant=demo` means "no Supabase, SEED data" (per audit:
`scripts/app-state.js:101–109`). For self-serve trials this needs to change.
Recommendation when Phase 2 fires:

1. (recommended) Provision a real `demo` tenant in `organisations`, seed it
   server-side on signup, run normal RLS against it. SEED data lives in DB,
   not in JS. URL becomes `eq.solutions/field/demo/`.
2. Keep SEED-in-JS for demo-only and route real signups to a fresh tenant.
   More code paths, more divergence — exactly what we're trying to escape.

**Per memory:** demo tenant must continue to send real emails. RLS must allow
demo's email-send path the same way live's does — Royce uses real CC to verify
flow end-to-end during dev.

### Phase 2 deliverable checklist

- [ ] `org_id` constraints applied across all 4 batches (apprentice features →
      leave/checkins → core → schedule/timesheets)
- [ ] `verify-pin.js` mints Supabase-native JWT with `app_metadata.tenant_id`
      and `app_metadata.eq_role`
- [ ] `scripts/supabase.js` `sbFetch` swaps `Authorization` header from anon
      key to user JWT
- [ ] `scripts/auth.js` `readSession()` detects pre-migration token shape and
      forces clean re-login
- [ ] RLS migration written + applied for at least one canary table on
      eq-solves-field; zero regressions on existing `eq` tenant
- [ ] Edge function hardening shipped (Step 2.5 A + B + C)
- [ ] Documented in `eq-context/changelog/EQ-FIELD.md`
- [ ] Documented in `changelog/EQ-FIELD.md`
- [ ] **Not deployed** without explicit Royce approval (per `rules/non-negotiables.md`)

---

## Code organization — small, optional

Royce's note: open to better organisation, no full rewrite. Three changes that pay for
themselves quickly without a Vite migration:

1. **Group tenant logic into one folder.** Move `app-state.js`, `supabase.js`, `auth.js`,
   `analytics.js`, and the new `flags.js` into `scripts/core/`. Update `index.html`
   script tags accordingly. ~5 minutes of work, signals "this is the platform layer".
2. **Extract `TENANT_SUPABASE` and `TENANT_BRANDING` into `scripts/core/tenants.js`.**
   Today they live in `app-state.js` and `apprentices.js` — moving them to one file
   makes adding a new customer a 1-line change.
3. **Add a `scripts/core/tenant-context.js`** — single module that owns "who is the
   current tenant, what's their config, what feature flags are on for them". Consumed
   by everything else.

**Do not** introduce TypeScript or a build tool in this initiative. That's a separate
decision and not on the critical path. (Aligned with Royce's "working before refactoring"
rule.)

---

## Testing checklist

Run before flipping each RLS table from permissive to strict:

### Tenant isolation tests
- [ ] As tenant A: SELECT returns only A's rows
- [ ] As tenant A: INSERT with `org_id=B` is rejected (RLS WITH CHECK)
- [ ] As tenant A: UPDATE setting `org_id=B` is rejected
- [ ] As tenant A: DELETE on B's row returns 0 rows affected, no error leak
- [ ] Anon (no JWT) → no rows returned (not a 500)
- [ ] JWT with missing `app_metadata.tenant_id` → no rows returned, no SQL exception
- [ ] JWT with non-UUID `tenant_id` value → no rows returned, no SQL exception
- [ ] Service role bypass still works for `supervisor-digest` and `ts-reminder`

### Auth + token tests
- [ ] PIN login still works for both roles (staff, supervisor)
- [ ] Old localStorage token (pre-migration shape) → forces re-login cleanly, no crash
- [ ] Token tampered (signature broken) → Supabase rejects with 401, frontend re-prompts PIN
- [ ] Token tampered (claims swapped, re-signed with wrong secret) → same — Supabase rejects
- [ ] `auth.jwt()` returns expected shape inside an RLS policy when called via PostgREST

### Demo-mode tests
- [ ] `?tenant=demo` still gives SEED data (until Step 2.6 is decided)
- [ ] Demo-mode email send still hits Resend with real CC (per memory: this is required)

### Performance smoke
- [ ] Roster query latency p95 unchanged (RLS adds <5ms typically — verify)
- [ ] Calendar query latency p95 unchanged
- [ ] Timesheet write latency p95 unchanged

### Rollback rehearsal
- [ ] Practice flipping `mt_rls_strict=false` and confirm legacy permissive policies
      take over immediately
- [ ] Practice rolling back the JWT change — old tokens still work for one full session

---

## Out of scope (Phases 3–7)

Listed only so we don't lose them. Each gets its own plan once Phases 1–2 are stable.

| Phase | What | Trigger |
|-------|------|---------|
| 3 | Stripe → tenant subscription linking | First paying customer queued |
| 4 | Self-serve onboarding (`welcome.html` rebuild) | Phase 2 done + self-serve trial is the GTM motion |
| 5 | `tenant_memberships` + role system | When >1 user per tenant matters |
| 6 | Security audit + advisor review | After Phase 2 RLS rolled out fully |
| 7 | Live data migration | Only if we ever fold legacy data into shared schema (currently we don't) |

---

## Risks to manage

| Risk | Mitigation |
|------|-----------|
| Accidentally touching SKS live (`nspbmirochztcjijmcrx`) | All migrations in this plan target eq-solves-field project only. Verify project ID at top of every migration. `SUPABASE_JWT_SECRET` only added to eq-solves-field Netlify site |
| `SUPABASE_JWT_SECRET` leaks | Treat exactly like `EQ_SECRET_SALT` today. Netlify env vars only, never committed, never pasted into chat |
| RLS misconfigured → tenant data leak | Roll one table at a time, behind kill switch, verify before proceeding |
| RLS misconfigured → tenant locked out | Service role keeps fallback; rollback flag flips back to permissive |
| Stale localStorage tokens after JWT shape change | Frontend detects old token shape (missing `app_metadata.tenant_id`) and forces re-login cleanly |
| Demo email regression | Memory rule: demo tenant must send real emails. Add explicit test in checklist |
| GTM slip while building this | Decision 1 enforces a stop point — Phase 2 is gated on customer trigger |
| Supabase JWT secret rotated | Every issued token invalidates instantly. All users forced to re-login on next query. Operationally fine for a small base; document the behaviour so nobody is surprised, and keep the rotation recovery path explicit (rotate secret → frontend gracefully detects 401 → PIN prompt re-issues fresh tokens) |
| Service-role query forgets `org_id` filter (data leaks across tenants) | Triple defence per Step 2.5: PR rule (A), tenant-wrapper helper auto-injects (B), tenant-impersonation JWT means RLS catches it as a final safety net (C) |

---

## References

- Audit trail: this branch (`claude/hopeful-wright-058c8b`), worktree at
  `.claude/worktrees/hopeful-wright-058c8b`
- Existing tenancy logic: [scripts/app-state.js:31](scripts/app-state.js:31) (tenant detection),
  [scripts/app-state.js:19](scripts/app-state.js:19) (tenant Supabase map),
  [apprentices.js:163](apprentices.js:163) (branding map)
- Existing RLS: [migrations/2026-04-16_tier1_features_schema.sql](migrations/2026-04-16_tier1_features_schema.sql),
  [migrations/2026-04-21_ts_reminders_sent.sql](migrations/2026-04-21_ts_reminders_sent.sql)
- PIN auth: [netlify/functions/verify-pin.js:137](netlify/functions/verify-pin.js:137)
- PostHog init: [scripts/analytics.js:127](scripts/analytics.js:127)
- Eq-context source of truth:
  - `C:\Projects\eq-context\state\pending.md` (GTM priority, env var cleanup)
  - `C:\Projects\eq-context\knowledge\architecture.md` (three-Supabase rule)
  - `C:\Projects\eq-context\state\products.md` (EQ Field current state)
- Pattern to mirror: EQ Solves Service multi-tenant RLS (already shipped, 80 Vitest tests)
