# EQ Field — Multi-lens review

**Date:** 2026-05-13
**State reviewed:** demo branch at v3.4.75 (eq-solves-field.netlify.app), main at v3.4.73 (sks-nsw-labour.netlify.app)
**Author:** Claude, on Royce's request — three perspectives, ruthless but fair.

The CEO/Head-of-Construction lens. The UI-engineering-as-invisible-technology lens.
The coding-purist-under-the-hood lens. No marketing-speak. What's actually here.

---

## TL;DR — what jumps out across all three lenses

**The honest summary: this is a remarkable solo-builder achievement that solves a
real, painful problem extremely well at its current scale (~20 users). It's
visibly punching above its budget. It has three structural risks that get bigger
the further you take it: (1) the founder-as-sole-engineer concentration, (2) the
scale ceiling that's now documented but not yet engineered through, and (3) the
"vanilla JS, no build step" philosophy is a strength today and a tax tomorrow.**

| Lens | Verdict | One-line |
|------|---------|----------|
| CEO / Head of Construction | **Strong YES, with sequencing concerns** | Replaces real pain. Pre-sales-ready today for similar SMBs. Enterprise needs hardening (already mapped). |
| UI engineering (invisible tech) | **Above average for SaaS, below Linear** | The work happens. The UI doesn't get in the way. But it doesn't yet *feel* like a category-defining product. |
| Coding purist | **Pragmatic, not pristine** | A senior engineer would say "smart choices for the constraints, but I see where the constraints ran out." |

---

## Lens 1 — CEO / Head of Construction at SKS

**Who is this lens?** Imagine the SKS Technologies CEO (Trevor Saunders) and Head
of Construction (David Stone — large-scale operations, data centres, hospitals).
They're not technologists. They care about: dollars, safety, audit trail,
operational tempo, vendor management, and whether their NSW Operations Manager
(Royce) is solving the right problems with the right tools.

### What jumps out, strategically

**1. Royce built this. That's both the thing and the risk.**

You are the NSW Operations Manager *and* the software architect for the tool
your business depends on. That's an extraordinary multiplier — you understand
the user because you ARE the user. But from a board's perspective, this is a
"bus factor of 1" risk on a system that now handles:
- Live rostering for SKS NSW labour
- Leave approval workflow (with audit log)
- Timesheet submission and supervisor digest
- Apprentice tracking, TAFE coordination
- Prestart briefings (rolling out)

If you got hit by a bus tomorrow, who maintains this? "AI handles it" is a real
answer in 2026, but the CEO will still ask the question.

**Mitigation that doesn't exist yet:** a documented runbook for "if Royce is
unavailable for 2 weeks, here's how someone else picks this up." That's a
weekend's work and it materially de-risks the asset.

**2. The strategic positioning is sharp.**

The fact that the same codebase serves *both* sks-nsw-labour.netlify.app (SKS
internal, ~20 users) AND eq-solves-field.netlify.app (EQ Solutions product
demo) is genuinely clever. SKS gets a tool that fits its workflow exactly.
EQ Solutions gets a battle-tested product to sell to similar SMBs. SKS
effectively pays for the R&D — fees stay flat, EQ gets the IP.

A CEO will look at the multi-tenancy implementation (`TENANT_BRANDING`,
`HOSTNAME_MAP`, the data-model tenant isolation) and see a real productisation
strategy, not just an in-house tool. **This is the most underrated thing in the
codebase.**

**3. The Melbourne move is correctly identified as the next inflection point.**

`MELBOURNE-SCALE-DESIGN.md` is exactly the kind of document a CEO wants to
see from an operator-engineer. It says, in essence: "I built this for 50
people. To take it to 577, here is what changes, in what order, with what risks."
That's the level of forward planning the average tech-savvy SMB owner never
does.

**4. The audit trail is the unsung hero.**

Every supervisor action — leave approvals, schedule edits, person changes —
hits an `audit_log` table with timestamp, actor, action, category. For a
construction business in NSW, that's not nice-to-have. That's the difference
between "we have a casual roster" and "we have evidence trail meeting Fair
Work record-keeping obligations." If you ever get a payroll dispute or a Fair
Work inspector visit, this is what saves you.

The CEO probably doesn't know it exists. It absolutely should be in your next
board update.

### What would worry a CEO

**1. No SOC 2, no ISO 27001, no penetration test on record.**

For SKS internal use this doesn't matter. For selling EQ Solutions to enterprise
customers (Melbourne, larger contractors), this is going to come up by Q3-Q4.
The codebase has good security primitives (HMAC-signed magic links, RLS, env
var discipline) but no formal attestation. That gap is currently a deal-blocker
for any procurement above ~$50k/year ACV.

