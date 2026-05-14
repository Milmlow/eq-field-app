-- ────────────────────────────────────────────────────────────
-- Migration: SEC2 — rate_limit_buckets table + bump_rate_limit() RPC
-- Project:   eq-field-app
-- Version:   design-only (no app version bump — file is unapplied)
-- Created:   2026-05-15
-- Status:    PENDING — DESIGN ONLY. DO NOT APPLY YET.
-- Applied:   Demo  (ktmjmdzqrogauaevbktn) — NOT applied (intentionally pending)
--            Prod  (nspbmirochztcjijmcrx) — NOT applied (intentionally pending)
-- ────────────────────────────────────────────────────────────
-- DO NOT RUN THIS FILE.
--
--   • Do NOT call `mcp__*__apply_migration` for this file.
--   • Do NOT call `mcp__*__execute_sql` against the public.rate_limit_buckets
--     table or the public.bump_rate_limit() function.
--   • This file exists as documentation + ready-to-run shell only.
--     The schema is locked in now so Phase D doesn't have to re-design it
--     under deadline pressure.
--
-- Why pending: rate_limit_buckets is only useful when there's a caller
-- enforcing it. Today's `netlify/functions/verify-pin.js` uses an
-- in-memory map (FINDING #SEC2 in AUDIT-REVIEW.md). The fix lives in
-- Phase D — when server-side role checks land, we'll wire bump_rate_limit()
-- into:
--   1. `verify-pin.js`  → replaces the in-memory `attempts` map
--   2. role-gated endpoints (approve_leave, etc.) → per-tier quotas
--
-- When Phase D starts:
--   1. mcp apply this file to the EQ demo project (ktmjmdzqrogauaevbktn) first.
--   2. Wire `bump_rate_limit()` into `verify-pin.js`, soak on demo.
--   3. Promote to SKS prod (nspbmirochztcjijmcrx) only on explicit "SKS live".
--
-- Source: SPRINT-PLAN.md §SEC2 (schema design captured 2026-05-13,
--         locked 2026-05-15 per SPRINT-QUESTIONS Q9 default "yes,
--         create the file unapplied").
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
