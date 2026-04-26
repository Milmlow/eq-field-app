# v3.4.9 — Supervisor Digest (demo drop)

**Release date:** 2026-04-19
**Branch:** `demo` (eq-solves-field.netlify.app)
**Tag line:** Friday lunchtime, every supervisor knows where their week is going.

---

## What shipped

A scheduled email digest that lands in every opted-in supervisor's inbox at
**12:00 AEST every Friday**. Each digest is personalised to the recipient and
covers four things: leave next week, pending requests waiting on them,
unrostered staff, and timesheet completion for the week just ending.

This is the first piece of EQ Field that runs on a Supabase Edge Function and
pg_cron rather than a user-triggered Netlify call. Same Supabase DB, same
RLS — just driven by a service-role schedule instead of a session.

### 1. Friday 12:00 AEST cadence

`pg_cron` job `supervisor-digest-weekly` fires at `0 2 * * 5` UTC, which is
Friday 12:00 AEST in winter and 13:00 AEDT during daylight saving. Royce
picked Friday lunchtime so supervisors have the afternoon to review pending
requests and chase missing timesheets before the week closes.

Manual trigger for testing:

```sql
SELECT public.trigger_supervisor_digest(true);   -- dry run
SELECT public.trigger_supervisor_digest(false);  -- send for real
```

### 2. Per-supervisor opt-in

`managers.digest_opt_in` (boolean, default **true**) controls who receives.
The migration sets every existing supervisor to opted-in. Supervisors can
opt out from the **Supervision page** — there's a new "📧 Weekly supervisor
digest" panel above the contacts list with a checkbox per supervisor with an
email on file. Tick toggles `digest_opt_in` immediately via the same
`sbFetch()` PATCH the rest of the app uses.

Opt-out also works from SQL for ops convenience:

```sql
UPDATE managers SET digest_opt_in = false WHERE name = 'Demo Supervisor';
```

### 3. Section 1 — On leave next week

Approved `leave_requests` whose date range overlaps next Mon–Sun
(`date_start <= nextSunday AND date_end >= nextMonday`, `status = 'Approved'`,
not archived). Empty state shows "Nobody approved off next week. 🎉" so
nobody mistakes the message for a delivery failure.

### 4. Section 2 — Pending your approval

Pending `leave_requests` filtered by `approver_name = <recipient>`. The
subject line bumps these to the front: when there's at least one pending,
the subject becomes **"Weekly digest · N pending for you · Mon DD MMM"**
to flag inbox-skim attention. Otherwise it's the plain weekly subject.

### 5. Section 3 — Unrostered next week

Active people (`people` with `deleted_at IS NULL`) whose name doesn't appear
on a `schedule` row for next week, OR who appears but every Mon–Sun cell is
blank or a leave/education code (RDO, A/L, TAFE, etc.). Defensible
definition of "unrostered" — covers both "missing from the roster" and
"present but unscheduled".

### 6. Section 4 — Timesheet completion this week

For the week just ending: counts every rostered cell in `schedule`
(non-blank, not a leave/education code) as one expected timesheet day. For
each expected day, checks the matching `timesheets` row's same-day `hrs`
column for `> 0`. Percentage with green/amber/red bar, plus a list of
people still to submit. Returns *"No rostered days this week — nothing to
measure"* on empty weeks rather than an awkward 0%.

### 7. Two email transports — Resend or Netlify

Edge function reads `DIGEST_TRANSPORT` env:

* `resend` (default): direct call to Resend API. Cleanest for the demo
  drop — no Netlify dependency. Requires `RESEND_API_KEY` and
  `DIGEST_FROM_EMAIL`.
* `netlify`: posts to the existing `/.netlify/functions/send-email` with a
  shared-secret header `x-eq-digest-secret`. Reuses the live SKS sender
  setup, but the Netlify function needs a one-line update on its end to
  accept the secret as an alternative to the `x-eq-token` session check.

Default is `resend` so the demo can ship end-to-end without touching
Netlify. SKS prod can switch to `netlify` once Royce updates `send-email`.

### 8. Multi-tenant safe

