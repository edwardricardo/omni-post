-- RLS enrollment for Channel — defense-in-depth layer 2 (tenant-guard rollout).
-- Mirrors the `tenant_isolation` policy shape from 20260527000000_add_rls_tenant_isolation (which
-- is NEVER edited in place): row visibility (USING) and mutation (WITH CHECK) gate on the session
-- GUC `app.account_id`, with a `__system__` bypass for withSystemContext() flows.
--
-- ORDER: this migration MUST sort AFTER 20260723000000_add_channel_account_id — the policy
-- references the "accountId" column that migration adds. Prisma applies migrations in
-- lexicographic timestamp order (000100 > 000000).
--
-- Note (honest layering): RLS binds only inside a UoW transaction (the GUC is set by
-- PrismaUnitOfWork), and the current connection role is a superuser with BYPASSRLS, so this
-- policy is inert at runtime today — layer 1 (the Prisma $extends guard) plus explicit
-- accountId predicates are the active enforcement. The policy ships with the structural PR to
-- satisfy the guard<->RLS parity invariant (rls-tenant-isolation suite); the worker-side GUC
-- binding that makes it enforceable under a hardened role lands in the worker-reconciliation
-- PR. See docs/security/MULTI_TENANT_GUARDS.md.
--
-- Rollback: the companion down.sql (not auto-applied by Prisma).

ALTER TABLE "Channel" ENABLE ROW LEVEL SECURITY;

-- Idempotent on re-apply to a stale snapshot.
DROP POLICY IF EXISTS tenant_isolation ON "Channel";

CREATE POLICY tenant_isolation ON "Channel"
  USING (
    current_setting('app.account_id', true) = '__system__'
    OR "accountId" = current_setting('app.account_id', true)
  )
  WITH CHECK (
    current_setting('app.account_id', true) = '__system__'
    OR "accountId" = current_setting('app.account_id', true)
  );
