# v3.4.39 — id-coercion sweep + EMAIL_FROM wired up

**Date:** 2026-04-27
**Branch flow:** demo → main
**Why:** v3.4.38 fixed the leave.js id-coercion bugs Royce reported. A whole-codebase sweep showed the same `r.id === X` pattern in three other files — same silent-failure class, just less visible because the affected features (Apprentices, Job Numbers, Journal) get less use on SKS than the leave list does. Closing the class now while the rule is fresh.

Plus a small env-var feature wired up: configurable `from:` address on outbound emails.

## Code changes

### `scripts/apprentices.js` — 7 lookups coerced

All `find()` and `findIndex()` lookups in user-facing handlers now use `String(a) === String(b)`:

- Line 378 — `getCustomCompetencies` entry lookup
- Lines 744 + 2065 — `apprenticeProfiles` lookup by `req.apprentice_id`
- Line 1060 — `feedbackEntries` findIndex by `feedbackId`
- Line 1344 — `competencies` lookup by `entry.competency_id`
- Line 1802 — `feedbackRequests` lookup by `requestId`
- Line 2062 — `feedbackRequests` lookup by `reqId`

(Line 510 was already defensively coerced — left alone. Line 1568 already coerced.)

### `scripts/jobnumbers.js` — 2 lookups coerced

- Line 127 — `editJobNumber` lookup
- Line 166 — duplicate-check lookup before save

### `scripts/journal.js` — 1 lookup coerced

- Line 263 — `apprenticeJournal` findIndex on shared toggle

### `netlify/functions/send-email.js` — EMAIL_FROM env var support

```js
// Before
from: 'Leave Request <noreply@eq.solutions>',

// After
from: process.env.EMAIL_FROM || 'Leave Request <noreply@eq.solutions>',
```

Each Netlify project can now set `EMAIL_FROM` independently. Falls back to the prior hardcoded value if unset, so existing behaviour preserved.

**Suggested values** (optional):
- `eq-solves-field`: `EMAIL_FROM='EQ Field <noreply@eq.solutions>'` (Royce already added EMAIL_FROM as an env var on demo earlier today — was previously dead, now active)
- `sks-nsw-labour`: leave unset to keep current behaviour, or set to e.g. `'SKS Labour Hire <noreply@eq.solutions>'`

Resend authorises by domain, not mailbox, so any address on the verified `eq.solutions` domain works.

## Verification

```bash
grep -rn "\\.id === [a-zA-Z]" scripts/ | grep -v "String("
```

Should return only `apprentices.js:510` (the defensive belt-and-braces line) and `auth.js:145` (DOM element string compare, not a bigint issue).
