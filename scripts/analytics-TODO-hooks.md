# Analytics hooks pending — EQ Field

These five events need call-sites, but their home script is referenced
in `index.html` and doesn't exist on disk yet. When the script is
extracted from `index.html` (or written fresh), add the hook.

Plan ref: `eq-context/docs/EQ_Analytics_Install_Plan_v2.md` §5.1

## Pending hooks

### 1. scripts/auth.js → `checkPin()` — after PIN check

When the PIN is compared and the user is admitted, fire `pin_login_succeeded`
with the resolved role. When the PIN is rejected, fire `pin_login_failed`
with an incrementing counter tracked in a module-local variable.

```js
// Near the top of scripts/auth.js
let _pinFailCount = 0;

function checkPin() {
  // ... existing PIN comparison ...
  if (accepted) {
    _pinFailCount = 0;
    // resolve role from isManager / agencyMode / sessionStorage flags
    const role = isManager ? 'supervisor' : (agencyMode ? 'admin' : 'tradie');
    try {
      if (window.EQ_ANALYTICS) {
        window.EQ_ANALYTICS.events.pinLoginSucceeded({ role: role });
      }
    } catch (e) {}
    // ... existing post-login flow ...
  } else {
    _pinFailCount++;
    try {
      if (window.EQ_ANALYTICS) {
        window.EQ_ANALYTICS.events.pinLoginFailed({ attempt_count: _pinFailCount });
      }
    } catch (e) {}
  }
}
```

Staff timesheet PIN (`checkStaffTsLogin`) should get the same treatment if
you want to distinguish — or leave it out for v1 and just fire on the main
gate PIN.

### 2. scripts/timesheets.js → `showTimesheetsTab()` / render function

When the timesheet screen opens, fire `timesheet_viewed`:

```js
try {
  if (window.EQ_ANALYTICS) {
    window.EQ_ANALYTICS.events.timesheetViewed({
      week_of:          STATE.currentWeek,
      entries_existing: (STATE.timesheets || []).filter(t => t.week === STATE.currentWeek).length,
    });
  }
} catch (e) {}
```

### 3. scripts/timesheets.js → `saveTimesheetEntry()` / equivalent save fn

When a new entry is saved, fire `timesheet_entry_created`:

```js
try {
  if (window.EQ_ANALYTICS) {
    window.EQ_ANALYTICS.events.timesheetEntryCreated({
      hours:        Number(entry.hours) || 0,
      has_job_code: !!(entry.job_code && String(entry.job_code).trim()),
      entry_method: 'manual',
    });
  }
} catch (e) {}
```

### 4. scripts/roster.js (or dashboard.js) → roster render function

When the roster screen opens, fire `roster_viewed`:

```js
try {
  if (window.EQ_ANALYTICS) {
    window.EQ_ANALYTICS.events.rosterViewed({
      week_of:      STATE.currentWeek,
      people_count: (STATE.people || []).length,
    });
  }
} catch (e) {}
```

## Already wired

- `session_started` — `initApp()` in index.html (after realtime start)
- `leave_request_submitted` — `_performLeaveSubmit()` in scripts/leave.js
- `people_modal_opened` — `openAddPerson()` / `editPerson()` in scripts/people.js
- `people_modal_saved` — `savePerson()` in scripts/people.js
- `csv_exported` — `exportPeopleCSV()` / `exportContactsCSV()` in scripts/import-export.js
- `error_thrown` — global window.error + unhandledrejection listeners in scripts/analytics.js

## Guarding pattern

Every call site wraps in `try { ... } catch (e) {}` and checks
`window.EQ_ANALYTICS` existence. This keeps analytics **never breaking
the host app** — if PostHog fails to load, the app still works.

## Placeholder keys

`scripts/analytics.js` currently has `phc_REPLACE_ME_*` / `REPLACE_ME_CLARITY_*`
placeholders. Init is guarded — it's a no-op until real keys are pasted in.
Order: create PostHog AU account → create the two projects → paste keys →
same for Clarity's four projects.