**2. Single-vendor concentration on infrastructure.**

Netlify hosts the front-end. Supabase hosts the database + auth + realtime.
PostHog has the analytics. Cloudflare has icons. Resend (presumed) has email.
That's five different SaaS providers in a critical-path chain — a CEO will
ask "what's our DR story if Supabase has a 6-hour outage during a payroll
week?"

Today's answer: "we degrade to read-only on the last cached data." That's
honest but worth saying out loud. It also means Supabase is the company's
biggest single dependency by some margin.

**3. Pricing model isn't documented anywhere I can see.**

For EQ Solutions to sell this, there needs to be a clear answer to "what does
this cost per seat / per tenant / per year?" The codebase has feature-tier
hooks (`feat_project_hours_v1`, flag-gated routes) but no pricing
documentation. That's the next deliverable after Melbourne-scale, not before.

### CEO verdict

Royce has built something that's worth significantly more than the time invested
in it. The next 6-12 months should be about reducing key-person risk, scaling
through Melbourne, and starting the compliance conversation. The product itself
is already enterprise-pre-sales-ready.

---

## Lens 2 — Software UI engineering: technology should be invisible

**Who is this lens?** A UI engineer who has worked at Linear, Notion, Vercel,
Stripe. They believe great software disappears — you don't notice the tool,
you notice that work is happening. They will judge: cognitive load, recovery
from error, information hierarchy, micro-interactions, what happens on slow
networks, what happens when you're holding the phone in one hand.

### What's working

**1. The cold-start path is genuinely fast.**

From the v3.4.71 work, the SKS logo paints from the first frame (no EQ→SKS
flash). The v3.4.72 work means the 30-second background poll doesn't re-render
when nothing has changed — no flash, no scroll jump, no focus drop. That's
**polish-level work**. Most apps at this size don't bother.

The cache-busting service worker (`sw.js` with versioned `CACHE` constant)
means users get the latest UI without manually refreshing. That's invisible
infrastructure done right.

**2. The information density is correct for the user.**

SKS supervisors aren't browsing — they're working. The 13px body font, the
tight 12px table cells, the compact filter rows, the at-a-glance count badges
(◉ 49 contacts, ◉ 16 supervisors) — this is the right shape for
"glance, find, click, done." It's the opposite of consumer SaaS bloat.

**3. The "Property of EQ" footer + audit log + privacy link are unobtrusive.**

Compliance-adjacent surface area that doesn't shout. Linear-ish.

**4. Mobile breakpoint is intentional, not bolted-on.**

`styles/mobile.css` has explicit decisions: sidebar hides at <768px, topbar
collapses, stat pills disappear (declutter), week-picker becomes flex:1,
sync button becomes a 36×36 round icon. Someone thought about the supervisor
holding a phone on a job site. That shows.

### Where the seams show

**1. The aesthetic is "competent business app", not "category-defining product."**

Linear, Notion, Vercel, Stripe all have a *feeling* you recognise within
500ms. EQ Field feels like a really well-built internal tool. That's not a
criticism — it IS a really well-built internal tool — but if EQ Solutions is
going to compete in the SaaS market, there's an "elevated craft" tier still
to climb.

What that looks like concretely:
- The dashboard could use a much stronger primary-content / chrome ratio (more white space at the top, fewer competing colors in stat cards).
- Typography hierarchy is mostly weight-driven (700 / 600 / 500). Adding 1-2 letter-spacing tokens and a "subdued caps" treatment on labels would lift the whole thing.
- Color palette has too many active hues at once on busy screens. Linear gets away with two greys + one accent. You have navy, purple, blue, green, amber, red, plus tints. Worth a paring-down pass.
- The 11px font on stat labels is technically readable but emotionally cramped. 12px with more vertical breathing room would feel more "premium" without sacrificing density.

None of this is broken. It's the difference between a 7/10 visual and a 9/10
visual. Whether that gap matters depends on who you're selling to.

**2. Empty states are functional, not inviting.**

`<div class="empty"><div class="empty-icon">🔍</div><p>No contacts found</p></div>`
appears in many places. That's serviceable. A more polished version would
have:
- A muted illustration (not an emoji)
- A one-sentence helpful tip
- A primary action button ("Import contacts" or "Add your first")

When a supervisor lands on an empty supervision page on day one of SKS rollout,
the empty state should be a moment of "ah, I see what to do." Currently it's
"I see that there's nothing."

**3. Loading states are mostly absent.**

