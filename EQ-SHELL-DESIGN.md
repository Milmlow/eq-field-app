# EQ Shell — Architecture design (draft)

**Status:** DRAFT — design-first, open for Royce review.
**Created:** 2026-05-18 by Claude during Phase D of `NEW-WINDOW-PROMPT-melbourne-ready.md`.
**Supersedes:** Phase D as written in that brief. The brief assumed an "EQ Field tenant onboarding admin flow"; the actual direction is a higher-level EQ Shell of which EQ Field becomes one module among several.

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

Each of these blocks meaningful design work. Listed in roughly-priority order. Reply inline (or fork to a separate session) — I'll iterate this doc as answers come in.

### Q1. Where does the EQ Shell live as code today?

Is there:
- (a) A repo already (separate from `eq-field-app`)? Path?
- (b) A repo planned but empty?
- (c) Just the architecture sketch — no code anywhere yet?

The answer determines whether I'm starting from a green field or grafting onto a partial implementation.

### Q2. Is EQ Field expected to be migrated to React, or stay vanilla and embed differently?

Three options I can see:
- **(a) Migrate EQ Field to React.** Major rewrite — ~6500-line `index.html` + ~20 scripts. 2-6 weeks of focused work depending on whether functionality stays identical or gets re-thought. SKS prod stays on the vanilla build until the React port is verified.
- **(b) Keep EQ Field vanilla; embed via iframe.** Shell loads `<iframe src="/modules/field">` for the EQ Field route. Cleanest separation, weakest integration (cross-module navigation, shared auth context, message-passing all need wire-up).
- **(c) Keep EQ Field vanilla; embed via Web Component.** Wrap the vanilla app in a custom element, mount inside the React shell. Better integration than iframe, less work than full React port.

This is the highest-stakes decision in this doc. I'd recommend (c) for MVP if the other modules are already React; (b) if message-passing latency isn't a concern; (a) only when there's a real reason to unify the framework (e.g. shared component library).

### Q3. What's the "canonical layer per tenant" data shape?

Two readings I had earlier:
- **(a) EQ-corporate canonical Supabase.** Single EQ-owned project holds tenant list + billing + module entitlements + branding. Each tenant still has their own Supabase for app data. Shell queries canonical for "what modules does this tenant have"; modules query the per-tenant Supabase for their data.
- **(b) Canonical schema template.** Source-of-truth schema definition. New tenants get a clone (people, sites, schedule etc.). Future migrations push canonical → all tenant Supabases.
- **(c) Both.** Corporate canonical owns tenant metadata + entitlements; schema template defines what a new tenant Supabase looks like at provisioning.

Your sketch shows "Tenant config (modules enabled per customer)" inside the shell — that's the (a) reading at minimum. Schema template (b) is a separate concern that might or might not be in scope.

### Q4. Auth at the shell vs auth at the module — what's the contract?

Today's EQ Field has its own gate (STAFF_CODE + MANAGER_CODE env vars per Netlify project, plus a 7d remember-me JWT). The shell now wants "Auth (one login)" — single entry point.

