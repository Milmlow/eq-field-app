-- ─────────────────────────────────────────────────────────────
-- v3.4.18-hardening: tighten RLS on ts_reminders_sent
-- Runs after 2026-04-21_ts_reminders_sent.sql
-- ─────────────────────────────────────────────────────────────
--
-- Intent: narrow read access to service_role only.
--
-- Rationale:
--   The original policy allowed anon + authenticated SELECT so a future
--   UI could show "last reminded" timestamps inline. In practice the
--   12h cooldown response from the ts-reminder edge function already
--   carries lastSentAt, so client-side direct reads aren't needed.
--
--   The app uses a shared anon JWT (no per-user identity), so a literal
--   "managers-only" RLS policy keyed off JWT claims isn't implementable.
--   The edge function enforces the manager gate via the sentBy name +
--   managers-table lookup. Keeping client reads off the table prevents
--   anyone with the anon key from dumping the audit history directly.
--
-- Safe to re-run: drops both policies by name if present, re-creates
-- the service-role-only policy, re-grants ALL to service_role.

-- Idempotent drop of any existing SELECT policies on the table.
drop policy if exists ts_reminders_sent_select_own_org on public.ts_reminders_sent;
drop policy if exists ts_reminders_sent_service_role_only on public.ts_reminders_sent;

-- Service role bypasses RLS implicitly, but we create an explicit
-- placeholder policy so psql \d shows an intentional authorization.
create policy ts_reminders_sent_service_role_only
  on public.ts_reminders_sent
  for select
  to service_role
  using (true);

-- Revoke any grants that existed for anon/authenticated reads.
revoke select on public.ts_reminders_sent from anon;
revoke select on public.ts_reminders_sent from authenticated;

-- Keep service_role all-access (explicit grant; service_role bypasses
-- RLS but having the grant makes intent unambiguous).
grant all on public.ts_reminders_sent to service_role;

comment on table public.ts_reminders_sent is
  'Audit trail for timesheet reminder emails. RLS tightened on 2026-04-22 '
  'to service_role only. Edge function ts-reminder is the sole writer/reader '
  '(enforces manager-gate via sentBy + managers-table check). lastSentAt is '
  'surfaced to clients through the edge function response, not direct reads.';
