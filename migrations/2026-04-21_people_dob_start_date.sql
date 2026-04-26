-- ─────────────────────────────────────────────────────────────
-- 2026-04-21_people_dob_start_date.sql
-- Adds birthday (day + month only) and start_date columns to people.
-- Ships with v3.4.16 (birthdays + anniversaries widget).
--
-- Design decisions:
--   • DOB is stored as two ints (dob_day, dob_month) — we only display
--     day + month, never year, to avoid age-based surfacing.
--   • start_date is a DATE — anniversary year delta is derived at render.
--   • All columns are NULLABLE so existing rows keep working.
--   • year_level backfill is idempotent (no-op on 2nd run).
--
-- Apply against EQ demo first (ktmjmdzqrogauaevbktn).
-- SKS prod (nspbmirochztcjijmcrx) uses identical SQL — promoted via
-- PROMOTE-v3.4.16-18-TO-MAIN.md.
-- ─────────────────────────────────────────────────────────────

begin;

-- DOB (day + month only) + start_date
alter table public.people
  add column if not exists dob_day    smallint,
  add column if not exists dob_month  smallint,
  add column if not exists start_date date;

-- Sanity constraints — no-op if already present
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

-- Helpful indexes for dashboard widget queries (filter next 30 days)
create index if not exists people_dob_month_day_idx
  on public.people (dob_month, dob_day)
  where dob_month is not null and dob_day is not null;

create index if not exists people_start_date_idx
  on public.people (start_date)
  where start_date is not null;

commit;
