# supervisor-digest

Supabase Edge Function. Sends a weekly digest email to every opted-in
supervisor in `managers` every Friday at 12:00 AEST (see
`migrations/2026-04-19_digest_cron_schedule.sql`).

## Deploy

```bash
# From repo root (wherever you keep the supabase CLI config):
supabase link --project-ref ktmjmdzqrogauaevbktn   # EQ demo
supabase functions deploy supervisor-digest --project-ref ktmjmdzqrogauaevbktn
```

## Required env (set as Supabase function secrets)

| Key                        | Purpose                                                              |
| -------------------------- | -------------------------------------------------------------------- |
| `SUPABASE_URL`             | Auto-injected by Supabase.                                           |
| `SUPABASE_SERVICE_ROLE_KEY`| Auto-injected. Used to read across tenants.                          |
| `DIGEST_TRANSPORT`         | `resend` (default) or `netlify`.                                     |
| `RESEND_API_KEY`           | Required if transport = `resend`.                                    |
| `DIGEST_FROM_EMAIL`        | Optional; default `EQ Field <noreply@eq.solutions>`.                 |
| `NETLIFY_SEND_EMAIL_URL`   | Required if transport = `netlify`. Full URL to `send-email`.         |
| `EQ_DIGEST_SECRET`         | Shared secret the Netlify function must accept on `x-eq-digest-secret`. |
| `APP_ORIGIN`               | Optional; link in email footer. Default demo URL.                    |

```bash
supabase secrets set \
  DIGEST_TRANSPORT=resend \
  RESEND_API_KEY=re_xxxxx \
  DIGEST_FROM_EMAIL='EQ Field <noreply@eq.solutions>' \
  APP_ORIGIN='https://eq-solves-field.netlify.app' \
  --project-ref ktmjmdzqrogauaevbktn
```

## Manual invocation (dry run, no email sent)

```bash
curl -X POST \
  "https://ktmjmdzqrogauaevbktn.supabase.co/functions/v1/supervisor-digest" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true, "orgSlug": "eq"}'
```

The response lists how many supervisors would have been mailed and any
per-supervisor errors — nothing is sent.

## Digest contents

Per supervisor:

1. **On leave next week** — approved leave requests whose date range overlaps
   next Mon–Sun.
2. **Pending your approval** — pending requests where `approver_name = <you>`.
3. **Unrostered next week** — active people with no schedule row for next
   week (or only blank / leave codes).
4. **Timesheet completion this week** — rostered-day timesheet submissions
   divided by rostered days for the week just ending. A day counts as
   "submitted" if the same-day `hrs` column on `timesheets` is > 0.

## Safe promotion path

1. Deploy to EQ demo (`ktmjmdzqrogauaevbktn`) and run 2–3 cycles.
2. Once the format is right, re-run `supabase functions deploy` against
   SKS prod (`nspbmirochztcjijmcrx`) and apply the same migrations.
