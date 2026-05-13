# EQ Solves Field — Nightly Audit Review

**Started:** 2026-05-13 (created via cloud schedule setup with Royce)
**Cadence:** Nightly at 2am Sydney time, 7 nights, then review
**Branch:** demo (eq-solves-field.netlify.app)
**North star:** Melbourne-scale enterprise readiness — 577 people, 12+ projects, 52-week forecast.
  Every finding is framed against "does this help or hurt the enterprise endgame?"

## How this doc works

Each night a cloud-scheduled Claude agent fires with the prompt in
`SCHEDULE-PROMPT.md` (kept in sync with this doc). It reads the latest
state on this branch, rotates through one of four focus angles, and
appends a new `## Night N — [Date] — [Angle]` entry below.

### Focus rotation (by day-of-week, AU local)

| Day | Angle | What gets checked |
|-----|-------|-------------------|
| Mon | **Code quality** | Recent commits for dead code, missing error handling, inconsistent patterns, race conditions in async/await, console.log leftovers, function bloat. Maintainability at Melbourne scale. |
| Tue | **Usability** | Mobile/desktop parity, keyboard nav, color contrast, empty states, button labels, modal flows, loading skeletons. Multi-tenant UX divergence. |
| Wed | **Scalability** | At 500+ rows: render perf, query cost, Supabase realtime channel cost, memory leaks, pagination gaps. Cross-ref MELBOURNE-SCALE-DESIGN.md if it lands. |
| Thu | **Security** | Auth flows, env var usage, RLS coverage (read-only Supabase MCP), secret leakage in client bundle, XSS via innerHTML, magic-link TTL, Edge Function CSRF. Enterprise compliance (SOC 2 timeline). |
| Fri | Code (cycle repeats) | |
| Sat | Usability | |
| Sun | Scalability | |

### Per-iteration output

1. **Pre-flight:** WebFetch both deploys, confirm version banners
2. **Pick 1–3 specific items** in tonight's angle. Deep over wide.
3. **For each finding:** file path + line number, severity (low/med/high),
   evidence, recommended fix, **enterprise tie-in** (how this helps/hurts
   Melbourne scale).
4. **Clear small bug fixes** (behaviour-preserving, <50 lines, no auth/RLS/env/migrations):
   open PR to demo, auto-merge if it passes the bar.
5. **Ambiguous findings:** append below as `FINDING #N — [angle] [severity]`,
   leave for Royce's morning review.
6. Commit doc + push to demo.

### Hard guardrails (all nights)

- **Demo branch only.** Never main, never SKS prod, never SKS Supabase (`nspbmirochztcjijmcrx`).
- **Read-only Supabase MCP.** No migrations, no DELETE, no RLS changes.
- **No new auth surfaces.** RLS that narrows is fine; anything that opens access stops and PRs for review.
- **No file deletions** without explicit Royce approval.
- **Auto-merge bar:** bug fix only, behaviour-preserving, <50 lines, doesn't touch auth/RLS/env vars/migrations.
- **Anything ambiguous → PR open**, not auto-merged.
- **One focused iteration per night** (~15 min, ~30k tokens). No runaway loops.

### What stays out of scope nightly

- Melbourne data-model expansion (separate workstream, MELBOURNE-SCALE-DESIGN.md)
- v3.4.68 role-system Phase D (server-side enforcement) — has its own plan
- SKS prod auth changes (always require Royce sign-off)
- Compliance/SOC 2 (Royce decision, not nightly review)

---

## Findings log

_Findings accumulate below. Each night appends a new section. Open findings
not yet addressed stay until Royce decides + closes them._

### Open findings — needs Royce review

#### FINDING #U2 — usability [med] — only 10 aria-* attributes across 3500-line index.html
- **File:** `index.html` (whole file)
- **Evidence:** `grep -c "aria-label\|aria-describedby\|role=\|tabindex"` = 10. Modals, action buttons (Edit, Archive, Delete), sortable headers, icon-only buttons all lack labels.
- **Enterprise tie-in:** WCAG 2.1 AA is increasingly a procurement gate for enterprise customers (Melbourne onboarding clients will ask). SOC 2 doesn't require it directly but accessibility is a compliance-adjacent expectation.
- **Recommended fix:** progressive pass — first all icon-only buttons (✎ Edit, ✕ Delete, 📦 Archive, ↺ Restore, etc.) get `aria-label`. Then modal `role="dialog"` + `aria-labelledby`. Then sortable headers get `aria-sort`. Estimated ~6-8 hours total for a meaningful pass.
- **Decision needed:** scope a sprint for this, or treat as gradual?

