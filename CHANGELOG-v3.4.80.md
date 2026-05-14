# v3.4.80 — CSP hotfix: unblock SheetJS for Tender Sync

**Date:** 2026-05-14
**Branch:** demo → main (pending)
**Risk:** low — single-line CSP relaxation, already present in `_headers`

## What broke

Tender Sync (v3.4.79) import was dead on arrival on the live demo
site (`eq-solves-field.netlify.app`). Uploading an xlsx triggered:

> Couldn't read the file — SheetJS (window.XLSX) not loaded. Add the CDN tag to index.html.

The CDN tag was there. What wasn't there was CSP permission for it.

## Why

Two CSP definitions live in the repo and they had drifted:

- `_headers` — file-based Netlify headers. v3.4.79 added
  `https://cdnjs.cloudflare.com` here.
- `netlify.toml` `[[headers]]` block — header rules in toml form.
  v3.4.79 did NOT touch this.

When both exist, `netlify.toml` wins. So the live CSP was the toml
version, which never trusted cdnjs, and the browser blocked the
SheetJS script with:

```
script-src 'self' 'unsafe-inline'
  https://*.posthog.com https://*.i.posthog.com
  https://www.clarity.ms https://*.clarity.ms
```

No cdnjs in the list → script blocked → parser fell through to its
loud-fail path (which is correct behaviour — but the fix is the CSP,
not the parser).

## The fix

`netlify.toml` line 61, added `https://cdnjs.cloudflare.com` to
`script-src`. Comment line above bumped to mention cdnjs alongside
PostHog / Clarity. No other behaviour change.

## TODO (deferred — not urgent)

Two-CSP-source drift is the smell behind this bug. Future cleanup
should unify on one source. Recommended: keep `netlify.toml` (more
expressive, supports per-path rules, easier to diff), delete
`_headers`. Both files now say the same thing for CSP, so this is
safe to do later without a third coordination point.

## Files touched

- `netlify.toml` — script-src += `https://cdnjs.cloudflare.com`
- `scripts/app-state.js` — APP_VERSION 3.4.79 → 3.4.80
- `sw.js` — CACHE bump + header comment
- `index.html` — favicon cache-buster + new v3.4.80 banner; v3.4.79
  banner re-tagged as history
- `CHANGELOG-v3.4.80.md` — this file

## Verification

After deploy, on `eq-solves-field.netlify.app`:

1. Hard refresh (Ctrl+Shift+R) to clear SW.
2. Navigate to Tender Sync.
3. Open browser console — no CSP violation for cdnjs.
4. Upload `Open 12m Tenders (State) - NSW.xlsx`.
5. Expect: 323 rows parsed, 0 errors, diff preview with 323 new.
6. Stage breakdown should read: tracked 212, watch 62, likely 43,
   won 6. Below-threshold: 279.
