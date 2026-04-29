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


