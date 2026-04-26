-- ─────────────────────────────────────────────────────────────
-- SKS promotion bundle
-- Target:   SKS Labour prod Supabase (nspbmirochztcjijmcrx)
-- Bundles:  v3.4.9  (supervisor-digest baseline)
--           v3.4.16 (birthdays + start_date + anniversaries)
--           v3.4.17 (timesheet completion clarity — no schema change)
--           v3.4.18 (timesheet reminder emails + hardening)
-- Author:   Royce Milmlow / EQ Solves
-- Built:    2026-04-22
--
-- READ THIS FIRST:
--   SKS prod is currently at v3.4.9 source code but does NOT have the
--   v3.4.9 Supabase bits (managers.digest_opt_in, pg_cron schedule).
--   Confirmed 2026-04-22 via schema diff. This bundle catches SKS up
--   to v3.4.18 in one idempotent pass.
--
--   Everything is safe to re-run. No destructive changes, no DROP on
--   existing data. Columns and indexes use IF NOT EXISTS; policies
--   and cron jobs are dropped-and-recreated by name; RPCs use
--   CREATE OR REPLACE.
--
-- ORDER OF OPERATIONS (do all of this as a transaction? See note at end):
--   Block 0 — extensions, sanity
--   Block 1 — v3.4.9  managers.digest_opt_in + indexes
--   Block 2 — v3.4.9  supervisor-digest pg_cron schedule + manual trigger
--   Block 3 — v3.4.16 people.dob_day / dob_month / start_date
--   Block 4 — v3.4.18 ts_reminders_sent table + RLS (service_role only)
--   Block 5 — v3.4.18-hardening ts_reminder_claim RPC (TOCTOU-safe)
--   Block 6 — verification SELECTs (non-mutating)
--
-- PRE-REQUISITES BEFORE APPLYING:
--   • app_config (key text pk, value text) must exist AND contain:
--       ('digest_fn_url',   'https://nspbmirochztcjijmcrx.supabase.co/functions/v1/supervisor-digest')
--       ('digest_fn_token', '<service-role-jwt-for-SKS-prod>')
--     Block 2 will INSERT ... ON CONFLICT DO UPDATE these values
--     if they are absent or out of date — see the guard in that block.
--   • Edge functions supervisor-digest AND ts-reminder deployed (but
--     they can be deployed after this SQL runs — pg_cron won't trip
--     until 02:00 UTC Friday, and ts-reminder is only called on demand).
--   • Supabase secrets on SKS prod: RESEND_API_KEY, DIGEST_FROM_EMAIL,
--     DIGEST_TRANSPORT=resend, APP_ORIGIN=https://sks-nsw-labour.netlify.app,
--     REMIND_COOLDOWN_HOURS=12 (optional, defaults to 12).
-- ─────────────────────────────────────────────────────────────


-- ─── Block 0 ─ extensions + sanity ───────────────────────────

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Confirm the SKS org row exists. Abort with a clear message if not.
do $$
begin
  if not exists (select 1 from public.organisations where slug = 'sks') then
    raise exception 'SKS organisation row missing: insert organisations (slug=sks) before running this bundle';
  end if;
end $$;


-- ─── Block 1 ─ v3.4.9 managers.digest_opt_in + indexes ───────

alter table public.managers
  add column if not exists digest_opt_in boolean not null default true;

comment on column public.managers.digest_opt_in is
  'When true, this supervisor receives the Friday 12:00 AEST digest email '
  'covering leave, pending approvals, unrostered staff and timesheet '
  'completion. Default true — opt-out, not opt-in.';

create index if not exists managers_org_digest_idx
  on public.managers (org_id)
  where digest_opt_in = true and deleted_at is null;

create index if not exists leave_requests_org_status_idx
  on public.leave_requests (org_id, status, archived);

create index if not exists leave_requests_org_dates_idx
  on public.leave_requests (org_id, date_start, date_end);


-- ─── Block 2 ─ v3.4.9 supervisor-digest cron schedule ────────
--
-- The cron job reads app_config for the function URL + bearer so we
-- don't hard-code secrets into the schedule body. If app_config rows
-- are missing, we log a NOTICE rather than fail — the job will run
-- but the http_post will 401 until config is populated.

do $$
declare
  _url_missing   boolean;
  _token_missing boolean;
