# v3.4.18 — Timesheet Reminder Emails

**Date:** 2026-04-21
**Scope:** EQ Solves Field (demo tenant ready; SKS promotion gated by `PROMOTE-v3.4.16-18-TO-MAIN.md`)

---

## What's new

- **Per-row "Send reminder" button** on the timesheet pending popover
  (introduced in v3.4.17). Clicking it calls a new edge function that
  emails the person a "please complete your timesheet" nudge for the
  current week, pre-populated with which days are missing or partial.
- **Rate limit** — one reminder per `(org, person_name, week)` per
  `REMIND_COOLDOWN_HOURS` (default **12**). A second click during
  cooldown returns `{ ok: true, rateLimited: true, lastSentAt }` and
  the UI shows "Already reminded · last sent <time>". The button
  locks to `✓ Reminded` so supervisors see the state.
- **Audit trail** — every send (success *and* failure) is recorded
  in the new `ts_reminders_sent` table, with sender, recipient email,
  transport, and provider detail on failure.
- **Client-side gap surfacing** — if a person has no `email` on file
  the button is rendered disabled with a "No email" label, so the
  supervisor sees the missing data *before* clicking.
- **Audit log integration** — `auditLog()` writes a row for each
  send and each cooldown skip so the Supervision → Audit view
  shows reminder history alongside other timesheet actions.

## Schema change

New migration: `migrations/2026-04-21_ts_reminders_sent.sql`

```
public.ts_reminders_sent
  id            uuid pk
  org_id        uuid fk → organisations(id)
  person_name   text
  person_email  text               -- captured at send time
  week          text               -- 'dd.MM.yy' Monday key
  sent_by       text               -- supervisor display name
  sent_at       timestamptz
  transport     text               -- 'resend' | 'netlify'
  ok            boolean
  detail        text               -- provider response preview
```

RLS: enabled; anon/authenticated can `select` (so the client can
display "last reminded" timestamps later). Writes only happen via
the service-role edge function.

Applied to EQ demo Supabase (`ktmjmdzqrogauaevbktn`) on 2026-04-21.

## New edge function

`supabase/functions/ts-reminder/index.ts` — deployed to EQ demo.

- **Auth:** `verify_jwt = true`. The app front-end supplies the anon
  JWT; the function uses `SUPABASE_SERVICE_ROLE_KEY` for DB access.
- **Request body:** `{ orgSlug, personName, week, sentBy?, dryRun?,
  appOrigin? }`.
- **Transport:** reuses the `DIGEST_TRANSPORT` env convention from
  `supervisor-digest` — no new secrets needed. Defaults to Resend
  (`RESEND_API_KEY` + `DIGEST_FROM_EMAIL`). Netlify path supported
  via `NETLIFY_SEND_EMAIL_URL` + `EQ_DIGEST_SECRET`.
- **CORS:** permissive (`*`) for now; can be tightened to
  `eq-solves-field.netlify.app` / `sks-nsw-labour.netlify.app`
  when SKS is promoted.

## Files changed

- `migrations/2026-04-21_ts_reminders_sent.sql` — new.
- `supabase/functions/ts-reminder/index.ts` — new (285 lines).
- `scripts/app-state.js` — `APP_VERSION = '3.4.18'`.
- `scripts/timesheets.js` —
  - `sendTsReminder(personName, week, btn)` helper added. Handles
    demo-tenant short-circuit, email-on-file gate, cooldown
    response, audit logging.
  - `updateTsStats()` popover rows updated to render the per-row
    button (enabled/disabled based on `person.email`).
- `index.html` — header block gains a v3.4.18 entry; footer version
  stamp bumped.
- `sw.js` — cache bumped to `eq-field-v3.4.18`.

## Compatibility notes

- **Schema additive only** — no existing columns touched. Safe to
  deploy the migration before the JS changes go live.
- **Edge function is additive** — `supervisor-digest` is unchanged;
  both functions share transport env.
- **SKS not yet affected** — SKS prod `supervisor-digest` is still
  v3.4.9 (pending promotion), and `ts-reminder` has not been
  deployed to SKS. See `PROMOTE-v3.4.16-18-TO-MAIN.md`.
- **Cooldown default (12h)** can be overridden per-project via
  `REMIND_COOLDOWN_HOURS` env var.

## Verification checklist (demo)

- [ ] Apply migration on EQ demo — confirmed via MCP.
- [ ] Edge function deployed and ACTIVE on EQ demo — confirmed.
- [ ] `RESEND_API_KEY` + `DIGEST_FROM_EMAIL` (or Netlify pair)
      present in EQ demo project secrets.
- [ ] Open Timesheets on demo → click "N pending" → row shows
      `Send reminder` button for staff with emails, `No email`
      for those without.
- [ ] Click `Send reminder` → toast reads "✓ Reminder sent to
      <email>"; button locks to `✓ Sent`.
- [ ] Click again immediately → toast reads "Already reminded · last
      sent …"; button locks to `✓ Reminded`.
- [ ] Inspect `ts_reminders_sent` — one row per attempt with
      `ok = true`, correct `sent_by` (supervisor display name),
      correct `transport`.
- [ ] Delete the row (or wait 12h) → button works again.
- [ ] Supervision → Audit view shows "Sent timesheet reminder →
      <email>" entries against the week.
- [ ] Dry-run via `curl -X POST .../functions/v1/ts-reminder -d
      '{"orgSlug":"eq","personName":"Alex Mitchell","week":"20.04.26","dryRun":true}'`
      returns `{ ok: true, dryRun: true, preview: { subject, html, … } }`.

## Security notes

- Function requires a valid Supabase JWT (anon or user). The front
  end attaches `SB_KEY` (anon) so any app visitor could theoretically
  invoke it; the real check is that the person they target must
  belong to the same `org_id` resolved from `orgSlug`. Tightening
  step (future): cross-check the caller against `managers` before
  allowing a send — deferred until SKS promotion so we can confirm
  the caller identity plumbing on live tenants.
- No PII added to logs beyond what was already there
  (`person_email` is now persisted — note in `ts_reminders_sent`).
