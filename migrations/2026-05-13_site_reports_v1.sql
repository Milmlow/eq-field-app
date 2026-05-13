-- ────────────────────────────────────────────────────────────
-- Migration: site_reports v1 — prestarts table
-- Project:   eq-field-app
-- Version:   3.4.67
-- Created:   2026-05-13
-- Applied:   Demo  (ktmjmdzqrogauaevbktn) — 2026-05-13 ✓
--            Prod  (nspbmirochztcjijmcrx) — 2026-05-13 ✓ (UI not yet deployed)
-- ────────────────────────────────────────────────────────────
-- Purpose: Site Reports module v1 — daily prestart briefings
--          with per-crew sign-off, HRCW categories, hazards,
--          permits. First step in absorbing the workflows
--          built in sks-field-reports.netlify.app v29 into
--          the EQ Field codebase.
--
-- v2 will add toolbox_talks; v3 site_diaries; v4 weekly_reports
-- and shared site_report_attachments (photos + signature pad).
-- This migration is intentionally prestarts-only so it can be
-- applied, tested, and reverted in isolation.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.prestarts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  -- site_abbr (not site_id) so the column type is uniform across tenants
  -- (EQ sites.id is uuid; SKS sites.id is bigint — see scripts/supabase.js
  -- line 60). The whole rest of the app already keys sites by abbr
  -- (schedule[dayKey] === site.abbr), so this matches existing data flow
  -- and is portable. Trade-off: no FK referential integrity if a site is
  -- renamed/deleted, but that's already true everywhere else in Field.
  site_abbr       text,
  briefing_date   date NOT NULL,
  briefing_time   time,
  sks_rep         text,
  subcontractor   text,
  prev_day_issues text,
  works_scope     text,
  -- Crew sign-off stored as JSONB rather than a child table so a
  -- mid-day re-roster doesn't orphan prior signatures, and so the
  -- whole record is one PATCH from the client.
  -- Shape: [{ name, person_id, signed_at, signed_by }]
  crew            jsonb NOT NULL DEFAULT '[]'::jsonb,
  hrcw_categories text[] NOT NULL DEFAULT '{}'::text[],
  swms_refs       text,
  hazards         text,
  permits         text,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted')),
  submitted_at    timestamptz,
  submitted_by    text,
  created_by      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS prestarts_org_date_idx
  ON public.prestarts (org_id, briefing_date DESC);

CREATE INDEX IF NOT EXISTS prestarts_site_date_idx
  ON public.prestarts (site_abbr, briefing_date DESC)
  WHERE site_abbr IS NOT NULL;

COMMENT ON TABLE public.prestarts IS
  'Daily prestart briefings, per site, per shift. Sourced from the '
  'sks-field-reports v29 workflow, generalised for EQ Field tenants.';

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.prestarts_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_prestarts_updated_at ON public.prestarts;
CREATE TRIGGER trg_prestarts_updated_at
  BEFORE UPDATE ON public.prestarts
  FOR EACH ROW EXECUTE FUNCTION public.prestarts_set_updated_at();

-- ────────────────────────────────────────────────────────────
-- RLS — same tenant-scoped pattern as leave_requests. Today
-- gates write at the app layer via window.EQ_PERMS. Phase 2
-- will tighten with auth.uid()-bound policies once the JWT-
-- driven role model lands (MULTI-TENANCY-PLAN.md §Phase 2).
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.prestarts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prestarts_select_tenant ON public.prestarts;
CREATE POLICY prestarts_select_tenant ON public.prestarts
  FOR SELECT USING (true);

DROP POLICY IF EXISTS prestarts_insert_tenant ON public.prestarts;
CREATE POLICY prestarts_insert_tenant ON public.prestarts
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS prestarts_update_tenant ON public.prestarts;
CREATE POLICY prestarts_update_tenant ON public.prestarts
  FOR UPDATE USING (true);

DROP POLICY IF EXISTS prestarts_delete_tenant ON public.prestarts;
CREATE POLICY prestarts_delete_tenant ON public.prestarts
  FOR DELETE USING (true);

-- ────────────────────────────────────────────────────────────
-- Realtime — so a future v2 presence on prestart editing lights
-- up multi-supervisor work the same way roster_presence does.
-- Defensive IF NOT EXISTS — safe to re-run on either tenant.
-- ────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'prestarts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.prestarts;
  END IF;
END $$;
