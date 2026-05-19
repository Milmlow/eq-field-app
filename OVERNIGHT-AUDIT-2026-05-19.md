# Overnight audit — 2026-05-19

Review of four open PRs that landed overnight 2026-05-18 → 2026-05-19. Read-only audit; no code touched in the reviewed PRs. PR comments posted on each. Branch off `origin/demo` for the doc-only PR carrying this summary.

## TL;DR

| PR | Repo | Title | Verdict | Confidence |
|---|---|---|---|---|
| **#106** | eq-solutions/eq-field | v3.5.9 Phase 1.C Field-side handoff | **LGTM merge as-is** | High |
| **#107** | eq-solutions/eq-field | Doc hygiene pass | **Merge after fixing one placeholder** | High |
| **#1** | eq-solutions/eq-shell | Phase 1.B shell auth + iframe handoff | **Merge with minor fixes (8 should-fix, no critical)** | High |
| **#2** | eq-solutions/eq-shell | Phase 2 spike — Tender Pipeline routes | **Block until rebased / sequenced with #1** | High |

**Recommended merge order:**

1. **PR #106** first. Smallest blast radius; no-op until shell ships; gets v3.5.9 onto demo and the version-bump tuple locked.
2. **PR #107** next. Doc-only. Just replace the `PR # — fill in after merge` placeholder with `PR #2` before merging.
3. **PR #1 (eq-shell)** third. Address the should-fixes (especially `name = user.email` and the missing audit log), then merge. After merge, set the three required Netlify env vars on the `eq-shell` project (`EQ_SECRET_SALT` matching demo, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) and link Netlify to GitHub.
4. **PR #2 (eq-shell)** last, after rebase. The current diff conflicts with PR #1's rewrites to `src/App.tsx` and the CSS files. Rebase onto post-#1 main, drop the `App.tsx` rewrite, fold the new Tender Pipeline route into PR #1's existing `TenantTree`.

## Critical findings highlighted

### None blocking, but two worth knowing before flipping the switch

