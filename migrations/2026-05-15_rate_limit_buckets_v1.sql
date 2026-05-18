-- ────────────────────────────────────────────────────────────
-- Migration: SEC2 — rate_limit_buckets table + bump_rate_limit() RPC
-- Project:   eq-field-app
-- Version:   demo Phase B2 of NEW-WINDOW-PROMPT-melbourne-ready.md
-- Created:   2026-05-15 (design)
-- Applied:   Demo  (ktmjmdzqrogauaevbktn) — 2026-05-18 (Phase D activation)
--            Prod  (nspbmirochztcjijmcrx) — pending (apply on explicit "SKS live")
-- ────────────────────────────────────────────────────────────
-- BACKGROUND (FINDING #SEC2 in AUDIT-REVIEW.md):
--   Pre-this-migration, netlify/functions/verify-pin.js used an in-memory
--   `attempts = {}` map for rate limiting. Netlify Functions are stateless —
--   each cold start reset the map, letting attackers spam past the 5-attempt
--   threshold by triggering cold starts. This migration adds the table +
--   atomic bump-and-check RPC; the matching client wiring (env-var-flagged
--   RATE_LIMIT_V2 in verify-pin.js + bumpRateLimit helper in
--   scripts/supabase.js) ships in the same PR.
--
-- WHY SECURITY DEFINER:
--   The RPC bypasses RLS so the anon role can call it (clients use anon
--   key only — see scripts/app-state.js TENANT_SUPABASE). Underlying table
--   has RLS enabled with no policies → denied by default for direct
--   anon/authenticated access. Only the RPC path can read/write.
--
-- ROLLBACK:
--   Unset RATE_LIMIT_V2 in the Netlify dashboard. Function falls back to
--   the in-memory path immediately on next cold start. Schema can stay
--   in place (it does nothing without callers).
--
-- SKS PROD ROLLOUT:
--   Apply this migration to nspbmirochztcjijmcrx ONLY on explicit Royce
--   instruction. The Netlify function code already supports per-tenant
--   activation via env var (RATE_LIMIT_V2=on on eq-solves-field but not
--   sks-nsw-labour until SKS is ready).
--
-- Source: SPRINT-PLAN.md §SEC2 (schema design captured 2026-05-13,
--         locked 2026-05-15 per SPRINT-QUESTIONS Q9 default "yes,
--         create the file unapplied"). Activated 2026-05-18 per
--         NEW-WINDOW-PROMPT-melbourne-ready.md Phase B2 green-light.
-- ────────────────────────────────────────────────────────────

-- migrations/<future-date>_rate_limit_buckets.sql

CREATE TABLE public.rate_limit_buckets (
  bucket_key TEXT PRIMARY KEY,         -- e.g. "sks:supervisor:approve_leave"
  count INT NOT NULL DEFAULT 0,
  window_starts_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Atomic bump-and-check RPC.
-- Returns TRUE if allowed, FALSE if rate-limited.
CREATE OR REPLACE FUNCTION public.bump_rate_limit(
  p_key TEXT,
  p_max INT,
  p_window_seconds INT
) RETURNS BOOLEAN AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_row public.rate_limit_buckets;
BEGIN
  INSERT INTO public.rate_limit_buckets (bucket_key, count, window_starts_at)
  VALUES (p_key, 1, v_now)
  ON CONFLICT (bucket_key) DO UPDATE SET
    count = CASE
      WHEN public.rate_limit_buckets.window_starts_at + (p_window_seconds || ' seconds')::INTERVAL < v_now
      THEN 1                                            -- window expired, reset
      ELSE public.rate_limit_buckets.count + 1          -- in-window, increment
    END,
    window_starts_at = CASE
      WHEN public.rate_limit_buckets.window_starts_at + (p_window_seconds || ' seconds')::INTERVAL < v_now
      THEN v_now
      ELSE public.rate_limit_buckets.window_starts_at
    END
  RETURNING * INTO v_row;

  RETURN v_row.count <= p_max;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS: only service-role can read/write (Edge Functions hit this).
ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;
-- (no policies = denied by default for anon/authenticated; service-role bypasses RLS)
