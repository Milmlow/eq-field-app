# v3.4.81 — Tender Sync (actually working) + What's New refresh

**Date:** 2026-05-14
**Branch:** demo → main (pending)
**Risk:** very low — one CDN URL pin + static-content refresh

## What broke

After v3.4.80, Tender Sync was STILL showing:

> Couldn't read the file — SheetJS (window.XLSX) not loaded. Add the CDN tag to index.html.

The v3.4.80 CSP fix was correct in isolation: it removed the
script-src block on `cdnjs.cloudflare.com`. But that wasn't the
only thing wrong.

## Root cause #2

`index.html` line 88 pointed at:

```
https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.20.3/xlsx.full.min.js
```

cdnjs does not host xlsx 0.20.3. Querying their library API, the
highest xlsx version on cdnjs is `0.18.5`. SheetJS stopped
publishing to cdnjs after the community-edition fork; the newer
0.19/0.20 releases live at `cdn.sheetjs.com` and npm, not cdnjs.

So the deployed page was issuing a request for a URL that 404s.
CSP allowed it, the script tag attempted it, the server replied
404, `window.XLSX` was never assigned, and the parser hit its
fallback path.

This means v3.4.79's banner claim "SheetJS loaded from cdnjs
(xlsx 0.20.3)" was wrong from the start. It would never have
worked. v3.4.80 made the CSP layer correct without noticing the
underlying URL was broken.

## The fix

`index.html:88` — `0.20.3` → `0.18.5`. The xlsx API surface this
project uses (`XLSX.read(buffer, { cellDates: true })` and
`XLSX.utils.sheet_to_json(sheet, opts)`) has been stable since
the 0.10.x line; 0.18.5 is a drop-in replacement for what 0.20.3
would have been.

If we ever need 0.19+ features (none of the parser's API calls
do today), the right move is to switch the CDN to
`https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js`
and add that origin to both CSP files. Not doing that now —
keeping cdnjs as the source so v3.4.80's CSP work isn't wasted.

## What's New banner refresh

`scripts/whatsnew.js` was stuck at `WHATSNEW_VERSION = 'v3.4.22'`
with highlights from that release (digest, birthdays, timesheet
bar, leave fixes, nav reshuffle). 27 versions later, that's
obviously stale.

Refreshed to v3.4.81 with the actual recent shipments:

1. **Tender Pipeline** (v3.4.79) — the big new "before" layer.
2. **Daily Site Diary** (v3.4.77) — DEMO-only for now.
3. **Toolbox Talks** (v3.4.75) — DEMO-only for now.
4. **Friday supervisor digest** — kept (still relevant).
5. **Timesheet progress + reminders** — kept (still relevant).
6. **Leave flow fixes** — re-worded to cover v3.4.36-38 work too.

`WHATSNEW_KEY` bumped to `eq.whatsnew.v3.4.81.seen`, so every
user sees the banner once after this release lands. Dismiss
button still writes to localStorage as before.

## Files touched

- `index.html` — CDN URL pin, favicon cache-buster, v3.4.81 banner.
- `scripts/app-state.js` — APP_VERSION 3.4.80 → 3.4.81.
- `scripts/whatsnew.js` — full rewrite; new highlights + key.
- `sw.js` — CACHE bump.
- `CHANGELOG-v3.4.81.md` — this file.

## Verification

After deploy, on `eq-solves-field.netlify.app`:

1. Force a service-worker refresh (Application → Clear site data,
   or unregister + hard reload).
2. Footer shows `v3.4.81`.
3. Dashboard shows the refreshed "What's new — v3.4.81" card.
4. DevTools → Network → confirm `xlsx.full.min.js` returns 200
   from `cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/...`.
5. DevTools → Console → `typeof XLSX` should report `"object"`.
6. Tender Sync → upload "Open 12m Tenders (State) — NSW.xlsx".
   Expected: 323 rows parsed, 0 errors, diff preview populates.

## TODO (still deferred)

- Two-CSP-source drift (`_headers` + `netlify.toml`) — same note
  as v3.4.80. Unify on `netlify.toml` when convenient.
- Service Worker auto-update toast — every release still requires
  manual cache-clear from end-users. Highest-impact UX gap open.
