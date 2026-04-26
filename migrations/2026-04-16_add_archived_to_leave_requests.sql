-- ────────────────────────────────────────────────────────────
-- Migration: Archive flag for leave requests
-- Project:   eq-field-app
-- Version:   3.4.3
-- Supabase:  20260416180305_add_archived_to_leave_requests
-- Applied:   Prod  (nspbmirochztcjijmcrx) — 2026-04-16 ✓
-- ────────────────────────────────────────────────────────────
-- Replaces the old destructive "Clear All Leave Requests" action
-- with a non-destructive archive workflow. See CHANGELOG-v3.4.3 §1.
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS archived boolean DEFAULT false;

COMMENT ON COLUMN public.leave_requests.archived IS
  'When true, request is hidden from the default Leave view but preserved for records. Roster schedule entries are NOT affected by archiving.';
