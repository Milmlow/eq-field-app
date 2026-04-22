# EQ Field v3.4.21 — Leave: fix uuid id breaking inline handlers

**Released:** 2026-04-23
**Severity:** P1 — Review / Approve / Reject / Withdraw / Archive all silently
broken in the leave list since the SKS port (v3.4.8).

## What was broken

Clicking **Review** (or Resend / Withdraw / Archive / Restore) on a leave
request did nothing. No modal, no toast, no visible error. The console
showed three `Uncaught SyntaxError: Invalid or unexpected token` messages
at `(index):1` per pending row but they were dismissed as extension noise.

## Root cause

`scripts/leave.js` rendered each row's action buttons with raw template
interpolation:

```js
`<button onclick="openLeaveRespond(${r.id})">Review</button>`
```

In **SKS** (`leave_requests.id` is `bigint`) this produces valid JS:
`openLeaveRespond(123)`.

In **EQ Field** (`leave_requests.id` is `uuid`) this produces invalid JS:
`openLeaveRespond(a1b2c3d4-5e6f-7a8b-9c0d-…)`. The substring `5e6f` is
parsed as numeric-with-exponent, which then collides with the trailing
`f`/hex chars and throws `SyntaxError: Invalid or unexpected token`. The
inline handler is parsed lazily at click time, so the error fires on
click and the handler never runs — exactly matching the "nothing happens"
symptom.

The leave module was ported from SKS v3.4.5 in EQ Field v3.4.8 without
adapting for the uuid id type.

## Fixes

`scripts/leave.js`:

1. Quote `${r.id}` → `'${r.id}'` in all five inline onclick handlers in
   `renderLeaveList` (lines ~904-908): Review, Resend, Withdraw, Archive,
   Restore.
2. In `respondLeave` (line ~448), drop `parseInt()` on the modal's hidden
   id field — keep it as a string. Without this, Approve/Reject would
   silently fail with `id = NaN` after fix #1 lands.

`index.html`:

3. Bump version stamp to v3.4.21 (header comment + footer span).
4. Add this changelog block to the in-page CHANGES section.

## Verification

- Open demo, log in as a supervisor, open a Pending leave request → click
  Review → modal renders with requester / dates / type populated.
- Click Approve → status updates, toast confirms, modal closes, list
  refreshes.
- Click Reject without a note → red border + toast prompt for a reason.
- Click Reject with a note → status updates.
- Console clean of `Invalid or unexpected token` errors.

## Audit follow-up (recommended for v3.4.22)

Other modules likely have the same `${r.id}` pattern in inline handlers.
If their backing tables are uuid-keyed in EQ Field, the same bug applies.
Quick scan candidates: timesheets, jobnumbers, audit, journal, apprentices.
A grep for `onclick="[a-zA-Z]+\(\$\{[^}]*\.id\}` across `scripts/*.js`
will surface them. Worth a 30-min sweep before the next SKS promotion.

## Affects

- **EQ Field demo** — broken since v3.4.8 (2026-04-19).
- **SKS** — not affected (bigint id renders as valid number).

## Does not affect

- The Submit / Withdraw flow for end-users (their own request cards use
  a different path).
- Leave email notifications (separate code path).
- Schedule write-back (runs server-side after Approve, only after Approve
  works again).
