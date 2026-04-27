-- migrations/2026-04-27_sites_track_hours.sql
-- ─────────────────────────────────────────────────────────────
-- Project hours tracking — opt-in per site, with budgeted hours.
-- Powers the new "Project Hours" supervisor tab gated by
-- feat_project_hours_v1 PostHog flag.
--
-- Plan ref: MULTI-TENANCY-PLAN.md §Phase 1 — Step 1.2
-- Target project: ktmjmdzqrogauaevbktn (eq-solves-field demo)
-- Do NOT apply to nspbmirochztcjijmcrx (SKS live).
--
-- Safe to apply: additive only. track_hours defaults false (no rows
-- opt in until explicitly ticked). budget_hours is nullable. Nothing
-- reads either column until the flag is enabled in PostHog.
--
-- Rollback (if ever needed):
--   alter table public.sites
--     drop column if exists track_hours,
--     drop column if exists budget_hours;
-- ─────────────────────────────────────────────────────────────

alter table public.sites
  add column if not exists track_hours    boolean       not null default false,
  add column if not exists budget_hours   numeric(10,2) null;

-- Index only the tracked subset — keeps it tiny since most sites are
-- noise (small jobs, no tracking).
create index if not exists idx_sites_track_hours
  on public.sites (org_id, track_hours)
  where track_hours = true;

comment on column public.sites.track_hours is
  'Opt site into project-hours tracking. Default false. Toggleable by supervisors / managers.';

comment on column public.sites.budget_hours is
  'Initial hour budget set at site kickoff. Editable. Null = no budget set yet. Drives burn-down view.';
