# v3.4.9 — Deploy & Test Guide

**What's already done:** both SQL migrations are applied to EQ demo
(`ktmjmdzqrogauaevbktn`). `managers.digest_opt_in` column exists (default
true), both demo supervisors opted in, `cron.job supervisor-digest-weekly`
scheduled at `0 2 * * 5` UTC. But the cron can't send anything yet because
(a) the edge function isn't deployed and (b) the `app_config` rows aren't
populated.

**What's in the zip (`eq-field-demo-v3.4.9.zip`)**

```
index.html                                              — +digest-settings.js script tag, v3.4.9 stamps
sw.js                                                    — cache bump eq-field-v3.4.9 + PRECACHE add
scripts/app-state.js                                     — APP_VERSION = '3.4.9'
scripts/digest-settings.js                               — NEW opt-in toggle UI
migrations/2026-04-19_managers_digest_opt_in.sql         — ALREADY APPLIED
migrations/2026-04-19_digest_cron_schedule.sql           — ALREADY APPLIED
supabase/functions/supervisor-digest/index.ts            — NEW edge function (Deno)
supabase/functions/supervisor-digest/deno.json           — NEW
supabase/functions/supervisor-digest/README.md           — NEW
CHANGELOG-v3.4.9.md                                      — NEW
```

---

## What you still need to do

### 1. Push the frontend to GitHub `demo` branch

Unzip and commit to `Milmlow/eq-field-app` on the `demo` branch. Netlify
picks it up automatically. The migrations and `supabase/functions/` folder
don't *need* to be in the repo (they don't get deployed from there), but
keeping them in is nice for history.

### 2. Deploy the edge function

From a terminal in the repo root (one-time setup if needed):

```bash
npm i -g supabase
supabase login
supabase link --project-ref ktmjmdzqrogauaevbktn
supabase functions deploy supervisor-digest --project-ref ktmjmdzqrogauaevbktn
```

### 3. Set function secrets

```bash
supabase secrets set \
  DIGEST_TRANSPORT=resend \
  RESEND_API_KEY=re_xxxxxxxxxxxxxxxx \
  DIGEST_FROM_EMAIL='EQ Field <noreply@eq.solutions>' \
  APP_ORIGIN='https://eq-solves-field.netlify.app' \
  --project-ref ktmjmdzqrogauaevbktn
```

