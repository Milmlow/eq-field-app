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


