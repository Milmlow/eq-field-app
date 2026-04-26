# v3.4.28 — Digest re-hydrate + tenant-aware favicon (2026-04-26)

Two follow-ups to v3.4.26 / v3.4.27:

## Bug 1 — Digest opt-in UI shows stale "all ticked" after navigation

**Symptom:** Untick a supervisor on the Supervision page → checkbox unticks → DB row updates correctly (`digest_opt_in = false`) → toast confirms. Navigate away and back → all checkboxes show ticked again, even though the DB still says `false`.

**Root cause:** The bulk `managers` fetch (in app-state) doesn't include the `digest_opt_in` column in its SELECT. `digest-settings.js` lazy-loads that column once on DOMContentLoaded via `hydrateDigestOptIns()`. After a navigation that re-fetches managers, those rows come back without the column → `m.digest_opt_in === undefined` → render path treats `undefined !== false` as "ticked".

**Fix:** `renderManagers` wrap now checks `STATE.managers.some(m => m.digest_opt_in === undefined)` before painting. If any row is missing the column, re-hydrate first, then render. Cheap query (id + boolean), runs ~25ms.

## Bug 2 — SKS-branded favicon serving on EQ demo

**Symptom:** `eq-solves-field.netlify.app` showed the SKS logo in the browser tab.

**Root cause:** Single repo, two Netlify sites. v3.4.26 replaced the icons in `/icons/` with SKS-branded versions; both sites pull from the same repo so both got the SKS icons.

**Fix:** Repo now has two icon sets:
- `/icons/` — SKS-branded (default, served as-is on `sks-nsw-labour.netlify.app`)
- `/icons-eq/` — EQ-branded (recovered from pre-v3.4.26 git history)

Inline `<script>` in `<head>` detects the hostname at boot. If hostname doesn't contain "sks", it rewrites every `<link rel*="icon">` href from `icons/` → `icons-eq/`. Runs synchronously, no flash.

Future tenants (anything that isn't SKS) inherit the EQ icons by default. If/when a third tenant ships, add a host check + a third `/icons-<tenant>/` folder.

## Verified

- DB after Royce's SKS unticks: 14/15 supervisors `digest_opt_in=false`, only Royce Milmlow `true`. PATCH path was always working — just the render path was lying.
- Live favicon md5 mismatch confirmed pre-fix: EQ demo and SKS prod both served the 2361-byte SKS-branded `favicon-32x32.png`. Post-fix should resolve to different bytes.
