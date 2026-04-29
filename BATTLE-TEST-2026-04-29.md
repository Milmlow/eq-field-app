# Battle test — 2026-04-29 evening / overnight

Royce off on holidays tomorrow. Claude doing an autonomous "try to break it" pass on the EQ demo while he's away. Demo-only blast radius — no SKS commits, no auth surface changes, no Supabase migrations to either project beyond what's already live.

Each finding gets:
- Severity: 🔴 likely user-visible bug · 🟡 latent / edge case · 🟢 cosmetic / nice-to-have
- Status: 🔧 fixed in this pass · 🚧 PR open, needs Royce review · 📝 documented only

---

## Pass 1 — `scripts/presence.js` review

### 🔴 1. Race: fast focus→blur produces orphan presence rows · 🔧 fixed
**Where**: `scripts/presence.js` `presenceFocus` and `presenceBlur` (lines 42-103).
**Symptom**: User focuses cell X, then blurs within ~50ms (rapid Tab navigation). The async POST and DELETE both go in flight. If DELETE arrives at the server before the POST, the DELETE no-ops (no row exists yet); then the POST inserts the row, which sits there with no matching DELETE coming. Other clients see "X is editing" for ~15s before the client-side staleness filter masks it. The pg_cron sweep eventually reaps the orphan after up to an hour.
**Fix**: Track the latest in-flight POST in a module-scope `_presenceInflight`. `presenceBlur` awaits it before issuing the DELETE so server-side ordering is guaranteed.

### 🔴 2. `beforeunload` sendBeacon block was dead code · 🔧 fixed
**Where**: `scripts/presence.js` lines 105-123.
**Symptom**: Comment correctly noted "best effort only … no auth headers" — and indeed, `sendBeacon` always sends POST (no DELETE option), and the request lacks the `apikey`/`Authorization` headers PostgREST requires. The block was a confidently-named no-op. Removed entirely; pg_cron's hourly cleanup handles the unclean-tab-close case (presence row sits up to 60min, but client-side `focused_at > now-15s` filter hides it visually within 15s on every other client).
**Fix**: Removed the block. Documented in the comment that pg_cron is the cleanup mechanism.

### 🟢 3. Dead `cutoff` variable · 🔧 removed
**Where**: `scripts/presence.js` line 162. Local variable computed but never read.

### 🟡 4. Lax RLS on `roster_presence` table · 📝 documented, not fixed
**Where**: `migrations/2026-04-29_roster_presence.sql`.
**Symptom**: Policies are `USING (true)` for SELECT/INSERT/UPDATE/DELETE on the anon role. A bad actor with the published anon key (visible in `scripts/app-state.js`) could mass-DELETE or spam-INSERT presence rows. Damage: presence indicators flash/disappear strangely. No data exposure (presence holds no PII beyond manager names already shown on the Supervisors page) and no data loss (presence is ephemeral).
**Why deferred**: Acceptable for MVP. Tightening would require either an authed JWT carrying the manager identity (real auth surface change — needs Royce sign-off per global rules) or an `org_id`-scoped policy that requires reading TENANT.ORG_UUID server-side, which the anon role can't easily prove. Flagged for v2.

### 🟡 5. Cross-week phantom presence on week change · 📝 documented
**Where**: `scripts/presence.js` interaction with the week-navigation buttons.
**Symptom**: If the user is focused on cell X on week A, then clicks "Next Week" via a button, the editor input loses focus → `onblur` fires → `presenceBlur` runs → DELETE goes through. So in practice this is handled cleanly today. Logged as a watch item if week-change is ever wired up via a keyboard shortcut that doesn't blur the input first.

---

## Pass 2 — `scripts/realtime.js` after EQ-tenant gate lift

