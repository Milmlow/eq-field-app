# v3.5.0 — Mobile-first home tile screen (staff role)

Released to demo branch on 2026-05-14. First non-patch release since v3.0. Demo-only flag-on rollout before SKS receives the flip.

## Why a 3.5.x bump

The home screen is a deliberate UX direction shift, not a feature patch. Bumping the minor signals the change to anyone tracking version stamps. Pre-existing tooling (Netlify deploy notifications, PostHog dashboards filtered by `app_version`) all keep working — the bump is purely a release signal.

## What shipped

A role-driven, flag-gated mobile home screen replacing the default "schedule" landing for users who tick all three boxes:

- `role === 'staff'` (i.e. not a supervisor, not in agency mode)
- viewport width < 768px (`matchMedia('(max-width: 767px)')`)
- PostHog flag `home_screen_v1` enabled (default `false` until per-tenant rollout)

If any of those conditions fails, the user lands on the existing `schedule` page as they did in v3.4.80. No-change-on-first-deploy is deliberate — the flag flips per tenant after eyeball verification.

### The screen

Four tiles in a 2×2 grid:

- **My schedule** — blue. Subtitle shows live count of this week's shifts (live, decision I1).
- **Timesheets** — green. Routes to the `staff-ts` page. "Due Fri" badge shows Wed/Thu/Fri.
- **Leave** — amber/coral. Routes to `leave`.
- **Pre-starts** — purple, "New" badge. Hidden on SKS via `TENANT_DISABLED_TABLES.sks` check (`prestarts` is gated there by an earlier release). Visible on EQ demo for iteration.

Above the tiles: a "Next shift" pill showing the soonest rostered shift (this week or next), pulled from `STATE.schedule`. Taps through to the schedule page.

Top-right: a cog button opening a slide-up drawer. Drawer contains Contacts, Calendar, Help, Privacy notice, Log out. Phase 1 set is minimal — more items move into the drawer in Phase 2 when the supervisor variant ships.

Greeting strategy (decision H1): "G'day, {firstname}" on the first session of the calendar day, then a date string ("Thursday 14 May") for subsequent sessions. Tracked via `sessionStorage.eqh_last_greet_day`.

### States designed for

- **Loading.** Skeleton placeholders (`.eqh-skel`) fade in. No spinner.
- **Empty.** "Nothing this week" on the Schedule tile when zero shifts exist.
- **Offline.** Amber banner above the tiles ("You're offline — showing last synced data"). Auto-shows on `navigator.onLine === false`; re-renders on `online` event.
- **Failed fetch.** Phase 1 reuses already-loaded `STATE` arrays (no new Supabase queries on home), so there's nothing to fail. If `STATE` is empty, the empty-state copy reads as confirmation rather than an error.
- **Zero permissions.** Pre-starts tile is conditionally rendered, not greyed out. Greyed tiles invite confused taps.

### Decisions baked in (per the proposal)

| Decision | Choice | Rationale |
|---|---|---|
| A. Phase 1 scope | A1 — staff mobile only | Smallest, safest slice. Supervisor variant + desktop = Phase 2/3. |
| B. Next-shift pill | B1 — shown | Surfaces the most-asked question without a tap. |
| C. Pre-starts tile on SKS | C1 — hidden via tenant flag | Module not yet built on SKS; show on EQ demo for iteration. |
| D. Tile labels | as proposed | "My schedule", "Timesheets", "Leave", "Pre-starts". |
| E. Greeting personality | kept | "G'day, {name}" — Australian, on-brand. |
| F. Version bump | v3.5.0 | Signals "notable change" to anyone tracking version stamps. |
| G. Supervisor badges | G1 — action strip wins, tiles drop counts | Applied in mockup; Phase 2 implements. |
| H. Greeting persistence | H1 — once per day, then date | Personality without wear-out. |
| I. Live counts on staff tiles | I1 — Schedule + Timesheets only | Live where it earns its keep. |

## Tech debt acknowledged (deliberately deferred)

Per § 4a of `_proposals/mobile-first-nav/MOBILE-FIRST-NAV-PROPOSAL.md`. None of these are introduced by this release; all pre-date it.

