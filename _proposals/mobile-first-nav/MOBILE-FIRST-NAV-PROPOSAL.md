# Mobile-first, role-driven navigation — proposal for review

Royce — this is the package for you to review tonight. Three parts: the visual mockups, the strategic case, and the implementation plan. Decisions you need to make are at the bottom under "Decisions needed before kickoff".

Target version: **v3.5.0** (this is significant enough to warrant the minor bump — first non-patch release since v3.0).

---

## Executive summary (lift for stakeholder briefings)

**Problem.** EQ Field's nav is one sidebar trying to serve two opposite users — a sparkie at 6am with one thumb, and a supervisor with 15 staff to approve. Neither gets a good experience. Result: slower onboarding for new staff, ongoing "where's that button?" support load, and half-built features visible to people who shouldn't see them.

**What changes.** Two role-driven mobile home screens. Staff land on 4 tiles. Supervisors land on 6 tiles plus an action strip surfacing approvals due today. Sidebar is untouched for desktop supervisors — bulk admin still works the way it does today. Half-built features (Apprentices, Pre-starts) get hidden per-tenant via the existing flags system. The cog icon top-right becomes the legitimate home for everything that doesn't earn a primary tile.

**Why now, for SKS specifically.** Pre-starts, toolbox talks, and SWMS are auditable compliance artefacts on Tier-1 data centre work (Equinix, Schneider). Putting them one tap away on every sparkie's phone, with a clean audit trail, strengthens both incident-review defence and tender responses. The same applies to digitised timesheets making 8h/40h discipline visible at supervisor level.

**Rough ROI sketch (validate before quoting upward).** 15 supervisors × ~20 min/week saved on approvals via the action strip ≈ 5 hours/week reclaimed at supervisor rates. New sparkie onboarding to "I can find my schedule" drops from ~20 min to ~5 min. First-tap-to-primary-action on phone drops from an average of 3 taps to 1.

**Cost.** Phase 1: 1.5–2 days of build, fully reversible via a single feature flag.

**Key-person risk note (worth surfacing to senior stakeholders pre-emptively).** EQ Field is built and maintained by Royce with AI assistance, not a vendor. Architecture and conventions are documented in `CLAUDE.md` at the repo root, which means the codebase remains navigable by a successor developer (human or AI) without Royce in the room. This specific proposal is non-destructive — rollback to v3.4.68 is one flag flip plus push.

---

## 1. Mockups to open

Both render properly on phone (open the file directly in mobile Safari/Chrome) and have a phone-frame view on desktop.

- **`staff-home.html`** — what a sparkie sees when they open the app. Four tiles, cog top-right for everything else.
- **`supervisor-home.html`** — what you see. Six tiles (the staff four plus Team and Reports), with an "action strip" surfacing leave-to-approve and timesheets-to-review counts.

Open them by double-clicking, or push them to demo and you'll get a public URL.

---

## 2. The case (short version)

The current sidebar nav is one-size-fits-all and tries to serve two very different jobs at once. A field tech opening the app at 6am on a data centre site needs three things: where am I rostered, did my hours save, am I on leave next week. A supervisor on a laptop needs to approve four people's leave, audit a timesheet, check who's covering Friday. The current sidebar makes both groups scroll past stuff that doesn't apply to them.

Role-driven home screens fix this without forcing anyone into a worse experience:

Staff users on any device land on the tile screen. Sidebar disappears for them. They almost never used it.

Supervisors on phones land on the supervisor tile screen (six tiles). Supervisors on desktop land on the existing app shell — sidebar intact, because bulk admin genuinely benefits from desktop density.

The cog icon top-right becomes the single home for everything that doesn't earn a tile: archive views, contacts grid, digest opt-in settings, audit log, job numbers, the things tradies don't touch but supervisors occasionally need.

The win isn't just visual cleanup. It's that you can finally hide half-built features (Apprentices, Pre-starts) behind a feature flag without having to delete them from the codebase. And new SKS supervisors don't need a 20-minute tour anymore.

---

## 3. Implementation plan

The good news is most of the plumbing already exists. Role detection is already in `auth.js`. Tenant-gating already exists via `TENANT_DISABLED_TABLES`. Feature flags exist in `scripts/flags.js`. We're composing existing pieces, not building new ones.

