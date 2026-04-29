# tafe-weekly-fill

Auto-fills "TAFE" into the upcoming week's roster for every apprentice
who has a nominated TAFE day. Runs every Sunday afternoon AEST via
pg_cron. Idempotent — only writes empty cells, skips holiday ranges,
skips days where someone already wrote something.

Mirrors the manual "🎓 Apply TAFE Day" button in `scripts/tafe.js` but
fires whether or not a manager has the app open.

## Triggers

- **pg_cron**, every Sunday 06:00 UTC (= 16:00 AEST / 17:00 AEDT in summer).
  See `migrations/2026-04-29_tafe_weekly_cron.sql`.
- **Manual** via SQL helper:
  ```sql
  SELECT public.trigger_tafe_weekly_fill();                     -- live run
  SELECT public.trigger_tafe_weekly_fill(p_dry_run := true);    -- preview
  SELECT public.trigger_tafe_weekly_fill(                       -- specific week
    p_dry_run := true, p_week := '04.05.26'
  );
  ```
- **HTTP POST** with optional body:
  ```json
  { "dryRun": false, "weekKey": "DD.MM.YY", "orgId": "uuid" }
  ```

## Required env (Edge Function secrets)

- `SUPABASE_URL` — auto-populated by Supabase
- `SUPABASE_SERVICE_ROLE_KEY` — auto-populated by Supabase

## Required `app_config` rows (per tenant project)

- `tafe_fn_url` — `https://<project>.supabase.co/functions/v1/tafe-weekly-fill`
- `tafe_fn_token` — service-role JWT (so pg_cron can call the function)

## Deploy

```
supabase functions deploy tafe-weekly-fill
```

Then apply `migrations/2026-04-29_tafe_weekly_cron.sql` in the same
Supabase SQL editor.

To temporarily disable:
```sql
SELECT cron.unschedule('tafe-weekly-fill');
```

## Behaviour

For each apprentice with `people.group = 'Apprentice'` and a non-null
`tafe_day`:

1. Compute target date = `nextMonday + DAY_KEYS.indexOf(tafe_day)`.
2. Skip the apprentice if that date falls inside any range stored in
   `app_config.tafe_holidays`.
3. Find the schedule row for `(name, week, org_id)`. Create a new one
   if missing.
4. Skip if the target weekday cell is already non-empty.
5. Compare-and-swap write of `'TAFE'` — `UPDATE … WHERE <day> IS NULL`,
   so a concurrent manual write wins and we treat it as occupied.
6. Audit log entry under `manager_name = 'TAFE Auto-Fill'`.
