# Ready-to-apply patches — v3.5.0 wiring

This file contains the literal `old_string` / `new_string` blocks for the four wiring edits that need to be re-applied after Royce's `git reset --hard origin/demo`. Once applied, the home tile screen is fully wired and the release is ready to commit.

**Pre-flight (Royce, before pinging me):**

```bash
cd C:\Projects\eq-solves-field
git fetch origin demo
git reset --hard origin/demo
# verify clean state:
git status                  # should show only the untracked v3.5.0 files
node --check scripts/flags.js   # should print nothing (clean parse)
grep APP_VERSION scripts/app-state.js   # expect 3.4.81 (origin/demo head)
head -3 sw.js               # expect v3.4.81
```

If all four lines pass, ping me with "ready" and I'll apply the four edits below in sequence.

---

## Edit 1 — `scripts/flags.js` — add `home_screen_v1` to DEFAULTS

**old_string**
```js
    'mt_self_serve_signup':  false
  };
```

**new_string**
```js
    'mt_self_serve_signup':  false,
    // v3.5.0 — mobile-first home tile screen for staff role.
    // Stays FALSE until per-tenant rollout. Flip true via PostHog
    // (or override here) to enable. Affects only mobile viewport
    // (< 768px) for users with role==='staff'. Desktop unchanged.
    'home_screen_v1':        false
  };
```

**Verify after:** `node --check scripts/flags.js` exits 0.

---

## Edit 2 — `scripts/app-state.js` — bump APP_VERSION

**old_string**
```js
const APP_VERSION = '3.4.81';
```

**new_string**
```js
const APP_VERSION = '3.5.0';
```

**Verify after:** `grep APP_VERSION scripts/app-state.js` shows `3.5.0`.

---

## Edit 3a — `sw.js` — bump comment header + CACHE

**old_string**
```js
// EQ Solves — Field  ·  Service Worker  v3.4.81
const CACHE = 'eq-field-v3.4.81';
```

**new_string**
```js
// EQ Solves — Field  ·  Service Worker  v3.5.0
const CACHE = 'eq-field-v3.5.0';
```

## Edit 3b — `sw.js` — add new files to PRECACHE

**old_string**
```js
  '/scripts/toolbox.js',
  '/scripts/diary.js',
];
```

**new_string**
```js
  '/scripts/toolbox.js',
  '/scripts/diary.js',
  // v3.5.0 — Mobile-first home tile screen (staff role, mobile viewport)
  '/scripts/home.js',
  '/styles/home.css',
];
```

**Verify after:** `head -3 sw.js && grep -c "home" sw.js` shows v3.5.0 in header and 2 home references in PRECACHE.

---

## Edit 4a — `index.html` — add home.css stylesheet link

**old_string**
```html
<link rel="stylesheet" href="styles/base.css">
<link rel="stylesheet" href="styles/print.css">
<link rel="stylesheet" href="styles/mobile.css">
<link rel="stylesheet" href="styles/apprentices.css">
```

**new_string**
```html
<link rel="stylesheet" href="styles/base.css">
<link rel="stylesheet" href="styles/print.css">
<link rel="stylesheet" href="styles/mobile.css">
<link rel="stylesheet" href="styles/apprentices.css">
<!-- v3.5.0 — Mobile-first home tile screen (gated by 'home_screen_v1' flag) -->
<link rel="stylesheet" href="styles/home.css">
```

## Edit 4b — `index.html` — add home.js script tag

**old_string**
```html
<script src="scripts/auth.js"></script>
<script src="scripts/apprentices.js"></script>
```

**new_string**
```html
<script src="scripts/auth.js"></script>
<!-- v3.5.0 — Mobile home tile screen. Must load after app-state.js,
     analytics.js, flags.js, auth.js. Renders into #page-home. -->
<script src="scripts/home.js"></script>
<script src="scripts/apprentices.js"></script>
```

## Edit 4c — `index.html` — favicon cache-buster bump

**old_string**
```js
    var v = '3.4.81'; // cache-buster — bump on icon changes
```

**new_string**
```js
    var v = '3.5.0'; // cache-buster — bump on icon changes
```

## Edit 4d — `index.html` — top-of-file changelog block

**old_string** (anchor — replace just the title line and the CHANGES heading):
```
  EQ Solves — Field  v3.4.81
  Modularised April 2026 — inline JS now ~300 lines (was ~4,000)

  CHANGES IN v3.4.81
```

