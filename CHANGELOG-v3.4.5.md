# EQ Solves — Field — v3.4.5

**Release date:** 19 April 2026
**Focus:** Leave module hotfix pass — email link, supervisor enforcement, supervisor email lookup

---

## 1. Leave module fixes

### L7 · Email "Review in App" link points at the wrong tenant (Blocker · SKS)

The approval / status-update emails hard-coded `https://eq-solves-field.netlify.app` in the CTA button. SKS supervisors were landing on the EQ demo site when they tapped the link from their inbox.

- Both email templates in `triggerLeaveEmail()` now use `${window.location.origin}` — the email is composed in the same browser that just submitted/approved the request, so the origin always matches the active tenant.
- Works for `sks-nsw-labour.netlify.app`, `eq-solves-field.netlify.app`, and any branch/preview deploy.

### L8 · Supervisor selection is now impossible to miss (High · SKS)

Staff were submitting leave requests without picking a supervisor, which meant the approval email had nowhere to go and the request silently sat unflagged. Root cause: the original validation was a one-line toast that was easy to overlook on mobile, and the default "Approver" label didn't read as required.

- Form label changed from **Approver** to **Your Supervisor \*** with a red asterisk.
- Helper text added under the dropdown: *"📧 Your approval email will be sent to this supervisor — the request is not flagged to anyone without a selection."*
- Placeholder text changed from *"Select approver"* to *"Select your supervisor"* for plain-language clarity.
- On submit with no supervisor selected, the field now flashes a red border + glow, scrolls into view, takes focus, and the toast reads *"⚠ Choose your supervisor — they need to approve this request."*
- New helper `_populateLeaveApprovers(excludeName)` rebuilds the dropdown. When the requester picks themselves (a supervisor submitting their own leave) the dropdown re-filters to exclude their own name, so self-selection isn't possible at submit time. Pairs with the existing A01-04 self-approval guard at the approve step.

### L9 · Supervisor approval email says "no email on file" when there is one (High · SKS)

When a supervisor's own leave request was approved by another supervisor, the status-update email showed *"No email on file for \<supervisor\>"* and never sent — even though the supervisor's email is present in the `managers` table. Root cause: `triggerLeaveEmail('status_update')` was looking up the requester only in `STATE.people`.

- The lookup now falls through to `STATE.managers` when the name isn't found in `STATE.people`. Supervisors who submit leave now receive the approved / rejected email at the same address listed on their manager row.
- No change needed for the `new_request` flow — approvers are always in `STATE.managers`, which was already correct.

---

## 2. Files changed

```
 scripts/leave.js       — L7, L8, L9
 index.html             — L8: supervisor label + helper + footer version stamp
 scripts/app-state.js   — APP_VERSION 3.4.5
 sw.js                  — cache bump v3.4.5
 CHANGELOG-v3.4.5.md    — NEW (this file)
 migrations/2026-04-19_leave_requests_approver_required.sql  — OPTIONAL (hold for Royce)
```

---

## 3. Schema / migrations

One optional migration is included for defense-in-depth. The L8 UI changes already prevent submits with no supervisor from the app side, but the database currently allows `approver_name` to be `NULL` or `''`. If you want the DB to reject any row that somehow skips the UI guard (e.g. direct REST calls, future admin tooling), apply:

```sql
-- migrations/2026-04-19_leave_requests_approver_required.sql
ALTER TABLE public.leave_requests
  ALTER COLUMN approver_name SET NOT NULL,
  ALTER COLUMN approver_name DROP DEFAULT;

ALTER TABLE public.leave_requests
  ADD CONSTRAINT leave_requests_approver_name_not_empty
  CHECK (approver_name <> '');
```

Pre-check: `SELECT COUNT(*) FROM leave_requests WHERE approver_name IS NULL OR approver_name = '';` returns 0 on SKS prod (19 Apr 2026), so the migration is safe to apply without a backfill.

Hold for Royce to confirm before running — belt-and-braces only.

---

## 4. Testing checklist (smoke test before merge)

- [ ] Submit a leave request on `sks-nsw-labour.netlify.app` → tap the email's "Review in App" button → confirm it lands on `sks-nsw-labour.netlify.app`, not `eq-solves-field.netlify.app`.
- [ ] Open the leave request modal → tap Submit without choosing a supervisor → field flashes red, scrolls into view, toast reads *"⚠ Choose your supervisor…"*, no row created.
- [ ] Supervisor A selects themselves in "Your Name" → confirm their own name is no longer in the Supervisor dropdown.
- [ ] Supervisor A submits leave, Supervisor B approves → A receives the status-update email at their managers-row address (no more "no email on file" toast).
- [ ] Staff submits leave → selects supervisor → supervisor receives approver email with correct SKS link.
