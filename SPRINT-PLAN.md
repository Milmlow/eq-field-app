# Sprint plan — Night 1 audit follow-up

**Created:** 2026-05-13 from Night 1 audit triage
**Status:** Queued for sprint tonight or over the weekend (Royce's call on timing)
**Branch:** demo only (none of this touches main/SKS prod)
**Total estimated effort:** ~17 hours across 4 workstreams

This doc captures the analysis from the Night 1 audit triage chat so it
survives context compaction. When ready to start the sprint, the agent
(or Royce) can read this directly without scrolling chat history.

Cross-ref: AUDIT-REVIEW.md (the source findings list).

---

## Order to tackle (recommended)

1. **S1** (scaling blocker, ~7h) — highest leverage for Melbourne
2. **U2** (accessibility, ~6h) — procurement gate prep
3. **SEC2 design** (~1h) — design the table/RPC NOW, implement during Phase D
4. **S2** (virtualisation, ~4-6h) — defer until ~200 rows actually bite

Parallel-friendly: U2 can run independently of S1. SEC2 is design-only
this sprint. S2 depends on STATE shape — best done AFTER S1 stabilises.

---

## U2 — Accessibility: automated + targeted manual combo

**Total: ~6 hours. Same effort as pure manual + regression protection.**

### Phase 1 — CI tool (~1h)
- Add `axe-core` or `pa11y` as a GitHub Action that runs on every PR against the deployed Netlify preview
- Output: structured JSON report attached to PR check
- Catches ~30-40% of WCAG violations mechanically: missing labels, contrast, heading order, role mismatches

### Phase 2 — Fix auto-flagged issues (~2-3h)
- Run tool against current state
- Almost all are 1-line fixes (the tool tells you exactly what to add where)
- Commit in batches of ~10 fixes for review-ability

### Phase 3 — Targeted manual pass (~2-3h)
- Focus management on modal open/close (capture focus, restore on close)
- Keyboard nav order (tabindex audit on custom widgets)
- Screen-reader announcements for dynamic updates (toast messages, count badges, "added" / "removed" feedback)
- These are flows the automated tool can't see.

### Bonus
- The CI tool's report doubles as procurement documentation. When a
  Melbourne customer asks "what's your WCAG compliance?" you have a
  generated audit instead of writing one from scratch.

### Test plan
- Open the Netlify preview deploy in screen reader (NVDA on Windows / VoiceOver on Mac)
- Navigate the main flows with keyboard only — Tab through entire app, ESC closes modals, Enter activates buttons
- Color contrast pass on the sky-blue links + gate buttons

---

## S1 — Sliding-window queries for schedule + timesheets

**Total: ~7 hours. Behaviour-preserving throughout.**

**Status:**
- ✅ **Phases 1–4 (demo)** shipped 2026-05-15 via [PR #89](https://github.com/Milmlow/eq-field-app/pull/89) as v3.5.3.
  All five phases folded into one PR per SPRINT-QUESTIONS Q11 default
  ("bump per workstream"). Defaults applied throughout per Q1, Q2, Q3, Q4, Q5.
- ✅ **Phase 5 (dashboard)** investigated and confirmed **no-op** per Q4 default —
  `renderDashboard` + `updateTopStats` already scope via `getWeekSchedule()` and
  current week is always in the loaded window. No aggregate RPC needed.
- ⏳ **SKS port** open in [PR #93](https://github.com/Milmlow/eq-field-app/pull/93) as
  v3.4.74 on `main` (2026-05-18). Re-implemented fresh rather than cherry-picked
  due to ~16 versions of demo-only stacked work between main (v3.4.73) and
  demo (v3.5.4). DO NOT auto-merge — explicit Royce instruction required for
  SKS prod port.

### Phase 1 — Visibility tracking (no behaviour change yet, ~1h)
Files: `scripts/app-state.js`, `index.html`

- Add `STATE.loadedWeeks = new Set()` initialization
- Helper `_getVisibleWeekRange()` in `index.html` — returns `[currentWeek - 4 ... currentWeek + 4]` (9 weeks visible)
- No queries change yet. Just instrument so the next phase has the data shape it needs.

### Phase 2 — Scope initial load (~2h)
Files: `index.html` (loadFromSupabase)

- Change `sbFetch('schedule?select=*')` to `sbFetch('schedule?select=*&week=in.(' + weekList + ')')`
- Same for `timesheets`
- After fetch, mark `STATE.loadedWeeks.add(w)` for each week present in the response
- Edge case: dashboard widgets (anniversaries, birthdays) — they query `STATE.people` not `STATE.schedule` so untouched
- Demo/EQ SEED path unchanged (those don't hit Supabase)

### Phase 3 — Lazy load on week navigation (~2h)
Files: `index.html` (onWeekChange), possibly new helper in `scripts/supabase.js`

- `onWeekChange()` checks if new week is in `STATE.loadedWeeks`
- If not: show inline `↻ Loading…` indicator in the topbar, fetch that week + adjacent weeks, merge into STATE
- Use the existing 30s poll to refresh stale weeks (only re-fetch weeks marked as "dirty" via realtime)

### Phase 4 — Cache eviction (~30min)
Files: `index.html`

- Cap `STATE.loadedWeeks` at 16 entries (4 months). Evict furthest-from-current first.
- Without this, a power user navigating around builds memory indefinitely.

### Phase 5 — Aggregate queries for dashboard (~1.5h)
Files: maybe new Supabase RPC, `scripts/dashboard.js`

- Dashboard's "active this week / total" stats currently scan the full `STATE.schedule`. After scoping, they only see ~9 weeks.
- Add a lightweight aggregate RPC (`get_org_stats()`) that returns counts WITHOUT row data — cheap server-side.
- Or skip if dashboard only needs current-week stats (probably true — investigate first).

### Risk register
- **Risk 1:** week-step buttons feel laggy on first hit. Mitigation: pre-fetch adjacent week alongside current.
- **Risk 2:** realtime updates to weeks outside `loadedWeeks` get ignored. Acceptable — user will see them on next navigation.
- **Risk 3:** existing reports (timesheet exports, audit log scan) that scan-all break. Audit needs: all bulk-export paths must trigger a full fetch (one-time) rather than relying on STATE.

### Test plan
- Demo: switch weeks 5+ times, confirm lazy-load fires correctly + indicator shows
- Net tab: confirm initial load is now ~50KB (was potentially MB at scale)
- Existing flows: roster edit, leave request, timesheet entry all work normally
- Timesheet export still produces full data (Phase 5 dependency)

### Why this is the highest priority
S1 is the single biggest blocker for Melbourne customer onboarding. Design doc already specifies the shape — this is now scheduling, not invention. At Melbourne scale (577 people × 52 weeks) the current `schedule?select=*` returns ~30k rows = 5-10MB. Every poll re-pulls it. Unusable.

---

## S2 — Virtualisation for big-list views

**Total: ~4-6 hours. Recommend deferring until S1 lands.**

### Library choice: `clusterize.js`
- 3KB, vanilla JS, no framework lock-in, ~10 years stable
- Drop-in for tables + lists
- Renders visible rows + buffer; swaps as user scrolls

### Apply selectively
- **Contacts page** (people list — biggest at scale)
- **Supervisors page** (managers list)
- **Roster editor** (most-edited surface)
- Skip: dashboard, audit log, leave (already <100 rows typically — innerHTML stays fine)

### Why defer
- Not urgent today (v3.4.72 hash-diff already kills the false-positive flashes)
- Real benefit only kicks in around 200+ rows on a single page
- S1 changes STATE shape — better to do virtualisation against the new structure

### Test plan
- Seed demo with 500 fake contacts via SEED.people (one-time test data)
- Confirm contacts page renders smoothly with no stutter
- Confirm scroll-to-row, edit, archive all still work
- Mobile (< 768px) layout unaffected

---

## SEC2 — Rate limit backend for 5-tier security

**This sprint: design only (~1h). Implementation deferred to Phase D.**

**Status:**
- ✅ **Phase 1 (design)** shipped 2026-05-15 — schema captured verbatim
  in [`migrations/2026-05-15_rate_limit_buckets_v1.sql`](migrations/2026-05-15_rate_limit_buckets_v1.sql).
  File is PENDING (not applied to any Supabase) per SPRINT-QUESTIONS Q9 default.
- ⏳ **Phase D (implementation)** — when server-side role checks land, that
  workstream grabs the migration file, applies it via MCP (demo first,
  then SKS prod on explicit "SKS live"), and wires `bump_rate_limit()`
  into `verify-pin.js` + role-gated endpoints.

### Recommendation: Supabase counter table, ship as part of Phase D
NOT as a standalone fix. Phase D is the moment you start adding server-side role checks anyway — same migration adds both the role-check and the rate-limit infrastructure.

### Schema design (captured verbatim in migrations/2026-05-15_rate_limit_buckets_v1.sql)

```sql
-- migrations/<future-date>_rate_limit_buckets.sql

CREATE TABLE public.rate_limit_buckets (
  bucket_key TEXT PRIMARY KEY,         -- e.g. "sks:supervisor:approve_leave"
  count INT NOT NULL DEFAULT 0,
  window_starts_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Atomic bump-and-check RPC.
-- Returns TRUE if allowed, FALSE if rate-limited.
CREATE OR REPLACE FUNCTION public.bump_rate_limit(
  p_key TEXT,
  p_max INT,
  p_window_seconds INT
) RETURNS BOOLEAN AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_row public.rate_limit_buckets;
BEGIN
  INSERT INTO public.rate_limit_buckets (bucket_key, count, window_starts_at)
  VALUES (p_key, 1, v_now)
  ON CONFLICT (bucket_key) DO UPDATE SET
    count = CASE
      WHEN public.rate_limit_buckets.window_starts_at + (p_window_seconds || ' seconds')::INTERVAL < v_now
      THEN 1                                            -- window expired, reset
      ELSE public.rate_limit_buckets.count + 1          -- in-window, increment
    END,
    window_starts_at = CASE
      WHEN public.rate_limit_buckets.window_starts_at + (p_window_seconds || ' seconds')::INTERVAL < v_now
      THEN v_now
      ELSE public.rate_limit_buckets.window_starts_at
    END
  RETURNING * INTO v_row;

  RETURN v_row.count <= p_max;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS: only service-role can read/write (Edge Functions hit this).
ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
-- (no policies = denied by default for anon/authenticated; service-role bypasses RLS)
```

### Why Supabase counter (vs alternatives)

| Option | Pros | Cons | 5-tier fit |
|--------|------|------|------------|
| **Supabase counter (recommended)** | Free, existing infra, audit-log integrated, RLS-aware, role-tier-aware keys | +50ms latency per call | ★★★★★ |
| Netlify Blobs | Free, Netlify-native | Eventual consistency = not great for strict counters | ★★★ |
| Upstash Redis | Best perf | $10/month, new service to manage | ★★★★ |
| Status quo | Zero work | Doesn't actually limit across cold starts | ✗ |

### Role-aware bucket key examples

```js
// In verify-pin.js
const allowed = await bumpRateLimit(`${tenant}:gate-pin:${ip}`, 5, 900);  // 5 per 15min

// In a future role-gated endpoint
const allowed = await bumpRateLimit(`${tenant}:${role}:approve_leave`, 60, 60);
// supervisor: 60/min, employee: would never reach this endpoint
```

### Implementation ticket (for Phase D)
- Migration with the schema above
- Update `netlify/functions/verify-pin.js` to call `bump_rate_limit` RPC instead of in-memory map
- Add helper `bumpRateLimit(key, max, windowSeconds)` in `scripts/supabase.js` for client-side enforcement (optional defence-in-depth)
- Test: spam verify-pin 10x, confirm 6th returns 429
- Roll back path: feature-flag the RPC call so we can revert to in-memory if RPC fails

---

## Out of scope this sprint (parked + tracked)

- **C1** — apprentices.js split → [issue #74](https://github.com/Milmlow/eq-field-app/issues/74), scheduled when convenient
- **C2** — already deleted (PR #75)
- **S3** — realtime org-scoped → parked, revisit alongside S1 phase 3
- **SEC1** — 7-day magic-link TTL → parked, risk accepted

---

## When sprint starts

1. Read this doc + AUDIT-REVIEW.md
2. Pick a workstream (recommend S1)
3. Branch off latest `demo`
4. Work in phase chunks, commit each phase separately so progress is reviewable
5. Each shipped phase = PR to demo with auto-merge if it passes the bar
6. Update SPRINT-PLAN.md status ticks as phases complete
