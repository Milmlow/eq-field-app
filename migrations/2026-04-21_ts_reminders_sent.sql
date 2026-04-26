-- v3.4.18 — Timesheet reminder rate-limit table.
-- Records every reminder email sent by the `ts-reminder` edge function
-- so supervisors can't accidentally spam a person by clicking the button
-- repeatedly, and so we have an audit trail of who nudged whom when.
--
-- The edge function enforces the rate limit itself (one reminder per
-- person+week per REMIND_COOLDOWN_HOURS, default 12) by reading this
-- table before sending. Deliberately no unique constraint on
-- (person_name, week, org_id) — we want history, not just the latest.

create table if not exists public.ts_reminders_sent (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organisations(id) on delete cascade,
  person_name  text not null,
  person_email text,                       -- captured at send time for audit
  week         text not null,              -- 'dd.MM.yy' Monday key, matches timesheets.week
  sent_by      text,                       -- supervisor name / 'cron' / 'manual'
  sent_at      timestamptz not null default now(),
  transport    text,                       -- 'resend' | 'netlify'
  ok           boolean not null default true,
  detail       text                        -- provider response preview on failure
);

-- Query pattern: "has X been reminded for week W in the last N hours?"
create index if not exists ts_reminders_sent_lookup_idx
  on public.ts_reminders_sent (org_id, person_name, week, sent_at desc);

-- RLS — enable and mirror the pattern used by other org-scoped tables.
-- The edge function uses service role so it bypasses RLS; the anon
-- key-fronted app reads its own org via the existing is_org_member() fn.
alter table public.ts_reminders_sent enable row level security;

-- Read-only history table; anon/authenticated can read any row so
-- the app can display "last reminded Xh ago" without extra plumbing.
-- Writes only happen via the service-role edge function.
do $$ begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'ts_reminders_sent'
                    and policyname = 'ts_reminders_sent_select_own_org') then
    create policy ts_reminders_sent_select_own_org
      on public.ts_reminders_sent for select
      using (true);
  end if;
end $$;

-- Give the service_role full access (mirrors other tables).
grant all on public.ts_reminders_sent to service_role;
grant select on public.ts_reminders_sent to anon, authenticated;
