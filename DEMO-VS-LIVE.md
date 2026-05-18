# Demo vs Live (SKS prod) — Comprehensive Comparison

**Generated:** 2026-05-18 by Claude (Royce's review session)
**Purpose:** Single source of truth for what's on demo, what's on live, and what should/shouldn't be ported. Royce annotates the **"Royce note"** sections with feedback per feature; SKS port decisions get made from this doc.

---

## Deploy snapshot

| | Demo | Live (SKS prod) |
|---|---|---|
| **URL** | eq-solves-field.netlify.app | sks-nsw-labour.netlify.app |
| **Repo branch** | `demo` | `main` |
| **GitHub branch HEAD** | `c9cde43` (post-#100, Phase B closed) | `2c769e0` (PR #69) |
| **APP_VERSION** | `3.5.6` (server-side Phase B since then) | `3.4.73` |
| **sw.js CACHE** | `eq-field-v3.5.6` | `eq-field-v3.4.73` |
| **Last shipped** | 2026-05-18 (Phase A+B Melbourne prep) | 2026-05-13 |
| **Tenant slug** | `eq` | `sks` |
| **Supabase project** | `ktmjmdzqrogauaevbktn` | `nspbmirochztcjijmcrx` |
| **Active users** | 0 (dev/demo only) | ~20 supervisors / staff |
| **Branding** | EQ blue diamond (`icons-eq/`) | SKS navy logo (`icons/`) |

**Divergence:** 59 commits, ~11,500 lines added across 61 files since the branches forked. SKS prod has been frozen on v3.4.73 since 2026-05-13 while demo took on 14 versions of work.

---

## What's IDENTICAL between demo and live

These behaviours are shared and any port preserves them:

- **Multi-tenant detection** via hostname (`eq-solves-field.*` → eq, `sks-nsw-labour.*` → sks). Same code path on both.
- **Core data model:** `people`, `sites`, `schedule`, `managers`, `timesheets`, `leave_requests`, `audit_log`, `job_numbers`. Both Supabases have these.
- **Role system Phase A:** access-gate with 4-char tenant codes (`staff` / `supervisor`), unlock-supervision modal, manager password from `app_config`.
- **Weekly Roster** (read-only view) — same UI, same grouping (Direct/Apprentice/Labour Hire).
- **Edit Roster** — same flexbox grid of `<input>`s, realtime presence outlines via `roster_presence` table, cell colours via `siteColor()`.
- **Sites CRUD, People CRUD, Managers CRUD, Job Numbers CRUD, Leave requests, Timesheets, Calendar, Import/Export, Audit log.**
- **PIN management** for apprentices + labour-hire timesheet entry.
- **Friday supervisor digest** (auto-emails managers a weekly summary at 12:00 AEST Fridays).
- **PostHog analytics + Microsoft Clarity** event firing.
- **Service Worker offline cache** (note: live has a tail-truncation bug — see "Risks on live" below).

If Royce wants confidence on "nothing changes for SKS users from the shared baseline," the above list is the answer.

---

## Demo-only features (NOT on live)

Grouped by domain. Each block has the same shape: what it is, where it lives, schema/tables, port risk, **Royce note**.

### 1. Tender Pipeline (v3.4.79–v3.4.83)

**What:** New workstream for tracking tender opportunities through stages (watch → confirmed → likely → won/lost). Kanban with drag-and-drop, enrichment slide-over, fortnightly Review decision queue, Excel ingestion via SheetJS, Pipeline Dashboard with stage + dept filters.

**Code:** `scripts/tender-pipeline.js` (~1929 lines), `scripts/tender-parser.js` (~346 lines), `tests/tender-parser.test.html`, four new sidebar entries (Pipeline Dashboard / Pipeline / Fortnightly Review / Tender Sync), CSP relax for SheetJS CDN.

**Supabase tables (EQ project only):** `tenders`, `tender_enrichment`, `nominations`, `nomination_clashes` (view), `pending_schedule`, `tender_import_runs`, `tender_review_decisions`. **Not present on SKS Supabase.** All listed in `TENANT_DISABLED_TABLES.sks` so the app's auto-fetch helpers no-op for SKS.

**Status:** DEMO ONLY by design. Code is safe to ship to SKS (it'd just no-op) but if Royce wants SKS supervisors to USE Tender Pipeline, the SKS Supabase needs the migrations applied.

**Verified loose ends from the 2026-05-14 frozen Cowork session (resume doc `C:\Projects\eq-field-pipeline\RESUME-2026-05-14.md`):**

| Loose end from resume doc | Status now (verified 2026-05-18) |
|---|---|
| Port parser + tests | ✅ `scripts/tender-parser.js`, `tests/tender-parser.test.html` shipped v3.4.79 |
| Build 5 screens | ✅ Shipped v3.4.79 → v3.4.83 |
| PostHog 8 events | ✅ **10 events shipped** (over-delivered): `tenderImported`, `tenderStageDragged`, `nominationAdded`, `tenderEnriched`, `reviewSessionStarted`, `reviewSessionEnded`, `pencillingsSavedReview`, `tenderPromoted`, `labourCurveConfirmed`, `decisionLogged` |
| `_headers` file | ✅ Shipped with proper CSP for SheetJS + both Supabases + PostHog + Clarity |
| `eq/pending.md` eq_role status | ✅ Marked `[x]` applied |
| Session log `eq-context/sessions/2026-05-14.md` | ✅ Exists (substrate-auto-push session; Pipeline work captured in `CHANGELOG-v3.4.79.md` + `eq-context/changelog/field.md`) |
| 3 cross-org nomination collisions (Dan/Tara/Chris UUIDs colliding with Alex/Jordan/Sam in org `a0000000-...`) | ✅ **Nominations cleaned up** — no nominations reference the 3 wrong UUIDs anymore. The 3 people rows still exist in the other org but are harmless (different `org_id`, won't load into demo-trades). |
| RLS policies | ✅ **Tightened 2026-05-18 — see SEC3 closure below** |

**✅ FINDING #SEC3 closed 2026-05-18.**

Shipped via [PR #98](https://github.com/Milmlow/eq-field-app/pull/98) (migration `2026-05-18_tender_rls_tighten.sql`, applied to EQ Supabase via MCP). All 24 placeholder `_anon_*` policies replaced — `tenders` / `tender_import_runs` / `tender_review_decisions` / `pending_schedule` gated on `org_id IS NOT NULL`; `nominations` / `tender_enrichment` gated on `EXISTS (tender_id → tenders.org_id IS NOT NULL)`.

**HONEST CAVEAT in the migration header** (mirrors `2026-05-13_roster_presence_rls_tighten.sql` precedent): the brief's prescribed `auth.uid()`-based pattern would have broken Tender Pipeline — EQ Field uses the anon key only, no per-user JWT. What's enforceable within the anon-key model: orphan-row prevention + structural integrity at the DB layer. Cross-tenant read by anyone holding the anon key remains structural until per-user SSO ships (MELBOURNE-SCALE-DESIGN.md §7 Q7, Wave 5+).

- **EQ demo today:** one org_id only → practical impact of the remaining gap is zero.
- **Future tenant on EQ Supabase:** the cross-tenant read risk becomes real once a second org_id is added. Wave 5+ SSO unblocks the proper fix.
- **SKS prod:** unaffected (no tender tables there).

**Port risk:** Low if just shipping code to SKS (no behaviour change, tables remain disabled). Medium-high if also enabling for SKS — needs migration + the SEC3-equivalent tighten applied to SKS Supabase first + supervisor training.

**Royce note:** _(is Tender Pipeline ever coming to SKS? The SEC3 tighten is portable — same migration shape applies once SKS has the tender tables.)_

---

### 2. Site Reports module — Prestart, Toolbox, Diary, HUB (v3.4.69 → v3.5.2)

**What:** Three workflows for capturing on-site activity, with a v3.5.2 HUB that collapses them into one sidebar entry.

- **Prestart Briefings** (v3.4.69) — form + 8 photos + signature pad + offline queue. HRCW categories. Crew sign-off.
- **Toolbox Talks** (v3.4.75) — weekly/per-shift talks with topic, safety message, items reviewed, attendance JSONB, open actions.
- **Daily Site Diary** (v3.4.77) — weather JSONB, shift_type, work_areas / delays / incidents / visitors repeaters, free-text materials_received / equipment_status / notes.
- **HUB** (v3.5.2) — Site Reports sidebar entry → three status cards (today / this week / today) → tap-through to underlying workflow.

**Code:** `scripts/site-reports.js`, `scripts/site-reports-shared.js` (photo/signature/offline-queue scaffold), `scripts/toolbox.js`, `scripts/diary.js`, `scripts/site-reports-hub.js`. ~2500 lines total.

**Supabase tables:**
- `prestarts`, `prestarts.photos` (JSONB) — present on **both** EQ + SKS Supabases.
- `toolbox_talks` — present on **both** EQ + SKS Supabases.
- `site_diaries` — present on **EQ only**; SKS port needs the migration applied.
- Permissions: `reports.{prestart,toolbox,diary}.{view,create,submit,sign}` defined in `scripts/permission-matrix.js`.

**Status:** DEMO ONLY today. Module is shipped under the "Testing (DO NOT USE)" sidebar section on demo. SKS supervisors don't see it.

**Port risk:** Medium. Prestart + Toolbox tables exist on SKS already — could port just those two if Royce wants. Diary needs a migration. HUB needs the others to be visible first.

**Royce note:** _(which of Prestart / Toolbox / Diary should go to SKS first? Any feedback from the demo soak?)_

---

### 3. Mobile-first home tile screen (v3.5.0 staff, v3.5.1 supervisor)

**What:** Phone-sized landing page replacing the sidebar shell on mobile. Staff variant: 4 tiles (My Schedule / Timesheets / Leave / Pre-starts) + next-shift pill + cog drawer. Supervisor variant: 6 tiles (Schedule / Timesheets / Leave / Pre-starts / Team / Reports) + action strip ("Needs you today · N leave to approve · N pre-start") + richer cog drawer (Edit roster, Sites, Job numbers, Apprentices, Supervision, Import/Export, Audit log).

**Code:** `scripts/home.js` (~572 lines), `styles/home.css` (~341 lines). Routed by `initApp()` if (a) `home_screen_v1` flag on, (b) viewport <768px, (c) role detected. Desktop (≥768px) keeps existing sidebar shell on both tenants.

**Flag:** `home_screen_v1` in `scripts/flags.js`. Currently **default ON for both tenants** on demo build. If shipped to main as-is, SKS mobile users would see the new home screen the next time they open the app on a phone.

**Status:** Phase 2 (supervisor) shipped via PR #83, live on demo. Flag-gated but defaults on.

**Port risk:** Medium-high. Code is safe (flag-gateable) but the default-on state means shipping = changing UX for SKS mobile users overnight. Could ship with `DEFAULTS.tenants.sks.home_screen_v1 = false` to stage.

**Royce note:** _(do SKS mobile users get the home tile screen? Roll out by tenant or hold back?)_

---

### 4. v3.4.68 Role system Phase B+C

**What:** Role-based permissions matrix replacing the binary "supervisor unlocked / not" check. Defines fine-grained permissions like `reports.diary.view`, `roster.edit`, `leave.approve` per role.

**Code:** `scripts/permissions.js`, `scripts/permission-matrix.js`, plus call-site changes in many modules to use `EQ_PERMS.can('xyz')` instead of `if (isManager) ...`.

**Status:** Soaked on demo for several weeks. Never ported to SKS prod because it changes the auth surface — needs a careful look before SKS users see it.

**Port risk:** Medium. Auth changes require explicit Royce approval (CLAUDE.md hard rule). Behaviour-equivalent for the SKS roles in use today, but the call sites changed across many files.

**Royce note:** _(is Phase B+C ready to port? Or wait for Phase D server-side enforcement?)_

---

### 5. S1 sliding-window queries (v3.5.3) — **the Melbourne scaling fix**

**What:** `STATE.schedule` and `STATE.timesheets` were unscoped (`?select=*`). At Melbourne scale (577 ppl × 52 weeks = 30k rows) every page load + 30s poll pulled 5–10MB. v3.5.3 scoped these to ±4 weeks (9-week window), added lazy-load on week navigation with adjacent prefetch, cache eviction at 16 weeks, separate full-fetch path for bulk exports.

**Code:** `index.html` (`loadFromSupabase`, `_getVisibleWeekRange`, `_loadWeeks`, `_evictDistantWeeks`, `onWeekChange`), `scripts/app-state.js` (`STATE.loadedWeeks`), `scripts/timesheets.js` (scoped `loadTimesheets`), `scripts/import-export.js` (full-fetch helper for bulk exports), `sw.js` (CACHE bump). ~341 lines.

**Status:** Live on demo since 2026-05-15. **3 days of clean soak** (no regressions flagged). This is the single biggest scaling unblocker for Melbourne customer onboarding.

**Port risk:** **LOW.** Behaviour-preserving at any tenant size. SKS has ~20 users + ~52 weeks = 1000 rows total → query payload drops from ~200KB to ~50KB but UX is identical. Demo SOAK met soak window.

**Royce note:** _(this is the one I want on SKS — Q5 default says wait for SKS green-light)_

---

### 6. S2 contacts virtualisation (v3.5.4) — `EQVirtualTable` shim

**What:** FINDING #S2 fix — wholesale innerHTML rebuilds on big-list views. Phase 1 = Contacts page desktop branch. Above 150 rows switches from innerHTML to a vanilla MIT-clean virtualisation shim (~80 LOC, EQ-authored, no third-party deps) that renders only the visible window of rows.

**Code:** `scripts/virtual-table.js` (NEW), `scripts/people.js` (`renderContacts` desktop branch wired). `sw.js` precaches the shim.

**Status:** Live on demo since 2026-05-15. Verified via browser deep-dive (read 498 seeded contacts → only 43 `<tr>` in DOM, math precise, action buttons fire correctly).

**Port risk:** **LOW.** Threshold-gated. SKS contacts page is ~20 rows → falls below 150 threshold → existing innerHTML path runs. Zero observable change for SKS unless the tenant grows past 150 contacts.

**Royce note:** _(pair with S1 in the SKS port?)_

---

### 7. S2 supervisors virtualisation (v3.5.5)

**What:** Phase 2 of S2 — same shim applied to `renderManagers` desktop branch. Category headers (Executive / Operations / etc) interleaved with manager rows in a flat array passed to `EQVirtualTable`.

**Code:** `scripts/managers.js` (`renderManagers`). No new shim files.

**Status:** Live on demo since 2026-05-18.

**Port risk:** **LOW.** Same threshold-gating. SKS has 2 managers → innerHTML path.

**Royce note:** _(bundle with S1+S2 contacts in the SKS port)_

---

### 8. S2 Phase 3 — roster editor + roster view (v3.5.6, **PR #95 open**)

**What:** Closes out FINDING #S2. Different approach from #91/#92: the editor has 8 `<input>`s per row wired to focus/blur/oninput/onchange + realtime presence. EQVirtualTable would rip inputs out of DOM mid-edit, killing focus. Used CSS `content-visibility: auto` on `.roster-editor-row` + `#roster-content tbody tr` instead — browser skips offscreen paint+layout, DOM stays intact.

**Code:** `styles/base.css` (~12 lines). No JS changes.

**Status:** PR #95 open against demo. Pure CSS delta.

**Port risk:** **LOW.** Behaviour-preserving. Pre-Safari-18 iPad clients fall back gracefully (renders normally).

**Royce note:** _(merge to demo? Bundle with S1+S2 ports?)_

---

### 9. SEC2 — rate-limit-buckets migration + Phase D activation ✅

**What:** Distributed rate limit infrastructure replacing the in-memory `attempts={}` map in `netlify/functions/verify-pin.js` (FINDING #SEC2).

**Status (2026-05-18):**
- ✅ **Phase 1 (design)** shipped 2026-05-15 via PR #90 — `migrations/2026-05-15_rate_limit_buckets_v1.sql`.
- ✅ **Phase D (activation)** shipped 2026-05-18 via [PR #99](https://github.com/Milmlow/eq-field-app/pull/99). Migration applied to EQ demo Supabase. `verify-pin.js` wired with env-var feature flag `RATE_LIMIT_V2`. Client helper `bumpRateLimit(key, max, windowSeconds)` added to `scripts/supabase.js`.
- ⏳ **Activation:** requires `RATE_LIMIT_V2=on` in eq-solves-field Netlify env vars. Without that flip, in-memory path serves as before. Code is dormant post-merge.

**Port risk:** Zero on SKS until you explicitly roll out. SKS Supabase doesn't have the migration applied and the SKS Netlify deploy doesn't have `RATE_LIMIT_V2` set. To roll to SKS: apply the migration to `nspbmirochztcjijmcrx`, then flip the env var on sks-nsw-labour Netlify.

**Royce note:** _(when to flip RATE_LIMIT_V2 on EQ Netlify? Same question for SKS rollout timing.)_

---

### 10. Audit + CI infrastructure (v3.4.74 + chores)

- **`AUDIT-REVIEW.md`** — nightly audit log with findings (#U1 shipped, #S1 shipped, #S2 in flight, #SEC2 tracked, #SEC1 + #S3 parked).
- **`SPRINT-PLAN.md`, `SPRINT-QUESTIONS.md`, `REVIEW-MULTI-LENS.md`** — sprint planning docs.
- **`.github/workflows/accessibility-audit.yml`** — axe-core CI for WCAG checks. Manual `workflow_dispatch` only, no cron.
- **`.claude/commands/audit-multi-lens.md`** — local slash command for strategic reviews.
- **ESC closes top-most modal** (FINDING #U1, shipped v3.4.74).

**Status:** Demo-only by design. All doc + tooling, no user-facing behaviour.

**Port risk:** Trivial — these can be ported anytime, zero user impact.

**Royce note:** _(any reason NOT to port these chore PRs to main?)_

---

## Schema delta (Supabase migrations)

Migrations on demo `migrations/` directory that haven't been applied to SKS Supabase:

| File | Table / RPC | Applied EQ? | Applied SKS? |
|---|---|---|---|
| `2026-05-13_prestarts_photos.sql` | `prestarts.photos` JSONB column | ✅ Yes | ✅ Yes |
| `2026-05-13_site_reports_v1.sql` | `prestarts` table | ✅ Yes | ✅ Yes |
| `2026-05-13_realtime_leave_requests.sql` | realtime publication | ✅ Yes | ✅ Yes |
| `2026-05-13_managers_dob_start_date_archived.sql` | manager columns | ✅ Yes | ✅ Yes |
| `2026-05-13_roster_presence_rls_tighten.sql` | roster_presence RLS | ✅ Yes | ✅ Yes |
| `2026-05-14_toolbox_talks_v1.sql` | `toolbox_talks` table | ✅ Yes | ✅ Yes |
| `2026-05-14_site_diaries_v1.sql` | `site_diaries` table | ✅ Yes | ❌ **NOT applied** |
| `2026-05-15_rate_limit_buckets_v1.sql` (SEC2) | `rate_limit_buckets` + `bump_rate_limit()` | ❌ PENDING | ❌ PENDING |
| Tender Pipeline migration (v3.4.79 era) | `tenders`, `tender_enrichment`, `nominations`, `nomination_clashes`, `pending_schedule`, `tender_import_runs`, `tender_review_decisions` | ✅ Yes | ❌ **NOT applied** |

**Net for SKS Supabase:** missing only `site_diaries` + Tender Pipeline tables. SEC2 is pending for both.

---

## Risks already on live (worth flagging)

Bugs/concerns present on SKS prod TODAY (would benefit from a port even without any new features):

### sw.js tail truncation (silent)
SKS's `sw.js` ends mid-statement at `caches.open(CACHE).then(cache => cache.p` (no closing parens). SW registration silently fails with "ServiceWorker script evaluation failed". App still works because it falls back to network fetches without caching, but the PWA's offline cache has been dead since at least v3.4.73 (probably longer). Caught + fixed in PR #91 (demo); same fix is portable.

### FINDING #SEC2 — verify-pin rate limit (still in-memory on live)
SKS prod still uses the in-memory `attempts = {}` map. Demo shipped the distributed-RPC path via PR #99 on 2026-05-18, but the env var is not flipped yet (so even demo runs the in-memory path until activation). SKS rollout pending explicit "SKS live" — migration must be applied to `nspbmirochztcjijmcrx` first.

### FINDING #SEC1 — magic-link approve/reject TTL (closed on demo)
Closed on demo 2026-05-18 via PR #100 (7d → 48h). SKS prod still serves 7d until the same one-line change is promoted to `main`. Worth bundling with the next SKS port wave.

### FINDING #S3 — realtime channel org-scoped, not week-scoped
Parked. Complementary to S1 — wastes channel bandwidth at scale, but SKS at 20 users runs fine on org-scoped.

### FINDING #SEC3 — Tender Pipeline RLS placeholder (closed on demo)
Discovered 2026-05-18 during the loose-ends review of the 2026-05-14 resume doc; closed same day via PR #98 (`2026-05-18_tender_rls_tighten.sql`). HONEST CAVEAT: tighten within anon-key model only — cross-tenant read by anyone holding the anon key remains structural until SSO (Wave 5+). SKS unaffected (no tender tables).

---

## Live-version feedback (Royce's notes go here)

_Paste your feedback on the live SKS prod version below. Anything not working, friction points, requests, things to fix in any port. We'll consolidate from here._

- _feedback item 1_
- _feedback item 2_
- _feedback item 3_

---

## Port decision matrix (Royce decides)

Suggested order if Royce wants to port _some_ of demo to live. Sorted by safety (top = safest, bottom = most disruptive).

| Group | What | Port effort | User-visible change on SKS | Royce decision |
|---|---|---|---|---|
| **A** | sw.js truncation fix | 5 min | None (offline cache silently revives) | ⬜ Yes / ⬜ No |
| **B** | ESC closes modals (v3.4.74) | 10 min | Tiny QoL — `ESC` now closes modals | ⬜ Yes / ⬜ No |
| **C** | S1 sliding-window (v3.5.3) | ~2h surgical port (1,134 lines divergence in 5 files) | None at SKS scale; future-proofs Melbourne | ⬜ Yes / ⬜ No |
| **D** | S2 contacts + supervisors + roster (v3.5.4–6) | ~30 min once C lands | None (threshold-gated) | ⬜ Yes / ⬜ No |
| **E** | Site Reports — Prestart only | ~1h | New "Pre-starts" sidebar entry for SKS supervisors | ⬜ Yes / ⬜ No |
| **F** | Site Reports — Toolbox only | ~1h | New "Toolbox" sidebar entry | ⬜ Yes / ⬜ No |
| **G** | Site Reports — Diary (needs migration) | ~1.5h | New "Diary" entry + Supabase migration | ⬜ Yes / ⬜ No |
| **H** | Site Reports HUB (depends on E+F or +G) | +30 min | Three originals hidden, HUB lands | ⬜ Yes / ⬜ No |
| **I** | Mobile home tile (staff, flag-off SKS) | ~30 min | None until flag flipped per tenant | ⬜ Yes / ⬜ No |
| **J** | Mobile home tile (supervisor, flag-off) | ~30 min | None until flag flipped | ⬜ Yes / ⬜ No |
| **K** | Role system Phase B+C | ~2h | Internal — auth surface change, behaviour-equivalent | ⬜ Yes / ⬜ No |
| **L** | Tender Pipeline | ~30 min code + migration + **SEC3 RLS rewrite (~1h) MUST precede SKS enablement** | Requires data work; SKS doesn't have tenders today | ⬜ Yes / ⬜ No |
| **M** | Audit/CI chores (AUDIT-REVIEW.md, axe workflow, /audit-multi-lens, sprint docs) | ~15 min | Zero | ⬜ Yes / ⬜ No |

**Total if all ported:** ~10h surgical work + the data decisions for E/F/G/L.
**Recommended starter pack:** A + B + C + D + M (the safe, behaviour-preserving wins).

---

## Next session prompts

When Royce comes back with feedback in the **Live-version feedback** section above, the natural next-session shape is:

1. Read this doc + Royce's feedback.
2. For each port-decision row marked "Yes," generate a focused PR (one row = one PR, easy to review/revert).
3. For each live-version feedback item, scope a fix (could be a separate PR or bundled with related port work).
4. Open all PRs against `main` with explicit "do not merge until Royce green-lights" in each PR body.
5. Royce reviews, merges in order. Netlify auto-deploys each merge to SKS prod.

---

_Generated by Claude based on git diff of `origin/main..origin/demo`, Supabase MCP table lists, and code reading at 2026-05-18. Update this doc as features ship or get ported; treat it as the canonical demo↔live state record._