**new_string**
```
  EQ Solves — Field  v3.5.0
  Modularised April 2026 — inline JS now ~300 lines (was ~4,000)

  CHANGES IN v3.5.0  (Mobile-first home tile screen — staff role, flag-gated)
  ────────────────────────────────────────────────────────────
  • First non-patch release since v3.0. Adds a mobile-first home
    screen for the staff role: four tiles (My Schedule, Timesheets,
    Leave, Pre-starts), a Next-shift pill, and a cog drawer for
    everything else. Existing sidebar shell remains untouched for
    supervisors and desktop users — flag-gated, default OFF, no
    visible change on first deploy until the flag is flipped per
    tenant.
  • SCOPE — Phase 1 of the mobile-first navigation proposal in
    _proposals/mobile-first-nav/. Supervisor variant + desktop role
    shell are Phase 2 / Phase 3. Decisions A1/B1/C1/D/E/F/G1/H1/I1
    baked in — see CHANGELOG-v3.5.0.md for the audit trail.
  • FEATURE FLAG — 'home_screen_v1' in scripts/flags.js, default
    FALSE. Routing only fires when:
      (a) flag enabled (PostHog or DEFAULTS override)
      (b) role==='staff' (i.e. !isManager)
      (c) viewport < 768px (matchMedia check)
    Anything else falls through to the existing schedule landing.
  • STATES — loading skeleton, empty ("Nothing this week"), offline
    banner (auto-shows on navigator offline event + re-render on
    'online'), failed-fetch reuses STATE arrays (no new queries
    in Phase 1), and Pre-starts tile is hidden on SKS via the
    existing TENANT_DISABLED_TABLES.sks check.
  • GREETING — "G'day, {firstname}" shown once per day (first
    session), thereafter a date string ("Thursday 14 May"). Tracked
    via sessionStorage 'eqh_last_greet_day' key.
  • TILE-TAP ROUTING — schedule → showPage('schedule'),
    Timesheets → showPage('staff-ts'), Leave → showPage('leave'),
    Pre-starts → showPage('prestart'). No screens rewritten —
    existing render functions handle the destinations.
  • COG DRAWER — slide-up sheet with Contacts, Calendar, Help,
    Privacy notice, Log out. Phase 1 set is minimal; further
    items added in Phase 2 when supervisor variant ships.
  • ANALYTICS — 'home_tile_tapped' (per-tile) and 'home_cog_opened'
    PostHog events emitted via window.EQ_ANALYTICS.capture.
  • TECH-DEBT NOTE — proposal explicitly listed six pre-existing
    debts NOT addressed by this release (no tests, no bundler,
    String() coercion, JS viewport detection, hard-refresh
    requirement, audit-log schema mismatch). Each deferred
    deliberately. See _proposals/mobile-first-nav/MOBILE-FIRST-NAV-PROPOSAL.md
    § 4a for the audit trail.
  • ROLLOUT — flag stays default-off post-deploy. Royce flips it
    per tenant: eq first (eyeball on phone), then sks once
    confident. Rollback = flip back to false; 5-minute round trip.
  • FILES TOUCHED
    - scripts/home.js                 (NEW, ~280 lines)
    - styles/home.css                 (NEW, ~250 lines)
    - scripts/flags.js                (add 'home_screen_v1': false)
    - scripts/app-state.js            (APP_VERSION 3.4.81 → 3.5.0)
    - index.html                      (link, script tag, #page-home
                                       mount, PAGE_TITLES, render
                                       dispatch, initApp routing,
                                       favicon cache-buster, this
                                       banner)
    - sw.js                           (CACHE bump + home.js/home.css
                                       in PRECACHE)
    - CHANGELOG-v3.5.0.md             (NEW)

  CHANGES IN v3.4.81
```

## Edit 4e — `index.html` — `#page-home` mount div

**old_string**
```html
  <!-- Pages — content injected by render functions -->
  <div class="page print-active" id="page-dashboard">
```

**new_string**
```html
  <!-- Pages — content injected by render functions -->
  <!-- v3.5.0 — Mobile-first home tile screen. Populated by scripts/home.js -->
  <div class="page hidden" id="page-home"></div>
  <div class="page print-active" id="page-dashboard">
```

## Edit 4f — `index.html` — PAGE_TITLES entry

**old_string**
```js
  prestart:'Prestart Briefings', toolbox:'Toolbox Talks', diary:'Daily Site Diary',
```

**new_string**
```js
  prestart:'Prestart Briefings', toolbox:'Toolbox Talks', diary:'Daily Site Diary',
  // v3.5.0 — Mobile-first home tile screen (staff role, mobile viewport)
  home:'Home',
```

## Edit 4g — `index.html` — renderCurrentPage dispatch

**old_string**
```js
function renderCurrentPage() {
  if      (currentPage === 'dashboard')  renderDashboard();
  else if (currentPage === 'roster')     { renderRosterWeekNav(); renderRoster(); }
  else if (currentPage === 'schedule')   renderSchedule();
```

**new_string**
```js
function renderCurrentPage() {
  if      (currentPage === 'home')       { if (typeof renderHomeScreen === 'function') renderHomeScreen(); }
  else if (currentPage === 'dashboard')  renderDashboard();
  else if (currentPage === 'roster')     { renderRosterWeekNav(); renderRoster(); }
  else if (currentPage === 'schedule')   renderSchedule();
```