The audit log opens with `<div class="empty"><div class="empty-icon">⏳</div><p>Loading…</p></div>`
— that's the only intentional loading state I noticed. Most pages just stay
blank until data arrives, or show the previous data until it's swapped in.

In a slow network (a supervisor on a 3G site), this is the part of the UX
that breaks. Skeleton screens for the first paint of the contacts page, the
roster grid, the leave list — 3 hours of work, dramatic feel-improvement.

**4. The action buttons in lists are sometimes too small and too close.**

The `_managerActions` and `_personActions` helpers render `[✎] [📦] [✕]` in
a tight cluster. On mobile, hitting "Edit" instead of "Archive" instead of
"Delete" is real risk. The buttons are 24-28px tall — Apple's HIG and Material
both recommend 44px minimum tap targets on mobile.

This is the kind of thing that doesn't show up in usability testing with the
builder (Royce knows exactly what each button does) but burns new supervisors.

**5. Toast messages are the dominant feedback channel.**

Almost every successful action shows a toast: "Saved", "Imported", "PIN set",
"Archived". Toasts are fine for low-stakes confirmations, but they're not
great for high-stakes ones. When a supervisor approves a leave request, that
feedback deserves more weight — maybe the row visibly changes state with an
animation, or a slide-out side panel briefly confirms the email was sent.

The current pattern: click → toast → row updates on next poll → no animation.
That misses an opportunity to make the supervisor feel confident they did the
right thing.

### UI engineering verdict

This passes the "technology disappears" test about 75% of the time. The remaining
25% is mobile touch targets, empty states, loading states, and the visual-craft
ceiling. Nothing here is a redesign — it's a polish sprint. Probably 20-30 hours
of focused work would shift this from "really good internal tool" to "product
people show their friends."

---

## Lens 3 — Coding purist: would a senior engineer be impressed?

**Who is this lens?** A senior engineer with 10+ years of experience across
React, Vue, vanilla JS, Rust, Go. They've shipped at scale, they've cleaned up
other people's messes, they know what "good" looks like. They'll judge:
architectural choices, separation of concerns, error handling, security
discipline, test coverage, deployability, evolvability.

**Their first reaction:** they open `index.html` and see 3,549 lines of HTML.
They take a breath. Then they look at the script tags and see ~20 separate `<script src=>` tags, no build step, no bundler, no module system.

If they stop there, they walk away thinking "amateur hour."

If they keep reading, the picture changes.

### What they'd respect

**1. The constraint discipline is real.**

No build step is a *choice*, not an accident. The deployment story is "git
push → Netlify serves static files → end." There is no `npm install`, no
`vite build`, no `webpack.config.js`, no dist directory. For a vanilla JS
PWA, that's the right call. Every dependency you don't have is a CVE you
don't have to patch, a build break you don't have to debug, a developer
onboarding day you don't have to spend.

The flip side: you can't use TypeScript, you can't use modern frameworks,
you can't tree-shake. That's the deal. Royce took it knowingly.

**2. The version bump discipline is excellent.**

Every release touches four files atomically (banner block, `APP_VERSION`
constant, sidebar version span, `sw.js CACHE`). There's a `scripts/release.mjs`
that automates three of those four. Every commit message references the
version + a one-line theme. The git log reads like a changelog.

This is the kind of discipline that production code at established companies
often *lacks*. It's a tell that Royce respects the artifact.

**3. The multi-tenant architecture is meaningful.**

`TENANT_BRANDING`, `TENANT_SUPABASE`, `HOSTNAME_MAP`, `GROUP_ALIAS_READ/WRITE`,
`TENANT_DISABLED_TABLES`, per-tenant SEED data, per-tenant access codes
sourced from `app_config` with fallback to hardcoded values — this is a
real multi-tenancy story. The `denormaliseGroupForDb()` function that translates
"Direct" → "SKS Direct" on write so the SKS Supabase schema stays compatible
without a data migration — that's the kind of pragmatic move that earns
respect.

**4. The id-coercion bug class is hardened against, not just fixed.**

EQ Supabase uses UUID PKs. SKS Supabase uses bigint PKs (which PostgREST
sometimes returns as strings). Code consistently uses `String(a) === String(b)`
in id comparisons (~64 sites across 9 files per the audit). The comment trail
in commits explains the pattern. This is the difference between fixing one
symptom and immunising the codebase against a *class* of bugs.

**5. The audit/security primitives are mostly right.**

