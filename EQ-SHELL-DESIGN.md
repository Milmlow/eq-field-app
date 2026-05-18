# EQ Shell — Architecture design

**Status:** Q1-Q10 LOCKED 2026-05-18. MVP scope ready. Awaiting kickoff green-light.
**Created:** 2026-05-18 by Claude during Phase D of `NEW-WINDOW-PROMPT-melbourne-ready.md`.
**Supersedes:** Phase D as written in that brief. The brief assumed an "EQ Field tenant onboarding admin flow"; the actual direction is a higher-level EQ Shell of which EQ Field becomes one module among several.

---

## Decisions locked 2026-05-18

| Q | Answer | Implication |
|---|---|---|
| Q1 — shell repo state | **No code yet — fresh start.** | I scaffold a new repo. Stack proposal: Vite + React + TypeScript + React Router (Vite over Next.js — no SSR needed for an authenticated tool; faster setup; simpler Netlify hosting). |
| Q2 — Field integration | **iframe MVP + new screens in React (trajectory).** | Phase 1: shell iframe-loads existing EQ Field deploy. Phase 2: Tender Pipeline's planned screens land as React shell-routes (NOT as additions to vanilla Field). Phase 3+: gradual surface-by-surface Field migration as each needs rework. No big-bang rewrite. |
| Q3 — canonical layer | **EQ-corporate canonical Supabase.** | New project `eq-shell-control` owns `tenants`, `users`, `module_entitlements`, `branding`. Each tenant keeps their own Supabase for app data. Shell reads canonical; modules read their tenant's project. Schema-template approach (Q3 option b) deferred. |
| Q5 — entitlements | **Lazy-load + runtime gate.** | Each module is a separate JS chunk via Vite's dynamic `import()` / React's `lazy()`. Shell fetches only the chunks for enabled modules. Bandwidth-efficient, mostly-secure, free in the framework. Procurement-cleanest answer (B — build-time omit) is reserved for the day a customer demands it. |
| Q6 — branding | **Shell React Context + iframe URL hash.** | Shell fetches brand object from canonical Supabase on login, holds in React Context, passes to React modules via Provider. Field iframe gets brand object via URL hash alongside the auth token. Two delivery mechanisms, both natural to their context. |
| Q8 — timeline | **Representative shape — weeks/months.** | No signed Melbourne deal yet; platform-readiness shapes prospect conversations. Phase 1 over a few weeks, iterate on first prospect feedback. Most natural pace. |
| Q9 — marketing site | **Marketing stays at root, shell on subdomains.** | `eq.solutions` = existing Cloudflare Pages marketing site, untouched. `*.eq.solutions` = shell deploy on Netlify. Cleanest separation; no migration risk; marketing's manual zip-upload deploy process keeps working. |
| Q10 — Tender Pipeline placement | **Split out as React module under the shell (Phase 2).** | Becomes a first-class module, not a sub-feature of Field. Phase 2 is the wedge. |
| Q7 — minimum viable shell | **Answered by Phase 1 scope below.** | Shell repo + canonical Supabase + 3 Netlify functions + iframe-Field route. ~1-3 sessions. |

### The auth contract spelled out (Q4)

Cookie on `*.eq.solutions`. Concretely:

1. User lands on `melbourne.eq.solutions` → shell mounts.
2. Shell sees no session cookie → renders login form.
3. Login posts to `/.netlify/functions/shell-login` → validates credentials → sets `eq_shell_session` cookie (HttpOnly, Secure, SameSite=Lax, domain=.eq.solutions, ~7d TTL).
4. Subsequent requests across `*.eq.solutions` modules read the cookie automatically.
5. React modules (Cards / Intake / Quotes / Service / future Tender Pipeline) call `/.netlify/functions/verify-shell-session` on mount to hydrate user + tenant context.
6. **EQ Field is cross-domain** (`eq-solves-field.netlify.app`, not `*.eq.solutions`) — cookie won't reach. Shell mints a short-lived HMAC token, passes via URL hash on iframe load (`<iframe src="https://eq-solves-field.netlify.app/#sh=...">`). Field reads the hash on boot, treats it as a Remember-me-equivalent: validates HMAC via existing `/.netlify/functions/verify-pin` (extended action="verify-shell-token"), skips the gate.
7. When `eq-solves-field` is eventually moved under `field.eq.solutions` (subdomain alias), the URL-hash dance goes away and Field becomes cookie-native.

This means **one new Netlify function** (`shell-login`) plus **two new actions** on `verify-pin` (`shell-login`, `verify-shell-token`). The HMAC signing key is already there (`EQ_SECRET_SALT`).

---

## Background

The Melbourne-ready brief's Phase D asked four questions (E1-E4) about a tenant-onboarding admin flow inside the EQ Field app. Mid-session, Royce surfaced a different architecture that's been forming in parallel: a multi-module EQ Shell with a "canonical layer per tenant".

