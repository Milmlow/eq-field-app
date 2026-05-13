# Sprint pre-flight questions — Night 1 audit

**Status:** awaiting Royce's answers
**Created:** 2026-05-13
**Total questions:** 13

When Royce gets home, review + commit this doc. Once it's pushed to `demo`
I'll pick it up, read the answers, and start the sprint unattended.

## How to use this doc

Every question has a **(Recommended)** option — that's what I'll do if you
don't override it. Three ways to push:

- **A. Confirm all defaults** — add `✅ All defaults confirmed` to the
  "Royce's answers" section at the bottom and commit. Fastest path,
  ~30 seconds.
- **B. Override specific questions** — write `Q3: B` or `Q5: ±8 weeks` in
  the answers section. Anything you don't override falls back to
  (Recommended).
- **C. Free-text any question** — write your answer naturally; I'll parse.

Cross-ref: `SPRINT-PLAN.md` (the work to be done), `AUDIT-REVIEW.md`
(source findings).

---

# S1 — Sliding-window queries (5 questions)

The big one. ~7 hours estimated. Scopes `schedule` + `timesheets` queries
to a window of weeks instead of full-table fetch.

### Q1. How many weeks visible at any time?
**Why:** Bigger window = fewer lazy-loads but bigger initial payload.
Smaller = snappier load but more lazy fetches as user navigates.

- (Recommended) **±4 weeks** (9 weeks loaded). ~150 row payload at Melbourne scale. Good balance.
- ±2 weeks (5 weeks loaded). Snappiest initial, more lazy fetches.
- ±8 weeks (17 weeks loaded). Roomier, fewer fetches, larger payload.
- ±12 weeks (~quarter, 25 weeks). Power-user friendly, big initial.

### Q2. Pre-fetch the next week when user clicks the › arrow?
**Why:** When user steps to next week, do we ALSO fetch the week
after that? Trades one extra query for instant feel on the next click.

- (Recommended) **Yes, always** — adjacent week pre-fetches alongside the step.
- Only when network is idle (browser-detect, more complex).
- No — wait until user actually requests the week.

### Q3. Bulk exports (timesheet CSV, audit log) — current code scans full STATE
**Why:** Once we scope STATE to ~9 weeks, exports need a different
strategy.

- (Recommended) **Fetch fresh full data on export click** — one-time cost, slow modal but correct.
- Pre-warm — when user opens Export modal, start loading all weeks in background.
- Scope-match — export only the currently-loaded window. User can re-export with wider window selected.

### Q4. Dashboard "active this week / total" stats
**Why:** Currently scans full STATE.schedule. After scoping, only sees ~9 weeks.

- (Recommended) **Investigate first** — if dashboard only ever shows current-week stats (likely), no change needed; this question becomes a no-op.
- Build a Supabase RPC `get_org_stats()` for true org-wide aggregates.
- Accept current-week-only stats (drop "total ever" badges if any exist).

### Q5. Apply scope: which tenants?
**Why:** Schedule + timesheet changes are infrastructure-level. Need
soak before SKS gets it.

- (Recommended) **Demo soak first, then SKS port after 3-5 days clean** — matches existing pattern (v3.4.68 role system).
- Apply to demo AND SKS simultaneously — riskier but unblocks Melbourne sooner.
- Demo only indefinitely — block SKS port until Melbourne customer is signed.

---

# U2 — Accessibility (2 questions)

Parallel-runnable with S1. ~6 hours. Adds automated WCAG check + targeted
manual pass.

### Q6. Automated tool choice
**Why:** Both work, both free, both vanilla-JS-friendly.

- (Recommended) **axe-core** — industry standard, better PR comment integration.
- pa11y — slightly more configurable, less common.
- Both — overkill but bulletproof.

### Q7. Procurement-ready WCAG Compliance Report doc
**Why:** The CI tool generates findings — do we wrap them in a doc
formatted for enterprise procurement questionnaires?

