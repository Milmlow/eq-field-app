-- ────────────────────────────────────────────────────────────
-- Migration: tighten RLS on Tender Pipeline tables (FINDING #SEC3)
-- Project:   eq-field-app (EQ tenant only — ktmjmdzqrogauaevbktn)
-- Version:   demo Phase B1 of NEW-WINDOW-PROMPT-melbourne-ready.md
-- Created:   2026-05-18
-- Applied:   Demo  (ktmjmdzqrogauaevbktn) — pending application via this PR
--            Prod  (nspbmirochztcjijmcrx) — N/A (SKS Supabase has no
--                                          tender_* tables; do not apply)
-- ────────────────────────────────────────────────────────────
-- BACKGROUND (FINDING #SEC3, AUDIT-REVIEW.md / DEMO-VS-LIVE.md):
--   When Tender Pipeline shipped in v3.4.79, the 6 tender tables had
--   RLS *enabled* (rowsecurity=true) but only placeholder policies
--   `<table>_anon_{select,insert,update,delete}` with the body
--   USING (true) / WITH CHECK (true) — effectively wide-open to anyone
--   holding the EQ anon key. Verified live 2026-05-18 via
--   MELBOURNE-VERIFY-2026-05-18.md: `EQ_TENDER_PIPELINE.loadAll()`
--   read all 323 tenders + 12 nominations from a gate-locked,
--   non-supervisor browser session.
--
-- HONEST CAVEAT (same shape as 2026-05-13_roster_presence_rls_tighten):
--   The EQ Field auth model uses the Supabase anon key with no per-user
--   JWT — auth is via the tenant access code at the app layer. So we
--   CANNOT enforce the textbook `auth.uid()`-based RLS pattern; the
--   anon role has no `auth.uid()` to filter on. Cross-tenant read by
--   anyone holding the anon key is structural until SSO ships
--   (MELBOURNE-SCALE-DESIGN.md §7 Q7, Wave 5+).
--
-- WHAT THIS MIGRATION ACTUALLY DOES:
--   For the 4 tables that have a direct `org_id` column (tenders,
--   tender_import_runs, tender_review_decisions, pending_schedule):
--     SELECT / UPDATE / DELETE  →  USING (org_id IS NOT NULL)
--     INSERT / UPDATE WITH CHECK →  WITH CHECK (org_id IS NOT NULL)
--   For the 2 tables that don't (nominations, tender_enrichment) but
--   do have a NOT NULL `tender_id`:
--     SELECT / UPDATE / DELETE  →  USING (EXISTS (SELECT 1 FROM
--                                  tenders t WHERE t.id = <this>
--                                  .tender_id AND t.org_id IS NOT NULL))
--     INSERT / UPDATE WITH CHECK →  same EXISTS shape in WITH CHECK
--
-- WHAT IT BLOCKS:
--   - INSERT/UPDATE of rows with NULL org_id (defense-in-depth — column
--     is already NOT NULL, but the policy makes the failure mode
--     consistent across both layers)
--   - INSERT of nominations / tender_enrichment rows referencing
--     non-existent or orphan tenders
--   - UPDATE that would change a row's org_id to NULL
--
-- WHAT IT DOES NOT BLOCK (the SSO gap):
--   - Cross-tenant read by anyone holding the EQ anon key. The anon
--     key is shipped in the client bundle (scripts/app-state.js
--     TENANT_SUPABASE.eq.key). That key has SELECT on every tender_*
--     row regardless of which org_id it belongs to. There is exactly
--     one `org_id` on EQ demo today, so practically this is moot, but
--     it becomes a real risk the moment a second tenant shares this
--     Supabase project. **Real fix waits for per-user auth (SSO,
--     Wave 5+).**
--
-- WHAT'S NOT TOUCHED:
--   - The `nomination_clashes` view (relrowsecurity=false). Views
--     inherit row visibility from their base tables, so tightening
--     `nominations` + `tenders` tightens the view by extension.
--   - The 6 INSERT policies that already have
--     `WITH CHECK (org_id IS NOT NULL)`. Two tables get fresh INSERT
--     WITH CHECK clauses where they previously had `true`
--     (nominations, tender_enrichment via the tender_id EXISTS path).
--
-- SAFETY:
--   - Migration is a no-op for valid rows (every existing tender_*
--     row has a non-null org_id; every nomination + enrichment row
--     references a real tender).
--   - DROP POLICY IF EXISTS ... avoids errors on partial pre-states.
--   - Migration scoped to EQ Supabase (ktmjmdzqrogauaevbktn).
--     SKS Supabase has none of these tables — DO NOT apply there.
-- ────────────────────────────────────────────────────────────

-- ─── tenders (has org_id) ────────────────────────────────────
DROP POLICY IF EXISTS tenders_anon_select ON public.tenders;
CREATE POLICY tenders_anon_select ON public.tenders
  FOR SELECT TO anon
  USING (org_id IS NOT NULL);

DROP POLICY IF EXISTS tenders_anon_update ON public.tenders;
CREATE POLICY tenders_anon_update ON public.tenders
  FOR UPDATE TO anon
  USING (org_id IS NOT NULL)
  WITH CHECK (org_id IS NOT NULL);

DROP POLICY IF EXISTS tenders_anon_delete ON public.tenders;
CREATE POLICY tenders_anon_delete ON public.tenders
  FOR DELETE TO anon
  USING (org_id IS NOT NULL);
-- INSERT policy (tenders_anon_insert) already has WITH CHECK (org_id IS NOT NULL) — keep as-is.

-- ─── tender_import_runs (has org_id) ─────────────────────────
DROP POLICY IF EXISTS tender_import_runs_anon_select ON public.tender_import_runs;
CREATE POLICY tender_import_runs_anon_select ON public.tender_import_runs
  FOR SELECT TO anon
  USING (org_id IS NOT NULL);

DROP POLICY IF EXISTS tender_import_runs_anon_update ON public.tender_import_runs;
CREATE POLICY tender_import_runs_anon_update ON public.tender_import_runs
  FOR UPDATE TO anon
  USING (org_id IS NOT NULL)
  WITH CHECK (org_id IS NOT NULL);

DROP POLICY IF EXISTS tender_import_runs_anon_delete ON public.tender_import_runs;
CREATE POLICY tender_import_runs_anon_delete ON public.tender_import_runs
  FOR DELETE TO anon
  USING (org_id IS NOT NULL);

-- ─── tender_review_decisions (has org_id) ────────────────────
DROP POLICY IF EXISTS tender_review_decisions_anon_select ON public.tender_review_decisions;
CREATE POLICY tender_review_decisions_anon_select ON public.tender_review_decisions
  FOR SELECT TO anon
  USING (org_id IS NOT NULL);

DROP POLICY IF EXISTS tender_review_decisions_anon_update ON public.tender_review_decisions;
CREATE POLICY tender_review_decisions_anon_update ON public.tender_review_decisions
  FOR UPDATE TO anon
  USING (org_id IS NOT NULL)
  WITH CHECK (org_id IS NOT NULL);

DROP POLICY IF EXISTS tender_review_decisions_anon_delete ON public.tender_review_decisions;
CREATE POLICY tender_review_decisions_anon_delete ON public.tender_review_decisions
  FOR DELETE TO anon
  USING (org_id IS NOT NULL);

-- ─── pending_schedule (has org_id) ───────────────────────────
DROP POLICY IF EXISTS pending_schedule_anon_select ON public.pending_schedule;
CREATE POLICY pending_schedule_anon_select ON public.pending_schedule
  FOR SELECT TO anon
  USING (org_id IS NOT NULL);

DROP POLICY IF EXISTS pending_schedule_anon_update ON public.pending_schedule;
CREATE POLICY pending_schedule_anon_update ON public.pending_schedule
  FOR UPDATE TO anon
  USING (org_id IS NOT NULL)
  WITH CHECK (org_id IS NOT NULL);

DROP POLICY IF EXISTS pending_schedule_anon_delete ON public.pending_schedule;
CREATE POLICY pending_schedule_anon_delete ON public.pending_schedule
  FOR DELETE TO anon
  USING (org_id IS NOT NULL);

-- ─── nominations (no org_id — filter via tender_id join) ─────
DROP POLICY IF EXISTS nominations_anon_select ON public.nominations;
CREATE POLICY nominations_anon_select ON public.nominations
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.tenders t
      WHERE t.id = nominations.tender_id
        AND t.org_id IS NOT NULL
    )
  );

