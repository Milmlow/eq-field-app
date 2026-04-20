# v3.4.11 — Analytics wire-up (PostHog EU + Microsoft Clarity)

Adds opt-in-able product analytics to EQ Field. PostHog for structured
events/funnels/cohorts; Clarity for session replay and heatmaps. Both
free tiers. Region: PostHog **EU Cloud** (`eu.i.posthog.com`) — PostHog
has no AU region; EU is the closest to Australia and data-sovereignty-
friendlier than US. Clarity is US-only.

Demo-only on this release. SKS production push is gated on Royce
sending the internal disclosure note.

## What's in

### New files

- `scripts/analytics.js` — plain-JS IIFE loader. Hostname-keyed config
  (`eq` for demo, `sks` for prod) selects the right PostHog project key
  and Clarity ID. Exports `window.EQ_ANALYTICS` with an `init()`,
  `identify()`, `track()`, and an `events.*` namespace for named helpers.
- `scripts/analytics-TODO-hooks.md` — snippets for the five event hooks
  whose home scripts (`auth.js`, `timesheets.js`, `roster.js`) aren't on
  disk yet. Drop in when those files land.

### Modified

- `index.html` — loads `scripts/analytics.js` after `app-state.js`.
  `initApp()` fires `session_started` once identity is resolved.
  Six inputs masked from session replay via `data-ph-no-capture` +
  `data-clarity-mask="true"`: gate PIN, staff TS PIN, person PIN, bulk
  PIN, site address, journal reflection.
- `scripts/leave.js` — fires `leave_request_submitted` on successful
  submit (includes `days_count`, `leave_type`, `has_note` flags).
- `scripts/people.js` — fires `people_modal_opened` (mode: add/edit) and
  `people_modal_saved` (includes `has_apprentice_year` flag).
- `scripts/import-export.js` — fires `csv_exported` for both exports,
  with `export_type` = `people` or `contacts[_<group>]`.
- `sw.js` — cache bumped to `eq-field-v3.4.11` and
  `/scripts/analytics.js` added to `PRECACHE` so analytics works
  offline.
- `scripts/app-state.js` — `APP_VERSION = '3.4.11'`.

## Events live on this release

| Event | Where it fires | Props |
|---|---|---|
| `session_started` | `initApp()` after identify | `app_env`, `tenant_slug`, `app_version` |
| `leave_request_submitted` | `_performLeaveSubmit()` | `days_count`, `leave_type`, `has_note` |
| `people_modal_opened` | `openAddPerson()` / `editPerson()` | `mode: 'add' \| 'edit'` |
| `people_modal_saved` | `savePerson()` | `has_apprentice_year` |
| `csv_exported` | `exportPeopleCSV()` / `exportContactsCSV()` | `export_type` |
| `error_thrown` | global `window.onerror` + `unhandledrejection` | `message`, `source`, `line` |

## Events still pending (see `scripts/analytics-TODO-hooks.md`)

- `pin_login_succeeded` / `pin_login_failed` — in `auth.js` (file not
  present on demo branch yet)
- `timesheet_viewed` / `timesheet_entry_created` — in `timesheets.js`
  (file not present on demo branch yet)
- `roster_viewed` — in `roster.js` (file not present yet)

Precached in `sw.js` so they load once the home scripts land.

## Privacy and masking

- PostHog `person_profiles: 'identified_only'` — no anonymous profiles
  get created. Identity is set in `initApp()` using the same user handle
  the app already has.
- Session replay is on but masks (a) all inputs with
  `data-ph-no-capture` / `data-clarity-mask="true"`, (b) all `<input>`,
  `<textarea>`, `<select>` contents by default (PostHog's `mask_all_inputs`
  is the default), and (c) all text with `data-private="true"`.
- Per-tenant opt-out wiring is in the plan (`tenant_settings.analytics_enabled`
  Supabase column) but the migration isn't in this release — it lands
  with the SKS prod push.

## Keys

- PostHog EU `eq-development` — embedded in `scripts/analytics.js`
  (public, safe to ship in a frontend bundle).
- PostHog EU `eq-production` — embedded for hostname `sks-nsw-labour.*`.
- Clarity IDs — placeholders; init is guarded and no-ops until filled
  in. Next step is creating four Clarity projects.

Inventory lives in `Projects/eq-analytics-v2/eq-context/KEYS_INVENTORY.md`.

## How to verify after deploy

1. Open `https://eq-solves-field.netlify.app` with DevTools → Network.
   Filter for `posthog`. You should see a POST to
   `https://eu.i.posthog.com/e/` within seconds of page load.
2. In PostHog EU → project `eq-development` → **Activity** → **Live
   events**. You should see `$pageview` and `session_started` within ~30s.
3. Submit a leave request / open the Add Person modal / export a CSV and
   watch the matching events arrive.
4. Wait ~60s then check PostHog → **Replay**. Should see the session.
5. Clarity: skipped until IDs are in.

## Rollback

Netlify → Deploys → pick the v3.4.10 deploy → **Publish deploy**.
Or revert the commit and push.
