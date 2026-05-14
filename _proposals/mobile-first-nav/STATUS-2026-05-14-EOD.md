# v3.5.0 Phase 1 — end-of-day status (2026-05-14)

Snapshot for Royce to pick up tonight. Everything below is verified on disk at the time of writing.

## What's ready to commit (intact, verified)

| Path | Lines | Status |
|---|---|---|
| `scripts/home.js` | 362 | Parses clean. IIFE closes correctly. Public API: `renderHomeScreen`, `eqhTileTap`, `eqhOpenDrawer`, `eqhCloseDrawer`. |
| `styles/home.css` | 315 | Tile grid, next-shift pill, cog button, badges, loading skeleton, offline banner, error state, cog drawer styles. |
| `CHANGELOG-v3.5.0.md` | 121 | Release notes with decision-trace, files-touched table, rollout sequence, rollback steps. |
| `_proposals/mobile-first-nav/READY-TO-APPLY-v3.5.0.md` | 400 | **Critical for tonight.** 12 literal old_string / new_string edit blocks for flags.js, app-state.js, sw.js, index.html. Pre-flight commands, post-apply verification commands, commit/push sequence, flag-flip cheat sheet, 10-step mobile test checklist, rollback. |
| `_proposals/mobile-first-nav/phase-2-supervisor-home.js` | 436 | DRAFT scaffolding for v3.5.1. Action strip + 6 tiles + supervisor cog drawer. Parses clean. Includes promotion checklist for Option A (extend home.js) vs Option B (separate file). |
| `_proposals/mobile-first-nav/staff-home.html` | 296 | Visual reference mockup (Cowork-rendered HTML). |
| `_proposals/mobile-first-nav/supervisor-home.html` | 321 | Visual reference mockup. Already updated to decision G1 (no count badges). |

## What still needs to happen (in order)

1. **Sync local to origin/demo.** From your terminal:
   ```bash
   cd C:\Projects\eq-solves-field
   git fetch origin demo
   git diff HEAD origin/demo --stat
   git reset --hard origin/demo
   ```
   After this: `flags.js` will be the clean origin version (no truncation), `app-state.js` will be at 3.4.81, `sw.js` will be at v3.4.81. Untracked files survive — the table above is preserved.

2. **Verify clean state:**
   ```bash
   node --check scripts/flags.js && echo OK
   git status        # should show only untracked v3.5.0 files
   ```

3. **Ping me with "ready"** — I apply the 12 edits in `READY-TO-APPLY-v3.5.0.md` mechanically. ~2 minutes.

4. **Run the post-apply verification block** in that doc.

5. **`git add` the seven files, commit, push to demo:**
   ```bash
   git add scripts/home.js styles/home.css CHANGELOG-v3.5.0.md \
           scripts/flags.js scripts/app-state.js sw.js index.html
   git commit -m "v3.5.0 — Mobile-first home tile screen ..."
   git push origin demo
   ```
   (Full commit message in `READY-TO-APPLY-v3.5.0.md`.)

6. **Wait ~30s for Netlify deploy** to `eq-solves-field.netlify.app`. Verify footer reads `v3.5.0`. Flag is default-off — no behaviour change yet.

7. **Enable the flag for EQ tenant only.** Two options documented in `READY-TO-APPLY-v3.5.0.md` § "Enabling the flag for testing" — PostHog (cleaner) or DEFAULTS override (faster).

8. **10-minute mobile test** on your phone — checklist in the same doc.

## What didn't survive the session (and what to do about it)

`MOBILE-FIRST-NAV-PROPOSAL.md` was reverted to its v1.0 truncated state on disk during the build. Lost content:

- **Appendix A** (v1.0 → v1.1 review-pass summary) — non-essential. Captured what changed when the proposal was reviewed from three perspectives.
- **Appendix B** (Phase 1 build lessons learned — concurrent-session conflicts, git lock state, recovery pattern, recommendations for future parallel work) — useful as a future reference but not blocking.

The truncation pattern (file reverted to an earlier byte-length on disk despite a successful Edit call) is the same one that hit `scripts/flags.js` during build — see the diagnosis in this folder for next time.

**Recovery options if you want the appendices back:**

- Easiest: ping me after the reset is done and I'll write them to a new file `MOBILE-FIRST-NAV-PROPOSAL-APPENDICES.md` (new files survived this session reliably; only existing files got reverted).
- Or: accept the loss. The v1.0 truncated body is reference-only at this point — the active operating document is `READY-TO-APPLY-v3.5.0.md`. The decisions A through I are baked into the changelog and the code itself.

## Don't do this

- Do NOT `git add .` + commit in the current pre-reset state. The reverted edits in your working tree are out-of-sync with origin/demo (which has them committed). Committing now creates a divergent history that's painful to fix.
- Do NOT manually edit `scripts/flags.js`, `scripts/app-state.js`, `sw.js`, or `index.html` before the reset. They'll get clobbered anyway.
- Do NOT enable the `home_screen_v1` flag globally on first push. Flip per-tenant: EQ first, eyeball-verify, then SKS.

---

*Generated 2026-05-14 EOD · Awaiting Royce's reset + ping*