- (Recommended) **Wait until a real procurement question arrives** — Melbourne customer asks → we generate doc at that point from the tool's output. Save the work.
- Write the report doc now — proactive, ready to send when asked.

---

# S2 — Virtualisation (1 question)

### Q8. In scope for this sprint or defer until S1 lands?
**Why:** S1 changes STATE shape. Building S2 on top of pre-S1 STATE means
rework. Plus virtualisation only pays off at 200+ rows; not biting yet.

- (Recommended) **Defer until S1 stabilises** — schedule S2 as a follow-up sprint after S1 has soaked 3-5 days on demo.
- Do it this sprint anyway — accept the rework risk to ship both together.

---

# SEC2 — Rate limit table (1 question)

### Q9. Create the migration file this sprint (unapplied)?
**Why:** Migration is useless until Phase D consumers exist, but having
the SQL file ready means Phase D ticket can grab it.

- (Recommended) **Yes, create the file unapplied** — file lives in `migrations/`, status as "pending Phase D". Saves Phase D ~30 minutes.
- Wait until Phase D actually starts — keep this sprint pure to findings only.
- Apply it now to demo Supabase — get the infra in early, even if no consumer yet.

---

# Cross-cutting (4 questions)

### Q10. Auto-merge bar for sprint work
**Why:** S1 is bigger than my usual auto-merge bar (<50 lines, behaviour-
preserving). Should I tighten the bar for the sprint?

- (Recommended) **Per phase, demo-only auto-merge if it passes the bar; flag bigger phases for your review** — Phase 1+2 (instrumentation, scoping) auto-merge; Phase 3+4+5 open PRs you review on return.
- Auto-merge nothing in the sprint — every PR waits for your approval.
- Auto-merge everything that compiles + tests pass — fastest but riskiest.

### Q11. Version bump cadence
**Why:** S1 is 5 phases over ~7 hours. Each phase could be its own version
bump, or batch.

- (Recommended) **Bump per workstream** — v3.4.75 = S1 complete, v3.4.76 = U2 complete, etc. Banner block describes the full workstream.
- Bump per phase — v3.4.75 = S1 Phase 1, v3.4.76 = S1 Phase 2 etc. Granular but noisy.
- Single mega-bump v3.4.75 at end — everything bundled.

### Q12. Stop conditions / when to pause
**Why:** This is a long sprint. Want clear breakpoints in case something
goes sideways.

- (Recommended) **Stop after each S1 phase + write status to AUDIT-REVIEW.md; wait 10 min for "continue" signal, then proceed** — gives you cancel points if needed.
- Ship the whole thing unattended overnight — start tonight, finish Saturday morning.
- Pause after S1 only — get S1 fully done, then wait for your green light on U2.
- Strict per-phase pause — explicit "continue" for every phase.

### Q13. If something blocks me mid-sprint
**Why:** ~7 hour autonomous run = chance of hitting an unexpected blocker
(Supabase outage, weird schema state, etc.).

- (Recommended) **Park + write findings to AUDIT-REVIEW.md + continue with next workstream** — sprint never fully blocks.
- Try one alternative approach, then park if that fails too.
- Push notification to wake you up — bigger interruption but you make the call.
- Stop entirely + wait for next session.

---

# Royce's answers

Write your overrides below. Anything you skip = (Recommended).

```
[Add answers here. Examples:
   ✅ All defaults confirmed
   — OR —
   Q1: ±8 weeks
   Q5: apply to demo AND SKS simultaneously
   Q12: ship the whole thing unattended overnight
]
```

---

# After Royce pushes

1. I detect the merged `claude/sprint-questions` PR (or read this doc on demo)
2. Parse the "Royce's answers" section
3. Start S1 Phase 1 immediately
4. Update SPRINT-PLAN.md status ticks as I progress
5. Per Q12 default: stop after each phase, write a status line to AUDIT-REVIEW.md, wait 10 min for an interrupt then continue

If you change your mind on any answer mid-sprint, edit SPRINT-QUESTIONS.md
or just paste a new instruction into the chat — I'll pick up the change
on the next phase boundary.
