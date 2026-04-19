# v3.4.8 — Leave Module (demo drop)

**Release date:** 2026-04-19
**Branch:** `demo` (eq-solves-field.netlify.app)
**Tag line:** Leave requests you can trust to reach the right person.

---

## What shipped

The leave module is now fully functional on EQ Field demo. Previously the modals and the Leave tab were present in the UI but had no JavaScript behind them — submitting a request did nothing. The working implementation is ported from SKS v3.4.5, where these behaviours have been running in production.

### 1. Leave requests actually work

`scripts/leave.js` is now shipped with EQ Field. Every button on the Leave tab does what it says: submit, approve, reject, withdraw, resend email, archive, restore, print, filter, search, calendar view. Both staff (`STATE.people`) and supervisors (`STATE.managers`) can submit their own requests.

### 2. Supervisor selection is required

Submitting without picking an approver now red-highlights the select, scrolls to it, focuses it, and shows a toast:

> ⚠ Choose your supervisor — they need to approve this request

The approver dropdown filters out the person submitting, so you can't pick yourself. This was the most common cause of orphaned requests on SKS before the v3.4.5 hotfix.

The approver field copy is clearer too — label reads **"Your Supervisor *"** with a helper line: *"📧 Your approval email will be sent to this supervisor — the request is not flagged to anyone without a selection."*

### 3. Rejection requires a reason

Rejecting a request with an empty response note now red-highlights the note field and shows:

> ⚠ Add a reason when rejecting — the requester will see this

The requester sees the reason in their rejection email and in the list view.

### 4. Backdated-leave confirmation

Submitting a request with a start date before today now opens a confirm modal:

> This leave starts on YYYY-MM-DD, which is in the past. Continue submitting a backdated request?

Prevents accidental submits when the date picker was left on a stale value.

### 5. Withdraw a pending request

New **Withdrawn** status (neutral grey chip). Withdraw button is visible to the requester themselves or to any supervisor while the request is still Pending. Uses the standard confirm modal so a stray tap on a phone won't nuke the request.

Bulk archive of resolved requests now includes Withdrawn alongside Approved/Rejected, so withdrawn requests don't linger.

### 6. Submission receipt

New `submit_confirmation` email type. Requesters get a receipt email the moment they submit, including who needs to approve it. Silent-fail: if the requester has no email on file, it skips without a toast (the approver email is the critical one).

### 7. CC supervisors on status emails

Approval and rejection emails now CC the same supervisor CC list that was already CC'd on new requests. The whole chain sees the outcome, not just the requester.

### 8. Status emails fall through to managers list

If the person submitting leave is a supervisor (in `STATE.managers`) rather than regular staff (in `STATE.people`), the status-update email now still lands — previously it looked only in `STATE.people` and silently dropped the notification.

### 9. Quick-add supervisors to CC config

The Email Notification CC List modal now has a **Quick-add from Supervisors** chip strip above the manual CC list. Chips render from `STATE.managers` with emails, toggle on/off with a visible ✓/+ state, and stay in sync with the manual list.

### 10. Email CTA URLs follow the current deploy

Email CTA links now use `${window.location.origin}` so preview/branch deploys link back to themselves instead of the hard-coded production host.

---

## Database

New migration: `migrations/2026-04-19_leave_requests_approver_required.sql`

Makes `leave_requests.approver_name` `NOT NULL` with a `CHECK (approver_name <> '')` constraint. Defense-in-depth — the UI now enforces it, this stops anyone hitting the API directly from inserting an orphaned request.

**Pre-check before applying to EQ demo Supabase (`ktmjmdzqrogauaevbktn`):**

```sql
SELECT COUNT(*) FROM leave_requests
WHERE approver_name IS NULL OR approver_name = '';
-- must return 0 before applying
```

If the count is 0, apply the migration. If it's non-zero, backfill the offenders first.

---

## File changes

- **New:** `scripts/leave.js` (996 lines) — full leave module implementation
- **New:** `CHANGELOG-v3.4.8.md` (this file)
- **New:** `migrations/2026-04-19_leave_requests_approver_required.sql`
- **Edited:** `index.html` — approver label + helper text, `#leave-cc-supervisors` container added to CC modal, header comment + footer version stamp → v3.4.8
- **Edited:** `scripts/app-state.js` — `APP_VERSION` → `3.4.8`
- **Edited:** `sw.js` — comment + `CACHE` → `eq-field-v3.4.8`

---

## Not in this drop

- SKS v3.4.5 shipped the same leave improvements as a *hotfix* to an existing module. On EQ Field this is a first-shipment — the leave module has never been live here before. Expect at least one follow-up pass once real demo users poke at it.
- The leave page doesn't yet include an archive-toggle button in the EQ Field header strip. The underlying function (`toggleShowArchived`) is present and guarded against a missing button, so adding the button in a later drop will turn the feature on without any JS changes.
