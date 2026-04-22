# Promotion Plan — v3.4.9 + v3.4.16–18 to SKS Labour Prod

**Owner:** Royce Milmlow
**Source branch:** `demo` (eq-field-app, `ktmjmdzqrogauaevbktn`, eq-solves-field.netlify.app)
**Target branch:** `main` (same repo, `nspbmirochztcjijmcrx`, sks-nsw-labour.netlify.app)
**Status:** Demo features complete and verified (incl. post-v3.4.18 hardening on 2026-04-22). SKS promotion **not yet executed** — this doc is the playbook.

> **Hard rule:** Do not touch SKS Supabase (`nspbmirochztcjijmcrx`) until Royce explicitly says "SKS live".

---

## Scope change from the original plan

The original plan covered v3.4.16 → v3.4.18 only. On 2026-04-22 the schema diff confirmed SKS prod never received the **v3.4.9** supervisor-digest Supabase migrations (no `managers.digest_opt_in`, no `digest_cron_schedule`, no `trigger_supervisor_digest` fn). The v3.4.9 **edge function** had shipped but could not be fired on schedule without its cron. This promotion now bundles v3.4.9 so SKS receives the Friday digest for the first time alongside v3.4.16–18.

A second scope change: v3.4.18 shipped with a permissive RLS policy (anon/authenticated `SELECT`) and no caller-identity check. On 2026-04-22 both were hardened on EQ demo:

1. **RLS on `ts_reminders_sent`** is now **service_role only**. Clients learn `lastSentAt` from the edge function response, not from direct reads.
2. **`ts-reminder` edge function** now requires `sentBy` and rejects any value that is not a row in `public.managers` for the target org (shared anon JWT means no per-user claim to key off — `sentBy` + a managers-table lookup is the trust anchor).
3. **`ts_reminder_claim` RPC** (new) makes the cooldown check TOCTOU-safe via `pg_advisory_xact_lock(hash(org|person|week))` + a "pending" row pattern. Verified on EQ demo: 4 parallel reminder calls for the same key produce 1 send + 3 rate-limited.

All three are included in the consolidated migration below.

---

## What's being promoted

| Version | Feature | Shipped on `demo` | SKS status |
|---------|---------|-------------------|-----------|
| v3.4.9  | Supervisor digest (Friday 12:00 AEST): managers.digest_opt_in, pg_cron schedule, trigger_supervisor_digest() helper | 2026-04-19 | **Schema missing** — edge fn deployed but cron not scheduled |
| v3.4.16 | Birthdays + work anniversaries (people.dob_day/dob_month/start_date, dashboard widget, CSV columns) | 2026-04-21 | Missing |
| v3.4.17 | Timesheet completion clarity (progress bar, day-based row tint, supervisor digest enriched with per-name day counts) | 2026-04-21 | Missing (UI-only; no schema change) |
| v3.4.18 | Per-row "Send reminder" button + ts-reminder edge function + ts_reminders_sent audit table | 2026-04-21 | Missing |
| v3.4.18-hardening | Service-role-only RLS, manager-gate in edge function, TOCTOU-safe claim RPC | 2026-04-22 | Missing |

Five migrations consolidated into one idempotent bundle; one net-new edge function; one updated edge function (`supervisor-digest` to accept the richer `tsCompletion.missing` shape from v3.4.17 — backwards compatible).

---

## Pre-flight checks

Run these on the SKS app **before** starting the promotion:

1. Confirm current SKS Labour app version (footer on sks-nsw-labour.netlify.app).
   SKS `main` is at v3.4.9 source code; DB is at v3.4.8-era schema. This bundle brings both to v3.4.18.
2. Confirm `organisations` row exists for SKS:

   ```sql
   select id, slug, name from public.organisations where slug = 'sks';
   ```

3. Confirm `app_config` table exists **and** has the two digest rows the cron needs. If either row is missing, insert it before running the bundle (the bundle will raise a NOTICE but continue; the cron will 401 until fixed).

   ```sql
   -- expected: 2 rows
   select key from public.app_config where key in ('digest_fn_url', 'digest_fn_token');

   -- if missing, insert (replace <SKS-SERVICE-ROLE-JWT> with the real value):
   insert into public.app_config (key, value) values
     ('digest_fn_url',   'https://nspbmirochztcjijmcrx.supabase.co/functions/v1/supervisor-digest'),
     ('digest_fn_token', '<SKS-SERVICE-ROLE-JWT>')
   on conflict (key) do update set value = excluded.value;
   ```

