# v3.4.12 — Clarity IDs live (Field demo + SKS prod)

Small, single-purpose release: replace the Clarity `REPLACE_ME`
placeholders in `scripts/analytics.js` with the real 10-char project
IDs. With these in, the Clarity snippet no longer no-ops and both the
demo and SKS sites now capture session replays + heatmaps in addition
to the PostHog event stream that went live in v3.4.11.

## Changes

- `scripts/analytics.js` — Clarity IDs wired:
  - `eq` (demo, `eq-solves-field.netlify.app`) → `wek7yeida5`
    (project `eq-field-demo`)
  - `sks` (prod, `sks-nsw-labour.netlify.app`) → `wek8dmtbuu`
    (project `eq-field-sks`)
- `sw.js` — cache bumped to `eq-field-v3.4.12` so existing clients
  invalidate and pick up the new `analytics.js`.
- `scripts/app-state.js` — `APP_VERSION = '3.4.12'`.
- `index.html` — version stamps in header comment + sidebar footer
  bumped.

## Keys inventory

All four Clarity project IDs are now recorded in
`Projects/eq-analytics-v2/eq-context/KEYS_INVENTORY.md`. The `eq-service`
and `eq-assets` IDs are held there until those two apps are wired in
follow-up releases.

## Verify after deploy

1. Hard-reload `https://eq-solves-field.netlify.app` in incognito.
   Console should show `[analytics] Clarity init running` (or, at
   minimum, no more `Clarity ID is a placeholder` info log).
2. Network tab → filter `clarity` → expect a GET to
   `https://www.clarity.ms/tag/wek7yeida5` and follow-up POSTs to
   `https://c.clarity.ms/...`.
3. Clarity dashboard → project `eq-field-demo` → the top-right
   "Waiting for first visit" banner should disappear within a few
   minutes. Session recordings appear ~5 minutes after a session ends.
   Heatmaps require ~100 sessions to render.

## Privacy reminder

Clarity is Balanced-mode masked (default) and our app additionally
stamps `data-clarity-mask="true"` on every PII-ish input (gate PIN,
staff TS PIN, person PIN, bulk PIN, site address, journal reflection).
Verify in a replay that those fields render as black boxes before
letting anyone outside EQ watch a recording.
