-- Migration: add digest_opt_in flag to managers
-- Created: 2026-04-19 (v3.4.9, supervisor digest)
-- Purpose: per-supervisor opt-in for the Friday lunchtime digest email.
--          Defaults to TRUE so existing supervisors are subscribed unless
--          they explicitly opt out from the Supervision page (or via SQL).
--
-- Runs on EQ demo (ktmjmdzqrogauaevbktn) first; promote to SKS prod
-- (nspbmirochztcjijmcrx) once the digest has been observed for a couple
-- of cycles.

ALTER TABLE public.managers
  ADD COLUMN IF NOT EXISTS digest_opt_in boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.managers.digest_opt_in IS
  'When true, this supervisor receives the Friday 12:00 AEST digest email '
  'covering leave, pending approvals, unrostered staff and timesheet '
  'completion. Default true — opt-out, not opt-in. Toggled from the '
  'Supervision page or via UPDATE managers SET digest_opt_in = false WHERE name = ''<x>''.';

-- Helpful index for the digest function: it scans by org + opt-in.
CREATE INDEX IF NOT EXISTS managers_org_digest_idx
  ON public.managers (org_id)
  WHERE digest_opt_in = true AND deleted_at IS NULL;

-- Helpful index for leave-this-week and pending-approvals lookups.
CREATE INDEX IF NOT EXISTS leave_requests_org_status_idx
  ON public.leave_requests (org_id, status, archived);

CREATE INDEX IF NOT EXISTS leave_requests_org_dates_idx
  ON public.leave_requests (org_id, date_start, date_end);