DROP POLICY IF EXISTS nominations_anon_insert ON public.nominations;
CREATE POLICY nominations_anon_insert ON public.nominations
  FOR INSERT TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenders t
      WHERE t.id = nominations.tender_id
        AND t.org_id IS NOT NULL
    )
  );

DROP POLICY IF EXISTS nominations_anon_update ON public.nominations;
CREATE POLICY nominations_anon_update ON public.nominations
  FOR UPDATE TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.tenders t
      WHERE t.id = nominations.tender_id
        AND t.org_id IS NOT NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenders t
      WHERE t.id = nominations.tender_id
        AND t.org_id IS NOT NULL
    )
  );

DROP POLICY IF EXISTS nominations_anon_delete ON public.nominations;
CREATE POLICY nominations_anon_delete ON public.nominations
  FOR DELETE TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.tenders t
      WHERE t.id = nominations.tender_id
        AND t.org_id IS NOT NULL
    )
  );

-- ─── tender_enrichment (no org_id — filter via tender_id join) ─
DROP POLICY IF EXISTS tender_enrichment_anon_select ON public.tender_enrichment;
CREATE POLICY tender_enrichment_anon_select ON public.tender_enrichment
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.tenders t
      WHERE t.id = tender_enrichment.tender_id
        AND t.org_id IS NOT NULL
    )
  );

DROP POLICY IF EXISTS tender_enrichment_anon_insert ON public.tender_enrichment;
CREATE POLICY tender_enrichment_anon_insert ON public.tender_enrichment
  FOR INSERT TO anon
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenders t
      WHERE t.id = tender_enrichment.tender_id
        AND t.org_id IS NOT NULL
    )
  );

DROP POLICY IF EXISTS tender_enrichment_anon_update ON public.tender_enrichment;
CREATE POLICY tender_enrichment_anon_update ON public.tender_enrichment
  FOR UPDATE TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.tenders t
      WHERE t.id = tender_enrichment.tender_id
        AND t.org_id IS NOT NULL
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenders t
      WHERE t.id = tender_enrichment.tender_id
        AND t.org_id IS NOT NULL
    )
  );

DROP POLICY IF EXISTS tender_enrichment_anon_delete ON public.tender_enrichment;
CREATE POLICY tender_enrichment_anon_delete ON public.tender_enrichment
  FOR DELETE TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.tenders t
      WHERE t.id = tender_enrichment.tender_id
        AND t.org_id IS NOT NULL
    )
  );

-- ─── Verify final state ──────────────────────────────────────
-- Expected: every policy below is now scoped (no more bare `true`).
SELECT
  tablename,
  policyname,
  cmd,
  qual AS using_clause,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'tenders',
    'tender_enrichment',
    'tender_import_runs',
    'tender_review_decisions',
    'pending_schedule',
    'nominations'
  )
ORDER BY tablename, policyname;
