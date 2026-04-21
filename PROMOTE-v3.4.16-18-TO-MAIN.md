# Promotion Plan — v3.4.16 → v3.4.18 to SKS Labour Prod

**Owner:** Royce Milmlow
**Source tenant:** EQ Solves Field demo (`ktmjmdzqrogauaevbktn`, eq-solves-field.netlify.app)
**Target tenant:** SKS Labour live (`nspbmirochztcjijmcrx`, sks-nsw-labour.netlify.app)
**Status:** Demo features complete and verified; SKS promotion **not yet executed** — this doc is the playbook.

> **Hard rule:** Do not touch SKS Supabase (`nspbmirochztcjijmcrx`) until Royce explicitly says "SKS live" — see `eq-context/SKS-CONTEXT.md` constraint.

---

## What's being promoted

| Version | Feature | Demo state |
|---------|---------|------------|
| v3.4.16 | Birthdays + work anniversaries (people.dob_day, dob_month, start_date; dashboard widget; contacts chips; CSV columns) | Live on EQ demo |
| v3.4.17 | Timesheet completion clarity (progress bar, day-based row tint matched to stat cards, supervisor digest enriched with per-name day counts) | Live on EQ demo |
| v3.4.18 | Per-row "Send reminder" button + ts-reminder edge function + ts_reminders_sent rate-limit table | Live on EQ demo |

Three migrations and one new edge function. No destructive changes — all schema additions are additive, all function deploys are net-new.

---

## Pre-flight checks

Run these on the SKS app **before** starting the promotion:

1. Confirm current SKS Labour app version (footer on sks-nsw-labour.netlify.app).
   The EQ Field codebase is ahead — verify the SKS branch you're merging into
   is at or past v3.4.9 (supervisor-digest baseline). If SKS prod is on an
   older base, port the supervisor-digest function first or this becomes a
   bigger uplift than the digest enrichment in v3.4.17 expects.
2. Confirm `organisations` row exists for SKS:
   ```sql
   select id, slug, name from public.organisations where slug = 'sks';
   ```
3. Confirm Supabase project secrets present on SKS prod:
   - `RESEND_API_KEY` and `DIGEST_FROM_EMAIL` *or* `NETLIFY_SEND_EMAIL_URL` + `EQ_DIGEST_SECRET`
   - `DIGEST_TRANSPORT` (`resend` | `netlify`)
   - Optional: `REMIND_COOLDOWN_HOURS` (defaults to 12)
   - Optional: `APP_ORIGIN` (recommended `https://sks-nsw-labour.netlify.app`)
4. Confirm `managers` table has at least one row with `digest_opt_in = true`
   and a valid email — otherwise the digest send is silent.
5. Snapshot the SKS Supabase schema before starting:
   ```bash
   supabase db dump --project-ref nspbmirochztcjijmcrx --schema public > sks-pre-promote-$(date +%F).sql
   ```

---

## Step 1 — Apply consolidated migration

Run this single block against SKS prod (`nspbmirochztcjijmcrx`). It bundles
the three EQ Field migrations into one idempotent script.

```sql
-- ─────────────────────────────────────────────────────────────
-- SKS promotion · v3.4.16 → v3.4.18 schema bundle
-- Idempotent — safe to re-run.
-- ─────────────────────────────────────────────────────────────

-- v3.4.16 — DOB + start date on people
alter table public.people
  add column if not exists dob_day    smallint check (dob_day   between 1 and 31),
  add column if not exists dob_month  smallint check (dob_month between 1 and 12),
  add column if not exists start_date date;

create index if not exists people_dob_month_day_idx
  on public.people (dob_month, dob_day) where dob_day is not null and dob_month is not null;

create index if not exists people_start_date_idx
  on public.people (start_date) where start_date is not null;

-- v3.4.17 — no schema change (digest function signature change only)

-- v3.4.18 — reminder rate-limit / audit table
create table if not exists public.ts_reminders_sent (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organisations(id) on delete cascade,
  person_name  text not null,
  person_email text,
  week         text not null,
  sent_by      text,
  sent_at      timestamptz not null default now(),
  transport    text,
  ok           boolean not null default true,
  detail       text
);

create index if not exists ts_reminders_sent_lookup_idx
  on public.ts_reminders_sent (org_id, person_name, week, sent_at desc);

alter table public.ts_reminders_sent enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'ts_reminders_sent'
                    and policyname = 'ts_reminders_sent_select_own_org') then
    create policy ts_reminders_sent_select_own_org
      on public.ts_reminders_sent for select
      using (true);
  end if;
end $$;

grant all on public.ts_reminders_sent to service_role;
grant select on public.ts_reminders_sent to anon, authenticated;
```

