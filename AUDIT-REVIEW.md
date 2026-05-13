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

_(None yet — first run hasn't fired.)_

### Closed / shipped findings

_(None yet.)_

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
