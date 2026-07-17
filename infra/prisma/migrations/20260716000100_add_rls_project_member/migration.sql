-- RLS enrollment for ProjectMember — defense-in-depth layer 2 (tenant-guard rollout, Slice 5).
-- Mirrors the `tenant_isolation` policy shape from 20260527000000_add_rls_tenant_isolation (which
-- is NEVER edited in place): row visibility (USING) and mutation (WITH CHECK) gate on the session
-- GUC `app.account_id`, with a `__system__` bypass for withSystemContext() flows.
--
-- ORDER: this migration MUST sort AFTER 20260716000000_add_project_member_account_id — the policy
-- references the "accountId" column that migration adds. Prisma applies migrations in
-- lexicographic timestamp order (000100 > 000000). Final migration of Slice 5.
--
-- Note (honest layering): RLS binds only inside a UoW transaction (the GUC is set by
-- PrismaUnitOfWork). ProjectMember has NO production writer today (the dev seed runs as a
-- superuser with BYPASSRLS), so at runtime reads are guarded by layer 1 (the Prisma $extends
-- guard) alone; this RLS policy backstops any future UoW-wrapped write path once per-project
-- membership is wired. See docs/security/MULTI_TENANT_GUARDS.md.
--
-- Rollback: the companion down.sql (not auto-applied by Prisma).

ALTER TABLE "ProjectMember" ENABLE ROW LEVEL SECURITY;

-- Idempotent on re-apply to a stale snapshot.
DROP POLICY IF EXISTS tenant_isolation ON "ProjectMember";

CREATE POLICY tenant_isolation ON "ProjectMember"
  USING (
    current_setting('app.account_id', true) = '__system__'
    OR "accountId" = current_setting('app.account_id', true)
  )
  WITH CHECK (
    current_setting('app.account_id', true) = '__system__'
    OR "accountId" = current_setting('app.account_id', true)
  );
