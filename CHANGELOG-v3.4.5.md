# EQ Solves — Field — v3.4.5

**Release date:** 19 April 2026
**Focus:** Leave module hotfix pass + "Pro" usability upgrades — email link, supervisor enforcement, supervisor email lookup, CC quick-picks, rejection reasons, backdated-leave guard, withdraw, confirmation receipts

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

### L10 · Quick-pick supervisors for the CC list (Feature)

CC'ing the other supervisors on every leave email used to mean retyping each address into the CC config modal. Now the modal opens with a "Quick-add from Supervisors" row of chips — one per manager that has an email on file. Tap a chip to toggle them in or out of the CC list.

- New container `#leave-cc-supervisors` rendered above the existing email-chip list.
- Chips show as outlined "+ Name" when not in the CC list and filled purple "✓ Name" when added. Tooltip shows full name + role + email.
- New `renderLeaveCCSupervisors()` and `toggleLeaveCCSupervisor(email)` keep both views in sync — manual `addLeaveCC` / `removeLeaveCC` calls also re-render the chip strip so state stays consistent regardless of which entry path you use.
- All emails are normalised to lowercase before compare/store (matches existing convention).

### L11 · Status-update emails CC the supervisor group too (Pro)

Pairs with L10. The CC list was only being applied to the *new request* email — when a request was approved or rejected, only the requester saw it. The other supervisors lost visibility once the approver responded.

- `triggerLeaveEmail('status_update')` now sets `cc = leaveCCList.filter(e => e && e !== to)` so the same supervisor group that was CC'd on submission is CC'd on the outcome. Self-recipient is filtered out so people don't get the email twice if they're both the requester and on the CC list.

### L12 · Rejecting a request requires a reason (Pro)

Without a written reason, "Rejected" arrives in the requester's inbox as a wall — no context, no path forward. Supervisors were sometimes hitting Reject with the note field blank.

- `respondLeave('Rejected')` now blocks submit if the response note is empty. Field flashes red + glow, scrolls into view, takes focus, toast reads *"⚠ Add a reason when rejecting — the requester will see this."*
- Approvals are unaffected — the note is still optional when approving.

### L13 · Backdated-leave confirmation guard (Pro)

The leave date picker remembers its last value, so a quick re-submit could end up dated last week without anyone noticing. People then ended up retroactively booking in leave they'd already taken (or never took), distorting the schedule and the audit trail.

- New check in `submitLeaveRequest()`: if `dateStart < todayIso`, show `modal-confirm` reading *"This leave starts on YYYY-MM-DD, which is in the past. Continue submitting a backdated request?"* with a "Submit Anyway" action button.
- Insert path refactored into `_performLeaveSubmit(row)` helper so the confirm path and the normal path share one implementation. No behaviour change for non-backdated submits.

### L14 · Withdraw a pending request (Pro)

Once submitted, the only way to "cancel" a request was to ask a supervisor to reject it — which then sat in the resolved list as a Rejection with no real meaning. Now requesters and supervisors can pull a pending request before it gets actioned.

- New "Withdrawn" status, distinct from Approved/Rejected. Renders as a neutral grey chip (not red) so it's visually clear the request was retracted, not denied.
- New `withdrawLeaveRequest(id)` function. Available to the requester themselves (matched via `sessionStorage.getItem('eq_logged_in_name')` set at PIN unlock) or any supervisor.
- "✕ Withdraw" button shown on each pending row when the viewer is allowed to act on it.
- Uses `modal-confirm` for the action so it can't be tapped past by accident on mobile.
- Status filter dropdown gains a "Withdrawn" option. `confirmArchiveAllResolved()` includes Withdrawn requests in the bulk-archive sweep.
- Audit log entry written on withdraw; existing approvals/rejections of withdrawn requests aren't possible because `respondLeave` is gated by the Pending Review screen which only lists Pending rows.

### L15 · Submission confirmation email to the requester (Pro)

Submitting a request used to be a leap of faith — you'd hit Submit and hope the email got through. Approvers were getting their notification but the requester had nothing in their inbox to point at. Now they get an immediate receipt.

