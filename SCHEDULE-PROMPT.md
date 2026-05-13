# Nightly cloud schedule prompt

This is the exact input Royce pastes into Claude Code (with `/schedule`
prefix) to set up the nightly audit. Saved here so it's recoverable
without scrolling chat history. Cross-ref: AUDIT-REVIEW.md (the doc
each nightly run appends to).

**Last updated:** 2026-05-13
**Status:** Initial setup attempted 2026-05-13; Anthropic cloud service
returned a transient connection error — re-run `/schedule` with the
block below verbatim.

---

## Copy-paste this (prefixed with `/schedule`)

```
every night at 2am audit the eq-solves-field codebase for Melbourne-scale enterprise readiness

Working dir: C:\Projects\eq-solves-field (use the main checkout, NOT worktrees — those are scratchpads for parallel work). Branch: demo. Always pull latest demo before reading any file.

NORTH STAR: Melbourne-scale enterprise readiness (~577 people, 12+ projects, 52-week forecast). Every finding gets framed against "does this help or hurt the enterprise endgame?" — not just "is this code clean today."

PRE-FLIGHT (every run, ~2 min):
1. git pull origin demo
2. WebFetch https://eq-solves-field.netlify.app/sw.js and https://sks-nsw-labour.netlify.app/sw.js — confirm both deploys are live and on the same version. If a site is down or stale, that IS tonight's finding — escalate immediately.
3. Read AUDIT-REVIEW.md for the iteration log + open findings list. Pick up where last night left off.

TONIGHT'S ANGLE (rotation by day-of-week, AU local):
- Mon: Code quality — recent commits for dead code, missing error handling, inconsistent patterns, race conditions in async/await, console.log leftovers, function bloat. Frame for Melbourne-scale maintainability.
- Tue: Usability — mobile/desktop parity, keyboard nav, color contrast, empty states, button labels, modal flows, loading skeletons. Frame for multi-tenant UX divergence.
- Wed: Scalability — at 500+ rows: render perf, query cost, Supabase realtime channel cost, memory leaks, pagination gaps. Cross-ref MELBOURNE-SCALE-DESIGN.md if present.
- Thu: Security — auth flows, env var usage, RLS coverage (read-only Supabase MCP), secret leakage in client bundle, XSS via innerHTML, magic-link TTL, Edge Function CSRF. Frame for SOC 2 / enterprise compliance.
- Fri: Code (cycle repeats)
- Sat: Usability
- Sun: Scalability

WORK SHAPE (per iteration):
1. Pick 1-3 specific items in tonight's angle. Depth over breadth.
2. For each finding: file + line, severity (low/med/high), evidence, recommended fix, enterprise tie-in.
3. Clear small bug fixes (behaviour-preserving, <50 lines, no auth/RLS/env/migrations): create branch off demo, open PR to demo, auto-merge if it meets the bar. Bump version via `node scripts/release.mjs` only if code shipped.
4. Ambiguous findings: append below "Open findings" section of AUDIT-REVIEW.md as "FINDING #N — [angle] [severity] — [one-line title]" with file refs + reasoning. Leave for Royce's morning review.
5. Append iteration entry: "## Night N — [Date] — [Angle]" with morning summary block (top-line, action items, "Look at this first").
6. Commit AUDIT-REVIEW.md + any merged code to demo. Push.

HARD RULES (every iteration):
- Demo branch only. Never main, never SKS prod, never SKS Supabase project (nspbmirochztcjijmcrx).
- Read-only Supabase MCP for the EQ project (ktmjmdzqrogauaevbktn). No migrations, no DELETE, no RLS changes, no UPDATE on production data.
- No new auth surfaces. RLS that narrows is fine; anything that opens access stops and PRs for review.
- No file deletions without Royce approval (mention in AUDIT-REVIEW.md and leave for morning).
- Auto-merge bar (demo only): bug fix, behaviour-preserving, <50 lines, doesn't touch auth/RLS/env vars/migrations. Anything ambiguous → leave PR open.
- One focused iteration per run. ~30k tokens budget. No runaway loops, no spawning sub-agents.

ASKING FOR HELP:
Don't. This runs unattended. Use best judgment, document the decision, and flag anything truly ambiguous in the "Open findings" section for Royce.

MORNING SUMMARY format (top of each iteration entry):
- Angle: [code|usability|scalability|security]
- Findings count: N total (M auto-merged, K open)
- "Look at this first": single highest-leverage item Royce should review

If something catastrophic happens (Supabase down, deploys 404ing, repo state weird), append a "BLOCKED" line to AUDIT-REVIEW.md and stop the iteration. Don't try to fix infrastructure unattended.

After 7 nightly runs, stop firing automatically and append a "## Week 1 retrospective" entry summarizing: total findings count by angle/severity, PRs shipped, PRs open, top 3 trends, recommended cadence going forward.
```

---

## If `/schedule` fails again

The first attempt on 2026-05-13 hit an Anthropic cloud connectivity error
("trouble connecting with your remote claude.ai account"). It's a transient
service issue, not anything wrong with the prompt. Options if it keeps
failing:

1. **Wait 5-10 minutes, re-run** — most likely fix.
2. **Run `/schedule` with shorter trigger** — paste just the first line
   (`every night at 2am audit the eq-solves-field codebase for Melbourne-scale enterprise readiness`)
   to test the auth flow, then update the prompt later via the scheduled
   task settings.
3. **Manual first run tonight** — Claude (this session) can do one
   iteration right now as a test so we have a Night 1 entry to look at
   tomorrow. Doesn't replace the schedule, just shows the format.
4. **Fall back to local scheduled task** — `mcp__scheduled-tasks__create_scheduled_task`
   runs locally while Claude Code is open. Not as good for overnight
   (laptop must stay awake) but works.

## To update the prompt later

Once scheduled, use the Claude UI's scheduled-tasks settings to edit the
prompt — don't try to recreate the schedule, just update it. Keep this
file in sync so the source of truth is git-tracked.
