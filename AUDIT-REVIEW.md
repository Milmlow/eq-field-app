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

### Parked findings — acknowledged, deliberately deferred

- **FINDING #S3 — scalability [med] — realtime channel is org-scoped, not week-scoped.**
  PARKED 2026-05-13 by Royce. Acknowledged as a priority for the Melbourne scaling sprint but not blocking today (SKS ~20 users runs fine on org-scoped channel). Revisit alongside FINDING #S1 implementation since the per-week subscription pattern complements the per-week query scoping.

### Tracked findings — open as GitHub issues / migration files for scheduled work

- **FINDING #C1 — code [low] — apprentices.js is 2271 lines.** Tracked via [issue #74](https://github.com/Milmlow/eq-field-app/issues/74) for scheduled refactor when convenient.

### Closed / shipped findings

- **FINDING #U1 — usability [med] — modals can't be closed with ESC.** SHIPPED in v3.4.74 (Night 1). `scripts/utils.js` keydown listener added. Closes top-most open modal on ESC press.
- **FINDING #C2 — code [low] — stale TODO doc in scripts/.** CLOSED 2026-05-13 by Royce. `scripts/analytics-TODO-hooks.md` deleted; hooks already implemented in `scripts/analytics.js` so the doc was misleading rather than aspirational.
- **FINDING #SEC1 — security [med] — magic-link approve/reject TTL was 7 days.** SHIPPED 2026-05-18 via [PR #100](https://github.com/Milmlow/eq-field-app/pull/100) (Phase B3 of `NEW-WINDOW-PROMPT-melbourne-ready.md`). `LEAVE_ACTION_TTL_MS` dropped from `7 * 24 * 60 * 60 * 1000` to `48 * 60 * 60 * 1000` in both `netlify/functions/send-email.js` and `supabase/functions/supervisor-digest/index.ts`. Was parked 2026-05-13 by Royce; unparked for Melbourne procurement posture.
- **FINDING #SEC2 — security [low] — verify-pin rate limit was in-memory only.** SHIPPED 2026-05-18 via [PR #99](https://github.com/Milmlow/eq-field-app/pull/99) (Phase B2 / Phase D activation). Phase 1 (schema design) shipped 2026-05-15 via PR #90. Phase D activated 2026-05-18: migration `2026-05-15_rate_limit_buckets_v1.sql` applied to EQ demo Supabase, RPC sanity-tested (5x true, 6th false), `netlify/functions/verify-pin.js` wired to `bump_rate_limit` RPC behind env-var feature flag `RATE_LIMIT_V2`. Client helper `bumpRateLimit(key, max, windowSeconds)` added to `scripts/supabase.js` for future defence-in-depth callers. **Activation requires setting `RATE_LIMIT_V2=on` in the Netlify env vars** — not flipped automatically by the merge. In-memory path serves as fallback when RPC blips.
- **FINDING #SEC3 — security [med] — Tender Pipeline RLS placeholder wide-open.** Discovered + recorded 2026-05-18 (DEMO-VS-LIVE.md). SHIPPED same day via [PR #98](https://github.com/Milmlow/eq-field-app/pull/98) (Phase B1). All 24 placeholder `_anon_*` policies on the 6 tender tables replaced — `tenders` / `tender_import_runs` / `tender_review_decisions` / `pending_schedule` gated on `org_id IS NOT NULL`; `nominations` / `tender_enrichment` gated on `EXISTS (tender_id → tenders.org_id IS NOT NULL)`. **HONEST CAVEAT in migration header:** EQ Field's anon-key auth model can't enforce `auth.uid()`-based per-user RLS — cross-tenant read by anyone holding the anon key remains structural until SSO (MELBOURNE-SCALE-DESIGN.md §7 Q7, Wave 5+). The brief's prescribed `TO authenticated USING (auth.uid()...)` pattern was a wrong premise; the precedent set in `2026-05-13_roster_presence_rls_tighten.sql` was the right shape.

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

---

### Session — 2026-05-15 — v3.5.1 supervisor home (manual, not cloud-scheduled)