4. Confirm Supabase project secrets present on SKS prod:

   - `RESEND_API_KEY` and `DIGEST_FROM_EMAIL` *or* `NETLIFY_SEND_EMAIL_URL` + `EQ_DIGEST_SECRET`
   - `DIGEST_TRANSPORT` (`resend` | `netlify`)
   - `APP_ORIGIN` (recommended `https://sks-nsw-labour.netlify.app`)
   - Optional: `REMIND_COOLDOWN_HOURS` (defaults to 12)

   Note on branding: Royce has confirmed the reminder and digest emails keep `DIGEST_FROM_EMAIL = "EQ Field <noreply@eq.solutions>"` on SKS prod as subtle EQ Solutions visibility through SKS staff inboxes. Only change if Royce says otherwise.

5. Confirm `managers` table has at least one row with `digest_opt_in = true` (after Block 1 applies — the column defaults to `true`, so existing managers are auto-subscribed) and a valid `email` — otherwise the digest send is silent.

6. Snapshot the SKS Supabase schema before starting:

   ```bash
   supabase db dump --project-ref nspbmirochztcjijmcrx --schema public > sks-pre-promote-$(date +%F).sql
   ```

---

## Step 1 — Apply consolidated migration

The full SQL lives in `migrations/SKS-PROMOTE-v3.4.9-plus-v3.4.16-18-BUNDLE.sql`. Apply it via the Supabase SQL editor, or via `psql` against the SKS connection string. It is idempotent — safe to re-run after a partial apply.

The bundle contains six blocks:

| Block | Purpose |
|-------|---------|
| 0 | Extensions (`pg_cron`, `pg_net`) + abort guard if `organisations (slug=sks)` is missing |
| 1 | v3.4.9 `managers.digest_opt_in` column + supporting indexes |
| 2 | v3.4.9 `supervisor-digest-weekly` cron schedule + `trigger_supervisor_digest()` helper fn |
| 3 | v3.4.16 `people.dob_day / dob_month / start_date` + constraints + indexes |
| 4 | v3.4.18 `ts_reminders_sent` table + **service_role-only RLS** (hardened) |
| 5 | v3.4.18-hardening `ts_reminder_claim(...)` RPC (TOCTOU-safe claim via advisory lock) |
| 6 | Six verification SELECTs (commented out — run them manually after) |

Run the verification block after applying. Expected results are inline in the file.

---

## Step 2 — Code merge (demo → main)

With source on one repo two branches (`Milmlow/eq-field-app` `demo` vs `main`), the promotion is a **branch merge**, not a cross-repo cherry-pick. However, SKS-specific plumbing (tenant slug, group aliases, no-analytics build) must be preserved — do not wholesale fast-forward `demo` onto `main`.

Open a PR `demo → main` and cherry-pick the diff per file:

| File | Action |
|------|--------|
| `scripts/app-state.js` | Bump `APP_VERSION = '3.4.18'`. Confirm `TENANT_SUPABASE.sks` is unchanged. SKS already has the group alias `SKS Direct ↔ Direct` plumbing. |
| `scripts/people.js` | Port the v3.4.16 DOB block: `MONTH_SHORT`, `personHasDob`, `_daysUntilMD`, `personBirthdayLabel`, `personIsBirthdayToday`, `personAnniversaryYearsToday`, `todayBadges(p)` and the modal field read/write in openAddPerson/editPerson/savePerson. Verify form field IDs match SKS markup before merging. |
| `scripts/dashboard.js` | Port `renderAnniversariesWidget()` and the early-return fix (call the widget on both branches). |
| `scripts/supabase.js` | Extend savePersonToSB and importPeopleToSB with `dob_day`, `dob_month`, `start_date`. |
| `scripts/import-export.js` | Add Birthday + StartDate columns to people / contacts CSV exports and import parser (`_fmtCsvBirthday`, `_parseCsvBirthday`). |
| `scripts/timesheets.js` | Port v3.4.17 row-tint rewrite (day-based) and `updateTsStats()` progress bar + popover. Port v3.4.18 `sendTsReminder()` and the per-row button in the popover render. |
| `index.html` | Add changelog header entries for v3.4.16/17/18. Add DOB selects + start_date input to person modal. Add `#dashboard-anniversaries` container. Add `#ts-progress-bar` container above `#ts-completion-tracker`. Bump footer version stamp. Update loadFromSupabase select+map to include `dob_day, dob_month, start_date`. |
| `sw.js` | Bump cache name to the SKS-tenant equivalent of `eq-field-v3.4.18` — keep the existing SKS cache prefix (check current `sw.js` on `main`; if it is `sks-labour-v…`, use `sks-labour-v3.4.18`). |
| `supabase/functions/supervisor-digest/index.ts` | Port the v3.4.17 `tsCompletion.missing` shape change (`Array<string \| { name, days }>`) and the `missingListHtml` renderer. **Backwards compatible** — older callers passing `string[]` still render correctly. |
| `supabase/functions/ts-reminder/index.ts` | Net-new — copy from `demo`. **Must include** the hardening: manager-gate check after org resolve, and the `ts_reminder_claim` RPC call in place of the in-function cooldown SELECT + insert. |

