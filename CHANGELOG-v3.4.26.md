# v3.4.26 — SKS go-live polish (2026-04-26)

Bundled fixes from the post-cutover review. None of these block SKS from operating but they're what Royce flagged after seeing v3.4.25 live.

---

## Database (already applied to SKS prod by Claude this session)

**Migration `sks_promote_part6_people_year_level`** — `ALTER TABLE public.people ADD COLUMN IF NOT EXISTS year_level smallint;` plus a backfill from existing `licence` text (`'1st Year'` → 1, `'2nd Year'` → 2, etc.). The original column was added on EQ demo by an early apprentice-profiles migration that never made it to SKS — without it, every `people` fetch with `year_level` in the select list 400'd with PGRST 42703 ("column does not exist"). Cascade was breaking the contacts grid on the Supervision page and the Add Person flow.

**Verification:**
```sql
-- col present, all 9 SKS apprentices backfilled with year_level 1..4
SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='people' AND column_name='year_level';
SELECT count(*) FROM public.people WHERE org_id='1eb831f9-aeae-4e57-b49e-9681e8f51e15' AND year_level IS NOT NULL;
-- → 9 of 9
```

---

## Frontend (in workspace, awaiting demo→main merge)

### `scripts/digest-settings.js` — Supervision digest opt-in checkbox no-op

Symptom: untick a supervisor's checkbox on the Supervision page → checkbox visually unticks → next render re-ticks it. Database never updated.

Root cause: same uuid-vs-bigint cluster as v3.4.22. SKS `managers.id` is `bigint` (number); the inline `onchange="toggleDigest('${m.id}', this.checked)"` template literal wraps the id in quotes so the handler receives a string `'17'`. Then `find(m => m.id === managerId)` strict-compares `17 === '17'` → false → handler bails silently. Optimistic UI update never happens, render replays from STATE.

Fix: `String()` coerce both sides in the find, and stringify keys in the bulk hydrate. EQ demo (uuid string ids) is unaffected either way; SKS is the one this rescues.

### `scripts/timesheets.js` — Incomplete timesheets red highlight

New rule per Royce: **complete = every Mon–Fri ≥ 8 hrs AND week total ≥ 40 hrs**. Anything less → row red. Drops the prior amber middle state.

Behavioural changes:
- Hours are the source of truth, not job-cell presence. A row with job numbers entered but no hrs now reads as red until the hrs are filled in. (Old logic looked at `_job` cells only.)
- The Total column gains a new `.ts-total-red` class. CSS injected at module load for forward-compat with base.css.

### `index.html` — Favicon, footer, copyright

- New SKS-branded favicons in `/icons/` (16, 32, 48, 192, 512, apple-touch-icon, multi-size .ico) — generated from `pub-97a4f025d993484e91b8f15a8c73084d.r2.dev/SKS_Logo_Colour_Arrows_Clean.png`, tight-cropped and padded to a square.
- Sidebar version stamp bumped to `v3.4.26`.
- Sidebar footer now carries a quiet copyright line: "© 2026 CDC Solutions Pty Ltd ATF Hexican Holdings Trust. All rights reserved. Proprietary & confidential — unauthorised use prohibited."

### `LICENSE.md` — Proprietary licence

Full proprietary terms at repo root: ownership, confidentiality, no-licence-by-distribution, NSW jurisdiction. Names CDC Solutions Pty Ltd ATF Hexican Holdings Trust as Owner.

### Source-file copyright headers

Single-line `/*! Copyright … */` stamp prepended to every `.js` in `scripts/`, the supervisor-digest edge function, and `sw.js`. Idempotent — won't double-stamp on re-run.

---

## Backend code — deployed this session

### `supervisor-digest-v2` — Resend rate-limit throttle (DEPLOYED to SKS)

The 2026-04-26 dry-run probe surfaced Resend's 2/sec free-tier limit: 6 of 15 sends got 429'd because the loop fired fast. Adds a 600ms sleep between live sends (`firstLiveSend` skips the first delay, `dryRun` skips entirely). Configurable via env `DIGEST_SEND_INTERVAL_MS`.

**What actually shipped:** The MCP `deploy_edge_function` repeatedly 500'd when redeploying to the existing `supervisor-digest` slug (something stuck on that specific function — fresh function names deploy fine). So Claude deployed the new code as `supervisor-digest-v2` and re-pointed `app_config.digest_fn_url` to that endpoint. The cron pulls the URL from app_config every fire, so next Friday's run automatically uses v2.

**Verified live on SKS:**
- v2 endpoint dry-run: 200 OK, 15/15 SKS managers, ts 73/87 (84%), no errors.
- Cron command (re-run as a probe with the live `digest_fn_url`): 200 OK against v2 for both `sks` and `demo` orgs.

**EQ demo project still needs the same deploy** — Claude only had MCP access to the SKS Supabase project. Run on demo when convenient:

```bash
supabase functions deploy supervisor-digest --project-ref <eq-demo-project-ref>
```

(Or just dashboard-deploy the workspace `index.ts` to demo.)

---

## Smoke tests run this session

| # | Canary | Result |
|---|---|---|
| 0 | year_level migration | ✅ column present, 9/9 apprentices backfilled |
| 1 | Footer shows current version | ✅ live SKS shows v3.4.25 (will flip to v3.4.26 after merge) |
| 3 | People dedupe (no dupes in current data) | ✅ 0 duplicate names per org on SKS |
| 4 | Schedule dedupe (no dupes in current data) | ✅ 0 duplicate (name, week) rows; timesheets also clean |
| 5 | Multi-day leave structure | ✅ 4 active approved multi-day request