- Does the shell mint a session token that modules trust?
- Does each module still gate independently and the shell just remembers credentials?
- How do tenant-specific access codes (which are public-ish — they're in env vars per Netlify deploy) get scoped under a single login?
- Is this an SSO conversation (MELBOURNE-SCALE-DESIGN.md §7 Q7 said Wave 5+)?

The simplest contract: shell holds a session cookie scoped to `*.eq.solutions`; each module reads the cookie, calls `/.netlify/functions/verify-shell-session` to validate, hydrates its own state. Shared HMAC secret. Routes through `verify-pin.js` for now.

### Q5. Module entitlements — runtime or build-time?

When a tenant has Cards + EQ Field enabled but not Quotes:
- (a) Shell hides the Quotes nav entry; everyone fetches the same shell bundle.
- (b) Shell builds a per-tenant bundle that omits Quotes code.

(a) is cheap to ship, opens the door to feature-flag-style toggles. (b) is what enterprise customers typically expect for "code we don't pay for never reaches us". (a) is the MVP; (b) is Wave 5+.

### Q6. Branding — per tenant where?

Today's EQ Field switches between EQ blue and SKS navy via hostname detection in `scripts/app-state.js`. With a shell:
- Brand colors / logos / favicons are shell-owned.
- Modules ask the shell for the current tenant's brand object on mount.
- Or: modules accept brand props from the shell at route render time.

This is straightforward once Q2 (React vs vanilla embedding) is decided.

### Q7. What's the minimum viable shell shape that gets a new Melbourne customer onto the platform?

The brief's MVP for Phase D was: off-app provisioning + shared Supabase + URL param routing. That maps poorly to the new EQ Shell topology. A revised MVP candidate:

- **Shell repo** with a basic React app: routing, tenant-config fetch, one navigable nav item ("EQ Field"), passthrough to the existing EQ Field deploy.
- **Canonical Supabase** with `tenants` table (id, slug, name, brand_color, modules_enabled[]).
- **EQ Field as iframe child** initially (Q2 = b). Migrate to web component or React port later.
- **Provisioning** = me running a `provision-tenant.sql` script + committing a `tenants` row + ensuring the EQ Field deploy is alive. No wizard in MVP.

Royce flagged E2 = "Full guided wizard" — that's a richer scope. If MVP needs to include the wizard, time-budget doubles or triples.

### Q8. What's the timeline / who's the first non-SKS customer?

The brief framed this as "Melbourne-ready" — i.e. ready for a real Melbourne customer to sign up. Is Melbourne:
- (a) A signed deal with a deadline I should plan against?
- (b) A representative shape ("if we wanted to land an enterprise customer, the platform shouldn't be the blocker")?
- (c) An internal aspiration with no specific customer behind it yet?

(a) means days/weeks; (b) means weeks/months; (c) means architect-but-don't-rush. Determines whether I start building this week or just iterate the doc.

### Q9. Does the EQ Shell replace the eq.solutions marketing site, or live alongside?

`eq.solutions` is currently the marketing site (manual Cloudflare Pages zip upload per CLAUDE.md). If the shell lives at `<tenant>.eq.solutions`, marketing presumably stays at `eq.solutions` (root). Worth confirming so I don't disturb that deploy.

### Q10. Where does Tender Pipeline live in this picture?

Tender Pipeline shipped inside EQ Field (v3.4.79-83). If EQ Field becomes one module among many, does Tender Pipeline:
- (a) Stay inside the EQ Field module (current state)?
- (b) Split out as its own module under the shell?

(b) feels right long-term (Tender Pipeline is a workflow EQ owns, not customer data) — but it's a follow-on, not MVP.

---

## Proposed MVP shape (one paragraph)

If the answers to Q1-Q9 mostly land where I expect (no shell repo yet; EQ Field stays vanilla initially; canonical Supabase = EQ-corporate only; auth = shell session cookie; modules are runtime-toggled; Melbourne is (b) representative not (a) signed):

> Build an EQ Shell repo as a small React app. Single canonical Supabase project (call it `eq-shell-control`) holds `tenants`, `users` (one login per tenant, hashed PIN initially), and `module_entitlements` (which of Cards / Intake / Quotes / Service / Field a tenant has). Shell renders nav based on entitlements; clicking "EQ Field" iframe-loads the existing eq-solves-field.netlify.app deploy with a session token in URL hash. Per-tenant subdomain `<tenant>.eq.solutions` via Netlify domain aliases on the shell deploy. Existing SKS deploy and EQ-Field demo stay live and untouched; only NEW tenants land under the shell. No EQ Field rewrite. No wizard MVP — Royce provisions via SQL until tenant #3.

That's a 3-5 session build for a working end-to-end shell-routes-to-Field path. Not Melbourne-ready in a SOC 2 sense; ready enough that a customer signs up + Royce provisions them + they navigate to EQ Field through the shell.

If anything in that paragraph is wrong, the answers to Q1-Q10 will tell me where to course-correct.

---

## What I'm NOT proposing in this doc

- A React migration of EQ Field. That's a separate decision (Q2) with a separate scope.
- Killing the existing SKS deploy or EQ-Field demo. Both stay live; the shell sits in front of NEW deployments.
- Touching the SKS auth model. The shell auth contract is independent of SKS prod's gate.
- A wizard. The brief asked for one; my read is wizard = Wave 5+ once 3+ tenants exist.
- Module-level rewrites. Cards / Intake / Quotes / Service are out of scope for this doc — only the shell + EQ-Field-as-module piece.

---

## What I want next

Answers to Q1-Q10 (or even just Q1, Q2, Q3, Q4 — those four unblock everything else). Once locked, I'll:

1. Rewrite this doc into a real spec (data model, route table, auth flow, provisioning SOP).
2. Scope into milestones (~3-5 sessions of work, depending on Q2 answer).
3. Open a separate PR per milestone.

If the EQ Shell repo doesn't exist yet (Q1 = c), I'll also propose the initial scaffolding shape (Next.js vs Vite + React Router vs SvelteKit etc.) as part of the spec — once I know Q2.

---

**This is a doc-only PR.** No code. No version bump. No migration. Merge or close as you prefer; I treat your reply (here or as PR comments) as the authoritative answer set.
