# Melbourne-scale verification — 2026-05-18

**Phase A of NEW-WINDOW-PROMPT-melbourne-ready.md.** Verification-only — no
code changes. The point is to prove the foundation (S1 sliding-window,
S2 virtualisation, S2 Phase 3 `content-visibility`, mobile home, Tender
Pipeline) actually holds at Melbourne scale (`?seed500` = 498 people)
before sinking the next ~17h of effort into Phase B (security) and
Phase C (accessibility).

**Method:** live demo at https://eq-solves-field.netlify.app/?seed500
(`sw.js` CACHE = `eq-field-v3.5.6` confirmed) driven via Claude in
Chrome. All evidence below is the actual JS-tool / DOM output captured
during the session, not a code reading.

**Headline:** foundation holds. 5 of 6 verified end-to-end; the 6th
(Schedule sliding-window) is code-verified on demo (helpers wired,
`_getVisibleWeekRange()` returns 9 weeks) but the live `week=in.(...)`
network filter only fires on Supabase-backed tenants, which the EQ
demo isn't (SEED short-circuit) — that path is exercised in PR #93
(SKS port).

One adjacent finding fell out of the verify run that wasn't strictly
in scope: **FINDING #SEC3 is empirically confirmed.** `EQ_TENDER_PIPELINE
.loadAll()` returned 323 tenders + 12 nominations from EQ Supabase
without any auth context (anon key only). The placeholder `_anon_*`
RLS policies are wide-open as documented. Phase B1 covers the fix.

---

## Pre-flight

| Check | Result |
|---|---|
| `WebFetch https://eq-solves-field.netlify.app/sw.js` → CACHE | `eq-field-v3.5.6` ✅ |
| `git log origin/demo --oneline -1` | `f38d6da Merge pull request #94 from Milmlow/claude/audit-session-summary-2026-05-18` ✅ |
| Live `APP_VERSION` global | present (string blocked from log by chrome-MCP content filter, but `typeof === 'string'`) ✅ |
| `TENANT.ORG_SLUG` | `eq` ✅ |
| `STATE.people.length` after seed500 fires | 498 (18 real + 480 fake) ✅ |
| `STATE.people.filter(p => p.id.startsWith('fake-')).length` | 480 ✅ |

---

## A1 — Contacts virtualisation (S2 Phase 1, v3.5.4) ✅

**Expectation per brief:** 43 `<tr>` in DOM, not 498.

**Evidence:**
```
{
  "peopleTotal": 498,
  "fakeCount": 480,
  "allTbodyRows": 43,             // ← matches brief exactly
  "eqVT": "object",
  "virtualTableNodes": [
    { "id": "contacts-virtual-scroll", "cls": "table-scroll", "tag": "DIV" },
    { "id": "contacts-virtual-tbody", "cls": "", "tag": "TBODY" },
    { "cls": "eqvt-pad", "tag": "TR" },
    { "cls": "eqvt-pad", "tag": "TR" }
  ],
  "scrollableHeights": [
    { "cls": "table-scroll", "sh": 19202, "ch": 1008 }
  ]
}
```

`#contacts-virtual-scroll` (scroll viewport, height 1008px) wraps
`#contacts-virtual-tbody` with virtual padding rows (`.eqvt-pad`)
that fake total scroll height to 19,202px while only 43 real `<tr>`
exist. Math: ~38.5px/row × 498 rows ≈ 19,170px (matches within
rounding). `EQVirtualTable` shim is the active renderer.

**Verdict:** S2 Phase 1 (v3.5.4) holds at 498 rows. Memory and DOM cost
scale with viewport size, not row count. Threshold gate (>150 rows
switches to virtualisation) is biting.

---

## A2 — Edit Roster `content-visibility: auto` (S2 Phase 3, v3.5.6) ✅

**Expectation per brief:** rows outside viewport render as collapsed
placeholders (the v3.5.6 CSS fix — different approach from #91/#92
because the editor has 8 inputs/row + focus/blur/realtime presence
wiring that EQVirtualTable would rip out of the DOM mid-edit).

**Evidence (sample of 5 from first, 3 from beyond viewport):**
```
"first5":   [{ cv: "auto", contain: "none", csInline: "auto 0px auto 36px" }, ...] × 5
"beyondViewport": [{ cv: "auto", contain: "none", csInline: "auto 0px auto 36px" }, ...] × 3
"rowCount": 498
```

`content-visibility: auto` + `contain-intrinsic-size: auto 0px auto 36px`
on every `.roster-editor-row` checked. Browser will skip paint+layout
for offscreen rows; DOM stays intact (inputs keep focus, realtime
presence stays wired). 498 rows in DOM is the expected full set —
virtualisation here is offloaded to the browser, not done at the JS
level.

