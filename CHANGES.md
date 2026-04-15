# Demo Branch Update — What Changed

## Files to upload to `demo` branch via GitHub web UI

### 1. scripts/app-state.js
Changes from main:
- APP_VERSION bumped to '3.3.8-demo'
- Added `eq` entry to TENANT_SUPABASE with demo Supabase credentials
- loadTenantConfig() — only 'demo' slug now short-circuits to in-memory mode. The 'eq' slug now falls through to the normal Supabase flow.
- Added TENANT_BRANDING.eq with demo access codes
- SEED data comment updated — SEED only used when ?tenant=demo

### 2. scripts/supabase.js
One-line change:
- _isDemoTenant() now only returns true for 'demo' slug (was 'eq' OR 'demo')
- This allows the EQ tenant to make real Supabase calls instead of returning fake data

## What was NOT changed
- main branch — untouched
- SKS live Supabase — untouched
- All other files — identical to main