#### FINDING #S1 — scalability [HIGH] — full-table fetch on schedule + timesheets
- **File:** `index.html:2517-2521` (loadFromSupabase)
- **Evidence:** `sbFetch('schedule?select=*')` and `sbFetch('timesheets?select=*')` with NO week filter. At Melbourne scale (577 ppl × 52 weeks = ~30k schedule rows, similar for timesheets), initial load is 5–10MB. Every poll re-pulls it. Already documented in `MELBOURNE-SCALE-DESIGN.md` §6.
- **Enterprise tie-in:** BLOCKS the Melbourne rollout directly. At ~100 users the current pattern starts to slow noticeably; at 577 it's unusable.
- **Recommended fix:** scope schedule + timesheets queries to a sliding window of weeks (e.g. current week ± 8). Lazy-load older data when user navigates back. Design in MELBOURNE-SCALE-DESIGN.md §6 already specifies the shape.
- **Decision needed:** prioritise this for the next sprint? It's the single biggest scaling blocker.

#### FINDING #S2 — scalability [med] — wholesale innerHTML rebuild on render
- **Files:** `scripts/roster.js:294, 491, 591`, `scripts/leave.js:1004, 1135`, `scripts/timesheets.js:451, 638, 956, 1088`, etc. (~15 sites)
- **Evidence:** every render swaps the full innerHTML on the page container. v3.4.72's hash-diff reduces frequency but not cost per render.
- **Enterprise tie-in:** at 500+ rows on contacts/roster pages, the rebuild becomes visibly chunky (~100-300ms freeze). Affects perceived performance even when correctness is fine.
- **Recommended fix:** virtualisation library (e.g. clusterize.js, ~3KB) for the few big-list views (contacts, roster editor). Alternatively, lit-html for surgical updates. MELBOURNE-SCALE-DESIGN.md §6.1 mentions the gap.
- **Decision needed:** library vs roll-our-own, and when?

#### FINDING #SEC2 — security [low] — verify-pin rate limit is in-memory only
- **File:** `netlify/functions/verify-pin.js:49-50` — `const attempts = {}; const MAX_ATTEMPTS = 5; const LOCKOUT_MS = 15 * 60 * 1000;`
- **Evidence:** Netlify Functions are stateless — each cold start resets the in-memory counter. Attacker can spam attempts across cold starts (~every 5min on low traffic).
- **Enterprise tie-in:** enterprise pen-tests will flag this. Distributed rate limit (Supabase row lock, Upstash Redis, or Netlify Blobs) would be the proper fix.
- **Recommended fix:** move to Supabase-backed rate limit table OR Netlify Blobs (free tier covers the low write volume). 1-2 hours of work.
- **Decision needed:** acceptable for now given ~20 active users + 4-char PIN entropy? Defer to closer-to-launch?

### Parked findings — acknowledged, deliberately deferred

- **FINDING #S3 — scalability [med] — realtime channel is org-scoped, not week-scoped.**
  PARKED 2026-05-13 by Royce. Acknowledged as a priority for the Melbourne scaling sprint but not blocking today (SKS ~20 users runs fine on org-scoped channel). Revisit alongside FINDING #S1 implementation since the per-week subscription pattern complements the per-week query scoping.
- **FINDING #SEC1 — security [med] — magic-link approve/reject TTL is 7 days.**
  PARKED 2026-05-13 by Royce. Risk accepted: if a supervisor's email is compromised, the leave-approval blast radius is bounded (approving direct-report leave is not a financial transaction; the move can be reversed in-app; audit log captures the action). Revisit if SOC 2 audit demands shorter TTL, or if leave-approval scope ever widens beyond same-team direct reports.

### Tracked findings — open as GitHub issues for scheduled work

- **FINDING #C1 — code [low] — apprentices.js is 2271 lines.** Tracked via [issue #74](https://github.com/Milmlow/eq-field-app/issues/74) for scheduled refactor when convenient.

### Closed / shipped findings