### Compatibility wrinkles to watch for

- **Group aliases:** SKS DB stores `SKS Direct`, UI shows `Direct`. `denormaliseGroupForDb()` is already wired through people writes — no action needed for v3.4.16 DOB fields. The timesheet popover row uses `STATE.people` (post-normalisation), so the reminder button passes the canonical name, which matches `people.name` in SKS DB (alias is on `group`, not `name`). ✅
- **Tenant slug:** the new `ts-reminder` function takes `orgSlug` from the request body. Front end passes `TENANT.ORG_SLUG`, which resolves to `'sks'` on sks-nsw-labour.netlify.app. ✅
- **Email transport:** `ts-reminder` reads the **same** `DIGEST_TRANSPORT` env as `supervisor-digest`. If SKS prod is configured for `netlify`, no change; if it is not configured at all, set `DIGEST_TRANSPORT=resend` + `RESEND_API_KEY` + `DIGEST_FROM_EMAIL`.
- **`APP_ORIGIN`:** set to `https://sks-nsw-labour.netlify.app` so the reminder email's CTA button opens the SKS app, not the EQ demo.
- **Analytics strip:** SKS has no analytics module. Strip any `scripts/analytics.js` references from sw.js precache and the index.html script tag list before merging the front-end changes.
- **Apprentice module:** SKS does not ship the EQ apprentice features. The DOB/start-date code is in `people.js` (shared) and is independent of the apprentice-only tabs — no extra strip step required.
- **Manager gate:** the hardened `ts-reminder` rejects any `sentBy` that is not a row in `public.managers` for the target org. SKS supervisors' front-end code must pass their display name as `sentBy`. Confirm the SKS `managers` table is current and includes every supervisor who will use the Send reminder button — add missing rows before go-live or reminders will 403.

---

## Step 3 — Deploy edge functions

```bash
# from the SKS worktree on the promotion branch
supabase functions deploy supervisor-digest --project-ref nspbmirochztcjijmcrx
supabase functions deploy ts-reminder       --project-ref nspbmirochztcjijmcrx --verify-jwt=true
```