- HMAC-signed magic links with `kind` namespacing (prevents key reuse across token classes)
- Env var discipline: secrets in Netlify env, code refuses to start without them
- Per-tenant Supabase isolation
- RLS-aware client code
- Audit log writes are fire-and-forget but with `console.warn` on failure (not silent)
- Rate limiting on PIN entry (even if in-memory — known limitation, documented)
- CORS allowlist on functions (not `*`)

For a solo-built app, this security posture is well above the median.

**6. The error-handling philosophy is consistent.**

User-facing failures: toast with reassuring message.
Network failures during writes: queue + retry, never block UI.
Audit log write failures: `console.warn` (forensics-load-bearing, can't be silent).
PRECACHE failures: log to console at deploy time.

Whoever set this up thought about it. The empty-`catch(e){}` pattern is used
exactly where it should be (localStorage in incognito, optional features), and
NOT used where errors need to surface.

### What they'd flag

**1. Global state mutation everywhere.**

`STATE.people.push(person)`, `STATE.managers = managers`, `mgr.archived = true`.
There's no immutability discipline. There's no single dispatch point for state
changes. There's no time-travel debugging. At ~14k LOC this is fine. At 50k
LOC across multiple contributors, this becomes a "where did this field get
mutated?" archaeology problem.

**Mitigation that doesn't require a rewrite:** introduce a thin `stateActions.js`
module that wraps all writes (`addPerson`, `archivePerson`, `updateManager`)
and makes them grep-able. Then read sites stay as-is. ~4 hour refactor.

**2. No automated tests anywhere.**

Manual QA on demo branch is the only test strategy. That worked at this scale.
At Melbourne scale with multiple contributors and 50k+ LOC, it won't. The
hardest part of bolting on tests later is convincing yourself the existing
code is even testable — many vanilla JS functions in this codebase reach into
`STATE` directly and depend on `document.getElementById(...)` side effects.
A handful of pure functions extracted (date parsing, group normalisation,
permission checks) into testable modules now would pay off in 12 months.

**3. The file size distribution is bimodal.**

`utils.js` is 144 lines. `apprentices.js` is 2,271. The middle-ground 400-800
line files are appropriately scoped. The outliers (2,271 / 1,135 / 1,106) are
clearly "this thing got too big." The Night 1 audit already flagged
apprentices.js for splitting; the same logic applies to leave.js and
timesheets.js eventually.

**4. innerHTML-based rendering is fragile and slow at scale.**

Every render does `container.innerHTML = bigHtmlString`. v3.4.72's hash-diff
helps with frequency but not cost-per-render. Event handlers attached via
`onclick="..."` attributes embedded in strings work but they require global
function names (`window.archivePerson`, `window.confirmRemove`), which leaks
implementation. Modern alternatives (lit-html, hyperHTML, even plain
template-cloning with event delegation) would clean this up significantly.

The MELBOURNE-SCALE-DESIGN.md correctly identifies virtualisation as the
fix for the perf side. The architectural side (event delegation, scoped
handlers) is unaddressed.

**5. The `<script>` load order is critical and undocumented.**

`scripts/app-state.js` must load first. `scripts/utils.js` must load before
anything that calls `esc()`. There's a comment in `index.html` saying "Script
load order matters — do not reorder" but no machine-enforceable check. Someone
will eventually reorder a tag and ship a broken deploy. CSP-style or
build-time enforcement (which would require a build step, so we're in a
chicken-and-egg) is the only durable answer.

**6. There's no TypeScript and no JSDoc types.**

For a 14k LOC vanilla JS codebase with multiple modules sharing global state,
that's a real cost. The cost shows up as: data shape drift, "is this field
ever null?" archaeology, runtime errors that would be compile-time errors.

Adding JSDoc types to the public shapes of `STATE.people[i]`, `STATE.managers[i]`,
`STATE.schedule[i]`, the database row types — that's ~6 hours of work and
gets you 70% of TypeScript's type safety without a build step. The trade-off
is excellent.

**7. The PR description discipline is uneven.**

Some PRs (v3.4.70, v3.4.72) have rich descriptions with test plans, schema
references, behaviour-preservation notes. Other PRs are one-liners. As soon
as a second contributor lands, this becomes a documentation gap.

### Coding purist verdict

A senior engineer would walk away thinking "this person knows what they're
doing and made deliberate trade-offs I disagree with but respect." They would
not say "wow, world-class architecture." They would say "smart pragmatism,
ceiling visible from here, knows when to stop."

That's the right place to be for a solo-built tool. The question is what
happens when it's no longer solo-built.

---

## Synthesis — three things that jump out across all three lenses

### 1. The competitive moat is the operator-engineer combo, but it's also the chokepoint

**CEO sees:** an operations manager who built the tool he needed. Massive ROI.
**UI engineer sees:** the polish only an operator who uses it daily would think to add.
**Coding purist sees:** the pragmatic choices only an engineer who ships every day would make.

All three perspectives notice the same thing from different angles: **this product
exists because Royce is both user and builder.** That's also the single biggest risk.
A documented "if Royce is unavailable" runbook is the cheapest insurance policy
in the entire portfolio.

### 2. The Melbourne scaling work is correctly identified but not yet committed-to

**CEO:** "When does this start?"
**UI engineer:** "When the 200-row pages start stuttering — call it the next 60-90 days."
**Coding purist:** "The design doc is ready. The code isn't. Schedule the sprint."

The MELBOURNE-SCALE-DESIGN.md document is the right document. The SPRINT-PLAN.md
is the right next step. The thing that's missing is a calendar commitment. From
all three lenses, the right call is: pick the date, block the time, ship S1
(sliding-window queries) in the next 30 days, with S2 (virtualisation) and
S3 (per-week realtime) following over 60 days.

### 3. The product is currently undersold

**CEO:** doesn't fully appreciate the audit/compliance value embedded.
**UI engineer:** doesn't see consumer-grade polish that matches the under-the-hood quality.
**Coding purist:** doesn't get the documentation it deserves (no architecture diagram, no README, no contributor guide).

For internal SKS use this is fine. For EQ Solutions to sell this externally,
there are three "promotion" gaps to close: the marketing story (what does this
replace, in dollar terms?), the visual elevation (Linear-tier polish on
6-8 key flows), and the technical credibility surface (public architecture
doc, security posture page, status page).

None of these are code work. They're product-marketing work. And the codebase
already deserves them.

---

## Recommendations, ranked by leverage

### Top three (do these first)

1. **Documented bus-factor runbook.** Half a weekend. Captures: how to deploy, how
   to roll back, where every credential lives, how to add a new tenant, who Royce
   trusts as second-in-command. Single biggest risk-reducer in the portfolio.

2. **The Melbourne scaling sprint (SPRINT-PLAN.md S1).** Schedule it in the next
   30 days. The longer this waits, the harder the eventual cutover. Design doc
   is ready, plan is ready, ~7 hours of focused work.

3. **A 6-key-flow polish sprint.** Empty states, loading skeletons, mobile tap
   targets, action-button affordance, primary-action emphasis. ~20 hours.
   Shifts the product from "really good internal tool" to "people show their
   friends." Highest perceived-value per hour spent.

### Next tier (3-6 month horizon)

4. **JSDoc types on the public STATE shapes + key function signatures.** ~6 hours.
   Catches 70% of the bugs TypeScript would catch, with zero build-step cost.

5. **Architecture page on the EQ Solutions marketing site.** One screen, one
   diagram, three paragraphs: what the data model looks like, what the
   security posture is, what the multi-tenancy story is. ~4 hours.
   Enterprise-buyer trust signal.

6. **Extract testable pure functions to their own module + add a tiny unit
   test framework.** Date parsing, group normalisation, permission resolution,
   week math. ~8 hours. Buys 12 months of regression safety.

### Strategic (6-12 month horizon)

7. **SOC 2 Type I readiness assessment.** Don't pursue the cert yet, but
   know what gap you're closing toward. Enables the enterprise sales
   conversation when Melbourne is live.

8. **Pricing page + tier feature matrix on eq.solutions.** Currently
   unknowable from the outside. Blocks any outbound sales motion.

9. **A second-contributor onboarding test.** Find an engineer who's never
   seen this codebase. Give them README.md + the Bus-factor runbook + a
   small feature. Time them. The friction is the inventory of what to
   document next.

---

## What I want to be wrong about

- The "polish to category-defining" gap might be smaller than I think. I'm
  comparing to companies with full design teams; that's an unfair bar for
  a solo build.
- The bus-factor risk might be partially mitigated by Claude Code itself
  becoming a continuity layer (i.e. another engineer with Claude + the
  repo + the docs can pick up where Royce left off faster than I'm
  modelling).
- The "no build step" choice might age better than I'm modelling. Browsers
  natively support ES modules now. The whole industry might rediscover the
  no-build-step path; you'd be early, not late.

If any of those are right, my recommendations shift slightly. They don't
collapse.

---

*Cross-references: AUDIT-REVIEW.md (open findings + nightly log),
SPRINT-PLAN.md (queued work), MELBOURNE-SCALE-DESIGN.md (data-model
expansion), CLAUDE.md (brand + tone rules).*
