-- ────────────────────────────────────────────────────────────
-- Migration: TAFE day + NSW 2026 holiday seed
-- Project:   eq-field-app
-- Version:   3.4.2
-- Applied:   Demo  (ktmjmdzqrogauaevbktn) — 2026-04-16 ✓
--            Prod  (nspbmirochztcjijmcrx) — 2026-04-16 ✓
-- ────────────────────────────────────────────────────────────
-- Note on key naming:
--   app_config keys in this project are FLAT (no namespace):
--     staff_code, supervisor_code, manager_password, logo_colour …
--   So the TAFE holidays key is just `tafe_holidays`, not `eq.tafe_holidays`.
--   An earlier version of this script used the prefixed form which caused
--   the client load to find nothing. That's been corrected.
-- ────────────────────────────────────────────────────────────

-- 1. Add tafe_day column to people (nullable, constrained to weekdays)
ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS tafe_day text
  CHECK (tafe_day IS NULL OR tafe_day IN ('mon','tue','wed','thu','fri'));

COMMENT ON COLUMN public.people.tafe_day IS
  'Apprentice nominated TAFE weekday (mon/tue/wed/thu/fri). NULL = no TAFE day. Used by the "Apply TAFE Day" action on the roster editor.';

-- 2. Seed TAFE holidays with NSW Eastern Division 2026 school holiday dates.
-- Source: NSW Department of Education — education.nsw.gov.au/schooling/calendars/2026
-- Covers Autumn, Winter, Spring 2026 and Summer 2026→Jan 2027.
INSERT INTO public.app_config (key, value, org_id)
VALUES (
  'tafe_holidays',
  '[
    {"start":"2026-04-07","end":"2026-04-17","label":"Autumn holidays (Term 1 break)"},
    {"start":"2026-07-06","end":"2026-07-17","label":"Winter holidays (Term 2 break)"},
    {"start":"2026-09-28","end":"2026-10-09","label":"Spring holidays (Term 3 break)"},
    {"start":"2026-12-18","end":"2027-01-26","label":"Summer holidays (Term 4 break)"}
  ]'::text,
  '1eb831f9-aeae-4e57-b49e-9681e8f51e15'  -- SKS org_id; replace for other tenants
)
ON CONFLICT (key) DO NOTHING;