Both functions require:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DIGEST_TRANSPORT` (and the matching transport credentials)
- `APP_ORIGIN` (recommended)

`ts-reminder` additionally honours:

- `REMIND_COOLDOWN_HOURS` (default 12)

Confirm via Supabase dashboard → Functions → both show ACTIVE. For `ts-reminder`, confirm the deployed version implements the hardening (search the file for `ts_reminder_claim` and `mgrRes` — both should be present).

---

## Step 4 — Smoke test on SKS prod

After Netlify deploy + edge function deploy:

1. Open sks-nsw-labour.netlify.app, sign in as supervisor.
2. **v3.4.16:** Open Add Person → confirm Birthday (Day + Month) and Start Date inputs render and save. Edit an existing person, set DOB to today (day + month) → save → Contacts row shows 🎂 Today chip.
3. **v3.4.16:** Set start_date to N years ago today → Dashboard widget shows "🎉 N yrs · today" entry.
4. **v3.4.17:** Open Timesheets → progress bar visible above the grid, reads `X of Y complete (Z%)`. Click `N pending` → popover lists Partial / No Data staff. Fill all Mon–Fri job cells for one staff member → row left border turns green, popover row disappears.
5. **v3.4.18:** Click `Send reminder` next to a pending staff member with an email → toast `✓ Reminder sent to <email>`. Inbox check — email arrives, `Complete timesheet →` CTA goes to sks-nsw-labour.netlify.app.
6. **v3.4.18:** Click again immediately → toast `Already reminded · last sent <time>` (rate-limited).
7. **v3.4.18 (manager gate):** Sign out. Temporarily remove your supervisor name from `public.managers` for the SKS org, sign back in, click Send reminder → expect a 403 toast / failure. Restore the manager row.
8. **v3.4.18 (audit row):** Inspect `ts_reminders_sent` for an SKS row with the correct `org_id` (= SKS organisations.id), `transport` (= `resend` or `netlify`, **not** `pending`), and `sent_by` (= the supervisor's display name).
9. **v3.4.17:** Manually trigger supervisor-digest dry-run for SKS:

   ```sql
   select public.trigger_supervisor_digest(true);
   ```

   Inspect the pg_net response — Section 4 HTML should contain `… · N days missing` for any incomplete staff.

10. **v3.4.9 cron:** confirm the Friday schedule is live:

    ```sql
    select jobname, schedule, active from cron.job where jobname = 'supervisor-digest-weekly';
    ```

    Next fire will be the next 02:00 UTC Friday. Do not wait — use `trigger_supervisor_digest()` in step 9 for same-day verification.

11. **PWA cache:** hard reload — footer should read **v3.4.18** and sw.js should report the SKS cache prefix at `v3.4.18`.

---

## Step 5 — Cron / scheduling

`supervisor-digest-weekly` is scheduled by Block 2 of the migration. **No new cron is required for v3.4.18** — `ts-reminder` is a manual button, not scheduled.

If supervisors want a "fire all reminders at once" sweep later, that becomes a v3.4.19 ticket — out of scope here.

---

## Rollback

| Layer | Rollback |
|-------|----------|
| Front-end JS | Netlify deploy → "Publish previous deploy" (single click). v3.4.18 is additive on the front end so reverting is safe and immediate. |
| `ts-reminder` function | Supabase Dashboard → Functions → ts-reminder → Disable. Front-end gracefully degrades (button posts → 404 → toast `Reminder failed`). No data loss. |
| `supervisor-digest` v3.4.17 enrichment | Re-deploy the v3.4.9 source. Backwards compatible — older callers already accepted `string[]`. |
| `ts_reminder_claim` RPC | `drop function public.ts_reminder_claim(uuid, text, text, text, text, numeric);` plus restore the in-function cooldown check by re-deploying the pre-hardening `ts-reminder/index.ts`. |
| `ts_reminders_sent` table | Leave in place — write-only audit log, costs nothing. If required: `drop table public.ts_reminders_sent cascade;` |
| `people.dob_day / dob_month / start_date` | Leave in place — additive columns with no UI dependency in pre-v3.4.16 builds. |
| Cron `supervisor-digest-weekly` | `select cron.unschedule('supervisor-digest-weekly');` — disables the Friday send; edge function and its fn secret stay put. |

---

## Open questions / future work

- **CORS tightening** — `ts-reminder` is currently `Access-Control-Allow-Origin: *`. Tighten to `https://sks-nsw-labour.netlify.app` (and the EQ origin) once both tenants are live on the function.
- **Manager-table accuracy** — the hardened gate makes `public.managers` load-bearing for reminder auth. Add a supervisor onboarding checklist item: "insert row into public.managers with name + email + digest_opt_in=true".
- **"Remind all pending" sweep button** — candidate for v3.4.19.
- **Per-user identity** — the shared anon JWT pattern forces the `sentBy`-name trust anchor. If/when SKS adopts per-user auth (Supabase auth users, or a custom JWT claim), migrate the gate from name-lookup to JWT-claim match + add a real RLS policy keyed off `auth.jwt() -> 'sub'`.

---

## Sign-off checklist (before flipping the SKS Netlify deploy)

- [ ] Pre-flight checks all green
- [ ] `app_config` rows for digest fn URL + token present on SKS prod
- [ ] Consolidated migration bundle applied on SKS prod (all 6 blocks, verification SELECTs return expected)
- [ ] Edge functions `supervisor-digest` and `ts-reminder` deployed + ACTIVE on SKS prod
- [ ] `ts-reminder` deployed version includes manager gate + ts_reminder_claim RPC call
- [ ] Required Supabase secrets present on SKS prod
- [ ] Snapshot SQL captured
- [ ] Smoke tests 1–11 pass
- [ ] `public.managers` populated for every supervisor who will use Send reminder
- [ ] Royce explicit "SKS live" confirmation captured in conversation