**1. `mint-iframe-token.ts:375` (PR #1) — `name: user.email` becomes the user's display name in EQ Field.**

The canonical `public.users` table has no `name` column (verified live on `eq-shell-control`). So a user logging into the shell will appear in Field as `test@eq.solutions` in:
- the topbar's "logged in as" pill
- leave form name prefill
- audit_log entries
- timesheets "submitted by"

**Fix options:** (a) add `users.name TEXT` in a follow-up migration; (b) one-line stopgap `user.email.split('@')[0]` in mint-iframe-token. The shell PR can ship without this fix — it's a UX bug, not a security or contract bug. But Royce should know before Phase 1.D smoke testing because the demo will look wrong.

**2. PR #2 vs PR #1 conflict + auth-bypass risk if order is wrong.**

PR #2 branched off main pre-Phase-1.B and rewrites `src/App.tsx` to a minimal router with NO auth (`SessionProvider`, `RequireSession`, login flow all absent — replaced with a `SpikeHome`). If PR #2 merges before PR #1, the shell deploy is unauthenticated. PR #2 should be rebased to NOT touch App.tsx and instead inject one Route into PR #1's existing `TenantTree`.

The PR body claims the two are "conceptually orthogonal." At the code level they are not — both rewrite the Vite-scaffold App.tsx differently.

## Cross-cutting issues

### HMAC contract — verified consistent across PR #1 and PR #106

This was the single highest-risk part of overnight work. Both sides match:

| Side | File | What it does |
|---|---|---|
| Sign (PR #1) | `eq-shell/netlify/functions/_shared/token.ts:264-268` | `base64(JSON.stringify(payload)) + '.' + hex(HMAC-SHA256(EQ_SECRET_SALT, JSON.stringify(payload)))` |
| Verify (PR #106) | `eq-field/netlify/functions/verify-pin.js:147-159` | Decodes `base64(payload)`, re-HMACs the raw decoded bytes, compares to provided sig |

Both sides hash the **transmitted JSON bytes** — not a re-stringified copy. So JSON key order on the producing side doesn't matter to validation. Token shape `{ kind: 'shell-token', name, role, exp }` matches the four checks PR #106 runs (`kind === 'shell-token'`, `typeof exp === 'number'`, `exp >= Date.now()`, both `name` and `role` truthy).

Canonical reference compared against: `eq-field/netlify/functions/verify-pin.js:117-123` (`signToken`). PR #1's `signShellToken` is the same shape with the addition of the `kind` discriminator.

### Env-var matrix

Required for the iframe handshake to work end-to-end:

| Variable | Netlify project | Value source | Status |
|---|---|---|---|
| `EQ_SECRET_SALT` | `eq-shell` | **Must match `eq-solves-field`'s value exactly** | Not set — Royce sets manually post-#1-merge |
| `SUPABASE_URL` | `eq-shell` | `https://hxwitoveffxhcgjvubbd.supabase.co` | Not set — Royce sets manually post-#1-merge |
| `SUPABASE_SERVICE_ROLE_KEY` | `eq-shell` | Supabase dashboard → Project settings → API keys | Not set — never readable via MCP, Royce sets manually |
| `EQ_SECRET_SALT` | `eq-solves-field` | (existing) | Already set in production |

**The handshake silently breaks if `EQ_SECRET_SALT` drifts between projects.** No log line will say "wrong salt" — the HMAC just doesn't validate and shell-token verify returns `{ valid: false }`. Worth a one-shot smoke test after env vars are set: visit `https://<tenant>.eq.solutions/<tenant>/field`, watch the iframe, confirm Field skips the gate. If the gate still appears with a console warn `"shell-token verify rejected"`, the salt drifted.

### Auth surface — net new surface area

Three new Netlify functions on `eq-shell`:
- `shell-login` — POST email + PIN — sets cookie (no rate limit, no audit log — gap flagged in PR #1 review)
- `verify-shell-session` — GET — reads cookie, returns user/tenant/entitlements
- `mint-iframe-token` — POST — 60s HMAC token in shape PR #106 validates

Plus one new action on `eq-field/verify-pin`:
- `verify-shell-token` — POST — swaps shell token for 7d Field session token

All five paths inherit the existing `EQ_SECRET_SALT` HMAC pattern. None of them is rate-limited yet (verify-pin's existing rate limit only applies to PIN-action calls). The brief flagged `shell-login` specifically as a follow-up. Same gap applies to all three new shell functions.

### Migration state on `eq-shell-control`

Verified via Supabase MCP (read-only):

| Migration | Status |
|---|---|
| `20260518133337_2026_05_18_canonical_schema_v1` | Applied |
| `20260518133433_2026_05_18_touch_updated_at_search_path` | Applied |
| `20260518135006_2026_05_18_phase_1b_pin_hash_and_service_role_policies` | Applied |

`public.users.pin_hash` column exists with the bcrypt comment. RLS enabled on all three canonical tables. Service-role-only policies in place. State matches what PR #1's body claims.

## Per-PR notes

### PR #106 — Phase 1.C Field-side (LGTM)

- Token-type confusion guard correct: `if (data.kind !== 'shell-token') return null;` rejects session tokens (no `kind`) and leave-action tokens.
- `_consumeShellToken()` clears hash via `history.replaceState` BEFORE the validation fetch — verified order in the diff. Even a bad token leaves no URL-bar trace.
- Backwards-compat verified: `if (!hash) return false;` early return = pure no-op on direct visits to `eq-solves-field.netlify.app`. Existing PIN gate, remember-me, staff TS, agency gates all run unchanged.
- Version-bump tuple complete: `index.html:20` cache-buster, banner block, `scripts/app-state.js:9` `APP_VERSION`, `sw.js:1-3` CACHE — all bumped to 3.5.9.

Confidence: **High.** Nothing in this PR is blocking.

### PR #107 — Doc hygiene (LGTM after one fix)

- Three files, zero code touched. Behaviour-preserving confirmed.
- One unresolved placeholder at `AUDIT-REVIEW.md:64`: `PR # — fill in after merge` should be `PR #2` (the Phase 2 spike PR exists).
- S1 / S2 closure entries are exemplary — phase-by-phase breakdown with PR numbers, dates, and net-effect numbers.
- `DEMO-VS-LIVE.md` snapshot reflects current HEAD (`7249833`) and APP_VERSION (`3.5.8` with `3.5.9` queued).

Confidence: **High.**

### PR #1 — Phase 1.B shell wire-up (Merge with fixes)

8 should-fix items, 0 critical:

1. `mint-iframe-token.ts:375` — `name: user.email` (UX bug)
2. `mint-iframe-token.ts:371` — role mapping collapses `'member'` → `'staff'` (document or expand)
3. `shell-login.ts` — no audit log on login attempts (visibility gap)
4. `token.ts:254` — `!==` instead of `timingSafeEqual` (same gap as verify-pin.js; not a regression)
5. `shell-login.ts:494` — `last_login_at` update awaits but errors not handled
6. `shell-login.ts:467` — leaks DB error message in 500 response body
7. `FieldIframe.tsx:41` — no `referrerPolicy`
8. `FieldIframe.tsx:43-44` — sandbox includes `allow-popups` (probably unnecessary)

What's good:
- HMAC contract matches PR #106 exactly
- Cookie attributes all correct (`Domain=.eq.solutions`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Max-Age=604800`)
- Defensive tenant_id check in verify-shell-session prevents stale-cookie tenant carry-over
- Lazy modules wired per Q5
- `pin_hash` stripped from responses
- Lazy Supabase client init with clear error
- `Cache-Control: no-store` on every function

Confidence: **High.** The core contract is correct; the should-fixes are quality-of-deploy, not correctness.

### PR #2 — Phase 2 spike (Block until rebased)

- Route shape correct: 5 stubs, each `React.lazy()`, each citing vanilla source location.
- Line ranges verified against `eq-field/scripts/tender-pipeline.js` (1929 lines): Import 276 / Kanban 542 / Enrichment 752 / Review 963 / Curve 1457 all map to the right `render*` / `openTenderPanel` function.
- Blocking issue: rewrites `src/App.tsx`, `src/App.css`, `src/index.css` in a way that conflicts with PR #1. The -395 deletions are the Vite scaffold being torn out for a SECOND time differently.
- Conceptual issue: Enrichment + Curve as standalone routes don't match the vanilla UX (slide-over panel + stateful confirm screen). Consider `/enrichment/:tenderId` or folding into Kanban.

Confidence: **High** that this PR shouldn't merge as-is. Rebase + scope-reduce.

## Recommended actions for Royce (morning)

1. **Fix PR #107 placeholder** — one-line edit: `PR # — fill in after merge` → `PR #2`. Then merge.
2. **Merge PR #106.** No changes needed.
3. **Decide on PR #1 should-fixes.** The two highest-impact:
   - The `name = user.email` UX bug (one-line stopgap in mint-iframe-token, or a follow-up migration to add `users.name`).
   - The missing audit log on `shell-login`. Even without rate limiting, getting failed-login spikes into `audit_log` is cheap and high-value.
   If you want to ship PR #1 fast: just the audit log; defer the rest. The other 6 should-fixes are paper cuts.
4. **After PR #1 merges:** set the three Netlify env vars on `eq-shell`, link Netlify to GitHub, kick off Phase 1.D smoke test.
5. **Tell the agent to rebase PR #2** onto post-#1 main and re-scope to just the new `src/modules/tender-pipeline/` tree + a single-line route addition to `TenantTree`.

## What I did not do

- Did not modify any source code in any of the four PRs (read-only audit per the brief).
- Did not merge or close anything.
- Did not change DNS, env vars, or any cloud resource.
- Did not write to Supabase (read-only MCP calls only — `list_migrations`, `list_tables`).
- Did not run any destructive git ops.

PR comments posted as `--comment` reviews (not `--approve` or `--request-changes`) on all four PRs. Comments are the only artifact left behind on the reviewed branches.