- No automated tests in the codebase. `home.js` doesn't add any either; needs its own proposal.
- 30+ JS files loaded in order via `<script>` tags, no bundler. Adding `home.js` makes 32. Earmark for a v4.0 refactor.
- `String()` coercion saga still active. `home.js` uses it defensively on every id comparison.
- Viewport detection via `matchMedia` in JS — fragile but acceptable for now. CSS media queries also hide `#page-home` on desktop as belt-and-braces.
- Service Worker still requires a hard-refresh on existing devices to pick up new versions. Same as every release.
- `audit_log` schema mismatch with `verify-pin.js`. Pre-existing silent failure. Not this release.

## Rollout sequence

1. Deploy to demo branch. Flag stays `false` — no visible change to either tenant.
2. Push to `eq-solves-field.netlify.app`. Once it lands, set `home_screen_v1: true` either via PostHog (preferred — per-user variant control) or by editing `scripts/flags.js DEFAULTS` directly.
3. Royce eyeball-tests on his own phone. Iterate if needed.
4. Once happy, merge demo → main. SKS receives the code but `home_screen_v1` is still `false` for SKS users.
5. Flip flag for SKS in a follow-up push (single-line change to `DEFAULTS` or a PostHog variant override).
6. Watch PostHog for 48h: engagement (`home_tile_tapped`), error rates, time-to-first-action.
7. If green, start Phase 2 (supervisor variant).

## Rollback

One line change in `scripts/flags.js`:

```js
'home_screen_v1': false  // was true
```

Commit, push, demo redeploys in ~30s. Five minutes from "this is bad" to "back to v3.4.80 behaviour". Tile screen code stays in repo (no destructive deletes), so re-enabling is symmetric.

## Files touched

| File | Change | Lines |
|---|---|---|
| `scripts/home.js` | NEW | ~280 |
| `styles/home.css` | NEW | ~250 |
| `scripts/flags.js` | Added `home_screen_v1` to `DEFAULTS` | +6 |
| `scripts/app-state.js` | `APP_VERSION` 3.4.80 → 3.5.0 | 1 |
| `index.html` | CSS link, script tag, `#page-home` mount, `PAGE_TITLES` entry, `renderCurrentPage` dispatch, `initApp()` routing, favicon cache-buster, top-of-file changelog block | ~80 |
| `sw.js` | CACHE bump 3.4.80 → 3.5.0; `/scripts/home.js` and `/styles/home.css` added to `PRECACHE` | +4 |
| `CHANGELOG-v3.5.0.md` | NEW (this file) | ~150 |

## What this release does NOT do

- Supervisor home variant (Phase 2 / v3.5.1).
- Desktop staff tile home (Phase 3 / v3.5.2 — undecided, may stay on existing shell).
- Re-organising the sidebar for supervisors. Untouched.
- Building Pre-starts/Toolboxes itself. The tile just links to whatever state the module is in (already shipped on EQ via v3.4.69 Site Reports, gated off on SKS).
- Rebuilding any existing screens. Schedule, Timesheets, Leave, Pre-starts all reached via existing render functions.

## Version-stamp audit

Per the project's strict-monotonic v3.x.y discipline:

- `scripts/app-state.js → APP_VERSION` — `3.5.0` ✓
- `index.html → favicon cache-buster` — `'3.5.0'` ✓
- `sw.js → // comment header` — `v3.5.0` ✓
- `sw.js → const CACHE` — `'eq-field-v3.5.0'` ✓
- `index.html → sidebar footer span` — derived from `APP_VERSION` automatically (since v3.4.45) ✓
- `index.html → top-of-file changelog block` — `v3.5.0` ✓
- This file (`CHANGELOG-v3.5.0.md`) — ✓

## Note for the next CC session

This release was built alongside the v3.4.79 Tender Pipeline / v3.4.80 CSP hotfix work in another Cowork session. The two streams of work touch overlapping files (`scripts/app-state.js`, `sw.js`, `index.html`). If you see a mid-edit conflict, re-read the file before editing — both sessions can write to disk. The git index was stuck (stale `.git/index.lock`, missing object `9f000f1b...`) at the time of build, so no commit was attempted from the home-screen session — Royce will commit both streams together once the locks are cleared.