**Phase 1 — staff home tile screen (v3.5.0)**

New file: `scripts/home.js`. Renders the four-tile screen for any user with `role === 'staff'` AND a mobile viewport (< 768px). Desktop staff still see the current shell for now — that's a Phase 3 decision.

New file: `styles/home.css`. The mockup CSS lifts directly into this with minor cleanup.

Modify `index.html`: add a `<div id="home-screen">` mount point above the existing `.shell` div. Default hidden. `home.js` decides whether to show it based on `STATE.role` and viewport.

Modify `scripts/auth.js`: after successful gate + token mint, if mobile-viewport AND role==='staff', set `STATE.view = 'home'` and call `renderHome()` instead of the current default route.

Tap behaviour on tiles: each tile calls the existing nav function for that section. "My schedule" → existing `showCalendar()`. "Timesheets" → existing `showTimesheets()`. We're not rewriting the underlying screens, just changing how they're entered.

The cog icon opens a slide-up drawer (full-height on mobile) that lists everything currently in the sidebar that isn't a primary tile. Reuses the existing nav HTML — we just present it differently.

**Phase 2 — supervisor home tile screen (v3.5.1)**

Same approach with two extra tiles (Team, Reports). Supervisor mobile users land here instead of the staff version. Desktop supervisors still see the current app — no change for the 90% of supervisor work that happens at a desk.

Action strip at the top ("2 leave to approve · 3 timesheets") needs new queries — they're simple counts though, ~20 lines each.

**Phase 3 — desktop role-aware shell (v3.5.2, optional)**

Decide later whether desktop staff also get a tile home, or whether they stay on the current app shell. Punting this decision until we see how Phase 1 lands. My guess: yes for staff (consistency wins), no for supervisors (desktop density wins).

**What we are NOT doing in this release:**

- User-selectable "Basic / Standard / Advanced" mode toggle. Not yet. Wait until someone asks.
- Reorganising the sidebar for supervisors. Untouched. They get what they have today.
- Building Pre-starts/Toolboxes itself. That's a separate scope — the tile just links to whatever state that module is in.
- Rebuilding any existing screens. Calendar, Timesheets, Leave are all reached via the existing functions.

**Estimated effort (revised after engineering review):** Phase 1 is 1.5–2 days, including version bump, CHANGELOG, mobile testing on actual devices for both tenants, and the inevitable z-index / scroll fixes once it hits real iOS Safari. The earlier "one focused day" estimate was optimistic. Phase 2 is ~1 day if Phase 1 patterns hold. Phase 3 is open-ended.

---

## 3a. States that must be designed (non-optional)

A tile screen with only a happy path is half-built. Each of these states needs an explicit visual before Phase 1 ships:

- **Loading.** Tiles render as skeleton placeholders while Supabase responds. No spinner — tiles fade in as data arrives. Same skeleton on a slow 3G connection.
- **Empty / no data.** "No shifts this week" on the schedule tile, "Up to date" on Timesheets when nothing is pending, "Nothing waiting on you" on the supervisor action strip. Empty must read as confirmation, not error.
- **Offline.** Service Worker already caches the shell; the home screen must render from cache. Show a subtle "Offline — showing last sync" banner above the tiles. Tap behaviour still works for cached destinations; non-cached destinations show "Reconnect to access" toast.
- **Failed fetch.** Specific (Supabase 5xx vs network drop vs auth expired) — not a generic "something went wrong". Auth expired routes back to gate.
- **Zero permissions on a tile.** If a staff member's role doesn't grant access to a tile destination, tile is hidden, not greyed out. Grey tiles invite confused taps.

Implementation note: most of these states reuse existing patterns from `scripts/supabase.js` (sbFetch error handling) and the existing offline-friendly cache strategy in `sw.js`. We're surfacing them visually, not building new infrastructure.

---

## 4. Files that change

```
NEW   scripts/home.js                         ~200 lines
NEW   styles/home.css                         ~150 lines
EDIT  index.html                              add mount div + script tag
EDIT  scripts/auth.js                         route mobile staff to home on login
EDIT  scripts/app-state.js                    bump APP_VERSION → 3.5.0
EDIT  sw.js                                   bump cache versio