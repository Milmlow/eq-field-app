-- ─────────────────────────────────────────────────────────────
-- v3.4.18-hardening: TOCTOU-safe ts-reminder claim RPC
-- Runs after 2026-04-22_ts_reminders_sent_tighten_rls.sql
-- ─────────────────────────────────────────────────────────────
--
-- Problem:
--   The ts-reminder edge function's original check-then-send-then-insert
--   sequence is racy. Two near-simultaneous invocations (e.g., retried
--   network call, two managers on the same person/week) can both read
--   "no recent ok=true row", both send, both insert — duplicate email.
--   Verified on 2026-04-22: four parallel pg_net.http_post calls against
--   the same (org, person, week) produced two successful sends.
--
-- Fix:
--   This RPC performs an atomic claim. It acquires a per-(org, person,
--   week) transaction-scoped advisory lock, checks for either a recent
--   successful send (within cooldown) or an in-flight "pending" row
--   (within 2 minutes), and if neither is present, INSERTs a pending
--   row and returns its id. The caller then sends the email and
--   UPDATEs the row with the final ok/transport/detail.
--
--   Because the lock is transaction-scoped and the pending row is
--   committed before the lock releases, a second concurrent claim
--   will observe the pending row and report rate-limited.
--
-- Cooldown semantics:
--   - ok = true rows within `_cooldown_hours` → rate_limited
--   - ok = false, transport = 'pending' rows within 2 min → rate_limited
--     (protects against concurrent claims while the first is sending)
--   - ok = false, transport != 'pending' → NOT rate-limiting (failures
--     should be retriable immediately, as before)
--
-- Safe to re-run: uses create or replace.

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
  -- Serialize concurrent claims for the same (org, person, week).
  -- hashtextextended → bigint is stable and well-distributed.
  _key := hashtextextended(_org_id::text || '|' || _person_name || '|' || _week, 42);
  perform pg_advisory_xact_lock(_key);

  _cutoff         := now() - make_interval(secs => _cooldown_hours * 3600);
  _pending_cutoff := now() - interval '2 minutes';

  -- Cooldown: a recent successful send, OR an in-flight pending claim
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

  -- Reserve the slot by inserting a pending row. The caller (edge function)
  -- UPDATEs this row after attempting to send, flipping ok/transport/detail.
  insert into public.ts_reminders_sent (
    org_id, person_name, person_email, week, sent_by, transport, ok, detail
  ) values (
    _org_id, _person_name, _person_email, _week, _sent_by, 'pending', false, 'claim reserved'
  )
  returning id into _id;

  return query select _id, false, null::timestamptz, _cooldown_hours;
end;
$$;

-- service_role only (the edge function uses the service-role key)
revoke execute on function public.ts_reminder_claim(uuid, text, text, text, text, numeric) from public;
revoke execute on function public.ts_reminder_claim(uuid, text, text, text, text, numeric) from anon;
revoke execute on function public.ts_reminder_claim(uuid, text, text, text, text, numeric) from authenticated;
grant  execute on function public.ts_reminder_claim(uuid, text, text, text, text, numeric) to service_role;

comment on function public.ts_reminder_claim(uuid, text, text, text, text, numeric) is
  'Atomic claim for ts-reminder edge function. Uses pg_advisory_xact_lock on '
  'hash(org|person|week) to serialize concurrent claims. Returns claim_id on '
  'success (caller UPDATEs the inserted pending row), or rate_limited=true '
  'if a recent successful send or in-flight pending claim exists.';
