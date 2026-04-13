# EQ Solves — Field  ·  Deploy & Operations
## v3.3.5 — April 2026

> **Local repo path:** `C:\Projects\sks-nsw-labour`
> **Live site:** https://sks-nsw-labour.netlify.app
> **Demo site:** https://eq-solves-field.netlify.app

---

## Quick deploy

```
cd C:\Projects\sks-nsw-labour
git add .
git commit -m "v3.3.5 — description of changes"
git push
```

Netlify auto-deploys both sites in ~30 seconds.

---

## Netlify environment variables (required)

These are set in **Netlify → Site Settings → Environment Variables** and injected into
Netlify Functions at runtime. The functions will **fail explicitly** if any are missing.

| Variable | Used by | Purpose |
|----------|---------|---------|
| `EQ_SECRET_SALT` | verify-pin, eq-agent, send-email | HMAC-SHA256 signing key for session tokens |
| `AUDIT_SB_URL` | verify-pin, eq-agent | Supabase REST URL for audit log writes |
| `AUDIT_SB_KEY` | verify-pin, eq-agent | Supabase publishable key for audit logging |
| `RESEND_API_KEY` | send-email | Resend email API key |
| `ANTHROPIC_API_KEY` | eq-agent | Anthropic API key for EQ Agent chat |

> **Important:** No secrets are hardcoded in the codebase. If you rotate a key,
> update the Netlify env var and redeploy. Rotating `EQ_SECRET_SALT` will
> invalidate all existing session tokens (users must re-login).

---

## Netlify Functions

| Function | Auth | Purpose |
|----------|------|---------|
| `verify-pin.js` | PIN + HMAC-SHA256 | PIN validation, session token generation, remember-me |
| `eq-agent.js` | x-eq-token header | Anthropic API proxy for EQ Agent chat |
| `send-email.js` | x-eq-token header | Leave request email notifications (Resend) |

All functions enforce **CORS origin whitelisting** — only requests from
`sks-nsw-labour.netlify.app`, `eq-solves-field.netlify.app`, and `localhost`
(dev) are accepted. Branch deploys are auto-permitted via subdomain matching.

---

## Security headers (netlify.toml)

| Header | Value |
|--------|-------|
| Strict-Transport-Security | max-age=31536000; includeSubDomains |
| X-Frame-Options | DENY |
| X-Content-Type-Options | nosniff |
| Referrer-Policy | strict-origin-when-cross-origin |
| Permissions-Policy | camera=(), microphone=(), geolocation=(self), payment=() |
| Content-Security-Policy | self + Supabase + Google Fonts + R2 bucket |

---

## Scripts folder

```
scripts/
├── app-state.js      ← Global state, tenant config, seed data
├── utils.js          ← Helpers: esc, toast, modal, CSV
├── supabase.js       ← sbFetch, write queue, upsert helpers
├── roster.js         ← Roster grid render + cell editing
├── people.js         ← People CRUD + contacts
├── sites.js          ← Sites CRUD + grid
├── managers.js       ← Supervision CRUD
├── dashboard.js      ← Dashboard render
├── batch.js          ← Batch fill, copy last week
├── leave.js          ← Leave requests + email notifications
├── timesheets.js     ← Timesheet render, quick-fill, batch fill
├── jobnumbers.js     ← Job numbers CRUD + CSV
├── trial-dashboard.js← Trial dashboard view
├── import-export.js  ← Backup/restore, CSV import/export
├── calendar.js       ← Monthly calendar view
├── audit.js          ← Audit log write + modal + export
├── realtime.js       ← Supabase Realtime subscriptions
└── auth.js           ← Gate, PIN check, agency, supervisor auth
```

---

## Version history

| Version | Date | Changes |
|---------|------|---------|
| v3.3.5 | 13 Apr 2026 | **Security hardening:** env vars (no fallbacks), CORS whitelisting, send-email auth, HSTS, XSS fix, input validation, agent audit logging, error response sanitisation |
| v3.3.4 | 13 Apr 2026 | Privacy notice (APP compliance), security headers (CSP etc.), mobile nav polish, drawer reorg, timesheet quick-fill + Promise.all batch saves |
| v3.3.3 | 12 Apr 2026 | Mobile polish: 5-tab bottom nav, swipe drawer, logout button, responsive filters |
| v3.2.0 | 10 Apr 2026 | Code hygiene: Supabase upsert refactor, structured logging, dead code removal |
| v3.1.0 | Apr 2026 | Modularisation: extracted 13 script files from inline JS |

---

## Testing checklist

| Test | Expected |
|------|----------|
| Gate loads | Name picker and PIN field visible |
| Staff login (PIN: `2026`) | My Schedule view |
| Supervisor login (PIN: `SKSNSW`) | Dashboard, lock shows unlocked |
| Weekly Roster | Grid renders with sticky name column |
| Timesheets | Combined table, quick-fill row visible (supervisor) |
| Leave → New Request | Modal opens, submit sends email |
| EQ Agent | Chat works, responses appear |
| Calendar | Monthly grid renders |
| Audit Log | Loads entries from Supabase |
| Mobile drawer | Swipe down to close, sections visible |
| CORS check | DevTools network tab shows correct `Access-Control-Allow-Origin` |

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "Server misconfigured — missing EQ_SECRET_SALT" | Set the env var in Netlify and redeploy |
| "Not authenticated — please log in again" | Session expired or token invalid — re-login |
| 401 on send-email | Ensure leave.js passes `x-eq-token` header |
| CORS error in console | Origin not in whitelist — check function ALLOWED_ORIGINS |
| Blank page | Syntax error — run `node --check scripts/X.js` locally |

---

## Security documentation

See `EQ-Field-Security-Architecture.html` (v1.1) for the full security architecture
document, suitable for presentation to SKS Technologies senior management.
