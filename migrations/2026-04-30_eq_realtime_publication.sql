-- ────────────────────────────────────────────────────────────
-- Migration: extend supabase_realtime publication on EQ Supabase
-- Project:   eq-field-app (EQ tenant only — ktmjmdzqrogauaevbktn)
-- Version:   3.4.49
-- Created:   2026-04-30 (battle-test pass 2)
-- Applied:   Demo  (ktmjmdzqrogauaevbktn) — pending (Royce on holidays)
--            Prod  (nspbmirochztcjijmcrx) — DO NOT APPLY without verifying
--                                          SKS publication state first
-- ────────────────────────────────────────────────────────────
-- Why: v3.4.47 lifted 'eq' from the realtime tenant gate (scripts/
--      realtime.js), but a `SELECT … FROM pg_publication_tables WHERE
--      pubname = 'supabase_realtime'` against the EQ project showed
--      only `public.roster_presence` was published. The `schedule` and
--      `leave_requests` tables were never added to the publication
--      (presumably because realtime had been gated off for EQ since
--      day one), so EQ users now connect to the WebSocket but receive
--      ZERO postgres_changes events for the two tables that matter
--      most. Single-user demo doesn't notice; multi-supervisor demo
--      sees stale rosters/leave until the 30-second poll catches up.
--
-- This migration is strictly additive — only adds tables to the
-- existing publication. No schema changes, no data changes, no RLS
-- changes. Safe to apply at any time.
--
-- For SKS prod (nspbmirochztcjijmcrx): VERIFY FIRST with the same
-- pg_publication_tables query. SKS has had realtime working for a
-- while so its publication is likely already correct — but don't
-- assume. Re-applying ALTER PUBLICATION ADD on a table that's
-- already published is a no-op error in PostgreSQL, hence the
-- defensive DO blocks below.
-- ────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'schedule'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.schedule;
    RAISE NOTICE 'Added public.schedule to supabase_realtime publication';
  ELSE
    RAISE NOTICE 'public.schedule already in supabase_realtime publication — no change';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'leave_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.leave_requests;
    RAISE NOTICE 'Added public.leave_requests to supabase_realtime publication';
  ELSE
    RAISE NOTICE 'public.leave_requests already in supabase_realtime publication — no change';
  END IF;
END $$;

-- Verify final state — should list at least: roster_presence, schedule, leave_requests
SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY schemaname, tablename;