The function loops every active row in `organisations` and runs them
independently. A bad row in one org doesn't block the others. `orgSlug`
parameter on the manual POST scopes a single org for testing
(`{"dryRun":true,"orgSlug":"eq"}`).

### 9. Defensive UI fallback

`scripts/digest-settings.js` checks for the `digest_opt_in` column at runtime.
If the migration hasn't been applied yet, every supervisor is treated as
opted-in (default state) and toast errors are surfaced cleanly when toggle
PATCHes fail. The zip can be uploaded before the SQL is run without
breaking the page.

---

## Database

Two new migrations:

`migrations/2026-04-19_managers_digest_opt_in.sql`

* `ALTER TABLE managers ADD COLUMN digest_opt_in boolean NOT NULL DEFAULT true`
* Partial index `managers_org_digest_idx` on opted-in non-deleted rows
* Two supporting indexes on `leave_requests` for the digest's status and
  date-range scans

`migrations/2026-04-19_digest_cron_schedule.sql`

* Enables `pg_cron` and `pg_net` if not already on
* Idempotently re-creates `supervisor-digest-weekly` cron entry
* Creates `public.trigger_supervisor_digest(p_dry_run boolean)` for manual
  runs from the SQL editor

**Pre-apply on EQ demo Supabase (`ktmjmdzqrogauaevbktn`):**

```sql
-- Confirm pg_cron and pg_net are available
SELECT extname FROM pg_extension WHERE extname IN ('pg_cron','pg_net');

-- Confirm managers table has rows we want to subscribe by default
SELECT count(*) FROM managers WHERE deleted_at IS NULL AND email IS NOT NULL;
```

Apply order:

1. Deploy edge function (`supabase functions deploy supervisor-digest`)
2. Set function secrets (`RESEND_API_KEY`, optional `APP_ORIGIN`)
3. Insert the two `app_config` rows the cron job reads:
   * `digest_fn_url` — `https://ktmjmdzqrogauaevbktn.supabase.co/functions/v1/supervisor-digest`
   * `digest_fn_token` — service-role JWT
4. Apply both migrations

---

## File changes

* **New:** `supabase/functions/supervisor-digest/index.ts` (~340 lines) — Deno edge function
* **New:** `supabase/functions/supervisor-digest/deno.json`
* **New:** `supabase/functions/supervisor-digest/README.md`
* **New:** `migrations/2026-04-19_managers_digest_opt_in.sql`
* **New:** `migrations/2026-04-19_digest_cron_schedule.sql`
* **New:** `scripts/digest-settings.js` (~125 lines) — opt-in toggle UI
* **New:** `CHANGELOG-v3.4.9.md` (this file)
* **Edited:** `index.html` — `<script src="scripts/digest-settings.js">`, header comment + footer version stamp → v3.4.9
* **Edited:** `scripts/app-state.js` — `APP_VERSION` → `3.4.9`
* **Edited:** `sw.js` — comment + `CACHE` → `eq-field-v3.4.9`, `digest-settings.js` added to PRECACHE

---

## Not in this drop

* No SKS prod promotion. EQ demo runs the digest for two cycles before SKS
  picks it up. When promoted, the same migrations and edge function deploy
  to `nspbmirochztcjijmcrx` — content stays identical, only the project ref
  changes.
* The Netlify `send-email` function does not yet accept the
  `x-eq-digest-secret` shared-secret header. Default transport is Resend so
  this isn't blocking. If Royce wants to switch to Netlify, that function
  needs a single-line check added (separate change).
* Digest opt-in toggles are write-through to Supabase but there is no audit
  log entry for them. If we want this to count toward the audit trail, add
  an `audit_log` insert in `digest-settings.js#toggleDigest`.
* No HTML preview button on the Supervision page yet — for now a dry run
  via `SELECT public.trigger_supervisor_digest(true);` is the testing
  surface. A "Preview my digest" button could come in the next drop.
* Daylight saving: cron runs in UTC, so the digest lands at 12:00 AEST in
  winter and 13:00 AEDT in summer. Accepted trade-off — `pg_cron` doesn't
  do timezone-aware scheduling.
