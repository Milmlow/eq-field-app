-- ────────────────────────────────────────────────────────────
-- Migration: prestarts.photos — inline photo storage
-- Project:   eq-field
-- Version:   3.4.68
-- Created:   2026-05-13
-- Applied:   Demo  (ktmjmdzqrogauaevbktn) — 2026-05-13 ✓
--            Prod  (nspbmirochztcjijmcrx) — 2026-05-13 ✓
-- ────────────────────────────────────────────────────────────
-- Purpose: v3.4.68 brings prestart up to "Ben can use it daily"
--          parity with sks-field-reports v29. Photos stored
--          inline as base64 in a JSONB array on the prestart row
--          rather than via Supabase Storage — simpler ship, no
--          bucket provisioning, no signed-URL roundtrip. Trade-
--          off: each photo adds ~80-150KB to the row. Postgres
--          TOAST handles JSONB > 8KB transparently, so this is
--          fine at the volumes we expect (8 photos/record max,
--          ~20 records/supervisor/week).
--
-- Shape: prestarts.photos = [
--          { id: uuid, caption: text, base64: text (data URI),
--            taken_at: iso8601, taken_by: text }
--        ]
--
-- Signatures (Ben's v29 signature pad) are stored in the existing
-- prestarts.crew jsonb column — each crew member object gets a
-- new optional signature_image field (data URI). No schema change.
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.prestarts
  ADD COLUMN IF NOT EXISTS photos jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.prestarts.photos IS
  'Inline base64-encoded photos taken during the briefing. Max 8 per record. '
  'Each entry: { id, caption, base64 (data URI), taken_at, taken_by }. '
  'Stored inline rather than Storage bucket for v1 simplicity.';
