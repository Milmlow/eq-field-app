-- migrations/2026-04-27_eq_role_enum_people_role.sql
-- ─────────────────────────────────────────────────────────────
-- 5-tier role system: manager > supervisor > employee > apprentice >
-- labour_hire. Backs window.EQ_PERMS.can() permission gates.
--
-- Plan ref: MULTI-TENANCY-PLAN.md §Phase 1 — Step 1.5
-- Target project: ktmjmdzqrogauaevbktn (eq-solves-field demo)
-- Do NOT apply to nspbmirochztcjijmcrx (SKS live).
--
-- ╔═════════════════════════════════════════════════════════════╗
-- ║ BEFORE APPLYING — verify the backfill assumption.           ║
-- ║                                                             ║
-- ║ This migration assumes:                                     ║
-- ║   - public.people has no existing `role` column. (If it     ║
-- ║     does, this migration will FAIL on the add column step.) ║
-- ║   - supervisors are identifiable by joining people.name +   ║
-- ║     people.org_id against public.managers.                  ║
-- ║                                                             ║
-- ║ Run these in Supabase Studio / MCP first to confirm:        ║
-- ║                                                             ║
-- ║   -- 1. Does people.role already exist?                     ║
-- ║   select column_name, data_type                             ║
-- ║   from information_schema.columns                           ║
-- ║   where table_schema = 'public'                             ║
-- ║     and table_name   = 'people'                             ║
-- ║     and column_name  = 'role';                              ║
-- ║   -- 0 rows = safe to apply as-is.                          ║
-- ║                                                             ║
-- ║   -- 2. How many supervisors will the join find?            ║
-- ║   select count(*) as supervisors_to_promote                 ║
-- ║   from public.people p                                      ║
-- ║   where exists (                                            ║
-- ║     select 1 from public.managers m                         ║
-- ║     where m.name   = p.name                                 ║
-- ║       and m.org_id = p.org_id                               ║
-- ║   );                                                        ║
-- ║                                                             ║
-- ║ If query 1 returns rows: rename existing role column first  ║
-- ║ (e.g. role -> role_legacy), then apply.                     ║
-- ║ If query 2 returns 0: hand-promote supervisors after apply  ║
-- ║ via UPDATE public.people SET role='supervisor' WHERE ...    ║
-- ╚═════════════════════════════════════════════════════════════╝
--
-- Rollback (if needed):
--   alter table public.people drop column if exists role;
--   drop type if exists public.eq_role;
-- ─────────────────────────────────────────────────────────────

-- Step 1 — create the enum type if it doesn't exist.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'eq_role') then
    create type public.eq_role as enum (
      'manager',
      'supervisor',
      'employee',
      'apprentice',
      'labour_hire'
    );
  end if;
end $$;

-- Step 2 — add the role column to people (nullable initially so the
-- backfill can run, then made not-null after).
alter table public.people
  add column if not exists role public.eq_role;

-- Step 3 — backfill: anyone who exists in the managers table for the
-- same org becomes 'supervisor'. The join is by (name, org_id).
update public.people p
   set role = 'supervisor'::public.eq_role
 where p.role is null
   and exists (
     select 1
       from public.managers m
      where m.name   = p.name
        and m.org_id = p.org_id
   );

-- Step 4 — everyone else defaults to 'employee'. Hand-elevate to
-- 'manager' or down-tier to 'apprentice' / 'labour_hire' after apply.
update public.people
   set role = 'employee'::public.eq_role
 where role is null;

-- Step 5 — lock it down: not null, sensible default for new rows.
alter table public.people
  alter column role set not null,
  alter column role set default 'employee'::public.eq_role;

comment on column public.people.role is
  'Per-person role within the tenant. Drives window.EQ_PERMS.can() permission gates. Tier 1=manager (full control), 2=supervisor, 3=employee, 4=apprentice, 5=labour_hire.';
