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
| `supabase/functions/tafe-weekly-fill/index.ts`  | ✓    | Pass 4 — 4 findings (#13-16, all 🟡/🟢) |
| `scripts/leave.js`                              | ✓    | Pass 5 — findings #17-19 (XSS gap fix)  |
| `scripts/roster.js`                             | ✓    | Pass 6 — findings #20-21 (fillWeek fix) |
| `scripts/people.js`                             | ✓    | Pass 9 — findings #27 (id-coerc + idem), #29 |
| `scripts/managers.js`                           | ✓    | Pass 7 — findings #22 (id-coercion fix), #23 |
| `scripts/supabase.js` (sbFetch wrapper, CAS)    | ✓    | Pass 3 — findings #10, #11 (meta), #12  |
| `scripts/audit.js`                              | ✓    | Pass 10 — findings #30-35 (forensics gaps) |
| `scripts/digest-settings.js`                    | ✓    | Pass 11 — findings #36-39 (race fix)    |
| `sw.js` (PRECACHE list, network-first logic)    | ✓    | Pass 12 — findings #40 (cache-error), #41, #42 |
| `scripts/auth.js` (PIN flow, session token)     |      |                                          |
| Supabase MCP runtime sweep — `roster_presence`  | ✓    | Pass 8 — clean (0 rows, finding #26)    |
| Supabase MCP runtime sweep — `audit_log`        | ✓    | Pass 8 — finding #24 (dup archive entry)|
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


---

## Pass 3 — `scripts/supabase.js` review (iteration 2 of loop)

### 🔴 10. Offline banner suppressed for EQ tenant · 🔧 fixed in v3.4.50
**Where**: `scripts/supabase.js` `updateOnlineStatus` line 265.
**Symptom**: Same gate-class as #9. `if (TENANT.ORG_SLUG === 'eq' || TENANT.ORG_SLUG === 'demo') { banner.classList.remove('show'); return; }`. EQ tenant DOES write to Supabase (audit log, presence, schedule, leave requests via saveCellToSB) — those writes silently failing without a banner means an EQ user editing offline has no idea their queue is filling up.
**Fix**: Drop `'eq'` from the gate; keep `'demo'` (genuinely has no Supabase per the loadTenantConfig short-circuit).

### 🟠 11. META-FINDING: EQ tenant is a SEED-demo, not a Supabase-backed tenant · 📝 surfaced for design doc
**Where**: `index.html:1810` (`loadFromSupabase` short-circuit), `scripts/auth.js:23,245,454` (auth gates), `scripts/digest-settings.js:129` (digest fresh-fetch skip), historic gates we've already lifted (`startRealtime` v3.4.47, `startPolling` v3.4.49, `updateOnlineStatus` v3.4.50).
**What's actually happening**: The EQ tenant has a configured Supabase project (`ktmjmdzqrogauaevbktn`), and writes DO go there (saveCellToSB, presence upserts, audit_log inserts). But the main READ path — `loadFromSupabase` at `index.html:1810` — short-circuits to in-memory `SEED.people / SEED.sites / SEED.schedule / SEED.managers` for both 'eq' AND 'demo' tenants. So EQ tenant users see the same fixed cast every page load, regardless of what's stored. EQ Supabase is effectively a write-only sink: data goes in, nobody reads it back.
**Why it works as a "live demo"**: Presence (v3.4.47) and audit logging still function because they operate ON TOP OF the SEED render — two prospects loading the same SEED simultaneously share cell coordinates, so presence outlines render correctly. The audit log captures "who did what" even though the data they touched gets re-seeded on next load.
**Implication for v3.4.49 (polling fix)**: lifting `'eq'` from the polling gate causes `refreshData(true)` → `loadFromSupabase` → SEED re-map → `renderCurrentPage` every 30s. Idempotent — no flicker, no data change — just wasted CPU on idle EQ tabs. NOT reverting because if EQ ever transitions to a real Supabase-backed tenant, polling becomes useful immediately. Forward-compatible cost.
**Implication for v3.4.49 migration**: `migrations/2026-04-30_eq_realtime_publication.sql` is also moot for the EQ tenant in its current SEED-demo shape — adding `schedule` + `leave_requests` to the publication doesn't help if EQ doesn't load schedule/leave_requests from Supabase. But the migration is still RIGHT — when EQ transitions to real-data, those tables need to be in the publication. Apply it on return; leave the gate-lift in place.
**The design question** (for tomorrow's design doc): Is the EQ tenant intentionally a SEED demo (Starter-tier "try it now" front-door, no real persistence required), or is it transitional state meant to become a real Supabase-backed tenant? That decision shapes:
  - Whether the Starter tier IS this SEED-demo model (just rebrand it as "Starter")
  - Whether to add a "Promote to real tenant" flow that flips the SEED short-circuit off and migrates writes
  - Whether to keep 6+ EQ-specific gates scattered across the codebase (auth, gate dropdown, digest, load path) or consolidate them behind a single `TENANT.IS_SEED_DEMO` flag

This is the highest-leverage open question for the morning. Adding to the design doc Section 7 (Open questions).

### 🟢 12. Six places treat 'eq' as 'demo' — pattern, not always a bug · 📝 documented
**Locations**: `scripts/auth.js:23` (gate dropdown source), `scripts/auth.js:245` (login flow accepts 'demo'/'demo1234' for both tenants), `scripts/auth.js:454` (`isDemo = eq || demo` for manager-password short-circuit), `scripts/digest-settings.js:129` (skip fresh fetch), `index.html:1810` (loadFromSupabase short-circuit), and the three we've already lifted.
**Audit verdict**:
  - `auth.js:23, 245, 454` — INTENTIONAL given EQ's SEED-demo nature. Lifting these would break the "anyone can try the demo with PIN 'demo'/'demo1234'" front-door.
  - `digest-settings.js:129` — INTENTIONAL. SEED `STATE.managers` IS the truth for EQ; fresh fetch from Supabase would surface stale write-only-sink data.
  - `index.html:1810` — INTENTIONAL by design. This is the SEED short-circuit itself.
  - Already-lifted gates: `startRealtime` (v3.4.47), `startPolling` (v3.4.49), `updateOnlineStatus` (v3.4.50) — all CORRECT to lift, since presence/polling/offline-warning work even on a SEED demo when writes go to a real Supabase.

So the codebase pattern is healthier than it looked at first read — there ARE intentional gates for the SEED-demo behaviour and there ARE accidentally-extended gates for things like polling/realtime/offline that should never have been gated. The remaining 4 gates (auth + digest + loadFromSupabase) are intentional and should stay until/unless Royce decides EQ transitions to a real tenant.

---

## Pass 4 — `supabase/functions/tafe-weekly-fill/index.ts` review (iteration 3)

### 🟡 13. Misleading comment claimed a fallback that doesn't exist · 🔧 fixed (comment-only)
**Where**: `supabase/functions/tafe-weekly-fill/index.ts` line 108 (now corrected).
**Symptom**: Comment said "(per-org, falls back to project-wide row if none for org)" but the code is strict per-org with no fallback. For tenants without their own `app_config.tafe_holidays` row (e.g. EQ tenant — see #14), `holidays = []` and no school-holiday days are skipped. Future devs would read the comment, trust it, and miss this. Comment now matches behaviour.
**Why no version bump**: source-only doc change; the deployed Edge Function's behaviour is unchanged. Will be reflected next time the function is re-deployed (no urgency).

### 🟡 14. EQ Supabase has no `tafe_holidays` row; client-loader vs Edge Function inconsistency · 📝 documented
**Where**: EQ Supabase project `ktmjmdzqrogauaevbktn`, plus `scripts/tafe.js` `loadTafeHolidays` vs the function above.
**Discovered**: The seed migration `2026-04-16_tafe_day_and_holidays.sql` only INSERTs one row scoped to `org_id = '1eb831f9-aeae-4e57-b49e-9681e8f51e15'` (SKS). EQ Supabase had the migration applied (per the migration header note) but received no row.
**Symptom 1 (Edge Function)**: For the EQ tenant, the Sunday cron has `holidays = []` and would happily fill TAFE on every weekday, including the Autumn / Winter / Spring / Summer school holiday ranges. Effectively-moot today because EQ runs in SEED-demo mode (finding #11) so the cron's writes go to a sink nobody reads. But the future-state when EQ becomes a real tenant needs a holiday seed.
**Symptom 2 (client-loader inconsistency)**: `scripts/tafe.js loadTafeHolidays` calls `sbFetch('app_config?key=eq.tafe_holidays&select=value')` with NO `org_id` filter (because `app_config` isn't in `ORG_TABLES` so sbFetch doesn't auto-stamp). On the EQ tenant this returns the SKS row (or any row) instead of empty. So the manual "Apply TAFE Day" button on EQ tenant uses NSW school holidays (the SKS row's data) — not by intent, but by accident of the client-side org_id behaviour.
**Severity**: 🟡 latent — only matters once EQ becomes a real tenant. Then the manual button and the cron disagree about what counts as a holiday, which is bad. **Why deferred**: requires either (a) fixing the client loader to filter by org_id (which then makes EQ holidays empty until seeded), (b) seeding EQ with NSW holidays, or (c) deciding holidays are project/region-level not org-level. Tied to the EQ-as-SEED-demo decision (#11).

### 🟢 15. Manual `trigger_tafe_weekly_fill()` always fills NEXT week · 📝 documented
**Where**: `supabase/functions/tafe-weekly-fill/index.ts` `nextMondayKey()` (lines 49-53).
**Symptom**: `nextMondayKey(now)` always returns "Monday-of-this-week + 7 days." If a manager runs `SELECT public.trigger_tafe_weekly_fill();` on Monday afternoon to fill TODAY's week, they instead get NEXT Monday's week. Counterintuitive but consistent — the function is named `tafe-weekly-fill` after all and the Sunday cron's intent is "fill the upcoming week." A user wanting the current week passes an explicit `p_week`.
**Severity**: 🟢 UX nit. Documented in the function README and migration but worth surfacing in the doc here.

### 🟢 16. EQ Supabase will run the cron against a SEED-demo sink · 📝 documented
**Where**: pg_cron schedule on EQ Supabase project `ktmjmdzqrogauaevbktn`.
**Symptom**: Every Sunday 06:00 UTC, EQ's pg_cron will fire the Edge Function which writes TAFE rows + audit_log entries that nobody reads (per finding #11). Wasted cycles but harmless. Could disable the cron on EQ Supabase but the cost is negligible (~5 row writes / week / 0 reads). Decision tied to #11 — if EQ stays a SEED demo, disable the EQ cron; if EQ transitions to a real tenant, leave it on and seed `tafe_holidays`.


---

## Pass 5 — `scripts/leave.js` triggerLeaveEmail review (iteration 4)

### 🟡 17. Leave email body had defensive XSS gap on leave_type + status · 🔧 fixed in v3.4.51
**Where**: `scripts/leave.js` `triggerLeaveEmail` (lines 734-843).
**Symptom**: Three template-string interpolations passed user-controlled DB fields into the HTML email body without escaping:
  - `${typeLabels[record.leave_type] || record.leave_type}` — typeLabels lookup is hardcoded and safe, but the `|| raw` fallback path emits raw `record.leave_type` from the DB
  - `${record.status}` (line 783)
  - `${record.status.toLowerCase()}` (line 787)
A user with the published anon key (visible in `scripts/app-state.js`) could insert a leave_request with `leave_type = '<img onerror="…">'` or similar; the supervisor receiving the email would render that string in their email client.
**Real-world risk**: low. Modern clients (Gmail / Outlook / Apple Mail) strip `<script>` tags from rendered HTML. But on* handlers on `<img>`, `<a>`, `<iframe>` etc. are not always stripped, depending on client. The defence is cheap; the principle is "don't ship raw user data into HTML even via an email roundtrip."
**Fix**: defined `safeTypeFallback`, `safeStatus`, `safeStatusLower` local helpers at the top of the function and substituted them in the HTML template. Subject lines kept plaintext — Resend handles MIME header encoding, and escaping subject would visibly mangle legitimate ampersands.
**Behaviour preservation**: typeLabels[record.leave_type] returns a hardcoded string for valid input (99.9% case) — the lookup result still flows through unescaped because it can't contain unsafe chars. Only the rare fallback path is now defensive.

### 🟡 18. Leave email subject leaks raw fields too · 📝 documented
**Where**: `scripts/leave.js` lines 747, 780, 804 (subject construction).
**Symptom**: Subjects use `${record.requester_name}`, `${record.leave_type}`, `${record.status}` raw without escaping. Subjects are plaintext (Resend handles MIME encoding) so this isn't an XSS vector. But a maliciously-crafted name could break subject formatting (newlines, control chars) — Resend probably strips these but not verified.
**Severity**: 🟡 latent. Not exploitable as XSS. Logged for completeness.

### 🟢 19. Email error toasts may leak the recipient address · 📝 documented
**Where**: `scripts/leave.js` line 837: `showToast('Email failed: ' + (data.message || JSON.stringify(data)));`.
**Symptom**: If the Resend / send-email function returns an error response containing the recipient email in the error body, the UI toast displays it. Information leak only at the supervisor's screen — they're allowed to see it. Cosmetic.


---

## Pass 6 — `scripts/roster.js` review (iteration 5)

### 🟡 20. fillWeek diverged from updateCell on four post-write behaviours · 🔧 fixed in v3.4.52
**Where**: `scripts/roster.js` `fillWeek` (line 298).
**Symptom**: The "⇒wk" Fill Mon-Fri button creates a new schedule entry (when none exists for this person/week) and copies Monday's value across Tue-Fri. Compared to the cell-by-cell `updateCell` path:
  1. **scheduleIndex not seeded** — new entries pushed to `STATE.schedule` but not added to `STATE.scheduleIndex`. The index is used elsewhere for O(1) lookups (e.g. realtime live-merge, presence rendering). Brand-new-person fillWeek would leave a `STATE.schedule` row that's invisible to index consumers until a full refresh.
  2. **updateTopStats not called** — top-of-page badges (X active / Y on leave / Z total) go stale until next render trigger.
  3. **No cross-page render** — editor → roster/dashboard navigation right after a fill shows yesterday's data until something else triggers a refresh.
  4. **No auditLog entry** — manual cell edits get audited (`updateCell` line 382), but bulk fills weren't logged. Compliance/forensics gap.
**Fix**: aligned fillWeek's post-write block with updateCell — seed scheduleIndex on new entries, call updateTopStats(), re-render roster/dashboard if currently visible, write an audit entry (`Filled Mon–Fri with "VAL"`, category=Roster), bump updateLastUpdated.
**Behaviour preservation**: visual outcome is identical for the common case (user stays on editor after clicking Fill — editor re-renders the same way). Fixes only manifest when (a) it's a brand-new person without prior schedule, or (b) the user navigates away after the fill.

### 🟢 21. Editor renderEditor: input attribute coupling between roster.js and presence.js · 📝 documented
**Where**: `scripts/roster.js` `renderEditor` line 444+ (data attributes on `<input>`s); `scripts/presence.js` `_presenceRender` (CSS selector matching those attributes).
**Symptom**: presence.js builds a CSS selector `#editor-content input[data-name="${CSS.escape(pName)}"][data-week="${CSS.escape(pWeek)}"][data-day="${pDay}"]` that depends on roster.js emitting matching `data-name`, `data-week`, `data-day` attributes. If roster.js's emitter changes (renames data attributes, drops one), presence breaks silently — outline stops appearing without any error. No type system to catch this; only e2e testing or visual check would notice.
**Severity**: 🟢 cosmetic. Worth adding a comment in both files cross-referencing the contract, or extracting the attribute names to a shared const. Documented for future hardening.


---

## Pass 7 — `scripts/managers.js` review (iteration 6)

### 🔴 22. removeManager filter used strict `!==`, leaving ghost rows on SKS · 🔧 fixed in v3.4.53
**Where**: `scripts/managers.js` `removeManager` line 225.
**Symptom**: `STATE.managers = (STATE.managers || []).filter(m => m.id !== id);` — strict inequality. Same id-coercion bug class as v3.4.22 (saveManager edit path) and v3.4.38 (six leave handlers). On SKS, bigint ids from PostgREST sometimes come back as strings; comparing `101 !== "101"` is always true, so the filter keeps every row including the one being deleted. Manager gets removed from the DB via `deleteManagerFromSB` but lingers in the local supervisors list as a "ghost" until next page reload. Royce probably saw this intermittently on SKS without realising the cause.
**Fix**: `String(m.id) !== String(id)` — same coercion pattern used elsewhere.
**Why this got missed**: v3.4.22 caught all the `find()` callers, v3.4.38 caught the leave handlers. The remove-flow `filter()` is structurally different (negative match instead of positive) and didn't get swept. Lesson: future audits should grep for both `=== id` AND `!== id` when checking for the bug class.

### 🟡 23. saveManager newId computation NaNs for uuid tenants · 📝 documented
**Where**: `scripts/managers.js` `saveManager` line 186 — `const newId = Math.max(0, ...STATE.managers.map(x => x.id)) + 1;`.
**Symptom**: `Math.max` coerces its arguments via `Number(...)`. For numeric SEED ids (EQ today) and bigint string ids (SKS) this works. But if EQ ever transitions to a real tenant with uuid ids (`abc-123-def`), `Number("abc-123-def")` is `NaN`, `Math.max(...)` returns `NaN`, `newId` becomes `NaN`. The created mgr object has `id: NaN`. Subsequent `saveManagerToSB` triggers `_upsertById` which detects this isn't a real DB id (NaN fails the regex) and POSTs a fresh row, the DB-assigned uuid gets written back to entity.id. So end-state correct — but during the brief in-memory window between push and POST, the row has id=NaN.
**Severity**: 🟡 latent. Manifests only on uuid tenants (which is the future-state EQ if it transitions per #11). Quick fix: filter the .map() result to only numeric / coercible ids before Math.max, or simpler — generate temp ids as `temp-${Date.now()}-${Math.random()}` and let `_upsertById` swap them out. Tied to #11 SEED-vs-real decision.


---

## Pass 8 — Supabase MCP runtime sweep + leave handler guard (iteration 7)

### 🔴 24. Duplicate audit-log entries from double-tap on archive · 🔧 fixed in v3.4.54
**Where**: EQ Supabase `audit_log` (read-only sweep), bug in `scripts/leave.js` archiveLeaveRequest, unarchiveLeaveRequest, respondLeave.
**Discovered via**: Runtime sweep against `audit_log` showed two "Archived leave: Casey Williams A/L" rows 686ms apart on 2026-04-27 (Demo Supervisor, ids `e12278a3…` and `d7f38e17…`). Classic iPad double-tap pattern.
**Symptom**: None of the three leave-mutating handlers have a double-click guard. Effects:
  - archive/unarchive: duplicate audit entries, otherwise idempotent server-side. Misleading audit trail.
  - **respondLeave: each click fires a separate PATCH AND triggers a separate email** to the requester via `triggerLeaveEmail('status_update', ...)`. Two emails saying "your leave was approved" — confusing and trust-eroding.
**Fix**: per-id inflight `Set` (`_leaveInflight`) at module level, shared across all three handlers. Each handler adds the leave id on entry, deletes on `finally`. The second concurrent click on the same leave row is silently ignored. Different leaves can still be actioned in parallel. Bonus: `archiveLeaveRequest` now early-returns if `req.archived === true` (already archived); `unarchiveLeaveRequest` early-returns if `req.archived !== true` (already not archived).

### 🟢 25. Audit-log ordering at minute resolution · 📝 documented
**Where**: query results from runtime sweep.
**Symptom**: `to_char(created_at, 'YYYY-MM-DD HH24:MI')` truncates at the minute boundary. Two events created within the same minute show up out-of-order in the list, since they sort by truncated string. Cosmetic — the underlying timestamps are millisecond-precise (verified separately with `.MS` formatting). Audit-log UI in the app should display sub-minute precision when entries cluster, or sort by raw `created_at` not the formatted string.

### 🟢 26. Runtime sweep — no other anomalies · 📝 documented
- `roster_presence`: 0 rows. Either pg_cron cleanup is working, or no one's been editing recently. Either way fine.
- `audit_log`: 43 total, 1 in last 24h, 0 "TAFE Auto-Fill" entries. The cron is scheduled for Sun 06:00 UTC; today's Wednesday so 0 firings is expected.
- `schedule`: 18 rows, 0 in last 24h, no duplicates (UNIQUE constraint holding). Recent v3.4.47 presence work didn't leave artifacts here — consistent with finding #11 (EQ tenant runs in SEED-demo mode so the schedule writes go to a sink).


---

## Pass 9 — `scripts/people.js` removePerson review (iteration 8)

### 🔴 27. removePerson filter used strict `!==` · 🔧 fixed in v3.4.55
**Where**: `scripts/people.js` `removePerson` line 281.
**Symptom**: Same id-coercion bug class as #22 (managers.removeManager) and the v3.4.22 / v3.4.38 sweeps. `STATE.people.filter(p => p.id !== id)` against SKS bigint ids that PostgREST sometimes returns as strings → `100 !== "100"` is always true → filter keeps everything → person deleted from DB but lingers locally as a "ghost" until next page reload. Silent UX bug.
**Fix**: see #28 — the elegant idempotency check fixes this and #28 in one line.

### 🔴 28. removePerson had no double-tap idempotency guard · 🔧 fixed in v3.4.55
**Where**: `scripts/people.js` `removePerson` (whole function).
**Symptom**: Same class as #24 (leave handlers). A double-tap on ✕ would call removePerson twice. Effects on the second call:
  - Filters STATE.people / STATE.schedule again (idempotent — first call already removed)
  - showToast('X removed') fires twice (UX confusion)
  - **auditLog fires twice** — duplicate forensics entry
  - deletePersonFromSB + sbFetch DELETE schedule both fire twice — server-side no-ops (200/204 even when zero rows match), but unnecessary network traffic
**Fix**: early-return if the person is already gone from STATE.people:
```js
if (!STATE.people.some(p => String(p.id) === String(id))) return;
```
The `some()` check uses String() coercion (fixes #27) and naturally short-circuits the second tap. The subsequent .filter() also gets String() coercion. Two bugs, one fix.
**Pattern lesson**: idempotency-via-state-check is cleaner than per-id inflight Sets when the action is purely local + fire-and-forget DB. Use this pattern for removeManager (currently uses just String() coercion without idempotency check — could double-fire audit/toast on iPad). Future cleanup.

### 🟡 29. Schedule table keyed by name not by person_id · 📝 documented
**Where**: `STATE.schedule` rows + `schedule` table — primary identity is `(name, week, org_id)`.
**Symptom**: Two people with the same name (e.g. two "John Smiths" in a 100-person org) can't coexist in the schedule data model. Saving a roster cell for "John Smith" overwrites whichever John Smith was there first; no way to disambiguate. Royce's roster is small enough today that name collisions are unlikely (he'd notice), but at Melbourne scale (~577 people, almost certainly multiple Andrew/James/Michael etc.) the architecture forces a workaround like name-suffixes ("John Smith (Apprentice)").
**Severity**: 🟡 long-standing architectural decision, not a fix-tonight bug. Surfaced for the design doc as a real gap before scaling to enterprise. The proper fix is foreign-key the schedule rows to `people.id`, not match by name. That's a non-trivial migration but unblocks the namesake case + lets renames not require schedule rewrites. Tied to the broader data-model expansion (projects + employment_type + region) in the Melbourne-scale design.


---

## Pass 10 — `scripts/audit.js` review (iteration 9)

### 🟡 30. auditLog write was silently swallowing all errors · 🔧 fixed in v3.4.56
**Where**: `scripts/audit.js` `auditLog` line 22.
**Symptom**: `sbFetch('audit_log', 'POST', entry, 'return=minimal').catch(() => {})`. Empty no-op catch hides ALL errors — network blips (expected), RLS rejections (latent misconfig), schema drift (deploy-time issue), validation errors (data shape change). For a forensics log this is dangerous: if writes start failing for any reason, audit entries stop being recorded with zero signal. The "we logged everything" compliance claim becomes silently false.
**Fix**: `.catch(e => console.warn('EQ[audit] write failed:', e && e.message || e))`. Still fire-and-forget (UI never blocks on audit), still non-fatal, but failures are observable in DevTools. Future hardening: also push to a localStorage failure queue + retry on next page load — but the console.warn is the cheapest first step.

### 🟢 31. Hard 500-row read limit, no pagination · 📝 documented
**Where**: `scripts/audit.js` `openAuditLog` line 34.
**Symptom**: `sbFetch('audit_log?select=*&order=created_at.desc&limit=500')`. The modal shows the most-recent 500 entries; older ones are unreachable from the UI. SMB scale fine (500 entries spans days/weeks). At Melbourne scale (~577 people, multiple supervisors, daily roster + leave + timesheet activity) 500 entries is a single morning. **Tier-relevant — Enterprise · S · audit log pagination + date filter** added to the Tier analysis section.

### 🟢 32. toLocaleDateString grouping uses browser locale not tenant timezone · 📝 documented
**Where**: `scripts/audit.js` `renderAuditLog` line 80.
**Symptom**: `d.toLocaleDateString('en-AU', {…})` formats per the user's browser locale + timezone. An audit entry created at 23:30 NSW time would group on Wednesday for someone in NSW, but on Thursday for someone in WA (which is 21:30 their time → still Wednesday actually, OK timezone is the issue not date). More likely scenario: late-night events near midnight grouping inconsistently across users in different states. Cosmetic for SMB; visible inconsistency at multi-region enterprise scale. Real fix needs a tenant-level timezone setting.

### 🟢 33+35. CSV export non-portable + missing ID · 🔧 fixed in v3.4.56
**Where**: `scripts/audit.js` `exportAuditCSV` line 115.
**Symptom**: Used `toLocaleString('en-AU')` for the timestamp column (ambiguous DD/MM/YYYY vs MM/DD/YYYY for international auditors, also viewer-locale dependent so two exports of the same data could differ). No `id` column — if an exported row needs investigation, no DB-level handle.
**Fix**: header is now `ID,Created At (UTC ISO),Manager,Category,Action,Detail,Week`. Timestamp uses `new Date(r.created_at).toISOString()` (always UTC, always sortable). Auditors and payroll integrators have something machine-readable. Also: every exported row is traceable back to its DB id.


### Tier-analysis entries from Pass 10 (audit.js)

- **Enterprise · S · Audit log pagination + date filter** — `openAuditLog` hard-caps at 500 rows. SMB scale fine (~days/weeks of activity). At Melbourne scale (~577 people, multi-supervisor, daily roster + leave + timesheet activity) 500 entries is a single morning. Need: paginated load (page=1,2,…), or date-range filter (default last 7 days, expand on demand). Not urgent at current SKS scale; surfaces as a real gap once seat count crosses ~150.
- **Enterprise · M · Tenant-level timezone setting** — both `renderAuditLog` grouping and the prior CSV export used the viewer's browser locale, so the same audit row "lives" on different dates for users in different timezones. A tenant has one canonical timezone (NSW for SKS, VIC for Melbourne); store it on the org record and use it for both display and export. Touches more than just audit.js — leave dates, schedule weeks, TAFE holiday windows would all benefit. Foundation feature for the multi-region tier.


---

## Pass 11 — `scripts/digest-settings.js` review (iteration 10)

### 🟡 36. toggleDigest optimistic-render races the PATCH · 🔧 fixed in v3.4.57
**Where**: `scripts/digest-settings.js` `toggleDigest` (lines 50-69 pre-fix).
**Symptom**: After the user clicks a digest checkbox, code did 1) optimistic STATE update 2) renderDigestPanel (which does a fresh DB fetch + repaint) 3) await PATCH. Step 2's fetch could complete BEFORE step 3's PATCH committed, so the panel painted with stale data and the checkbox visibly UNCHECKED for 50-200ms before the user's next interaction triggered a re-render. On a slow connection (Brave iOS, mobile data) the flicker could persist longer.
**Fix**: removed the immediate renderDigestPanel() call. The native `<input type="checkbox">` already shows the new state via default HTML behaviour after click — no JS re-render needed for the success case. The catch block keeps its renderDigestPanel call so the rollback DOES re-paint to undo the optimistic STATE change.

### 🟢 37. hydrateDigestOptIns silent catch could regress digest preferences · 📝 documented
**Where**: `scripts/digest-settings.js` `hydrateDigestOptIns` lines 32-37.
**Symptom**: On any sbFetch error (RLS rejection, network blip, schema migration not applied), the catch block defaults `m.digest_opt_in = true` for managers where it's currently `undefined`. Comment says this is graceful migration handling, but the same path triggers on transient errors too. Risk is narrow (only managers with `undefined` get reset; once `false` is loaded once, it sticks). Future hardening: add console.warn so transient failures are observable, mirroring the v3.4.56 change to auditLog write.

### 🟢 38. installWrap + hydrate polling degrade silently after 5-10s · 📝 documented
**Where**: `scripts/digest-settings.js` `document.addEventListener('DOMContentLoaded', ...)` lines 174-195.
**Symptom**: Two `setInterval` polling loops — one for managers.js to define `renderManagers`, one for STATE.managers to populate. Both stop silently after a fixed number of tries (20 / 40) if the dependency never appears. If managers.js fails to load (CDN issue, syntax error in upstream file, etc.), the digest panel never renders and there's no diagnostic. Future hardening: console.warn on timeout. Cosmetic at current scale.

### 🟢 39. m.id interpolated raw into onchange handler — defensive XSS gap · 📝 documented
**Where**: `scripts/digest-settings.js` `_paintPanel` line 98.
**Symptom**: `onchange="toggleDigest('${m.id}', this.checked)"` interpolates m.id into a single-quoted JS string. m.id is uuid string / bigint / number in practice — none contain quotes or backslashes, so safe in current data shape. If a malicious actor ever managed to insert a managers row with `id` containing `'` or `\`, the JS would break or be exploitable. Deeply defensive (anon role typically can't write to managers.id). Document for the security review checklist.


---

## Pass 12 — `sw.js` review (iteration 11)

### 🔴 40. SW caches error responses → users stuck on cached errors · 🔧 fixed in v3.4.58
**Where**: `sw.js` both fetch handlers (cache-first for `/icons/`+`/manifest.json` lines 65-77; network-first for everything else lines 81-89, pre-fix).
**Symptom**: `cache.put(event.request, c)` was called for ANY response. A 404 / 500 / 503 returned during a partial Netlify deploy got persisted in the SW cache. Subsequent requests from THIS user with flaky network would serve the cached error from the catch fallback in network-first mode, OR cache-first mode would prefer the cached error indefinitely. User stuck on a broken page until the next successful fetch overwrote the cache entry. Particularly nasty during deploy windows where index.html briefly 404s while Netlify swaps assets.
**Fix**: wrap `cache.put` in `if (res.ok) { … }` — standard service-worker pattern. Successful responses still cache; errors flow through to the user but don't poison the cache.

### 🟡 41. PRECACHE addAll silent failure · 🔧 fixed in v3.4.58
**Where**: `sw.js` install handler `.catch(() => {})` line 44 (pre-fix).
**Symptom**: If any URL in PRECACHE fails to fetch during install (script 404 from deploy mismatch, network blip, CDN issue), the entire `addAll` promise rejects and the empty catch swallows the error. SW installs in a partially-cached state with no signal. Users may experience inconsistent offline behavior; admins have no visibility into the failure mode.
**Fix**: `.catch(e => console.warn('EQ[sw] PRECACHE addAll failed', e))`. Same pattern as v3.4.56's auditLog change. SW still installs on partial failure (partial cache > no cache for non-blocking files); failures are now observable in DevTools / browser console.

### 🟢 42. manifest.json cache-first → stale tenant branding · 📝 documented
**Where**: `sw.js` `CACHE_FIRST_PATHS = ['/manifest.json', '/icons/']` line 39.
**Symptom**: manifest.json is in cache-first set. If tenant branding changes (PWA name, theme color, icon refs), the cached manifest stays until the next cache-version bump (i.e. next code release). For static tenants (SKS, EQ today) this is fine. For multi-tenant onboarding where customers can change their own branding via Settings, manifest staleness becomes a real UX bug — they update the logo, see the change everywhere except the home-screen install. **Tier-relevant**: surfaces once self-serve branding lands. Two fixes possible: (a) move manifest.json out of CACHE_FIRST_PATHS to network-first (slower install but fresh), or (b) include a tenant-branding hash in the cache key so branding changes auto-invalidate. Defer to multi-tenant onboarding phase.