```
                   ┌─────────────────────────────────┐
                   │  EQ Shell  (sks.eq.solutions)   │
                   │  ───────                        │
                   │  • Auth (one login)             │
                   │  • Navigation                   │
                   │  • Tenant config (modules       │
                   │    enabled per customer)        │
                   └────┬──────┬──────┬──────┬───────┘
                        │      │      │      │
                  ┌─────┘      │      │      └─────┐
                  ▼            ▼      ▼            ▼
              [Cards]      [Intake] [Quotes]   [Service]
              lazy-loaded routes inside the shell
              each module is its own React app
```

This doc captures my understanding so far, raises the open questions that need answers before code starts, and proposes an MVP shape.

---

## What I understand

1. **EQ Shell is the customer-facing app.** Hostname pattern is `<tenant>.eq.solutions` (sample: `sks.eq.solutions`). One login per tenant — supervisor types their code at the shell level, not at each module.

2. **Modules are sub-apps loaded as routes inside the shell.** Sketch lists Cards, Intake, Quotes, Service. Implied (not yet stated) — EQ Field becomes another module in this family.

3. **Each module is its own React app.** EQ Field today is vanilla JS — this is the first signal of a framework choice. Implications below.

4. **Tenant config lives at the shell layer.** Which modules a tenant has enabled, plus branding + access level, are owned by the shell and queryable from any module. This is the "canonical layer per tenant" — a single source of truth EQ controls, that modules read from.

5. **Provisioning is full-guided wizard.** Royce picked option (d) on E2 — onboarding includes welcome screen, demo-data option, first-week rollout. Presumably runs at the shell layer, not per-module.

6. **Hostname strategy is Netlify deploy per tenant.** Picked option (a) on E4. Each tenant gets a `<tenant>.eq.solutions` (or `<tenant>-eq-solves-field.netlify.app` while DNS is being sorted).

---

## Open questions before code

All Q1-Q10 are locked (see top of doc). No remaining design blockers for Phase 1 kickoff.

---

## Phase 1 — Shell MVP (1-3 sessions)

Given the locked decisions, here's the concrete Phase 1 scope:

**New `eq-shell` repo** — Vite + React + TypeScript + React Router. Hosted on Netlify (its own project, separate from `eq-field-app`).

**New `eq-shell-control` Supabase project** — EQ-corporate canonical. Tables:

```sql
tenants               (id uuid pk, slug text unique, name, brand_color, supabase_project_id, created_at)
users                 (id uuid pk, email, pin_hash, tenant_id fk, role, created_at)
module_entitlements   (tenant_id fk, module text, enabled boolean, primary key (tenant_id, module))
```

`module` enum: `field` / `cards` / `intake` / `quotes` / `service` / `tender_pipeline`.

**Netlify functions on shell deploy:**
- `shell-login` — POST { email, pin } → validates against `users` table → sets `eq_shell_session` cookie.
- `verify-shell-session` — GET → returns { user, tenant, entitlements } for an authenticated session.
- `mint-iframe-token` — POST → returns short-lived (60s) HMAC token for iframe handoff to Field.

**Shell app shape:**
- `/` → login form (renders if no session cookie).
- `/<tenant>/` → tenant home (nav lists enabled modules).
- `/<tenant>/field` → iframe page for Field. Mints token via `mint-iframe-token`, embeds `<iframe src="https://eq-solves-field.netlify.app/#sh=<token>">`.
- `/<tenant>/cards` etc. → stub routes for the other modules (return "coming soon" until built).

**Netlify domain setup:**
- `eq.solutions` → marketing (existing, untouched).
- `*.eq.solutions` → shell deploy (wildcard).
- `eq-solves-field.netlify.app` → existing Field deploy, untouched.

**Existing Field changes:** add `?sh=` URL hash handler in `scripts/auth.js` that calls `verify-pin` with `action="verify-shell-token"`. Backwards-compatible — direct visits to `eq-solves-field.netlify.app` still get the gate. ~30 lines of vanilla JS in Field; no shell-coupling.

That's the Phase 1 surface. Working end-to-end shell-routes-to-Field for one tenant.

## Phase 2 — Tender Pipeline migration (the wedge)

Per Royce's cowork context: Tender Pipeline is the active business wedge. The 5 originally-planned screens (Tender Sync import, Pipeline kanban, Enrichment panel, Fortnightly Review, Labour Curve Confirmation) all shipped in v3.4.79-83 *inside vanilla Field*. The product is the **fortnightly review meeting**, not the screen. Six fortnightly reviews in a row + 30+ notes logged at month 3 is the adoption proof.

This is the right module to migrate FIRST under the shell, because:

