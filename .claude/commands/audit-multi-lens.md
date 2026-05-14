---
description: Multi-lens review of EQ Field — CEO / UI / coding-purist perspectives. Replaces the broken nightly cloud schedule with an on-demand local trigger.
---

You are running a multi-lens strategic review of EQ Field, the codebase you're currently sitting in. This is the on-demand local equivalent of the nightly cloud audit (which never reliably fired). Mirrors the format of the existing `REVIEW-MULTI-LENS.md` (v1, dated 2026-05-13) so the output is comparable across runs.

## Three perspectives, ruthless but fair

1. **CEO / Head of Construction lens** — what would Trevor Saunders (SKS CEO) and David Stone (Head of Construction) ask if you pitched them this codebase? They care about dollars, safety, audit trail, operational tempo, vendor management, key-person risk, procurement-readiness for enterprise (Melbourne onboarding). Not technical depth.

2. **UI engineering — invisible technology lens** — the Linear / Notion / Superhuman bar. How "out-of-the-way" does the UI feel? Empty states, loading skeletons, error recovery, keyboard nav, mobile parity, motion design, copywriting. Compare to "above average for SaaS, below Linear" as the baseline from v1 — has the bar moved?

3. **Coding purist under the hood lens** — what would a senior staff engineer say after 20 minutes in the codebase? Architecture, separation of concerns, type safety (or lack of it given vanilla JS), test coverage gap, magic strings, hidden coupling, dead code, file size creep, the seams that will hurt the next refactor.

## How to run

1. **Pre-flight (~2 min):**
   - `git fetch origin` then `git log origin/demo --oneline -10` — note the current state
   - `WebFetch https://eq-solves-field.netlify.app/sw.js` — confirm deploy version (trust the wire over local files)
   - Read `REVIEW-MULTI-LENS.md` (the v1) so the new run is a *delta* not a duplicate
   - Read `AUDIT-REVIEW.md`'s open-findings list so you don't re-discover known issues

2. **Run each lens in turn.** Don't blend them. Each lens gets a section. Lead with the strongest jumps-out item, follow with 2-3 supporting observations, close with what would worry that lens.

3. **Synthesize:** TL;DR table at the top — verdict + one-liner per lens, like v1 did. Plus a "delta from v1" callout — what's improved, what's regressed, what's stayed the same since 2026-05-13.

4. **Decisions needed from Royce** — clear bullet list at the bottom. Same shape as the AUDIT-REVIEW session-summary block.

## Output

Save the review as a new file at `_reviews/multi-lens/YYYY-MM-DD.md` (use today's date in AU local time). If `_reviews/multi-lens/` doesn't exist, create it. Append a one-line entry to `_reviews/multi-lens/INDEX.md` (create if missing) pointing at the new file.

Then open a PR against `demo` with:
- Title: `docs: multi-lens review — YYYY-MM-DD`
- Body: brief summary + verdict-per-lens table + link to the new file

The audit doc itself is append-only via this command — don't restructure prior reviews, don't edit `REVIEW-MULTI-LENS.md` (the v1) directly. Each run produces a new dated artifact.

## Hard rules

- **Demo branch only.** Never main, never SKS prod.
- **Read-only Supabase MCP** for the EQ project. No migrations, no DELETE, no RLS changes.
- **No code changes in this command** — pure analysis. If you find something worth fixing, append to `AUDIT-REVIEW.md`'s open-findings section (don't restructure other entries) and flag in the PR body. Code fixes belong to a separate session/branch.
- **No file deletions** without Royce approval.
- **No "Other" option spam in questions** — if you need clarification, write a brief in chat first then ask via AskUserQuestion with pre-populated options.
- **One focused review per invocation.** ~30k tokens budget. Don't sprawl into the 4-angle audit territory.

## Tone

Direct, evidence-driven, ruthlessly fair. The v1 review's tone is the target — "smart choices for the constraints, but I see where the constraints ran out" type observations, not marketing copy. Cite file paths + line numbers wherever the evidence supports it. Acknowledge what's good, name what's hard to improve, recommend what's worth doing.

## If you hit a blocker

Append a `BLOCKED` line to `AUDIT-REVIEW.md`'s Open findings section with: the blocker, what you'd need to unblock, and stop the review. Don't try to fix infrastructure mid-review.

## Why this exists

The nightly cloud `/schedule` for the 4-angle audit (`SCHEDULE-PROMPT.md`) has failed twice — connectivity errors, never reliably re-attempted. This slash command is the manually-triggered fallback for the *strategic* multi-lens review (CEO / UI / coding), which is what Royce actually wanted out of a recurring audit cadence. The 4-angle engineering audit can still live as a separate command or just be invoked ad-hoc; this one covers the higher-leverage strategic pass.

Run me whenever you want a fresh strategic readout. Suggested cadence: every 2-3 weeks, or after any significant version bump (e.g. v3.6 / v4.0).
