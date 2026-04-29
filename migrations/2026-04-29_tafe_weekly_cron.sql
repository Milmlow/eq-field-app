-- ────────────────────────────────────────────────────────────
-- Migration: schedule tafe-weekly-fill via pg_cron
-- Project:   eq-field-app  (and SKS NSW Labour, applied separately)
-- Version:   3.4.41
-- Created:   2026-04-29
-- Applied:   Demo  ( ) — pending
--            Prod  ( ) — pending
-- ────────────────────────────────────────────────────────────
-- Purpose: fire the tafe-weekly-fill edge function every Sunday at
--          16:00 AEST (= 06:00 UTC). Cron runs in UTC, so Sydney
--          gets 16:00 AEST in winter and 17:00 AEDT in summer.
--          Both unambiguously land on Sunday in NSW. The function
--          itself computes "next Monday" from the wall clock at run
--          time, so DST drift doesn't move which week gets filled.
--
-- Apply ORDER:
--   1. Deploy the tafe-weekly-fill edge function first
--        supabase functions deploy tafe-weekly-fill
--   2. Required env on the function: SUPABASE_URL and
--      SUPABASE_SERVICE_ROLE_KEY (Supabase auto-populates these).
--   3. Create app_config rows with the function URL + a service-role
--      bearer so pg_cron can call it authenticated:
--        INSERT INTO public.app_config (key, value) VALUES
--          ('tafe_fn_url',
--           'https://<project-ref>.supabase.co/functions/v1/tafe-weekly-fill'),
--          ('tafe_fn_token', '<service-role-jwt>')
--        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
--   4. Apply THIS migration.
--   5. Smoke-test:
--        SELECT public.trigger_tafe_weekly_fill(p_dry_run := true);
--      Then check the function logs for the planned writes.
--
-- To disable temporarily:   SELECT cron.unschedule('tafe-weekly-fill');
-- ────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Idempotent re-apply: drop any prior schedule under this name first.
DO $$
BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'tafe-weekly-fill';
EXCEPTION WHEN OTHERS THEN
  -- cron.job may not exist on very fresh projects; ignore.
  NULL;
END $$;

-- Sunday 06:00 UTC — 16:00 AEST (17:00 AEDT in summer).
SELECT cron.schedule(
  'tafe-weekly-fill',
  '0 6 * * 0',
  $cron$
    SELECT net.http_post(
      url     := (SELECT value FROM public.app_config WHERE key = 'tafe_fn_url' LIMIT 1),
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Authorization',
                   'Bearer ' || (SELECT value FROM public.app_config WHERE key = 'tafe_fn_token' LIMIT 1)
                 ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $cron$
);

-- Manual trigger helper — preview or force a specific run from SQL.
CREATE OR REPLACE FUNCTION public.trigger_tafe_weekly_fill(
  p_dry_run boolean DEFAULT false,
  p_week    text    DEFAULT NULL,
  p_org_id  uuid    DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT net.http_post(
    url     := (SELECT value FROM public.app_config WHERE key = 'tafe_fn_url' LIMIT 1),
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization',
                 'Bearer ' || (SELECT value FROM public.app_config WHERE key = 'tafe_fn_token' LIMIT 1)
               ),
    body    := jsonb_strip_nulls(jsonb_build_object(
                 'dryRun',  p_dry_run,
                 'weekKey', p_week,
                 'orgId',   p_org_id::text
               )),
    timeout_milliseconds := 60000
  );
$$;

COMMENT ON FUNCTION public.trigger_tafe_weekly_fill IS
  'Manually fire the tafe-weekly-fill edge function. p_dry_run=TRUE returns '
  'the planned writes without executing. p_week overrides the auto-computed '
  'upcoming Monday (format DD.MM.YY). p_org_id restricts to one organisation. '
  'Returns the pg_net request id.';