- New `submit_confirmation` email type added to `triggerLeaveEmail`.
- Fired from `_performLeaveSubmit()` immediately after the successful POST, in parallel with the approver email.
- Looks up the requester in `STATE.people` then falls back to `STATE.managers` (same logic as L9) so supervisors who submit their own leave also get a receipt.
- Failure is silent (console.error only, no toast) — the receipt is nice-to-have. The approver email still surfaces failure loudly.
- Includes a "View in App" CTA that uses `window.location.origin` so it lands on the correct tenant.

---

## 2. Files changed

```
 scripts/leave.js       — L7, L8, L9, L10, L11, L12, L13, L14, L15
 index.html             — L8: supervisor label + helper · L10: CC modal supervisor strip · L14: Withdrawn status filter · footer version stamp
 scripts/app-state.js   — APP_VERSION 3.4.5
 sw.js                  — cache bump v3.4.5
 CHANGELOG-v3.4.5.md    — NEW (this file)
 migrations/2026-04-19_leave_requests_approver_required.sql  — APPLIED to SKS prod
```

---

## 3. Schema / migrations

**Applied to SKS prod 19 Apr 2026** (`nspbmirochztcjijmcrx`). Defense-in-depth against rows being inserted with no supervisor. Pre-check returned 0 rows with blank `approver_name`, so it applied without a backfill.

```sql
-- migrations/2026-04-19_leave_requests_approver_required.sql
ALTER TABLE public.leave_requests
  ALTER COLUMN approver_name SET NOT NULL,
  ALTER COLUMN approver_name DROP DEFAULT;

ALTER TABLE public.leave_requests
  ADD CONSTRAINT leave_requests_approver_name_not_empty
  CHECK (approver_name <> '');
```

**For EQ Field (demo):** migration not yet applied. Apply to `ktmjmdzqrogauaevbktn` when porting v3.4.5. Pre-check first.

---

## 4. Testing checklist (smoke test before merge)

- [ ] Submit a leave request on `sks-nsw-labour.netlify.app` → tap the email's "Review in App" button → confirm it lands on `sks-nsw-labour.netlify.app`, not `eq-solves-field.netlify.app`.
- [ ] Open the leave request modal → tap Submit without choosing a supervisor → field flashes red, scrolls into view, toast reads *"⚠ Choose your supervisor…"*, no row created.
- [ ] Supervisor A selects themselves in "Your Name" → confirm their own name is no longer in the Supervisor dropdown.
- [ ] Supervisor A submits leave, Supervisor B approves → A receives the status-update email at their managers-row address (no more "no email on file" toast).
- [ ] Staff submits leave → selects supervisor → supervisor receives approver email with correct SKS link.
- [ ] Open CC config modal → supervisor chips render above the current CC list → tap a chip → it flips to ✓ / purple and the email appears in the list below → tap again → removed. Type an email manually → the matching supervisor chip updates to ✓ automatically.
- [ ] Approve a pending request with 1+ emails in the CC list → all CC'd supervisors receive the status-update email (requester is primary To:, CC group is CC:d, self-match is filtered out).
- [ ] Open a pending request → tap Reject with the note field empty → no row updated, note field flashes red, toast reads *"⚠ Add a reason when rejecting…"*. Add a note, tap Reject again → status updates, requester receives rejection email containing the note.
- [ ] Submit a leave request with a start date earlier than today → confirm modal appears ("This leave starts on YYYY-MM-DD…"). Cancel → no row. Submit Anyway → row inserted, emails fire normally.
- [ ] Submit a leave request as yourself → confirmation email arrives in your own inbox shortly after with subject "Leave Request Submitted: …". Approver still receives their email.
- [ ] Pending request from logged-in user X → row shows "✕ Withdraw" button → tap → confirm modal → Withdraw → row moves to Withdrawn (grey chip), responded_by = X, approver no longer sees it in the Pending queue.
- [ ] Pending request from user Y, logged in as user Z (not a supervisor) → no Withdraw button shown. Log in as supervisor → Withdraw button appears.
- [ ] Filter dropdown → select "Withdrawn" → only withdrawn rows shown. Bulk Archive Resolved → withdrawn rows archived alongside approved/rejected.
