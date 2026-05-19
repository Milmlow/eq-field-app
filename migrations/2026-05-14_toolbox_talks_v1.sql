-- ────────────────────────────────────────────────────────────
-- Migration: site_reports v2 — toolbox_talks table
-- Project:   eq-field
-- Version:   3.4.75
-- Created:   2026-05-14
-- Applied:   Demo  (ktmjmdzqrogauaevbktn) — pending
--            Prod  (nspbmirochztcjijmcrx) — DO NOT APPLY until "SKS live"
-- ────────────────────────────────────────────────────────────
-- Purpose: Site Reports module v2 — weekly / per-shift toolbox talks
--          with per-attendee sign-off, topic + safety message,
--          items reviewed, open actions carried from prior talks.
--          Second workflow in the absorption of sks-field-reports v29
--          into EQ Field. Mirrors the prestarts table shape so the
--          UI module (scripts/toolbox.js) can reuse Prestart helpers
--          for photos, signatures, and the offline write queue.
--
-- Field-name notes:
--   • `facilitator` (not `sks_rep`) — Toolbox is shipping into a
--     multi-tenant product, so column names must be tenant-neutral.
--     Prestart's `sks_rep` is a legacy leak we don't repeat here.
--   • `meeting_date` / `meeting_time` (not `briefing_date/time`) —
--     toolbox talks are scheduled meetings, not pre-shift briefings.
--   • `attendance` (not `crew`) — toolbox audiences include subbies,
--     clients, visitors. Same JSONB shape as prestart.crew so the
--     signature pad code can be shared with no schema awareness.
--   • `photos` JSONB included from day 1. Prestart needed a follow-up
--     migration (2026-05-13_prestarts_photos.sql); not repeating that.
--
-- v3 will add site_diaries; v4 weekly_reports + compliance pack export.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.toolbox_talks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  -- site_abbr (not site_id) — same portability reasoning as prestarts.
  -- EQ sites.id is uuid; SKS sites.id is bigint. The rest of the app
  -- already keys sites by abbr (schedule[dayKey] === site.abbr).
  site_abbr       text,
  meeting_date    date NOT NULL,
  meeting_time    time,
  facilitator     text,
  subcontractor   text,
  -- Talk content
  topic           text,                                       -- main topic of the talk
  safety_message  text,                                       -- key safety takeaway
  items_reviewed  text,                                       -- bullet list / paragraph of items covered
  open_actions    text,                                       -- carried-over actions from last talk
  hazards         text,                                       -- hazards discussed
  swms_refs       text,                                       -- SWMS / SOPs referenced
  next_meeting    date,                                       -- next scheduled toolbox
  -- Attendance — same JSONB shape as prestarts.crew so the signature
  -- pad code is reusable without schema awareness.
  -- Shape: [{ name, person_id, signed_at, signed_by, signature_image }]
  attendance      jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Photos inline as base64. Same shape as prestarts.photos.
  -- Shape: [{ id, caption, base64 (data URI), taken_at, taken_by }]
  photos          jsonb NOT NULL DEFAULT '[]'::jsonb,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted')),
  submitted_at    timestamptz,
  submitted_by    text,
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS toolbox_talks_org_date_idx
  ON public.toolbox_talks (org_id, meeting_date DESC);

CREATE INDEX IF NOT EXISTS toolbox_talks_site_date_idx
  ON public.toolbox_talks (site_abbr, meeting_date DESC)
  WHERE site_abbr IS NOT NULL;

COMMENT ON TABLE public.toolbox_talks IS
  'Toolbox talks — periodic safety briefings, per site or per crew. '
  'Sourced from the sks-field-reports v29 workflow, generalised for EQ Field tenants.';

COMMENT ON COLUMN public.toolbox_talks.attendance IS
  'Per-attendee sign-off. Shape: [{ name, person_id, signed_at, signed_by, signature_image }]. '
  'Same JSONB shape as prestarts.crew so signature pad code is reusable.';

COMMENT ON COLUMN public.toolbox_talks.photos IS
  'Inline base64-encoded photos taken during the talk. Max 8 per record. '
  'Each entry: { id, caption, base64 (data URI), taken_at, taken_by }.';

-- updated_at trigger — mirror prestarts pattern.
CREATE OR REPLACE FUNCTION public.toolbox_talks_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_toolbox_talks_updated_at ON public.toolbox_talks;
CREATE TRIGGER trg_toolbox_talks_updated_at
  BEFORE UPDATE ON public.toolbox_talks
  FOR EACH ROW EXECUTE FUNCTION public.toolbox_talks_set_updated_at();

-- ────────────────────────────────────────────────────────────
-- RLS — same tenant-scoped pattern as prestarts. Today gates write
-- at the app layer via window.EQ_PERMS. Phase 2 will tighten with
-- auth.uid()-bound policies once the JWT-driven role model lands.
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.toolbox_talks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS toolbox_talks_select_tenant ON public.toolbox_talks;
CREATE POLICY toolbox_talks_select_tenant ON public.toolbox_talks
  FOR SELECT USING (true);

DROP POLICY IF EXISTS toolbox_talks_insert_tenant ON public.toolbox_talks;
CREATE POLICY toolbox_talks_insert_tenant ON public.toolbox_talks
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS toolbox_talks_update_tenant ON public.toolbox_talks;
CREATE POLICY toolbox_talks_update_tenant ON public.toolbox_talks
  FOR UPDATE USING (true);

DROP POLICY IF EXISTS toolbox_talks_delete_tenant ON public.toolbox_talks;
CREATE POLICY toolbox_talks_delete_tenant ON public.toolbox_talks
  FOR DELETE USING (true);

-- ────────────────────────────────────────────────────────────
-- Realtime — for future v2 presence on the toolbox form, same way
-- prestarts is wired. Defensive IF NOT EXISTS — safe to re-run.
-- ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'toolbox_talks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.toolbox_talks;
  END IF;
END $$;