1. **It's the active surface** — Royce + the Construction Manager are the users; they'll feel the difference (improved or otherwise) immediately, not in six months when someone first opens it.
2. **It's contained** — `scripts/tender-pipeline.js` (~1929 lines), `scripts/tender-parser.js` (~346 lines), 4 sidebar entries. Self-contained from the rest of Field. Clean cut.
3. **It's recent code** — written 2026-05-14 to ~05-18, fresh in mind. Patterns are documented.
4. **It exercises every shell capability** — Supabase reads/writes, drag-drop kanban, multi-step Review wizard, file upload (Smartsheet xlsx), PostHog events. Migrating Tender Pipeline successfully validates the React + shell pattern for everything else.
5. **The Tender data already lives in EQ Supabase** (`ktmjmdzqrogauaevbktn`, the EQ tenant), not the canonical. That's correct — tender data is tenant-owned. The shell just provides chrome + auth + nav.
6. **SEC3 was just closed** on the vanilla Tender Pipeline. The migration carries those policies forward — no security regression.

**Phase 2 scope (3-5 sessions):**

- React routes for each of the 5 screens, mounted at `/<tenant>/tender-pipeline/{import|kanban|review|enrichment|curve}`.
- Shared component library (kanban via `@dnd-kit`, forms via `react-hook-form`, tables via `@tanstack/react-table`).
- Reuse the EXISTING tender Supabase tables (`tenders`, `tender_enrichment`, `nominations`, `pending_schedule`, `tender_import_runs`, `tender_review_decisions`) — Phase 2 is a UI rewrite, not a schema change. Real-time stays via Supabase realtime channel.
- PostHog events preserved (the 10 from v3.4.79-83 are already firing — Phase 2 keeps the same event names).
- Tender Sync xlsx import — port the SheetJS parser to TypeScript, same logic.
- Cut over: shell's `/field` route still iframes vanilla Field, but the Tender Pipeline sidebar entries inside Field redirect to `/tender-pipeline/...` shell routes. Vanilla Tender Pipeline code can be deleted once the cutover proves stable (~2 weeks of soak with you + CM running fortnightly reviews on the React version).

**Adoption signal preserved:** the fortnightly meeting is unchanged. Same agenda, same kanban, same notes — different rendering engine.

## Phase 3+ — Field surfaces (months out, only as needed)

Each Field surface migrates one at a time when it next needs significant rework. Recommend starting order:

1. **Sites CRUD** — low traffic, well-tested, simple shape. Safest first migration.
2. **Supervisors / People CRUD** — same pattern as Sites; share the form abstractions.
3. **Leave** — moderate complexity (approval flow + email + magic-link tokens).
4. **Roster Editor + realtime presence** — highest complexity. Last to move.
5. **Timesheets** — depends on Roster shape; co-migrate.

Schedule (the read-only roster view) is the very last because v3.5.6's `content-visibility:auto` is a tight optimization that a naïve React port would lose.

---

## Phase 4 — Field is gone

Long-term goal: every surface is a React shell route. The `eq-solves-field.netlify.app` deploy is decommissioned. SKS and EQ tenants live entirely on `*.eq.solutions`. No iframe. Single codebase + single design system.

Not for this year. Worth naming so the trajectory is honest.

---

## What this doc is NOT proposing

- **A full React migration of EQ Field.** Q2 trajectory is iframe MVP → new screens (Tender Pipeline) in React → gradual Field migration only as surfaces need rework. No big-bang.
- **Killing the existing SKS deploy or EQ-Field demo.** Both stay live; the shell sits in front of NEW shell-hosted tenants. SKS prod is untouched until Phase 4.
- **Touching the SKS auth model.** The shell auth contract is independent of SKS prod's gate.
- **A wizard.** The brief asked for one; my read is wizard = Wave 5+ once 3+ tenants exist. Phase 1 provisioning is you running SQL + commit.
- **Module-level rewrites for Cards / Intake / Quotes / Service.** Out of scope until the shell exists.

---

## Next steps after this PR merges

All design questions answered (Q1-Q10). No remaining decision blockers. Concrete kickoff plan:

1. **Phase 1.A — scaffolding** — create new `eq-shell` repo on GitHub, Vite + React + TS init, Netlify project with `*.eq.solutions` wildcard pending, `eq-shell-control` Supabase project provisioned with the three tables. ~1 session, mostly mechanical.
2. **Phase 1.B — wire-up** — `shell-login`, `verify-shell-session`, `mint-iframe-token` Netlify functions. Basic React shell with login + tenant-home + iframe-Field route. React Context for brand. Lazy-loaded module routes (stub "coming soon" pages for Cards/Intake/Quotes/Service). ~1 session.
3. **Phase 1.C — Field side** — `?sh=` URL hash handler in `scripts/auth.js` so the iframe handoff works. Small PR against `eq-field-app/demo`. ~30 min.
4. **Phase 1.D — end-to-end smoke** — provision one test tenant (`sks-test.eq.solutions`), login, navigate to Field via iframe, confirm session flows through, check brand applies. ~1 session.

Then **Phase 2 (Tender Pipeline migration to React)** starts — see Phase 2 section above. ~3-5 more sessions.

Per Q8 (representative-shape timeline), the cadence is "few weeks, iterate on prospect feedback" — no rush to ship Phase 1 in a single sitting.

---

**Doc-only PR.** No code. No version bump. No migration. Merge or close as you prefer; the locked Q1-Q4 decisions are reflected in the document and inform the Phase 1/2 scoping above.
