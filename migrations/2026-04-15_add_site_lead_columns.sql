-- ────────────────────────────────────────────────────────────
-- Migration: Site lead columns (name + phone)
-- Project:   eq-field-app
-- Version:   3.4.x groundwork (shipped ahead of v3.4.3)
-- Supabase:  20260415035838_add_site_lead_columns
-- Applied:   Prod  (nspbmirochztcjijmcrx) — 2026-04-15 ✓
-- ────────────────────────────────────────────────────────────
-- Adds person-in-charge fields to sites. The email column is added
-- later by 2026-04-16_tier1_features_schema.sql so this file only
-- covers the name + phone pair.
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS site_lead text,
  ADD COLUMN IF NOT EXISTS site_lead_phone text;

COMMENT ON COLUMN public.sites.site_lead IS
  'Name of the person in charge at this site (free text, matched to STATE.people by name where possible).';

COMMENT ON COLUMN public.sites.site_lead_phone IS
  'Contact phone for the site lead.';