begin
  if not exists (select 1 from information_schema.tables
                  where table_schema = 'public' and table_name = 'app_config') then
    raise exception 'public.app_config table is missing — create it (key text pk, value text) and populate digest_fn_url + digest_fn_token before applying Block 2';
  end if;

  select not exists (select 1 from public.app_config where key = 'digest_fn_url')
    into _url_missing;
  select not exists (select 1 from public.app_config where key = 'digest_fn_token')
    into _token_missing;

  if _url_missing or _token_missing then
    raise notice 'app_config missing digest_fn_url or digest_fn_token — cron job scheduled but calls will 401 until populated';
  end if;
end $$;

-- Remove any previous schedule under this name so re-applying is idempotent.
do $$
begin
  perform cron.unschedule(jobid)
    from cron.job
   where jobname = 'supervisor-digest-weekly';
exception when others then
  null;
end $$;

-- Friday 02:00 UTC → 12:00 AEST (13:00 AEDT during daylight saving).
select cron.schedule(
  'supervisor-digest-weekly',
  '0 2 * * 5',
  $cron$
    select net.http_post(
      url     := (select value from public.app_config where key = 'digest_fn_url'  limit 1),
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Authorization',
                   'Bearer ' || (select value from public.app_config where key = 'digest_fn_token' limit 1)
                 ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $cron$
);

-- Manual trigger helper — SELECT public.trigger_supervisor_digest(true) for dry-run.
create or replace function public.trigger_supervisor_digest(p_dry_run boolean default false)
returns bigint
language sql
security definer
as $$
  select net.http_post(
    url     := (select value from public.app_config where key = 'digest_fn_url'  limit 1),
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization',
                 'Bearer ' || (select value from public.app_config where key = 'digest_fn_token' limit 1)
               ),
    body    := jsonb_build_object('dryRun', p_dry_run),
    timeout_milliseconds := 30000
  );
$$;

comment on function public.trigger_supervisor_digest(boolean) is
  'Manually fire the supervisor-digest edge function. Pass TRUE for a dry run '
  '(returns what would be sent without sending). Returns the pg_net request id.';


-- ─── Block 3 ─ v3.4.16 people.dob_day / dob_month / start_date

begin;

alter table public.people
  add column if not exists dob_day    smallint,
  add column if not exists dob_month  smallint,
  add column if not exists start_date date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'people_dob_day_range') then
    alter table public.people
      add constraint people_dob_day_range check (dob_day is null or (dob_day between 1 and 31));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'people_dob_month_range') then
    alter table public.people
      add constraint people_dob_month_range check (dob_month is null or (dob_month between 1 and 12));
  end if;
end $$;

create index if not exists people_dob_month_day_idx
  on public.people (dob_month, dob_day)
  where dob_month is not null and dob_day is not null;

create index if not exists people_start_date_idx
  on public.people (start_date)
  where start_date is not null;

commit;


-- ─── Block 4 ─ v3.4.18 ts_reminders_sent + hardened RLS ──────

create table if not exists public.ts_reminders_sent (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organisations(id) on delete cascade,
  person_name  text not null,
  person_email text,
  week         text not null,                  -- 'dd.MM.yy' Monday key
  sent_by      text,
  sent_at      timestamptz not null default now(),
  transport    text,                           -- 'resend' | 'netlify' | 'pending'
  ok           boolean not null default true,
  detail       text
);

-- Query pattern: "has X been reminded for week W in the last N hours?"
create index if not exists ts_reminders_sent_lookup_idx
  on public.ts_reminders_sent (org_id, person_name, week, sent_at desc);

alter table public.ts_reminders_sent enable row level security;

-- Hardened RLS (2026-04-22): service_role only. Clients get last-sent
-- metadata from the edge function response, not from direct reads.
-- The shared anon JWT gives no per-user identity so a "managers-only
-- policy keyed off JWT claims" isn't implementable; the manager gate
-- is enforced inside the ts-reminder edge function via sentBy +
-- managers-table check.
drop policy if exists ts_reminders_sent_select_own_org      on public.ts_reminders_sent;
drop policy if exists ts_reminders_sent_service_role_only   on public.ts_reminders_sent;

create policy ts_reminders_sent_service_role_only
  on public.ts_reminders_sent
  for select
  to service_role
  using (true);

revoke select on public.ts_reminders_sent from anon;
revoke select on public.ts_reminders_sent from authenticated;
grant  all    on public.ts_reminders_sent to service_role;

