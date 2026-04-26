# v3.4.23 — "What's new" banner (SKS upgrade comms)

**Date:** 2026-04-26
**Scope:** EQ Field demo (eq-solves-field.netlify.app). Ships immediately
before the demo→main promotion to SKS Labour prod so SKS users see a
"what's new" card on first load post-update.

---

## Why

SKS prod is currently on v3.4.9. The demo→main promotion (per
`PROMOTE-v3.4.9-to-v3.4.23-TO-SKS.md`) brings 12 releases of changes —
some of them user-visible in ways that will look unannounced if nobody
explains them (e.g. Friday digest emails arriving for the first time).
Field-team comms approach picked from the runbook Q5: in-app banner +
short email blast.

This release ships the in-app banner. The email is a separate text
artifact in the workspace folder for Royce to send via his preferred
channel.

## What's in

### `scripts/whatsnew.js` (new)

- Renders a dismissible "What's new — v3.4.22" card into
  `#whatsnew-banner` at the top of the dashboard.
- Six highlights: Friday digest, birthdays/anniversaries, timesheet
  progress + reminders, leave-approver attribution fix, multi-day leave
  roster write, nav reshuffle.
- Once-per-user via `localStorage.setItem('eq.whatsnew.v3.4.22.seen', '1')`.
- Bump the key name when there's a comparable batch of features to
  surface in a future release.

### `index.html`

- Empty `<div id="whatsnew-banner" style="display:none">` at the top of
  `page-dashboard`, just inside the `print-active` page wrapper.
- `<script src="scripts/whatsnew.js">` added after `digest-settings.js`.
- Header comment + footer span bumped to v3.4.23.

### `sw.js` + `scripts/app-state.js`

- `sw.js` cache + header → `v3.4.23`. PRECACHE list adds
  `/scripts/whatsnew.js`.
- `APP_VERSION` → `'3.4.23'`.

## Verification (on demo)

1. Open eq-solves-field.netlify.app in an incognito window. Footer shows
   v3.4.23. The "What's new" card renders above the dashboard stats row.
2. Click "Got it" or the ✕ → card disappears. Reload → stays dismissed.
3. Open DevTools → Application → Local Storage → delete the
   `eq.whatsnew.v3.4.22.seen` key. Reload → card returns.
4. No console errors.

## Behaviour for SKS post-merge

When the SKS deploy lands at v3.4.23, every SKS user sees the card on
first load — regardless of whether they used the app since v3.4.9. The
card is one card, dismissible in one click, and never auto-shows again
unless we bump the localStorage key.

EQ demo users will also see it once. That's fine — they were the test
audience for these features and a quick "yes, this is the same stuff
you've been seeing on demo" reminder is harmless.