Verify after running:

```sql
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'people'
   and column_name in ('dob_day','dob_month','start_date');
-- expect 3 rows

select count(*) from public.ts_reminders_sent;
-- expect 0
```

---

## Step 2 — Code merge

The EQ Field codebase and the SKS Labour codebase are parallel apps that
diverge in some module implementations (memory note:
`project_eq_field_vs_sks.md`). Do **not** copy the EQ index.html
wholesale — instead cherry-pick the diff from each module:

| File | Action |
|------|--------|
| `scripts/app-state.js` | Bump `APP_VERSION = '3.4.18'`. Confirm `TENANT_SUPABASE.sks` is unchanged. SKS already has the group alias `SKS Direct ↔ Direct` plumbing. |
| `scripts/people.js` | Port the v3.4.16 DOB block: `MONTH_SHORT`, `personHasDob`, `_daysUntilMD`, `personBirthdayLabel`, `personIsBirthdayToday`, `personAnniversaryYearsToday`, `todayBadges(p)` and the modal field read/write in openAddPerson/editPerson/savePerson. Verify openAddPerson form field IDs match SKS markup before merging. |
| `scripts/dashboard.js` | Port `renderAnniversariesWidget()` and the early-return fix (call the widget on both branches). |
| `scripts/supabase.js` | Extend savePersonToSB and importPeopleToSB with `dob_day`, `dob_month`, `start_date`. |
| `scripts/import-export.js` | Add Birthday + StartDate columns to people / contacts CSV exports and import parser (`_fmtCsvBirthday`, `_parseCsvBirthday`). |
| `scripts/timesheets.js` | Port v3.4.17 row-tint rewrite (day-based) and `updateTsStats()` progress bar + popover. Port v3.4.18 `sendTsReminder()` and the per-row button in the popover render. |
| `index.html` | Add changelog header entries for v3.4.16/17/18. Add DOB selects + start_date input to person modal. Add `#dashboard-anniversaries` container. Add `#ts-progress-bar` container above `#ts-completion-tracker`. Bump footer version stamp. Update loadFromSupabase select+map to include `dob_day, dob_month, start_date`. |
| `sw.js` | Bump cache to `eq-field-v3.4.18` (or the SKS-tenant equivalent name — check current SKS sw.js cache prefix; if it's `sks-labour-v…`, use that pattern instead). |
| `supabase/functions/supervisor-digest/index.ts` | Port the v3.4.17 `tsCompletion.missing` shape change (`Array<string \| { name, days }>`) and the missingListHtml renderer. **Backwards compatible** — older callers passing `string[]` still render correctly. |
| `supabase/functions/ts-reminder/index.ts` | Net-new — copy entire file from `eq-field-app/supabase/functions/ts-reminder/`. |

### Compatibility wrinkles to watch for

- **Group aliases:** SKS DB stores `SKS Direct`, UI shows `Direct`.
  `denormaliseGroupForDb()` is already wired through people writes — no
  action needed for v3.4.16 DOB fields, but the timesheet popover row
  uses `STATE.people` which is post-normalisation, so the reminder button
  passes the canonical name (which matches `people.name` in SKS DB
  because the alias is on `group`, not `name`). ✅
- **Tenant slug:** the new `ts-reminder` function takes `orgSlug` from
  the request body. Front end passes `TENANT.ORG_SLUG` which resolves
  to `'sks'` on sks-nsw-labour.netlify.app. ✅
- **Email transport:** `ts-reminder` reads the **same** `DIGEST_TRANSPORT`
  env as `supervisor-digest`. If SKS prod is configured for `netlify`,
  no change; if it's not configured at all, set `DIGEST_TRANSPORT=resend`
  + `RESEND_API_KEY` + `DIGEST_FROM_EMAIL` (use an SKS-specific from
  address — e.g. `SKS Labour <noreply@sks.com.au>`).
- **`APP_ORIGIN`:** set to `https://sks-nsw-labour.netlify.app` so the
  reminder email's CTA button opens the SKS app, not the EQ demo.
- **Analytics:** SKS has no analytics module (per memory
  `project_eq_field_vs_sks.md`). Strip any `analytics.js` references
  in sw.js precache and index.html script tag list before merging.
- **Apprentice module:** SKS doesn't ship the EQ apprentice features.
  The DOB/start-date code is in people.js (shared) and is independent
  of the apprentice-only tabs — no extra strip step required.

---

## Step 3 — Deploy edge functions

```bash
# from the SKS Labour repo working tree
supabase functions deploy supervisor-digest --project-ref nspbmirochztcjijmcrx
supabase functions deploy ts-reminder       --project-ref nspbmirochztcjijmcrx --no-verify-jwt=false
```

Both functions require:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DIGEST_TRANSPORT` (and the matching transport credentials)
- `APP_ORIGIN` (recommended)

`ts-reminder` additionally honours:
- `REMIND_COOLDOWN_HOURS` (default 12)

Confirm via Supabase dashboard → Functions → both show ACTIVE.

---

## Step 4 — Smoke test on SKS prod

After Netlify deploy + edge function deploy:

1. Open sks-nsw-labour.netlify.app, sign in as supervisor.
2. **v3.4.16:** Open Add Person → confirm Birthday (Day + Month) and
   Start Date inputs render and save. Edit an existing person, set DOB
   to today (day + month) → save → Contacts row shows 🎂 Today chip.
3. **v3.4.16:** Set start_date to N years ago today → Dashboard widget
   shows "🎉 N yrs · today" entry.
4. **v3.4.17:** Open Timesheets → progress bar visible above the grid,
   reads `X of Y complete (Z%)`. Click `N pending` → popover lists
   Partial / No Data staff. Fill all Mon–Fri job cells for one staff
   member → row left border turns green, popover row disappears.
5. **v3.4.18:** Click `Send reminder` next to a pending staff member
   with an email → toast `✓ Reminder sent to <email>`. Inbox check —
   email arrives, `Complete timesheet →` CTA goes to
   sks-nsw-labour.netlify.app.
6. **v3.4.18:** Click again → toast `Already reminded · last sent <time>`.
7. **v3.4.18:** Inspect `ts_reminders_sent` for an SKS row with the
   correct `org_id` (= SKS organisations.id), `transport`, and
   `sent_by` (= the supervisor's display name).
8. **v3.4.17:** Manually trigger supervisor-digest dry-run for SKS:
   ```
   POST https://nspbmirochztcjijmcrx.supabase.co/functions/v1/supervisor-digest
   { "dryRun": true, "orgSlug": "sks" }
   ```
   Inspect the JSON response — Section 4 HTML should contain
   `… · N days missing` for any incomplete staff.
9. **PWA cache:** hard reload — footer should read **v3.4.18** and
   sw.js should report cache `eq-field-v3.4.18` (or SKS-prefixed
   equivalent if you used a tenant-specific name in step 2).

---

## Step 5 — Cron / scheduling

`supervisor-digest` is already on a Friday 02:00 UTC cron via
`migrations/2026-04-19_digest_cron_schedule.sql`. **No new cron is
required for v3.4.18** — `ts-reminder` is a manual button, not
scheduled.

If you want supervisors to be able to send a "fire all reminders"
sweep from a single click later, that becomes a separate v3.4.19
ticket — out of scope here.

---

## Rollback

If a problem surfaces post-promote:

| Layer | Rollback |
|-------|----------|
| Front-end JS | Netlify deploy → "Publish previous deploy" (single click). v3.4.18 is additive on the front end so reverting is safe and immediate. |
| `ts-reminder` function | Supabase Dashboard → Functions → ts-reminder → Disable. Front-end gracefully degrades (button posts → 404 → toast `Reminder failed`). No data loss. |
| `supervisor-digest` v3.4.17 enrichment | Re-deploy the v3.4.9 source. Backwards compatible — older callers already accepted `string[]`. |
| `ts_reminders_sent` table | Leave in place even on rollback (it's a write-only audit log, costs nothing to keep). If absolutely necessary: `drop table public.ts_reminders_sent;` |
| `people.dob_day / dob_month / start_date` | Leave in place — additive columns with no UI dependency in pre-v3.4.16 builds. Removing them would require a column drop *and* a CSV importer compatibility check. Recommend: don't roll these back, just ignore. |

---

## Open questions / future work

- **Caller identity check on `ts-reminder`** — currently the function
  trusts `sentBy` from the request body for audit logging. Cross-check
  against `managers.name` once SKS prod identity plumbing is verified
  (deferred per CHANGELOG-v3.4.18.md security notes).
- **CORS tightening** — `ts-reminder` is `Access-Control-Allow-Origin: *`.
  Tighten to `https://sks-nsw-labour.netlify.app` (and EQ origin)
  once both tenants are live on the function.
- **"Remind all pending" sweep button** — supervisor convenience,
  candidate for v3.4.19.

---

## Sign-off checklist (before flipping the SKS Netlify deploy)

- [ ] Pre-flight checks all green
- [ ] Migration applied on SKS prod
- [ ] Edge functions deployed + ACTIVE on SKS prod
- [ ] Required Supabase secrets present on SKS prod
- [ ] Snapshot SQL captured
- [ ] Smoke tests 1–9 pass
- [ ] Royce explicit "SKS live" confirmation captured in conversation