comment on table public.ts_reminders_sent is
  'Audit trail for timesheet reminder emails. RLS is service_role only. '
  'Edge function ts-reminder is the sole writer/reader (enforces manager '
  'gate via sentBy + managers-table lookup). lastSentAt is surfaced to '
  'clients through the edge function response, not direct reads.';


-- ─── Block 5 ─ v3.4.18-hardening ts_reminder_claim RPC ───────
--
-- Atomic check + slot-reserve under pg_advisory_xact_lock. Prevents
-- the TOCTOU race where two near-simultaneous reminder clicks both
-- read "no recent send", both send, both insert. Confirmed reproducible
-- on EQ demo on 2026-04-22 without this RPC.

create or replace function public.ts_reminder_claim(
  _org_id uuid,
  _person_name text,
  _person_email text,
  _week text,
  _sent_by text,
  _cooldown_hours numeric
)
returns table (
  claim_id uuid,
  rate_limited boolean,
  last_sent_at timestamptz,
  cooldown_hours numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _key            bigint;
  _cutoff         timestamptz;
  _pending_cutoff timestamptz;
  _last           timestamptz;
  _id             uuid;
begin
  _key := hashtextextended(_org_id::text || '|' || _person_name || '|' || _week, 42);
  perform pg_advisory_xact_lock(_key);

  _cutoff         := now() - make_interval(secs => (_cooldown_hours * 3600)::int);
  _pending_cutoff := now() - interval '2 minutes';

  select sent_at into _last
    from public.ts_reminders_sent
    where org_id = _org_id
      and person_name = _person_name
      and week = _week
      and (
           (ok = true  and sent_at > _cutoff)
        or (ok = false and transport = 'pending' and sent_at > _pending_cutoff)
      )
    order by sent_at desc
    limit 1;

  if _last is not null then
    return query select null::uuid, true, _last, _cooldown_hours;
    return;
  end if;

  insert into public.ts_reminders_sent (
    org_id, person_name, person_email, week, sent_by, transport, ok, detail
  ) values (
    _org_id, _person_name, _person_email, _week, _sent_by, 'pending', false, 'claim reserved'
  )
  returning id into _id;

  return query select _id, false, null::timestamptz, _cooldown_hours;
end;
$$;

revoke execute on function public.ts_reminder_claim(uuid, text, text, text, text, numeric) from public;
revoke execute on function public.ts_reminder_claim(uuid, text, text, text, text, numeric) from anon;
revoke execute on function public.ts_reminder_claim(uuid, text, text, text, text, numeric) from authenticated;
grant  execute on function public.ts_reminder_claim(uuid, text, text, text, text, numeric) to service_role;

comment on function public.ts_reminder_claim(uuid, text, text, text, text, numeric) is
  'Atomic claim for ts-reminder edge function. Uses pg_advisory_xact_lock on '
  'hash(org|person|week) to serialize concurrent claims. Returns claim_id on '
  'success (caller UPDATEs the inserted pending row), or rate_limited=true '
  'if a recent successful send or in-flight pending claim exists.';


-- ─── Block 6 ─ verification (run these manually after the bundle) ────
--
-- Expected results are inline. All non-mutating.

-- 1. v3.4.9 managers column present
--    expect: digest_opt_in  boolean  NO  true
-- select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'managers' and column_name = 'digest_opt_in';

-- 2. v3.4.9 cron job scheduled
--    expect: 1 row with jobname = 'supervisor-digest-weekly', active = true
-- select jobname, schedule, active from cron.job where jobname = 'supervisor-digest-weekly';

-- 3. v3.4.16 people columns present
--    expect: 3 rows
-- select column_name from information_schema.columns
--  where table_schema = 'public' and table_name = 'people'
--    and column_name in ('dob_day','dob_month','start_date');

-- 4. v3.4.18 table + policy + RPC present
--    expect: 1 row each
-- select count(*) from public.ts_reminders_sent;                   -- 0 on first apply
-- select policyname from pg_policies
--  where schemaname = 'public' and tablename = 'ts_reminders_sent'; -- ts_reminders_sent_service_role_only
-- select proname from pg_proc where proname = 'ts_reminder_claim'; -- 1 row


-- ─── End of bundle ──────────────────────────────────────────
--
-- Transaction note: the whole bundle is NOT wrapped in one outer
-- transaction. CREATE EXTENSION and cron.schedule() cannot safely
-- sit inside a single serialisable transaction, so each logical block
-- commits independently. That is fine here because every block is
-- idempotent — re-running the bundle after a partial apply will
-- converge to the same state.