## Edit 4h — `index.html` — initApp() routing for mobile staff

**old_string**
```js
  if (typeof agencyMode !== 'undefined' && agencyMode) {
    if (typeof applyAgencyMode === 'function') applyAgencyMode();
  } else if (!isManager) {
    showPage('schedule');
    mobileNav('schedule');
  }
```

**new_string**
```js
  if (typeof agencyMode !== 'undefined' && agencyMode) {
    if (typeof applyAgencyMode === 'function') applyAgencyMode();
  } else if (!isManager) {
    // v3.5.0 — route mobile staff to the home tile screen if the flag is on.
    // Falls through to the existing schedule landing for desktop, flag-off,
    // or if home.js failed to load. Safe defaults.
    const _eqhWantsHome = (function () {
      try {
        if (!window.EQ_FLAGS || !window.EQ_FLAGS.isEnabled('home_screen_v1')) return false;
        if (typeof window.renderHomeScreen !== 'function') return false;
        if (typeof window.matchMedia !== 'function') return false;
        return window.matchMedia('(max-width: 767px)').matches;
      } catch (e) { return false; }
    })();
    if (_eqhWantsHome) {
      showPage('home');
    } else {
      showPage('schedule');
      mobileNav('schedule');
    }
  }
```

---

## Post-apply verification

After all four edits, run:

```bash
cd C:\Projects\eq-solves-field
node --check scripts/flags.js && echo OK
node --check scripts/home.js  && echo OK
grep APP_VERSION scripts/app-state.js          # expect 3.5.0
grep "const CACHE" sw.js                       # expect eq-field-v3.5.0
grep -c "v3\.5\.0" index.html                  # expect >= 4
grep -c "#page-home\|page-home" index.html     # expect >= 2
grep "home_screen_v1" scripts/flags.js         # expect 1 match
```

If all pass, the wiring is correct.

## Commit and push sequence

```bash
git add scripts/home.js styles/home.css CHANGELOG-v3.5.0.md \
        scripts/flags.js scripts/app-state.js sw.js index.html

git status                # confirm only v3.5.0 files staged

git commit -m "v3.5.0 — Mobile-first home tile screen (staff role, flag-gated)

Phase 1 of the mobile-first navigation proposal. Adds a 4-tile mobile
home screen for users with role==='staff' on viewport < 768px, gated by
PostHog flag 'home_screen_v1' (default FALSE). Sidebar unchanged for
supervisors and desktop.

See CHANGELOG-v3.5.0.md and _proposals/mobile-first-nav/ for details.
Decisions A1/B1/C1/D/E/F/G1/H1/I1 baked in.

Co-authored-by: Cowork session <claude.ai.mumbo966@passmail.net>"

git push origin demo
```

Wait ~30 seconds for Netlify to redeploy `eq-solves-field.netlify.app`. Verify the footer shows `v3.5.0`. The flag is still default-off — no visible change to either tenant yet.

## Enabling the flag for testing

Two options to flip `home_screen_v1` to true for the EQ tenant only:

**Option A — PostHog (proper way):**
1. Log into PostHog (`eu.i.posthog.com`)
2. Project: EQ Field — EQ demo
3. Feature flags → Create new flag `home_screen_v1`
4. Release condition: `tenantId equals "eq"` → enabled
5. Save. Effective within seconds via the PostHog client SDK in `analytics.js`.

**Option B — DEFAULTS override (faster, no PostHog setup):**

Edit `scripts/flags.js`:

```js
    'home_screen_v1':        true   // was false — temporarily enabled for eq demo
```

Commit + push to demo. This affects both tenants if SKS doesn't have its own variant override. Use Option A if you only want EQ.

## Mobile test checklist (10 minutes on your phone)

1. Open `eq-solves-field.netlify.app` on phone, log in as staff.
2. Verify you land on the tile home, NOT the schedule.
3. Tap each tile — confirm it routes to the correct existing page.
4. Tap cog → drawer slides up → tap "Contacts" → confirm route.
5. Toggle airplane mode → reload → confirm offline banner appears.
6. Re-enable network → page should re-render without offline banner.
7. Log out, log in as supervisor → confirm you see the existing sidebar shell, NOT the tile home.
8. Open same URL on desktop browser → confirm desktop shows existing shell.
9. Open on phone in browser dev tools, resize to 768px+ → confirm shell appears (not tile home).
10. Check Friday — does the Timesheets tile show "Due Fri" badge? (Wed/Thu/Fri only)

## Rollback (if needed)

One-line revert in `scripts/flags.js`:

```js
    'home_screen_v1':        false   // rolled back from v3.5.0 enable
```

Or if it's a PostHog flag, just toggle off in PostHog UI — no commit needed, effective in seconds.

---

*Generated 2026-05-14 · Ready for Royce's post-reset application*