**Look at this first:** [PR #83](https://github.com/Milmlow/eq-field-app/pull/83) — v3.5.1 supervisor home tile screen. Open for your review; does NOT pass auto-merge bar. Test plan in the PR body.

**Pre-flight findings (state-of-the-world correction):**

The session brief (`NEW-WINDOW-PROMPT.md` on the Desktop) was written before v3.5.0 shipped and said "build Daily Site Diary next". Diary actually shipped at v3.4.77; demo is now on v3.5.0. The brief was refreshed in place to reflect actual state through v3.5.0 and the v3.5.1 supervisor home draft on disk. Next-Claude pre-flight cost should drop by ~30 min.

Also confirmed:
- Cloud /schedule for nightly audit STILL not active (no Night 2+ entries in this log; Royce's retry pending)
- SPRINT-QUESTIONS.md still unanswered → S1/U2/S2/SEC2 sprint not started
- Tender Pipeline shipped a major workstream (v3.4.79–83) plus v3.4.84 polish rolled into v3.5.0 — not in any earlier brief, now documented

**What shipped (PR open, not yet merged):**

v3.5.1 — Mobile-first home tile screen: supervisor variant. Phase 2 of the mobile-first nav rollout. Promoted the `_proposals/mobile-first-nav/phase-2-supervisor-home.js` draft into `scripts/home.js` via Option A (extend with a role branch).

Diff: 8 files, +461 / -95 (≈366 net new). Above the auto-merge bar — PR left open for Royce review.

**Schema corrections vs the draft:**

Three of the draft's count functions were wired against fields that don't exist in the live schema. Re-wired against actual sources:

| Count | Draft path (wrong) | Actual schema | Fix |
| --- | --- | --- | --- |
| Pending leave | `STATE.leaveRequests` w/ `status==='pending'` | module-local `leaveRequests` in leave.js, `status==='Pending'` | new `window.eqGetPendingLeaveCount()` accessor in leave.js |
| Pre-starts to sign | `STATE.prestarts` w/ `signed_by_supervisor_id` | module-local `prestartCache` in site-reports.js, `status==='draft'` + `briefing_date` | new `window.eqGetPrestartsDraftCount()` accessor in site-reports.js |
| Timesheets to review | `STATE.timesheets` w/ `submitted_at`/`reviewed_at`/`approved_at` | None of those columns exist — timesheets are auto-saved per cell | **Dropped** the count from MVP. No source. |

**Decisions needed from Royce:**

1. **Review + merge PR #83** once you've poked at the supervisor home on your phone (test plan in the PR body).
2. **Stage SKS supervisors separately?** Right now `home_screen_v1` is default-on for both tenants — when PR #83 merges, SKS supervisors will see this on mobile too. If you want SKS to soak on the existing sidebar for a few days first, set `DEFAULTS.tenants.sks.home_screen_v1 = false` in scripts/flags.js before merging (or merge then flip via PostHog audience).
3. **SPRINT-QUESTIONS.md is still open.** S1 (sliding-window queries — Melbourne scaling blocker, ~7h) is gated on your answers. Nothing else can move that.
4. **Cloud /schedule retry.** Night 1 was a manual test run; no Night 2+ entries because the cloud schedule never fired. If you want the nightly audit cadence back, retry the /schedule setup with the prompt in SCHEDULE-PROMPT.md.

**What's queued after v3.5.1 ships:**

1. Site Reports HUB (~half day) — collapse Prestart + Toolbox + Diary sidebar entries into ONE "Site Reports" entry with landing-page status cards. Brief calls this next. Auto-merge candidate.
2. S1 sliding-window queries (~7h) — IF SPRINT-QUESTIONS answered.
3. U2 accessibility CI scaffold (~1-2h) — standalone, independent. Useful warm-up between bigger pieces.
4. Weekly Site Report (~6-8 days) — premature until at least one supervisor is using all three Site Reports workflows weekly.

**What was deliberately NOT touched:**

- main / SKS prod auth / RLS / env / migrations
- SKS Supabase project (off-limits per brief)
- scripts/tender-pipeline.js (Royce's active surface; he just shipped 5 versions of it)
- AUDIT-REVIEW's prior findings (append-only; this session added one new entry below Night 1, no restructure)

**Substrate hygiene:** not updated (eq-context substrate not visible from this worktree).

---

### Session — 2026-05-15 — SEC2 design + 2026-05-15 backlog merge

**Look at this first:** Demo backlog cleared — six PRs landed in this session (v3.5.0 → v3.5.3). Mission B Item 1 (S1 SKS port to main) is now **unblocked from a code perspective** but still gated on **3–5 days clean soak of v3.5.3 on demo** per SPRINT-QUESTIONS Q5 default. Next check-in: 2026-05-18 to 2026-05-20.

**Shipped this session:**
- **SEC2 Phase 1 (design-only)** — `migrations/2026-05-15_rate_limit_buckets_v1.sql` created PENDING, SQL lifted verbatim from SPRINT-PLAN.md §SEC2 per SPRINT-QUESTIONS Q9 default. **File NOT applied** to EQ demo or SKS prod Supabase. Phase D will apply + wire.
- FINDING #SEC2 moved from "Open findings" → "Tracked findings" with pointer to the migration file.
- SPRINT-PLAN.md §SEC2 updated with status block (Phase 1 ✅ shipped, Phase D ⏳ pending).
- **Backlog merge:** PRs #83 (v3.5.1 supervisor home), #84 (this entry's predecessor), #85 (v3.5.2 Site Reports HUB), #86 (audit slash command), #87 (axe-core CI scaffold), #89 (v3.5.3 S1 sliding-window) all merged into demo.
- **PR #88 closed** (not merged) as superseded by #89 — confirmed in #89's body ("Supersedes PR #88").
- Version-tuple conflicts on `sw.js` CACHE + `index.html` banner/cache-buster + `scripts/app-state.js` APP_VERSION between #85/#89 and prior merges were resolved locally taking the higher version each time. The `eqGetPrestartsTodayCount` (v3.5.2) and `eqGetPrestartsDraftCount` (v3.5.1) accessors in `scripts/site-reports.js` were both kept — different callers, different semantics.

**Decisions punted for Royce:**
1. **S1 SKS port (Mission B Item 1)** — runs as v3.5.4 on main after demo soak. Set a reminder for ~2026-05-18 to check demo health and green-light the port.
2. **Mission B Item 2 (S2 virtualisation v3.5.5)** — now unblocked. STATE shape is settled in v3.5.3. Ready to start when you give the word.
3. **Mission B Item 3 (S3 realtime window)** — still parked per AUDIT-REVIEW; needs explicit green-light.

**FINDING status changes:** #SEC2 → tracked (migration file landed PENDING). #S1 → effectively closed by v3.5.3 (PR #89). The Closed/Shipped findings section below should pick up #S1 once you confirm demo soak.

---

### Session — 2026-05-18 — S1 SKS port (v3.4.74, Mission B Item 1)

**Look at this first:** [PR #93](https://github.com/Milmlow/eq-field-app/pull/93) — `v3.4.74 — S1 sliding-window queries (SKS port from demo v3.5.3)`. Targets `main`. **DO NOT auto-merge** — SKS prod port per the brief's hard rule requires your explicit instruction. Test plan in the PR body.

**Pre-flight findings (state-of-the-world correction):**

The session brief (`NEW-WINDOW-PROMPT-sec2-melbourne.md` on Desktop) was written 2026-05-15 and assumed SEC2 + S2 Phase 1 were pending. Reality at 2026-05-18: SEC2 shipped via PR #90 on 2026-05-15, S2 Phase 1 (Contacts virtualisation) shipped via PR #91 today (2026-05-18 06:30). Both Mission A and Mission B Item 2 Phase 1 were already done. Only S1 SKS port + S2 Phase 2 + S3 were left.

Royce chose to go ahead with S1 SKS port despite soak being at the lower edge of the 3-5 day window (3 days clean since v3.5.3 merged 2026-05-15 04:52).

**What shipped (PR open, NOT merged):**

v3.4.74 on `main` — S1 sliding-window queries, **re-implemented fresh** against main (not cherry-picked). Why fresh: between main (v3.4.73) and demo (v3.5.4) there are ~16 versions of stacked demo-only work (mobile-first home, Site Reports HUB, Tender Pipeline, supervisor home, S2 contacts virtualisation, etc.) that touch the same files S1 modifies — especially `index.html`. Cherry-pick conflict risk was high; clean re-application avoided spurious conflicts and keeps the SKS branch lean (no demo-only features carry over).

Version choice: `v3.4.74` (conservative, matches the SKS train at v3.4.73) per Royce's call. The string `v3.4.74` already exists on demo (ESC-fix from Night 1) but never on `main` — no collision.

Behaviour parity with demo v3.5.3:
- `STATE.schedule` + `STATE.timesheets` bounded to ±4 weeks around `STATE.currentWeek`
- `STATE.loadedWeeks` Set tracks loaded week keys; capped at 16 by `_evictDistantWeeks`
- `onWeekChange` is now `async` + lazy-loads missing weeks via `_loadWeeks` with adjacent pre-fetch
- Bulk exports (`exportScheduleCSV`) use `_loadFullDataForExport` snapshot — doesn't mutate STATE
- Inline `↻ Loading…` indicator on the week-label during in-flight fetches
- SEED tenants short-circuit early — no behaviour change for eq/demo slugs

Diff: 5 files, 312 insertions / 14 deletions (compare to demo S1: 303 / 23 — same shape, slightly larger banner).

**Decisions needed from Royce:**

1. **Review + merge PR #93** when ready. Test plan in the PR body — Netlify preview deploy will exercise `?tenant=sks` path end-to-end (DevTools Network tab should show `&week=in.(...)` filters).
2. **S2 Phase 2 (Supervisors + Roster editor virtualisation)** — paused pending your green-light per the brief's "PAUSE FOR ROYCE between each" rule. Reply with go/no-go after PR #93 reaches a state you're happy with.
3. **S3 (week-scoped realtime channel)** — still parked. Brief says only proceed with explicit green-light.

**What was deliberately NOT touched:**

- Demo branch (this entry's PR is on a separate hygiene branch off `origin/demo`; the S1 work itself targets `main`)
- SKS Supabase project (off-limits per brief)
- scripts/tender-pipeline.js (Royce's active surface)
- `migrations/` (SEC2 file remains PENDING; no other migration touched)
- Auth / RLS / env vars

**FINDING status changes:** #S1 stays in "Open findings" until you merge PR #93 (then move to Closed/Shipped). Once landed, this is the audit's first cross-branch port — worth noting as a pattern for future demo→main work.

**Substrate hygiene:** not updated this session — v3.4.74 hasn't merged yet. Once PR #93 lands, the substrate `eq/changelog/field.md` should get an entry; deferred to the merge moment.

**Process notes:**

- The brief's "pre-flight catches stale state" guidance paid off — without it I would have re-shipped SEC2 from scratch. Brief versioning on Desktop matters.
- Re-implementation against main was the right call vs cherry-pick. Cherry-picking through 16 versions of stacked diffs would have wasted hours on conflict resolution and risked subtle scoping errors (the surrounding code on demo no longer matches main's structure).

---

### Session — 2026-05-18 — Phase A+B Melbourne prep

**Look at this first:** Phase A (scale verification) + Phase B (3 security findings) of `NEW-WINDOW-PROMPT-melbourne-ready.md` are shipped to demo. Phase B closes #SEC1/#SEC2/#SEC3. Phase A doc PR ([PR #97](https://github.com/Milmlow/eq-field-app/pull/97)) still open (your call). **One out-of-PR action needed:** flip `RATE_LIMIT_V2=on` in eq-solves-field Netlify env vars to activate PR #99's RPC path — without that flip, the merged code is dormant (in-memory rate-limit is still serving). Phase C (#U2 accessibility) is next.

**Pre-flight findings (state-of-the-world correction):**

The session worktree (`claude/eager-nobel-eb05e1`) was branched off main back at the v3.4.68 era — 56 commits behind origin/demo, missing every doc the brief asks me to read. Reset to origin/demo cleanly after confirming nothing was lost. Separate adjacent observation: your main checkout at `C:\Projects\eq-solves-field` is on local `demo` at `db2b5fa`, also far behind origin/demo. Worktree-based sessions have been keeping it stale. Suggest `git pull` next time you're in that directory; not actioned from any PR.

**Phase A — Scale verification (PR #97 open):**

Drove Claude-in-Chrome against `eq-solves-field.netlify.app/?seed500`. JS-tool + DOM evidence captured per the brief's 6-step list:
- A1 Contacts virtualisation: 498 people / 43 `<tr>` (matches brief's expected count exactly). `#contacts-virtual-scroll` + `EQVirtualTable` engaged. ✅
- A2 Edit Roster `content-visibility: auto`: all 498 `.roster-editor-row` elements gated; contain-intrinsic-size 36px. ✅
- A3 Roster (read-only) `content-visibility: auto`: same shape, 32px. ✅
- A4 Schedule sliding-window: helpers wired (`_getVisibleWeekRange()` returns 9 weeks), but EQ tenant short-circuits Supabase (SEED path) — live `week=in.(...)` is exercised on the SKS port (PR #93) instead. ⚠ partial, code-verified.
- A5 Tender Pipeline: 323 tenders + 12 nominations via `EQ_TENDER_PIPELINE.loadAll()`. (Brief said 10; count's grown from dogfood use.) ✅
  - **Incidental:** confirmed #SEC3 empirically — anon-key read of all tender data succeeded from a gate-locked, non-supervisor session. The placeholder RLS gap wasn't paper-only.
- A6 Mobile home tile: staff variant fully verified (flag on, `renderHomeScreen` wired, h1=Home, 17 tile elements). Supervisor variant deferred (would need supervisor unlock — privacy rules block me from typing passwords). ⚠ partial.

**Phase B — Security (3 PRs merged):**

- **B1 / [PR #98](https://github.com/Milmlow/eq-field-app/pull/98) — SEC3 tender RLS tighten.** The brief prescribed the textbook `TO authenticated USING (auth.uid()...)` pattern — that doesn't work on EQ Field (anon-key only, no per-user JWT). Surfaced this before writing the migration. Royce chose "tighten within anon model + caveat" per the precedent set in `2026-05-13_roster_presence_rls_tighten.sql`. Migration applied to EQ demo Supabase via MCP. App still reads 323 tenders + 12 noms post-tighten.
- **B2 / [PR #99](https://github.com/Milmlow/eq-field-app/pull/99) — SEC2 Phase D activation.** Migration `2026-05-15_rate_limit_buckets_v1.sql` applied to EQ demo Supabase, RPC sanity-tested. `verify-pin.js` wired with env-var feature flag `RATE_LIMIT_V2` — when off (current state, post-merge), serves the in-memory path unchanged. When on, distributed RPC bucket lockout supersedes the in-memory cold-start bypass. Belt-and-braces fallback: if the RPC fails (Supabase blip), falls through to in-memory. Client helper `bumpRateLimit` added to `scripts/supabase.js` for future defence-in-depth use.
- **B3 / [PR #100](https://github.com/Milmlow/eq-field-app/pull/100) — SEC1 magic-link TTL 7d → 48h.** Two `LEAVE_ACTION_TTL_MS` constants flipped (send-email.js + supervisor-digest/index.ts) + approve-leave.js header comment. Was parked 2026-05-13 with risk accepted; unparked for Melbourne procurement posture.

**Architectural notes (worth flagging):**
- The brief assumed EQ Field uses per-user Supabase auth. It doesn't (anon key + tenant access code at app layer). Three places that surface this constraint: `2026-05-13_roster_presence_rls_tighten.sql` HONEST CAVEAT, the new `2026-05-18_tender_rls_tighten.sql` (same shape), and MELBOURNE-SCALE-DESIGN.md §7 Q7 (Wave 5+ SSO). Worth keeping the precedent visible so the next finding hits the same shape rather than rediscovering the constraint.
- `bumpRateLimit` client helper is dormant (not wired anywhere yet). Future role-gated client actions (e.g. throttling PostHog bursts, leave-approve clicks) can pick it up without further infra work.

**Decisions punted for Royce:**
1. **Flip `RATE_LIMIT_V2=on` in Netlify env** when you want PR #99's RPC path active. Without it, the merge is dormant for the gate-PIN function. Same for SKS prod when you decide to roll out: requires the migration applied to SKS Supabase + a separate env-var flip on sks-nsw-labour Netlify.
2. **PR #97 merge decision.** Phase A verify doc is informational; doc-only; merge or close as you see fit.
3. **Phase C (U2 accessibility) kickoff.** Brief says ~5-6h split across Phase 2 (axe-core auto-fixes, ~2-3h) and Phase 3 (manual focus / keyboard / aria-live pass, ~2-3h). Awaiting your green-light.
4. **Phase D (tenant onboarding admin flow).** Greenfield work, design-first. Four open questions in the brief (E1-E4). Not started.

**FINDING status changes:**
- #SEC1 → Closed/Shipped (PR #100)
- #SEC2 → Closed/Shipped (PR #99 wires the RPC; env var still needed to activate)
- #SEC3 → Closed/Shipped (PR #98 — discovered + fixed same session)
- #S1, #S2 remain in "Open findings" in the list above despite being shipped to demo via v3.5.3+v3.5.4-6. Not touching them this PR to keep scope tight; worth a separate hygiene pass to also move them to Closed alongside the U2 work in Phase C.

**What was deliberately NOT touched:**
- main / SKS prod branch
- SKS Supabase project (off-limits per brief)
- scripts/tender-pipeline.js (Royce's active surface)
- Auth model itself — anon-key-only is preserved. Real per-user SSO is Wave 5+.
- `RATE_LIMIT_V2` env var (not set; required to activate B2's RPC path)
- PR #97 merge state (your call)

**Substrate hygiene:** `eq-context/eq/changelog/field.md` entry appended in the same PR.

**Process notes:**
- The brief's premise about EQ auth model was wrong on SEC3 (assumed per-user JWT). Catching this BEFORE writing the migration saved an hour of dead-end work + a broken Tender Pipeline. The lesson is the same as the 2026-05-15 session note: pre-flight catches stale state, surface architectural mismatches BEFORE writing code.
- Three separate PRs vs one bundle was the right shape — each PR is independently reviewable, mergeable, revertable. PR #98 had zero code-side risk (migration only). PR #99 had the heaviest review surface (function-level auth-edge changes). PR #100 was a one-line config bump per file. Clean separation made the merge train fast.