- **FINDING #U1 — usability [med] — modals can't be closed with ESC.** SHIPPED in v3.4.74 (Night 1). `scripts/utils.js` keydown listener added. Closes top-most open modal on ESC press.
- **FINDING #C2 — code [low] — stale TODO doc in scripts/.** CLOSED 2026-05-13 by Royce. `scripts/analytics-TODO-hooks.md` deleted; hooks already implemented in `scripts/analytics.js` so the doc was misleading rather than aspirational.

---

## Iteration log

_Each nightly run appends a `## Night N — [Date] — [Angle]` section here._

### Night 0 — 2026-05-13 — Setup

**Action:** scaffold this doc, draft cloud schedule prompt, ship via PR.

**State at setup time:**
- Both deploys live on v3.4.73 (eq-solves-field.netlify.app + sks-nsw-labour.netlify.app)
- Demo carries v3.4.68 (role system Phase B+C soak) + v3.4.69 (Site Reports/Prestart MVP)
- Main carries v3.4.70–73 only — Phase B+C + Prestart stay demo-only until SKS port
- Royce on SKS prod actively using the system

**No findings tonight — schedule fires tomorrow at 2am.**

**Look at this first (morning of 2026-05-14):** the first cloud run will land
overnight. Read the new `## Night 1` entry below.

---

### Night 1 — 2026-05-13 — All four angles (manual test run)

**MORNING SUMMARY**
- **Angle:** all four (manual test run before cloud schedule fires)
- **Findings count:** 8 total (1 shipped via auto-merge as v3.4.74, 7 open for Royce review)
- **Look at this first:** **FINDING #S1** — full-table `schedule?select=*` fetch. High-severity scaling blocker. Will not work at Melbourne scale. The design doc already specifies the fix, so this is now a sequencing question, not a discovery.

**Pre-flight:** ✅ Both deploys live on v3.4.73 before run. Demo carries v3.4.68/69 + v3.4.70–73. SKS carries v3.4.70–73 only.

**What ran (in order):**
1. WebFetch both deploys → confirm version banner
2. Branch off `origin/demo`
3. Code quality angle — recent commits, file sizes, error handling patterns
4. Usability angle — modal flows, ARIA coverage, ESC handling, mobile parity
5. Scalability angle — query shapes, render patterns, realtime channels
6. Security angle — env var leakage, magic-link TTL, rate limiting, XSS surface

**Auto-merged this iteration (v3.4.74):**
- ESC-to-close on modals — `scripts/utils.js` global keydown listener. Closes top-most open modal. Passes auto-merge bar (small, behaviour-preserving, no auth/RLS/env).

**Findings by angle:**
| Angle | High | Med | Low | Shipped |
|-------|------|-----|-----|---------|
| Code  | 0 | 0 | 2 | 0 |
| Usability | 0 | 1 (U2) | 0 | 1 (U1 → v3.4.74) |
| Scalability | 1 (S1) | 2 (S2, S3) | 0 | 0 |
| Security | 0 | 1 (SEC1) | 1 (SEC2) | 0 |

**Trend observations (after one iteration — qualified, not statistical):**
- Scalability is the dominant risk class for the Melbourne endgame. 3 of 8 findings, including the only HIGH severity, are scaling blockers. The design doc anticipates these but they're not yet on a sprint plan.
- Security findings are real but lower stakes — magic-link TTL is the one to act on for SOC 2 prep.
- Code quality is healthy. apprentices.js file size is the only structural concern and it's a slow-burn issue, not a current pain point.
- Usability has accessibility debt (FINDING #U2) that becomes a procurement blocker as enterprise customers ask. Worth scoping a sprint.

**Decisions needed from Royce (in priority order):**
1. **SCHEDULE THE MELBOURNE SCALING SPRINT** — FINDING #S1 is the highest-leverage thing to land before any actual Melbourne customer comes on. Design doc has the fix shape; it's now scheduling, not invention.
2. **Magic-link TTL** — drop 7d to 48h? FINDING #SEC1. One-line change, decide cutoff.
3. **Accessibility sprint** — FINDING #U2. Want to start the WCAG pass now (gradually) or wait for first enterprise procurement question?
4. The 5 other findings (C1, C2, S2, S3, SEC2) are valid but lower-priority — schedule when convenient.

**Process notes for the cloud-scheduled future runs:**
- This iteration covered ALL FOUR angles in one pass for the test. Cloud schedule will rotate ONE per night per the day-of-week plan.
- The "Look at this first" pointer at the top of each entry is the most useful summary item for Royce — keep it.
- The findings table by severity gives a quick visual of where attention is needed — keep it.
