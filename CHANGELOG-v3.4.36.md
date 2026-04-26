# v3.4.36 — PIN auth simplified to plaintext env-var compare

**Date:** 2026-04-27
**Branch flow:** demo → main
**Why:** A multi-hour debugging loop on 2026-04-27 traced the "Email failed: Not authenticated" error to a brittle salt+hash chain across two Netlify projects (sks-nsw-labour and eq-solves-field). The chain has too many things to keep aligned: salt env var name, salt value, hash env var name, hash value, hardcoded fallback. Any drift = silent 401. The hash layer was also security theatre — a 4-char PIN brute-forces in milliseconds even with HMAC-SHA256, and the salt sits in the same Netlify env vars as the hash, so the hash adds zero meaningful security against the actual threat.

## Code changes

**`netlify/functions/verify-pin.js`**
- Removed `hashCode()` function
- Removed hardcoded `STAFF_HASH` / `MANAGER_HASH` constants
- Added `STAFF_CODE` / `MANAGER_CODE` constants reading from `process.env`
- Replaced `codeHash === STAFF_HASH` with `code === STAFF_CODE`
- Added explicit 500 response if either env var is missing (fail loud, not silent)
- `EQ_SECRET_SALT` is **unchanged** — it's still used for session-token signing (signToken / verifyToken). That's a real security control against token forgery and stays.

**`scripts/auth.js`**
- Demo gate (`TENANT.ORG_SLUG === 'demo'`) now POSTs to `/.netlify/functions/verify-pin` after successful local check, mirroring the SKS path
- Stores returned `sessionToken` in `localStorage.eq_agent_token` and `sessionStorage.eq_session_token`
- Demo can now call `send-email` and other authenticated endpoints — unblocks the dev workflow where Royce CCs his real email on test leave requests

## Required Netlify env vars

Both projects must have these set after this deploy. The function returns 500 if either is missing.

| Project | STAFF_CODE | MANAGER_CODE |
|---|---|---|
| `sks-nsw-labour` | `2026` | `SKSNSW` |
| `eq-solves-field` | `demo` | `demo1234` |

## Cruft to clean up post-deploy

Once both sites are verified working, these env vars are no longer read by any code and can be deleted from both Netlify projects:

- `SECRET_SALT` (legacy name; superseded by `EQ_SECRET_SALT` for token signing)
- `STAFF_HASH`
- `MANAGER_HASH`
- `STAFF_HASH_OVERRIDE`
- `MANAGER_HASH_OVERRIDE`

## Security note

PINs now live in Netlify env vars (not in source code). Anyone with Netlify dashboard access has them in plaintext — same effective security as the prior hash setup, since anyone with env-var access already had the salt and could brute-force the 4-char hash in milliseconds. The simplification removes false complexity, not real security.

For a meaningful security upgrade in future: per-user passwords with bcrypt/argon2 + MFA. That's a redesign, not in scope here.

## Pending follow-ups (not in this release)

- `EQ_SECRET_SALT` rotation on the eq-solves-field project (the demo salt was exposed during today's debugging session)
- Withdraw button bug in leave.js — six places use `r.id === id` without `String()` coercion, breaks for older rows where Supabase returns id as a string
- Hard-delete leave requests (currently only Withdraw and Archive exist)
