-- Migration: make leave_requests.approver_name required
-- Created: 2026-04-19 (v3.4.5, L8)
-- Purpose: Defense-in-depth against rows being inserted with no supervisor
--          assigned, which leaves the request orphaned with no approval email.
--
-- Pre-check on SKS prod (org 1eb831f9-aeae-4e57-b49e-9681e8f51e15):
--   SELECT COUNT(*) FROM leave_requests
--   WHERE approver_name IS NULL OR approver_name = '';
--   -> 0   (safe to apply without backfill)

ALTER TABLE public.leave_requests
  ALTER COLUMN approver_name SET NOT NULL,
  ALTER COLUMN approver_name DROP DEFAULT;

ALTER TABLE public.leave_requests
  ADD CONSTRAINT leave_requests_approver_name_not_empty
  CHECK (approver_name <> '');
