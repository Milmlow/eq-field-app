# v3.4.29 — Digest panel bulletproofing + tenant 404 silencing (2026-04-26)

## Bug 1 — Digest opt-in checkboxes still re-appearing as ticked

v3.4.28 added a re-hydrate-before-render path via the `renderManagers` wrap. Royce reported it didn't fully fix the bug — unticks persisted to the DB but the UI still painted "all ticked" on Supervision page.

**Why the wrap pattern wasn't enough:** wrap fires when `renderManagers` is called from page-nav, but other code paths can call `renderDigestPanel()` directly (the function is exposed on `window`). Those direct calls skipped the hydrate, painted from STATE.managers (which doesn't carry `digest_opt_in`), and rendered everyone as ticked because `undefined !== false` reads as "on".

**Fix in v3.4.29:** make `renderDigestPanel` itself responsible for getting the truth. On every call:
1. Paint immediately from STATE (instant feedback, possibly stale).
2. Fire `sbFetch('managers?select=id,name,email,digest_opt_in&order=name.asc')` (~25ms).
3. Repaint from the fetch result, and sync STATE so `toggleDigest`'s optimistic update stays consistent.

Falls back to STATE-only render if the fetch fails (offline, migration absent on tenant).

## Bug 2 — Console 404 noise on SKS

SKS is a leaner tenant than EQ — it doesn't have the apprentice / feedback / skills-ratings / rotations / competencies / etc. tables. The frontend optimistically loads all `ORG_TABLES` and a few ad-hoc ones, hitting a postgrest 404 each time. ~10 red errors in DevTools on every page load. Cosmetic, but alarming.

**Fix:** new `TENANT_DISABLED_TABLES` map in `app-state.js`. `sbFetch` GET checks the active tenant's list and returns `[]` immediately — no fetch made, no 404 logged. Writes (POST/PATCH/DELETE) still hit the wire so a bug accidentally trying to insert into a disabled table fails loudly.

SKS's disabled list:
- `apprentice_profiles`, `apprentice_journal`
- `skills_ratings`, `competencies`, `sks_quotes_materials`, `checkins`
- `feedback_entries`, `feedback_requests`
- `rotations`, `buddy_checkins`, `quarterly_reviews`, `engagement_log`

EQ tenant gets the empty default — all tables enabled.

## Verification

- DB-truth check on SKS: `select count(*) filter (where digest_opt_in) as on, count(*) filter (where not digest_opt_in) as off from managers where org_id = sks_id;` → still 1 on / 14 off (Royce's earlier unticks). v3.4.29 should now paint that correctly on every render.
- Console: page load on SKS expected to show 0 red 404 lines for the table list above.
