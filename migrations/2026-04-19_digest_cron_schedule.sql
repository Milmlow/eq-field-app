-- Migration: schedule supervisor-digest via pg_cron
-- Created: 2026-04-19 (v3.4.9, supervisor digest)
-- Purpose: fire the supervisor-digest edge function every Friday at
--          12:00 Australian Eastern time. AEST = UTC+10 → 02:00 UTC.
--          Running cron in UTC means Sydney gets 12:00 AEST in winter and
--          13:00 AEDT in summer (daylight-saving shift). That's accepted
--          trade-off vs the complexity of DST-aware scheduling in pg_cron.
--
-- Apply ORDER:
--   1. Deploy the supervisor-digest edge function first
--      (supabase functions deploy supervisor-digest)
--   2. Set the required function secrets (RESEND_API_KEY etc.)
--   3. Create an app_config row with the Supabase function URL + a
--      service-role bearer so pg_cron can call it authenticated:
--        INSERT INTO app_config (key, value) VALUES
--          ('digest_fn_url',   'https://<project>.supabase.co/functions/v1/supervisor-digest'),
--          ('digest_fn_token', '<service-role-jwt>')
--        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
--   4. Apply THIS migration.
--
-- To disable temporarily:   SELECT cron.unschedule('supervisor-digest-weekly');

-- Required extensions (no-ops if already enabled).
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove any previous schedule under this name so re-applying is idempotent.
DO $$
BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'supervisor-digest-weekly';
EXCEPTION WHEN OTHERS THEN
  -- cron.job may not exist on very fresh projects; ignore.
  NULL;
END $$;

-- Friday 02:00 UTC — 12:00 AEST (13:00 AEDT).
SELECT cron.schedule(
  'supervisor-digest-weekly',
  '0 2 * * 5',
  $cron$
    SELECT net.http_post(
      url     := (SELECT value FROM public.app_config WHERE key = 'digest_fn_url'  LIMIT 1),
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Authorization',
                   'Bearer ' || (SELECT value FROM public.app_config WHERE key = 'digest_fn_token' LIMIT 1)
                 ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $cron$
);

-- Manual trigger helper: SELECT public.trigger_supervisor_digest();
CREATE OR REPLACE FUNCTION public.trigger_supervisor_digest(p_dry_run boolean DEFAULT false)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT net.http_post(
    url     := (SELECT value FROM public.app_config WHERE key = 'digest_fn_url'  LIMIT 1),
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization',
                 'Bearer ' || (SELECT value FROM public.app_config WHERE key = 'digest_fn_token' LIMIT 1)
               ),
    body    := jsonb_build_object('dryRun', p_dry_run),
    timeout_milliseconds := 30000
  );
$$;

COMMENT ON FUNCTION public.trigger_supervisor_digest IS
  'Manually fire the supervisor-digest edge function. Pass TRUE for a dry run '
  '(returns what would be sent without sending). Returns the pg_net request id.';
