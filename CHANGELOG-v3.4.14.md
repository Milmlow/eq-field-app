# v3.4.14 — Analytics scope: demo-only, SKS stripped

Housekeeping release to make the analytics scope explicit in code.
Decision 2026-04-20: PostHog + Clarity are scoped to the EQ Solves
DEMO site only (`eq-solves-field.netlify.app`). SKS prod is
deliberately NOT wired — putting session analytics on a live
labour-hire platform triggers APP 1/5/8 privacy obligations, NSW
industrial-relations considerations (apprentice-heavy workforce,
ETU/CFMEU coverage), and client-contract questions (Equinix /
Schneider supply-chain compliance). None of that pays back on a
stable tenant.

## Changes

- `scripts/analytics.js` — `_ANALYTICS_CONFIG` no longer carries
  the `sks` block. The SKS PostHog key and SKS Clarity ID
  (`wek8dmtbuu`) are parked in `KEYS_INVENTORY.md`, not referenced
  in shipped code, so they can't be revived by accident.
- `scripts/analytics.js` — fallback behaviour hardened. Previously
  any tenant slug not in the config silently fell back to the `eq`
  demo config, meaning the SKS hostname (if anyone navigated to
  it) would have posted events tagged `tenant: sks` against the
  demo PostHog project. Now: unknown slug → `_config = null` →
  init returns early with a console.info, PostHog + Clarity never
  load.
- `scripts/app-state.js` — `APP_VERSION = '3.4.14'`.
- `sw.js` — cache bumped to `eq-field-v3.4.14`.
- `index.html` — header banner + sidebar footer version updated.

## Not changed

- PostHog + Clarity still run on the demo site exactly as before.
- Event taxonomy unchanged. Call-site wiring unchanged.
- No schema, RLS, or CSP changes.

## If SKS prod ever gets revived

Before adding an `sks` block back:
1. Staff disclosure email sent + written consent captured
2. `tenant_settings.analytics_enabled` migration shipped (kill switch)
3. Prod PII-masking audit (rendered text, not just inputs)
4. PostHog billing cap set
5. Replay-deletion process documented
6. Clarity set to Strict mode (not Balanced) for SKS
(See conversation 2026-04-20 for full risk stack.)