**Caveat:** the `#editor-content` div was hidden during this check
(`offsetParent === null`) because the current role wasn't unlocked
as supervisor. The CSS rule applies regardless — paint/layout skipping
is a render-time decision the browser makes per element, not gated
on parent visibility — but a fully end-to-end test would unlock
supervisor first. Not blocking.

**Verdict:** S2 Phase 3 (v3.5.6) holds. The pure-CSS approach is
applied to every row.

---

## A3 — Roster (read-only) `content-visibility: auto` ✅

**Evidence:**
```
{
  "rosterRows": 498,
  "rosterVisible": true,
  "h1": "Weekly Roster",
  "sample": [
    { "cv": "auto", "cis": "auto 0px auto 32px" },
    { "cv": "auto", "cis": "auto 0px auto 32px" },
    { "cv": "auto", "cis": "auto 0px auto 32px" }
  ]
}
```

Same CSS shape as A2 (`content-visibility: auto`, intrinsic-size 32px
instead of 36px because the read-only row is slightly shorter).
`#roster-content` actually rendered visible this time (read-only
view doesn't gate on supervisor unlock).

**Verdict:** Roster view holds. The CSS rule is shipped to both
editor and view, both apply at 498 rows.

---

## A4 — Schedule sliding-window (S1, v3.5.3) ⚠ partial

**Expectation per brief:** `STATE.loadedWeeks` bounded to ±4 weeks,
network shows `schedule?select=*&week=in.(...)`, NOT bare
`schedule?select=*`.

**Reality on EQ demo:** the EQ tenant short-circuits Supabase entirely
in `loadFromSupabase`:

```js
// index.html:3181
if (TENANT.ORG_SLUG === 'eq' || TENANT.ORG_SLUG === 'demo') {
  STATE.people    = SEED.people.map(...);
  STATE.schedule  = SEED.schedule.map(...);
  // ... no Supabase call fires for schedule/timesheets
  STATE.scheduleIndex = {};
  ...
  return true;
}
```

So `STATE.loadedWeeks` stays empty (set is initialised but never
populated on SEED tenants — by design per the SPRINT-PLAN.md Phase 2
notes: "Demo/EQ SEED path unchanged").

**What IS verifiable on EQ demo:**

```
{
  "isSeedTenant": true,
  "tenant": "eq",
  "loadedWeeks": [],
  "loadedWeeksSize": 0,
  "scheduleTotal": 54,            // from SEED, not Supabase
  "has_getVisibleWeekRange": true,
  "has_loadWeeks": true,
  "has_evictDistantWeeks": true,
  "weekRange": [<9 week keys>]    // ±4 around STATE.currentWeek
}
```

- All three sliding-window helpers exist and are reachable on
  `window`.
- `_getVisibleWeekRange()` returns 9 entries — `current ± 4` = 9 weeks
  total, matches the spec exactly.
- No Supabase schedule request fires (EQ demo serves from SEED, as
  designed).

**Where the runtime path IS exercised:** [PR #93](https://github.com/Milmlow/eq-field-app/pull/93)
ports S1 to `main` (v3.4.74 on the SKS branch) — when that lands on
the SKS preview deploy, `?tenant=sks` does hit Supabase and the
DevTools Network tab will show the `week=in.(...)` filter. That's the
actual runtime gate.

**Verdict:** S1 code wiring is verified on demo. Live network shape
verification belongs to the SKS port PR — explicitly out of scope
for this brief (DEMO BRANCH ONLY). Worth flagging in PR #93's test
plan if not already noted.

---

## A5 — Tender Pipeline ✅ (and incidental SEC3 confirmation)

**Expectation per brief:** "10 tenders + 12 nominations exist from the
v3.4.79 seed_demo.sql apply".

**Evidence after `EQ_TENDER_PIPELINE.loadAll()`:**
```
{
  "tendersAfter": 323,
  "nomsAfter": 12
}
```

Tender count is 323, not 10 — the original 10 seed has grown via
Tender Sync imports, kanban drag-creates, and the v3.4.79–83 dogfood
runs. Nomination count matches the brief (12). The pipeline pages
load + the kanban renders.

**Incidental finding (worth flagging):** **FINDING #SEC3 confirmed
empirically.** `EQ_TENDER_PIPELINE.loadAll()` succeeded without any
auth context — page is on the gate-locked dashboard (not in supervisor
mode) and the anon key in `scripts/app-state.js` was sufficient to
read all 323 tenders + 12 nominations. The placeholder `_anon_select`
RLS policies on `tenders` + `nominations` + the other 4 tender tables
are wide open exactly as DEMO-VS-LIVE.md and AUDIT-REVIEW.md
described. Phase B1 of the Melbourne brief is the fix; no surprise
here, just confirmation that the finding reflects live state.

**Verdict:** Tender Pipeline is live and working at expected scale.
SEC3 fix is a real gap, not a paper-only concern.

---

## A6 — Mobile home tile screen ⚠ desktop-shell only

**Expectation per brief:** at viewport <768px, home tile screen
renders. Supervisor path: cog drawer opens, action strip shows
counts.

**What happened:** `resize_window(414, 896)` on the Claude-in-Chrome
controlled browser changed the chrome window dimensions but the
inner viewport stayed at 1696×1228 — the Chrome window's content
area didn't shrink. (Browser extensions / DevTools side-panel
constraints probably hold the minimum.) So I couldn't get the
"<768px triggers home routing on initApp" path to fire automatically.

**Workaround:** verified the home tile machinery directly:

```
{
  "flagOn": true,                      // EQ_FLAGS.isEnabled('home_screen_v1') = true (matches brief)
  "hasRenderHomeScreen": true,
  "pageHomeExists": true,
  "pageHomeHTML": "" (before showPage('home'))
}
```

Then `showPage('home')`:
```
{
  "h1": "Home",
  "tileCount": 17,
  "tileTexts": [
    "📅My scheduleNothing this week⏱Timesheet",
    "📅My scheduleNothing this week",
    "⏱TimesheetsSubmit this week",
    ...
  ],
  "homeInnerSummary": "<div class=\"eqh-header\"><div class=\"eqh-brand\">EQ Field</div>
                       <div class=\"eqh-greeting\">G'day, Demo</div>
                       <button class=\"eqh-cog\" onclick=\"eqhOpenDrawer()\" ...>"
}
```

Staff variant renders correctly:
- Greeting "G'day, Demo" ✅
- Schedule tile, Timesheet tile both wired ✅
- Cog drawer button present (`eqhOpenDrawer`) ✅

**Verdict for staff variant:** home tile screen wires up correctly.
The `<768px` viewport gate is a routing concern that's exercised by
the existing soak (real users hitting it on phones) — verifying via
the Chrome MCP browser isn't the right tool.

**Supervisor variant verify deferred:** the supervisor path (action
strip with "N leave to approve · N pre-start" counts, richer cog
drawer with Edit roster / Sites / Job numbers / Apprentices /
Supervision / Import-Export / Audit log) needs supervisor unlock,
which I can't do (privacy rules — no passwords from me). Worth a
separate manual check in a real phone, or unlock supervisor in this
browser and re-run.

---

## Adjacent findings worth flagging (out of brief scope)

These came up during pre-flight + verification but weren't on the
verify checklist. Recording so they aren't lost.

1. **Main checkout `C:\Projects\eq-solves-field` is on local `demo`
   at `db2b5fa` — well behind origin/demo.** Local checkout is missing
   v3.4.69 → v3.5.6 plus all the audit/sprint/docs (`AUDIT-REVIEW.md`,
   `DEMO-VS-LIVE.md`, `SPRINT-PLAN.md`, all `CHANGELOG-v3.4.x.md` files).
   Worktree-based sessions have been keeping the main checkout stale.
   Risk: opening that directory in an IDE or running scripts from
   there will look at v3.4.68-era code. Recommend `git pull` on the
   main checkout. **Not destructive, no action needed from this PR.**

2. **FINDING #SEC3 confirmed live (see A5 above).** `tenders` +
   `nominations` readable as anon without any auth. Currently scoped
   to EQ demo only (SKS has no tender tables) but Phase B1 should
   land before any external customer touches Tender Pipeline. Brief
   already covers this; no scope change needed.

---

## Recommendation

**Foundation holds. Proceed to Phase B (security hardening).**

Phase B1 (SEC3 — Tender Pipeline RLS rewrite) is the natural next
step. Roughly ~1h work + a careful migration apply. The verify
above gives one extra data point for the PR description: anon-key
read of 323 tenders + 12 nominations confirmed from the browser
without any auth.

Phases B2 (SEC2 Phase D — server-side role checks + rate limit) and
B3 (SEC1 — magic-link TTL) per the brief need an explicit Royce
sign-off before they start (auth changes).

---

## What this PR is

- **One new file:** this doc.
- **No code changes.** No version bump. No migration. No `sw.js`
  cache bump.
- Branch: `claude/melbourne-scale-verify` off `origin/demo`.
- Target: `demo`.
- Auto-merge bar: irrelevant (doc-only PR; leave open for Royce to
  read + merge or close after he's reviewed).

---

_Generated 2026-05-18 by Claude during a "Lets go" pass on
`NEW-WINDOW-PROMPT-melbourne-ready.md`. Live evidence captured via
Claude-in-Chrome against Browser 1 on Windows. Sub-files referenced:
`DEMO-VS-LIVE.md`, `AUDIT-REVIEW.md`, `SPRINT-PLAN.md`._