### 🔴 6. EQ Supabase realtime publication is missing `schedule` + `leave_requests` · 🚧 PR open with additive migration, NOT applied
**Where**: EQ Supabase project `ktmjmdzqrogauaevbktn`, `pg_publication_tables` for `supabase_realtime`.
**Discovered via**: `SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';` — returned only `public.roster_presence`.
**Symptom**: v3.4.47 lifted `'eq'` from the realtime gate so EQ users now connect to Realtime. But the EQ project's `supabase_realtime` publication was never extended beyond `roster_presence` (which we ADDed in the v3.4.47 migration). So `_rtJoinChannel('schedule')` and `_rtJoinChannel('leave_requests')` succeed at the Phoenix-protocol level but no postgres_changes events ever fire — silent realtime failure for the two tables that matter most. Effect on a single-user demo: invisible, because only one user is editing. Effect on multi-supervisor demo (two browsers): roster cells and leave requests don't live-merge; users see stale data until the next 30s poll.
**Fix shape**: Two-line additive migration —
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.schedule;
ALTER PUBLICATION supabase_realtime ADD TABLE public.leave_requests;
```
**Why deferred**: Schema change → Royce should sign off before applying, especially since SKS prod likely needs the same check (its publication state is unverified — read-only check skipped per "never touch SKS" rule). Migration file committed to repo; Royce applies via Supabase SQL editor when back.

### 🟡 7. No jitter in realtime reconnect backoff · 📝 documented
**Where**: `scripts/realtime.js` `_rtScheduleReconnect` (lines 125-131).
**Symptom**: Backoff is `1s, 2s, 4s, 8s, 16s, 30s` exactly. If many clients lose connection at the same instant (Supabase blip, Netlify edge issue), all reconnect at the same instants — thundering herd. Not a problem at SMB scale (5-50 supervisors) but worth fixing before enterprise scale. Add `Math.random() * delay * 0.3` jitter.
**Why deferred**: Latent at current scale; cosmetic-tier fix.

### 🟡 8. Failed channel JOIN is not retried · 📝 documented
**Where**: `scripts/realtime.js` `_rtOnMessage` (lines 184-191).
**Symptom**: If a `phx_join` reply has `status !== 'ok'`, the code logs an error and leaves `chan.joined = false`. There's no retry path. So if (e.g.) RLS rejects one client's subscription transiently, that channel stays dead until the next page reload. Other channels work, so the failure is partial and easy to miss.
**Why deferred**: Hard to repro — would need a transient RLS error to test. Document for future hardening.

### 🔴 9. EQ tenant ALSO has 30s polling gated → no sync at all · 🔧 fixed in v3.4.49
**Where**: `index.html` line 2189 (`startPolling`).
**Symptom**: Same root-cause as #6. Discovered while validating the realtime fix. The polling fallback (which calls `refreshData()` every 30s when no one's actively editing) has the SAME `if (TENANT.ORG_SLUG === 'eq' || TENANT.ORG_SLUG === 'demo') return;` gate as `startRealtime` did pre-v3.4.47. Combined with #6, the EQ tenant has neither realtime nor polling — two EQ supervisors editing simultaneously today would never see each other's changes until a page reload. Demo (in-memory tenant) correctly stays gated since it has no Supabase to poll.
**Fix**: Drop `'eq'` from the polling gate; keep `'demo'`. Polling is now active for EQ tenant. After the realtime publication migration (#6) is applied, polling becomes mostly redundant for EQ but stays harmless — it only fires when no one's editing and silently refreshes data.



---

## Coverage matrix

Tick rotation slots as they're reviewed so the loop spreads attention systematically rather than randomly. ✓ = at least one iteration spent on it.

| Slot                                            | Iter | Result                                  |
|-------------------------------------------------|------|------------------------------------------|
| `scripts/presence.js`                           | ✓    | Pass 1 — 5 findings (#1-5)              |
| `scripts/realtime.js`                           | ✓    | Pass 2 — 3 findings (#6, #7, #8)        |
| `index.html` polling / SW registration          | ✓    | Pass 2 — finding #9                     |
| `supabase/functions/tafe-weekly-fill/index.ts`  |      |                                          |
| `scripts/leave.js`                              |      |                                          |
| `scripts/roster.js`                             |      |                                          |
| `scripts/people.js`                             |      |                                          |
| `scripts/managers.js`                           |      |                                          |
| `scripts/supabase.js` (sbFetch wrapper, CAS)    |      |                                          |
| `scripts/audit.js`                              |      |                                          |
| `scripts/digest-settings.js`                    |      |                                          |
| `sw.js` (PRECACHE list, network-first logic)    |      |                                          |
| `scripts/auth.js` (PIN flow, session token)     |      |                                          |
| Supabase MCP runtime sweep — `roster_presence`  |      |                                          |
| Supabase MCP runtime sweep — `audit_log`        |      |                                          |
| Edge-case probe — DST / timezone boundaries     |      |                                          |
| Edge-case probe — long names / special chars    |      |                                          |
| Edge-case probe — memory/timer leaks            |      |                                          |
| Edge-case probe — offline / queue replay        |      |                                          |
| `scripts/release.mjs` regex robustness          |      |                                          |

---

## Tier analysis

Strategic findings: features (or absences) that affect which tier of customer the app appeals to. Track separately from bugs so Royce's morning skim can read this section as a roadmap, not a bug list.

Format per entry: **Tier · Effort (S/M/L) · Title** — one-line rationale.

(populated as iterations discover gaps)

---

## Process notes (loop self-improvement)

Captured as the loop matures — not directives for the next iteration (those live in the prompt), but lessons learned worth carrying forward.

- **Smoke-test preflight** added between iterations 1 and 2: ~30s `curl` of the live demo to confirm 200 + latest version banner before drilling into code. Catches deploy regressions before they compound across iterations.
- **Coverage matrix** added between iterations 1 and 2: rotation slot picking is now matrix-driven (prefer un-covered slots) rather than random.
- **Stop condition refined** between iterations 1 and 2: was "last 2 iterations with no findings"; now "every rotation slot covered at least once AND last 3 iterations produced no new findings." Less trigger-happy.
- **Iteration cap dropped** between iterations 1 and 2 (was ~12). Royce explicitly asked for "go as long as needed until you've improved everything as much as possible."

---

## Reference: Melbourne VIC labour program

Royce shared `2025 VIC Construction  Labour Program V1 .xlsm` as the upper-scale reference point — "about as large as we could ever hope to facilitate a solution for." Key data extracted (read-only inspection, no edits):

| Metric | Value |
|---|---|
| Total people in VIC ele construction | ~577 |
| Direct employees | ~350 |
| FT tradespeople | 398 |
| FT apprentices | 52 |
| Labour Hire apprentices | 116 |
| Forward forecast horizon | ~52 weeks (weekly columns) |
| Largest single-project headcount | 345 (Airtrunk Shell) |
| Apprentice year levels tracked | 1st–6th (not 1st–4th) |
| Apprentice training orgs | 7+ (NECA, Yanda, AGA, MAG, G-Force, MAXIM, Frontline) |
| Employment-type variants | 7+ (FT, PT, Casual, FT Apprentice, LH Apprentice, FT Apprentice On Loan, LH) |
| Master sheet dimensions | 660 rows × 614 cols (project × week × type matrix) |

**Pattern**: Melbourne treats labour as a **forecast problem**, not just a current-week roster problem. Their primary view is "where will my 577 people be deployed across 12 active projects over the next 12 months?" — EQ Field today answers "where are they this week?". That gap (forecast horizon, project hierarchy above sites, headcount roll-ups) is the single biggest enterprise feature missing.


## Tier analysis — initial entries (informed by Melbourne reference)

Format: **Tier · Effort · Title** — rationale.

### Enterprise (200–600 people, multi-project, multi-region)

- **Enterprise · L · Project hierarchy above sites** — Melbourne tracks per-project headcount across 52 weeks; EQ Field has flat site abbreviations. A `project` entity that groups sites + carries weekly headcount targets is the centre of gravity for enterprise. Without it the forecast view has no "what should this look like" anchor.
- **Enterprise · L · 52-week forward forecast view** — Melbourne's VIC LABOUR FORECAST sheet is project × week → required headcount, 52 weeks wide. The current EQ Field weekly editor doesn't compose into a horizon view. Needs a new screen + aggregation queries (weekly totals per project per state).
- **Enterprise · M · Employment-type modelling beyond `group`** — today `people.group` is one of Direct/Apprentice/Labour Hire (3 values). Melbourne uses 7+ types (FT, PT, Casual, FT Apprentice, LH Apprentice, FT Apprentice On Loan, LH). Add `employment_type` as a separate column from group; group becomes "what they do" and employment_type becomes "how they're engaged".
- **Enterprise · S · Apprentice training org (GTO/RTO) field** — Melbourne tracks NECA / Yanda / AGA / G-Force / MAG / MAXIM / Frontline per apprentice (the WORKING SHEET RTO column). One nullable text/enum field on `people`. Compliance reporting needs it.
- **Enterprise · M · Apprentice ratio compliance widget** — APP NO's sheet tracks weekly apprentice-to-tradesperson ratio (e.g. 3.5:1 means 3.5 trades per apprentice — well within Australian state rules). State rules vary (typically 1:3 in NSW for electrical). Needs a per-week, per-region computation + alert when below threshold.
- **Enterprise · M · Aggregate roll-up dashboards** — VIC ELE sheet has a left-rail "totals" stack (398 FT, 52 FT App, etc.). EQ Field has the dashboard but not these specific roll-ups. Add: totals by employment type × week, totals by project × week.
- **Enterprise · L · Multi-region within one tenant** — Melbourne is one state. SKS has NSW, VIC, presumably others. Today: separate Supabase project per tenant. Enterprise wants regions WITHIN a tenant (NSW + VIC + QLD as siblings under one SKS Group org). Schema: add `region_id` FK on `people` + `sites`; RLS policies extended; UI for region switcher. Big change.
- **Enterprise · M · Render performance at 500+ people** — current editor grid renders one row per person × 7 days. At 577 people that's ~4,000 cells in DOM at once. Slow on Safari/iPad. Needs virtual scrolling or pagination by group/site.
- **Enterprise · M · Print/PDF labour program export** — Melbourne distributes the program as a printed sheet. EQ has print CSS for the roster but not a multi-page labour-program layout.

### Mid-market bridge (50–200 people)

- **Mid · M · Filtering UX on the editor** — at 50+ people the editor scroll gets long. Needs persistent group/site filters up top + a search box that highlights matching rows. Not a new feature so much as a UX polish on existing data.
- **Mid · S · "Hire Company" as a first-class field** — today `people.agency` exists but is free-text. Melbourne's matrix has dedicated Hire Company columns. Promote agency from free-text to enum-with-typeahead so labour-hire reporting groups cleanly.
- **Mid · S · Roster bulk-paste from clipboard** — Melbourne workflow includes copying blocks from one week to another via Excel. EQ has "Copy Last Week" but not arbitrary bulk paste from clipboard. Useful at any size; matters more at 100+.

### SMB (5–50, EQ Field's current sweet spot)

- **SMB · S · Top-of-page "supervisors editing this week" indicator** — pairs with v3.4.47 presence. Shows you the count + names of other supervisors actively editing the current week without having to spot the cell-level outlines. Cheap addition.
- **SMB · M · "Save week as template" / "apply template"** — extends Copy Last Week. For repeating site assignments (e.g. "this is a NEXTDC week, fill from the NEXTDC template"). Tier-agnostic but earns its keep at 30+ people.

### Starter (1–10 people)

- **Starter · M · Self-serve onboarding** — today setting up a tenant requires manual Supabase project creation. Starter tier needs a sign-up flow that provisions per-tenant Supabase storage automatically. Without this, Starter pricing isn't viable.
- **Starter · S · Hide BETA / DO NOT USE tabs by default** — small teams shouldn't see Apprentices BETA, Job Numbers BETA, Trial Dashboard NEW. Behind a Settings → Advanced toggle.
- **Starter · S · Default-collapsed Leave/Timesheets** — first-load surface should be Roster + Contacts + Sites only. Leave/Timesheets surface when explicitly enabled. Reduces "what does all this do" friction for solo operators.

### Cross-cutting (any tier — bridge features)

- **Any · M · Magic-link approve from email** — already chipped in `mcp__ccd_session__spawn_task`. Removes the "open the app to approve a leave request" friction. Auth-surface change → needs Royce sign-off before deploying to either tenant.
- **Any · S · Realtime reconnect jitter (finding #7)** — latent at SMB scale, real at enterprise. Math.random() * delay * 0.3 in `_rtScheduleReconnect`.

