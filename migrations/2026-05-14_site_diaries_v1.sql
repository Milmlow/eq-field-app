-- ────────────────────────────────────────────────────────────
-- Migration: site_reports v3 — site_diaries table
-- Project:   eq-field
-- Version:   3.4.77
-- Created:   2026-05-14
-- Applied:   Demo  (ktmjmdzqrogauaevbktn) — pending
--            Prod  (nspbmirochztcjijmcrx) — DO NOT APPLY until "SKS live"
-- ────────────────────────────────────────────────────────────
-- Purpose: Site Reports module v3 — daily site diary entries.
--          The biggest workflow so far. Captures the full shift
--          picture per site: weather, work areas, delays, incidents,
--          visitors, materials, equipment, supervisor notes, plus
--          the standard photos + attendance + signature pattern
--          shared with Prestart and Toolbox.
--
--          Third workflow in the absorption of sks-field-reports v29
--          into EQ Field. Mirrors the prestarts / toolbox_talks
--          table shape so the UI module (scripts/diary.js) can reuse
--          the shared controllers from site-reports-shared.js (v3.4.76).
--
-- Field-name notes:
--   • `supervisor` (not `sks_rep`) — tenant-neutral, matching the
--     facilitator/etc. pattern from Toolbox v3.4.75.
--   • `diary_date` (not `briefing_date` or `meeting_date`) — diary
--     covers a whole day, not a moment.
--   • `attendance` JSONB (same shape as toolbox_talks.attendance and
--     prestarts.crew) — signature pad code is reusable.
--   • Repeating-row sections (work_areas, delays, incidents, visitors)
--     all stored as JSONB arrays so the whole record is one PATCH
--     from the client. Shapes documented in column comments below.
--
-- v4 will add weekly_reports + the cross-workflow compliance pack
-- export (Hammertech / Aconex / Procore).
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.site_diaries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  site_abbr       text,
  diary_date      date NOT NULL,
  shift_type      text CHECK (shift_type IS NULL OR shift_type IN ('day','night','split')),
  start_time      time,
  end_time        time,
  supervisor      text,
  subcontractor   text,
  -- Weather: { temp_min, temp_max, conditions, wind, rain_mm, humidity }
  weather         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Repeating sections, all JSONB arrays. Shapes per column comment.
  work_areas      jsonb NOT NULL DEFAULT '[]'::jsonb,
  delays          jsonb NOT NULL DEFAULT '[]'::jsonb,
  incidents       jsonb NOT NULL DEFAULT '[]'::jsonb,
  visitors        jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Free-text fields for ad-hoc information.
  materials_received text,
  equipment_status   text,
  notes              text,
  -- Attendance + signature pad (shared shape across workflows).
  attendance      jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Inline base64 photos (shared shape).
  photos          jsonb NOT NULL DEFAULT '[]'::jsonb,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted')),
  submitted_at    timestamptz,
  submitted_by    text,
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS site_diaries_org_date_idx
  ON public.site_diaries (org_id, diary_date DESC);

CREATE INDEX IF NOT EXISTS site_diaries_site_date_idx
  ON public.site_diaries (site_abbr, diary_date DESC)
  WHERE site_abbr IS NOT NULL;

COMMENT ON TABLE public.site_diaries IS
  'Daily site diary entries — full shift picture per site. Sourced from '
  'the sks-field-reports v29 workflow, generalised for EQ Field tenants.';

COMMENT ON COLUMN public.site_diaries.weather IS
  'Shape: { temp_min: number, temp_max: number, conditions: text, '
  'wind: text, rain_mm: number, humidity: number }. All keys optional.';

COMMENT ON COLUMN public.site_diaries.work_areas IS
  'Shape: [{ id, area, description, crew_count, hours_worked }].';

COMMENT ON COLUMN public.site_diaries.delays IS
  'Shape: [{ id, time, duration_min, cause, impact }].';

COMMENT ON COLUMN public.site_diaries.incidents IS
  'Shape: [{ id, time, type (near-miss|injury|spill|damage|other), '
  'description, action_taken }].';

COMMENT ON COLUMN public.site_diaries.visitors IS
  'Shape: [{ id, name, company, time_in, time_out, purpose }].';

COMMENT ON COLUMN public.site_diaries.attendance IS
  'Per-attendee sign-off. Shape: [{ name, person_id, signed_at, signed_by, '
  'signature_image }]. Same JSONB shape as toolbox_talks.attendance and '
  'prestarts.crew so signature pad code is reusable.';

COMMENT ON COLUMN public.site_diaries.photos IS
  'Inline base64-encoded photos. Max 8 per record. Each entry: '
  '{ id, caption, base64 (data URI), taken_at, taken_by }.';

-- updated_at trigger — mirror prestarts / toolbox_talks pattern.
CREATE OR REPLACE FUNCTION public.site_diaries_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_site_diaries_updated_at ON public.site_diaries;
CREATE TRIGGER trg_site_diaries_updated_at
  BEFORE UPDATE ON public.site_diaries
  FOR EACH ROW EXECUTE FUNCTION public.site_diaries_set_updated_at();

-- ────────────────────────────────────────────────────────────
-- RLS — same tenant-scoped pattern as prestarts and toolbox_talks.
-- Today gates write at the app layer via window.EQ_PERMS. Phase 2
-- will tighten with auth.uid()-bound policies once the JWT-driven
-- role model lands. KNOWN: USING (true) is permissive — flagged in
-- 2026-05-14 review for the upcoming RLS-tighten workstream.
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.site_diaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS site_diaries_select_tenant ON public.site_diaries;
CREATE POLICY site_diaries_select_tenant ON public.site_diaries
  FOR SELECT USING (true);

DROP POLICY IF EXISTS site_diaries_insert_tenant ON public.site_diaries;
CREATE POLICY site_diaries_insert_tenant ON public.site_diaries
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS site_diaries_update_tenant ON public.site_diaries;
CREATE POLICY site_diaries_update_tenant ON public.site_diaries
  FOR UPDATE USING (true);

DROP POLICY IF EXISTS site_diaries_delete_tenant ON public.site_diaries;
CREATE POLICY site_diaries_delete_tenant ON public.site_diaries
  FOR DELETE USING (true);

-- ────────────────────────────────────────────────────────────
-- Realtime — for future presence on the diary form, same way
-- prestarts + toolbox_talks are wired. Defensive IF NOT EXISTS.
-- ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'site_diaries'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.site_diaries;
  END IF;
END $$;
