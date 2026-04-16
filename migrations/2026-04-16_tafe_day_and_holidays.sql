-- ────────────────────────────────────────────────────────────
-- Migration: TAFE day + NSW 2026 holiday seed
-- Project:   eq-field-app
-- Version:   3.4.2
-- Applied:   Demo (ktmjmdzqrogauaevbktn) — 2026-04-16 ✓
-- Pending:   SKS prod (nspbmirochztcjijmcrx)
-- ────────────────────────────────────────────────────────────
-- Before running on SKS prod:
--   1. Confirm app_config PK is still (key) alone — if it's
--      (org_id, key), add org_id to the ON CONFLICT clause.
--   2. Replace the org_id below with the SKS org UUID.
--      SKS org UUID (from memory): 1eb831f9-aeae-4e57-b49e-9681e8f51e15
--   3. Verify no 'eq.tafe_holidays' row already exists — ON CONFLICT
--      DO NOTHING will skip silently if one does.
-- ────────────────────────────────────────────────────────────

-- 1. Add tafe_day column (nullable — Direct / Labour Hire leave it empty)
ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS tafe_day text
  CHECK (tafe_day IS NULL OR tafe_day IN ('mon','tue','wed','thu','fri'));

COMMENT ON COLUMN public.people.tafe_day IS
  'Apprentice nominated TAFE weekday (mon/tue/wed/thu/fri). NULL = no TAFE day. Used by the "Apply TAFE Day" action on the roster editor.';

-- 2. Seed TAFE holidays with NSW Eastern Division 2026 school holiday dates.
-- Source: NSW Department of Education, education.nsw.gov.au/schooling/calendars/2026
INSERT INTO public.app_config (key, value, org_id)
VALUES (
  'eq.tafe_holidays',
  '[
    {"start":"2026-04-07","end":"2026-04-17","label":"Autumn holidays (Term 1 break)"},
    {"start":"2026-07-06","end":"2026-07-17","label":"Winter holidays (Term 2 break)"},
    {"start":"2026-09-28","end":"2026-10-09","label":"Spring holidays (Term 3 break)"},
    {"start":"2026-12-18","end":"2027-01-26","label":"Summer holidays (Term 4 break)"}
  ]'::text,
  'a0000000-0000-0000-0000-000000000001'  -- DEMO org_id; replace for SKS prod
)
ON CONFLICT (key) DO NOTHING;
