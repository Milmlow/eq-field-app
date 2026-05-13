-- ────────────────────────────────────────────────────────────
-- Migration: roster_presence — ephemeral "X is editing cell Y"
-- Project:   eq-field-app
-- Version:   3.4.47
-- Created:   2026-04-29
-- Applied:   Demo  (ktmjmdzqrogauaevbktn) — pending
--            Prod  (nspbmirochztcjijmcrx) — NOT YET (Royce on holidays)
-- ────────────────────────────────────────────────────────────
-- Purpose: lightweight presence table so multiple supervisors
--          editing the same week see each other in near-real-time
--          via Supabase Realtime postgres_changes. The client
--          inserts/upserts a row when an editor cell gains focus,
--          deletes it on blur, and heartbeats focused_at while the
--          cell is held. Other connected clients render a small
--          outline + tooltip on the affected cell.
--
-- Cleanup: clients filter on focused_at > now() - 15s so stale rows
--          (orphaned by a tab close before blur fired) are ignored
--          visually. A pg_cron daily DELETE keeps the table from
--          growing unbounded.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.roster_presence (
  org_id        uuid        NOT NULL,
  manager_name  text        NOT NULL,
  week          text        NOT NULL,
  cell_name     text        NOT NULL,
  cell_day      text        NOT NULL,
  focused_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, manager_name, week, cell_name, cell_day),
  CHECK (cell_day IN ('mon','tue','wed','thu','fri','sat','sun'))
);

COMMENT ON TABLE public.roster_presence IS
  'Ephemeral "X is editing cell Y" presence for the roster editor. '
  'Rows are inserted on input focus, refreshed by heartbeat every 10s, '
  'deleted on blur. Clients filter by focused_at > now()-15s to handle '
  'orphaned rows from unclean tab closes.';

ALTER TABLE public.roster_presence ENABLE ROW LEVEL SECURITY;

-- Anyone with the anon key (i.e. anyone using the app) can read all
-- presence in their tenant — the table holds no PII beyond manager
-- names which are already shown to all logged-in supervisors via
-- the Supervision page.
CREATE POLICY "presence_select_anon" ON public.roster_presence
  FOR SELECT USING (true);
CREATE POLICY "presence_insert_anon" ON public.roster_presence
  FOR INSERT WITH CHECK (true);
CREATE POLICY "presence_update_anon" ON public.roster_presence
  FOR UPDATE USING (true);
CREATE POLICY "presence_delete_anon" ON public.roster_presence
  FOR DELETE USING (true);

-- Add to the realtime publication so postgres_changes events fire.
ALTER PUBLICATION supabase_realtime ADD TABLE public.roster_presence;

-- Daily cleanup of any rows that escaped client-side cleanup
-- (tab closed before blur, network dropped, etc.).
CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$
BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'roster-presence-cleanup';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule(
  'roster-presence-cleanup',
  '0 * * * *',
  $$DELETE FROM public.roster_presence WHERE focused_at < now() - interval '5 minutes';$$
);
