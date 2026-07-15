-- RLS enrollment for GeneratedImage — defense-in-depth layer 2 (tenant-guard rollout, Slice 4).
-- Mirrors the `tenant_isolation` policy shape from 20260527000000_add_rls_tenant_isolation (which
-- is NEVER edited in place): row visibility (USING) and mutation (WITH CHECK) gate on the session
-- GUC `app.account_id`, with a `__system__` bypass for withSystemContext() flows.
--
-- ORDER: this migration MUST sort AFTER 20260715000000_add_generated_image_account_id — the policy
-- references the "accountId" column that migration adds. Prisma applies migrations in
-- lexicographic timestamp order (000100 > 000000). Final migration of Slice 4.
--
-- Note (honest layering): RLS binds only inside a UoW transaction (the GUC is set by
-- PrismaUnitOfWork). GenerateImageUseCase persists the image WITHOUT a UoW, so at runtime the
-- create is guarded by layer 1 (the Prisma $extends guard injecting accountId) alone; this RLS
-- policy backstops any UoW-wrapped path and is the correct layer-2 posture once the use case is
-- retrofitted onto UoW (tracked as backlog canon-debt). See docs/security/MULTI_TENANT_GUARDS.md.
--
-- Rollback: the companion down.sql (not auto-applied by Prisma).

ALTER TABLE "GeneratedImage" ENABLE ROW LEVEL SECURITY;

-- Idempotent on re-apply to a stale snapshot.
DROP POLICY IF EXISTS tenant_isolation ON "GeneratedImage";

CREATE POLICY tenant_isolation ON "GeneratedImage"
  USING (
    current_setting('app.account_id', true) = '__system__'
    OR "accountId" = current_setting('app.account_id', true)
  )
  WITH CHECK (
    current_setting('app.account_id', true) = '__system__'
    OR "accountId" = current_setting('app.account_id', true)
  );
