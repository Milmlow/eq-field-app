# EQ Solves — Field  ·  Deploy Instructions
## v3.3.4 — April 2026

> **Local repo path:** `C:\Projects\sks-nsw-labour`

---

## What's in this zip

```
eq-field-deploy.zip
├── index.html              ← Updated — now ~300 lines of inline JS (was ~4,000)
├── DEPLOY.md               ← This file
└── scripts/
    ├── supabase.js         ← NEW: sbFetch, write queue, all save/delete helpers
    ├── people.js           ← NEW: people CRUD + contacts render
    ├── sites.js            ← NEW: sites CRUD + sites grid
    ├── managers.js         ← NEW: supervision CRUD + render
    ├── dashboard.js        ← NEW: renderDashboard
    ├── batch.js            ← NEW: batch fill, copy last week, cleanup codes
    ├── leave.js            ← NEW: all leave request functions
    ├── timesheets.js       ← NEW: all timesheet functions + staff self-entry
    ├── jobnumbers.js       ← NEW: job numbers CRUD + CSV
    ├── import-export.js    ← NEW: backup/restore, all CSV import/export
    ├── calendar.js         ← NEW: monthly calendar view + side panel
    ├── audit.js            ← NEW: audit log write + modal + export
    └── auth.js             ← NEW: gate, PIN check, agency, supervisor password
```

The following scripts were **already in the repo** and are NOT included here
(don't delete them):
- `scripts/app-state.js`
- `scripts/utils.js`
- `scripts/roster.js`

---

## Steps

### 1. Copy the new scripts into the repo

On the Beelink, open `C:\Projects\sks-nsw-labour\scripts\` and drop in all 13 `.js` files
from this zip. Don't touch `app-state.js`, `utils.js`, or `roster.js`.

### 2. Replace index.html

Copy the `index.html` from this zip into `C:\Projects\sks-nsw-labour\`, replacing the
existing file.

> **If you've made custom changes** to the existing index.html (seed data tweaks, branding,
> Netlify function URLs), check those before overwriting and re-apply them to the new file.
> The main things to check:
> - `SEED` data in `scripts/app-state.js` (not in index.html anymore)
> - Any hardcoded org names or colours in the HTML

### 3. Verify the scripts folder

Your `scripts/` folder should now contain exactly these files:

```
app-state.js      ← existing
utils.js          ← existing
roster.js         ← existing
supabase.js       ← new
people.js         ← new
sites.js          ← new
managers.js       ← new
dashboard.js      ← new
batch.js          ← new
leave.js          ← new
timesheets.js     ← new
jobnumbers.js     ← new
import-export.js  ← new
calendar.js       ← new
audit.js          ← new
auth.js           ← new
```

### 4. Push to GitHub

Open Command Prompt locally:

```
cd C:\Projects\sks-nsw-labour
git add .
git commit -m "v3.1.0 — modularise: extract 13 script files, ~4000 lines from inline JS"
git push
```

Netlify will auto-deploy both sites in ~30 seconds.

### 5. Test

Open **eq-solves-field.netlify.app** and check:

| Test | Expected |
|------|----------|
| Gate loads | Name picker and PIN field visible |
| Staff login (PIN: `demo`) | My Schedule view |
| Supervisor login (PIN: `demo1234`) | Dashboard, lock shows 🔓 |
| Weekly Roster | Roster grid renders |
| Edit Roster | Cells editable, saves show toast |
| Batch Fill | Modal opens, applies codes |
| Copy Last Week | Modal confirm (not browser confirm()) |
| Leave → New Request | Modal opens, submit works |
| Timesheets | Grid renders for Apprentice + Labour Hire |
| Calendar | Monthly grid renders, click opens panel |
| Job Numbers | Table renders |
| Import/Export | Backup download works |
| Audit Log | Loads from Supabase |
| Agency Access | Timesheets-only view |

### 6. If something breaks

Open browser DevTools → Console. The error will name the missing or redefined function.

Common issues:
- **"X is not defined"** — a function was deleted from index.html but its script tag is
  missing or in the wrong load order. Check the 16 `<script>` tags in `<head>`.
- **"X is already defined"** — a function exists in both index.html and a new script.
  Delete it from index.html.
- **Blank page** — syntax error in one of the new scripts. Run `node --check scripts/X.js`
  locally to find it.

---

## Bug fixes included in v3.1.0

| Bug | Fix |
|-----|-----|
| BUG-001 | `saveManager()` dupe check used wrong variable + wrong array |
| BUG-003 | `removePerson()` never called `deletePersonFromSB()` — person reappeared on sync |
| BUG-004 | Schedule dedup used `esc()` as map key — broke names with `&` `<` `>` |
| BUG-005 | `leaveRequests` was undefined when `confirmRemoveManager()` ran |
| BUG-009 | `copyLastWeek()` used `confirm()` — broken in iOS PWA standalone |
| BUG-011 | Write queue had no retry limit — infinite loop on invalid requests |
| BUG-013 | `showImportConfirm()` didn't escape summary string |
| BUG-014 | `respondLeave()` read `leave-respond-id` twice |
| BUG-016 | `toCSV()` wasn't always defined — exports silently failed |
| SEC-002 | Supervisor password now validated server-side for production tenants |
| SEC-004 | Manager remove buttons now use `data-` attributes (XSS fix) |
| PERF    | `STATE.scheduleIndex` built on load for O(1) schedule lookups |

## Supabase schema updates applied today

- `idx_schedule_name_week` + `idx_schedule_org_week` — faster roster queries
- `updated_at` triggers on `schedule`, `people`, `sites` — conflict detection works
- `idx_audit_log_created` + `idx_audit_log_org_cat` — faster audit queries
- `idx_leave_requests_status` — faster pending leave queries
- `idx_timesheets_name_week` — faster timesheet lookups
- Fixed `timesheets` unique constraint to include `org_id`
- `idx_sites_abbr_org` — enforces unique abbreviations per org at DB level
