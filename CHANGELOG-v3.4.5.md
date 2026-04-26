# v3.4.5 — Apprentices v2.1 (demo drop)

**Release date:** 2026-04-18
**Branch:** `demo` (eq-solves-field.netlify.app)
**Tag line:** Supportive, not administrative.

---

## What shipped

Three apprentice-module improvements plus a small bugfix, all bundled as one demo drop. Nothing added to the admin load — every new card reduces friction or surfaces what needs a human conversation.

### 1. Growth view on Skills Passport (B)

Positive-framed QoQ sparkline under the passport grid. For each competency the apprentice has rated 2+ times in the last 4 quarters, shows:

- A row label (competency name).
- A tiny SVG dot strip — last 4 periods, position = score, colour = rating tier.
- A delta chip — `+1.0` when things are going up (green), `−0.5` soft amber when dipping (not red).

Header copy: *"How you've grown"* with a one-liner like *"You've gained ground in 3 areas across this window — nice work."*

Pure SVG. No new libraries. Uses data already loaded in `skillsRatings`.

### 2. "Things to help them with" card on Overview (D)

Overview tab now shows any open follow-up items recorded in feedback entries. Each item has a **"Done — had the chat"** button that:

- Prompts for an optional resolution note.
- Stamps `resolved_at`, `resolution_note`, `resolved_by` on the feedback row.
- Updates the UI immediately.

Items older than 30 days get a soft amber background — supportive nudge, not red-alarm. Resolved items appear inline in the feedback log as a green "sorted on {date}" block with the note and the resolver's name.

### 3. "Who needs a check-in?" card on apprentices list (Option 1)

Manager-only card at the top of the apprentices list. Flags an apprentice if any of these are true:

- No self-rating recorded this quarter (guard: only starts firing 30 days into the quarter so supervisors aren't nagged on 1 July).
- No feedback in 60+ days.
- Open follow-up older than 30 days.

Each flagged apprentice gets one line with the reason(s) and a "Open profile" button. If nobody's flagged, the card doesn't render at all. Designed so supervisors walk in, see who's quietly falling behind, and have a chat — no escalation, no report, no new admin.

### 4. tafe.js bugfix (A)

`saveTafeHolidays()` POST fallback was writing `key: 'eq.tafe_holidays'` — the `eq.` is a Supabase filter operator, not part of the key value. Now writes `key: 'tafe_holidays'` to match the PATCH path.

Tiny fix but matters for any tenant that's never had the `tafe_holidays` row created via the UI before.

---

## Files changed

```
index.html                   — version bump + changelog block
sw.js                        — version bump + CACHE key bump
scripts/app-state.js         — APP_VERSION bump
scripts/tafe.js              — POST-fallback key fix
scripts/apprentices.js       — v2.0 → v2.1 (three new features)
```

All four JS files pass `node -c`.

---

## Supabase (demo only — ktmjmdzqrogauaevbktn)

Already applied in a previous session:

```sql
ALTER TABLE feedback_entries
  ADD COLUMN resolved_at TIMESTAMPTZ NULL,
  ADD COLUMN resolution_note TEXT NULL,
  ADD COLUMN resolved_by TEXT NULL;
```

**Not yet applied on SKS production** (`nspbmirochztcjijmcrx`). When these features merge to `main` as v3.4.6, the same migration needs to run on SKS first or `renderFollowUpsCard` will fail to PATCH on resolve.

---

## Upload checklist (demo branch)

1. Unzip `eq-field-demo-v3.4.5.zip`.
2. Upload each file to its matching path on `eq-solutions/eq-field-app`, branch `demo`:
   - `index.html`
   - `sw.js`
   - `scripts/app-state.js`
   - `scripts/apprentices.js`
   - `scripts/tafe.js`
3. Netlify auto-deploys to `eq-solves-field.netlify.app`.
4. Hard-refresh (Ctrl+Shift+R) to bust the service worker cache — network-first strategy should pick up fresh JS immediately.

---

## Not in this drop

- No PDF passport export (Royce: "schools worry about all that — keep it simple").
- No apprentice-set-their-own-goals (Tier 2 — next demo drop).
- No feedback-request email flow (Tier 2).
- No journal/reflection prompts (Tier 2).
- No FKs or per-org competencies (Tier 3).
- No weekly roster email (separate main-branch v3.4.5 candidate — got bumped, apprentices took priority today).

---

## Known minor things

- Local workspace folder has a leftover zip temp file `zia16Ad1` that couldn't be cleaned up from this session. Safe to delete manually.