`DIGEST_FROM_EMAIL` must use a domain you've verified with Resend — if
`eq.solutions` isn't verified there, use whatever sender domain you have
(e.g. one that's verified for the existing Netlify send-email). Resend's
free tier is happy with any verified domain.

### 4. Point the cron job at the function

In the Supabase SQL editor (EQ demo project):

```sql
-- Grab your service-role JWT from:
-- Supabase → Settings → API → Project API keys → service_role (reveal)

INSERT INTO public.app_config (key, value) VALUES
  ('digest_fn_url',   'https://ktmjmdzqrogauaevbktn.supabase.co/functions/v1/supervisor-digest'),
  ('digest_fn_token', '<paste service_role JWT here>')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

Double-check both rows are scoped right. If your `app_config` has a
`org_id` column that's NOT NULL, add `, org_id = <your eq org uuid>` (and
`WHERE org_id = …` on the conflict target).

### 5. First manual test — dry run

```sql
SELECT public.trigger_supervisor_digest(true);
```

This returns a `pg_net` request id (a bigint). Then check the response:

```sql
SELECT id, status_code, content::jsonb
FROM net._http_response
ORDER BY id DESC LIMIT 1;
```

You want `status_code = 200` and JSON like:

```json
{
  "ok": true,
  "dryRun": true,
  "results": [{ "slug": "eq", "sent": 2, "eligibleManagers": 2, "errors": [], "dryRun": true }]
}
```

If `sent: 0`, nobody had an email OR everyone's opted out. If `errors[]`
has something, read the message — usually a missing secret or a bad
sender domain.

### 6. First live test — send for real

```sql
SELECT public.trigger_supervisor_digest(false);
```

Same response check. Now you should have an email in the inbox of each
opted-in supervisor.

---

## Set yourself up as a supervisor to see the digest

Two options:

**Option A — Replace a demo manager with your email** (simplest)

```sql
UPDATE public.managers
SET name = 'Royce Milmlow', email = 'your.real@email.com'
WHERE name = 'Demo Supervisor';
```

**Option B — Add yourself as a third manager**

Go to the EQ demo app → unlock supervisor mode → Supervision page →
`＋ Add Contact` → fill in your details (use your real email).

Then in SQL, or via the new toggle panel, confirm `digest_opt_in = true`
for your row.

---

## How to test the four sections

Each digest section has a deliberate way to force a non-empty state so
you can confirm the layout and logic:

### 1. "On leave next week"

Create an approved leave request that overlaps next week (27 Apr → 3 May
2026 from today):

- In the app: Leave page → submit a request for yourself with dates
  27.04.26 to 01.05.26 → have another supervisor approve it (or flip it
  in SQL: `UPDATE leave_requests SET status = 'Approved' WHERE id = '…'`).

### 2. "Pending your approval"

- In the app while logged in as a *different* user: submit a leave
  request with **you** as the approver.
- Run the dry-run: your pending count should be 1+, subject line should
  read *"N pending for you"*.

### 3. "Unrostered next week"

The roster for week 27.04.26 may not exist yet in the demo data (only
through 20.04.26 is seeded). That means everyone will show as unrostered
on first test — good for verifying the list renders.

To shrink the list for a cleaner look, copy one of the existing
schedule rows to next week:

```sql
INSERT INTO public.schedule (org_id, name, week, mon, tue, wed, thu, fri)
SELECT org_id, name, '27.04.26', mon, tue, wed, thu, fri
FROM public.schedule
WHERE week = '20.04.26' AND name IN ('Alex Mitchell','Jordan Lee');
```

Now Alex and Jordan won't show in the unrostered list.

### 4. "Timesheet completion this week"

For **this week** (20.04.26 Monday) — the denominator is the number of
rostered weekday cells in `schedule`. The numerator is `timesheets.*`
hours > 0 for the same people and week.

Quickest way to see a partial completion bar:

```sql
-- Pick one person who's rostered this week and submit a partial timesheet
INSERT INTO public.timesheets (org_id, name, week, mon, tue, wed, thu, fri, submitted_by)
SELECT org_id, 'Alex Mitchell', '20.04.26', 8, 8, 0, 0, 0, 'test'
FROM public.managers LIMIT 1
ON CONFLICT DO NOTHING;
```

This gives Alex 2 of 5 days. The bar should render red with Alex not in
the "still to submit" list (because some days *are* submitted, but the
completion rate is about total days across the org, so Alex's 3 missing
days still count in the org-wide denominator).

If the `timesheets` table has a unique constraint on `(name, week)` you
may need to `UPDATE` instead of `INSERT`.

---

## Advice on testing

**Start with dry runs.** `trigger_supervisor_digest(true)` renders
the HTML and iterates recipients but doesn't call the mail provider. The
JSON response tells you how many emails *would* have gone out and
surfaces any per-recipient errors. Cheap feedback loop.

**Use one real inbox.** For the first live run, point both demo
supervisors at *your* email (`UPDATE managers SET email = 'me@…'`).
You'll get both copies and can compare — each is personalised to the
recipient's `pending_for_me` filter, so the Pending section should
differ between the two. Easy way to confirm the per-supervisor filter
actually works.

**Check the cron run log the Monday after.** First scheduled run is
Friday 24 Apr 2026 at 02:00 UTC:

```sql
SELECT jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'supervisor-digest-weekly')
ORDER BY start_time DESC LIMIT 5;
```

`status = 'succeeded'` means `net.http_post` accepted the request. Then:

```sql
SELECT id, status_code, timed_out, error_msg, content::text
FROM net._http_response
WHERE created > now() - interval '24 hours'
ORDER BY id DESC LIMIT 5;
```

That's the actual HTTP result from the edge function.

**Check edge function logs.** `supabase functions logs supervisor-digest
--project-ref ktmjmdzqrogauaevbktn` streams the function's console output.
Useful if Resend rejects a sender domain or a recipient bounces.

**Verify the opt-in toggle UI.** After you refresh the page on the
`demo` branch at least once to pick up the v3.4.9 cache, go to the
Supervision page. The "📧 Weekly supervisor digest" panel should sit
above the contacts list with a checkbox per supervisor. Untick one, run
a dry run, confirm `sent` drops by 1 and that supervisor isn't in
`results[0].eligibleManagers` count.

**Test the HTML on a real client.** Gmail/Outlook render inline CSS
differently than dev tools. Before you trust the digest for real SKS
traffic, send one to a Gmail address and one to an Outlook/Office365
address. The layout is simple table-based HTML that should be
bulletproof, but spot-checking is cheap.

**Common failure modes to watch**

- `sent: 0, eligibleManagers: 0` → `managers.email IS NULL` for
  everyone, or `digest_opt_in = false` for everyone, or `deleted_at IS
  NOT NULL`.
- 401/403 from Resend → API key wrong or sender domain unverified.
- `net._http_response` shows timeout → edge function is taking >30s;
  likely a Supabase query not returning (uncommon; usually means
  `DIGEST_TRANSPORT` is wrong and the fetch is stalling).
- Digest email says "week of Mon DD MMM" with wrong date → your
  computer/Supabase clock is in a DST edge, or the app_config
  `digest_fn_url` is pointing to the wrong project.

**Rollback**

Digest is entirely append-only to the DB. To silence everything:

```sql
SELECT cron.unschedule('supervisor-digest-weekly');
UPDATE public.managers SET digest_opt_in = false;  -- belt and braces
```

Or just undeploy the function (`supabase functions delete
supervisor-digest`). The UI panel will still render from the opt-in
column but nothing will actually fire.
