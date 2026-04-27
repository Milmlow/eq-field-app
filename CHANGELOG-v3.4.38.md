# v3.4.38 — Leave action lookups: id coercion fix

**Date:** 2026-04-27
**Branch flow:** demo → main
**Why:** Royce reported on SKS prod that "the Withdraw button doesn't work" for older leave requests. Root cause: `leaveRequests.find(r => r.id === id)` uses strict equality without `String()` coercion — when Supabase returns `id` as a string (which happens for older rows on SKS) but the onclick handler passes a numeric literal (e.g. `withdrawLeaveRequest(123)`), the comparison silently fails. `find` returns `undefined`, the function returns at `if (!req) return;` with no toast, and the button feels broken.

Same id-coercion rule that caused multiple bugs through v3.4.21–v3.4.25. CLAUDE.md says always wrap both sides in `String()` for id comparisons.

## Code changes

**`scripts/leave.js`** — six identical edits, all of the form:

```js
// Before
const req = leaveRequests.find(r => r.id === id);

// After
const req = leaveRequests.find(r => String(r.id) === String(id));
```

| Line | Function | Button |
|---|---|---|
| 397 | `openLeaveRespond` | Review |
| 447 | `respondLeave` | Approve / Reject submit |
| 595 | `archiveLeaveRequest` | Archive |
| 612 | `unarchiveLeaveRequest` | Restore |
| 629 | `withdrawLeaveRequest` | Withdraw (the one Royce reported) |
| 715 | `resendLeaveEmail` | 📧 Resend |

All six handlers now correctly find their target row regardless of whether Supabase returned `id` as a number or string.

## Pending follow-ups

- Hard-delete leave requests (currently only Withdraw and Archive)
- `EQ_SECRET_SALT` rotation on eq-solves-field (demo salt was exposed in chat earlier today)
- Cleanup of cruft env vars on both Netlify projects
- CLAUDE.md tenant-detection note is wrong (says `eq-solves-field → demo`, actual is `→ eq`)
- Architectural refactor: have verify-pin read Supabase `app_config` directly so PINs aren't stored in two places
