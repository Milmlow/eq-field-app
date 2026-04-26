# v3.4.37 — Lift eq/demo exclusion on token mint

**Date:** 2026-04-27
**Branch flow:** demo → main
**Why:** v3.4.36 simplified verify-pin to plaintext PIN compare via env vars, but the eq tenant (eq-solves-field.netlify.app) still couldn't send emails. Root cause: auth.js had a `TENANT.ORG_SLUG !== 'eq' && TENANT.ORG_SLUG !== 'demo'` gate around the verify-pin call, dating back to when only SKS had a Netlify backend. eq tenant was silently skipping the token mint, so `sessionStorage.eq_session_token` stayed null and send-email returned 401. Both tenants now have Netlify backends — the gate is obsolete.

## Code changes

**`scripts/auth.js`** — three places, same change:

1. Line ~209 (gate login, inside `window.__TENANT_CODES__` block) — removed the `if (... !== 'eq' && ... !== 'demo')` wrapper around the verify-pin IIFE. Now an unconditional bare `{` block scope.
2. Line ~348 (restore from `eq_local_remember_<slug>`) — changed `if (p.code && ... !== 'eq' && ... !== 'demo')` to `if (p.code)`.
3. Line ~378 (legacy `eq_remember_token` restore path) — removed the same wrapper.

All three flows now attempt to mint a server-side session token after a successful local check, regardless of tenant.

## Required Netlify env vars (each project's own values)

For verify-pin to succeed, the env-var values must match what's in **that tenant's Supabase app_config**:

| Netlify project | STAFF_CODE | MANAGER_CODE | Source of truth |
|---|---|---|---|
| `sks-nsw-labour` | `2026` | `SKSNSW` | sks Supabase app_config |
| `eq-solves-field` | `demo` | `demo1234` | eq Supabase app_config |

**The eq-solves-field env vars need to be updated** — Royce had set them to the SKS values during earlier debugging.

## Architecture note (not in this fix)

PINs now live in two places: Supabase `app_config` (read by the in-browser local gate check) and Netlify env vars (read by verify-pin). They have to be kept in sync manually — that's a real architectural smell.

Future cleanup: refactor verify-pin to read Supabase `app_config` directly via the per-tenant `AUDIT_SB_URL` / `AUDIT_SB_KEY` env vars (or rename those to drop `AUDIT_`). Single source of truth, env-var maintenance for PINs disappears entirely. Tracked but not in scope here.

## Pending follow-ups

- Withdraw button bug in `leave.js` — six `r.id === id` calls without `String()` coercion (lines 397, 447, 595, 612, 629, 715)
- Hard-delete leave requests (currently only Withdraw and Archive)
- `EQ_SECRET_SALT` rotation on eq-solves-field (demo salt was exposed in chat earlier today)
- Cleanup of cruft env vars on both Netlify projects: `SECRET_SALT`, `STAFF_HASH`, `MANAGER_HASH`, `STAFF_HASH_OVERRIDE`, `MANAGER_HASH_OVERRIDE`
- Sync Supabase app_config with Netlify env vars (or refactor per architecture note above)
- CLAUDE.md tenant-detection docs are wrong (says `eq-solves-field → demo`, actual is `→ eq`)
