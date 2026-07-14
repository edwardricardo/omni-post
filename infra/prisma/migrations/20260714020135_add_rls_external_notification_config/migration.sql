-- RLS enrollment for ExternalNotificationConfig — defense-in-depth layer 2 (tenant-guard
-- rollout, Slice 1). Mirrors the `tenant_isolation` policy shape from
-- 20260527000000_add_rls_tenant_isolation (which is NEVER edited in place): row visibility
-- (USING) and mutation (WITH CHECK) gate on the session GUC `app.account_id`, with a
-- `__system__` bypass for withSystemContext() flows.
--
-- ORDER: this migration MUST sort AFTER 20260714020035_add_external_notification_config_account_id
-- — the policy references the "accountId" column that migration adds. Prisma applies migrations
-- in lexicographic timestamp order (020135 > 020035).
--
-- Note (honest layering): RLS binds only inside a UoW transaction (the GUC is set by
-- PrismaUnitOfWork). The List + Test-fire read paths run outside a UoW, so at runtime they are
-- guarded by layer 1 (the Prisma $extends guard) alone; RLS backstops the UoW-wrapped Delete +
-- Create. See docs/security/MULTI_TENANT_GUARDS.md.
--
-- Rollback: the companion down.sql (not auto-applied by Prisma).

ALTER TABLE "ExternalNotificationConfig" ENABLE ROW LEVEL SECURITY;

-- Idempotent on re-apply to a stale snapshot.
DROP POLICY IF EXISTS tenant_isolation ON "ExternalNotificationConfig";

CREATE POLICY tenant_isolation ON "ExternalNotificationConfig"
  USING (
    current_setting('app.account_id', true) = '__system__'
    OR "accountId" = current_setting('app.account_id', true)
  )
  WITH CHECK (
    current_setting('app.account_id', true) = '__system__'
    OR "accountId" = current_setting('app.account_id', true)
  );
