-- RLS enrollment for RecurringPost — defense-in-depth layer 2 (tenant-guard rollout, Slice 3).
-- Mirrors the `tenant_isolation` policy shape from 20260527000000_add_rls_tenant_isolation (which
-- is NEVER edited in place): row visibility (USING) and mutation (WITH CHECK) gate on the session
-- GUC `app.account_id`, with a `__system__` bypass for withSystemContext() flows.
--
-- ORDER: this migration MUST sort AFTER 20260714040200_add_recurring_post_account_id — the policy
-- references the "accountId" column that migration adds. Prisma applies migrations in
-- lexicographic timestamp order (040300 > 040200). Final migration of Slice 3.
--
-- Note (honest layering): RLS binds only inside a UoW transaction (the GUC is set by
-- PrismaUnitOfWork). The recurrence sweep (RecurrenceScheduler tick) runs under an explicit
-- withSystemContext("recurrence-sweep") bypass; its cross-tenant safety is enforced app-level at
-- the create/update paths (which reject a foreign templatePostId/channels before persist), not by
-- this policy. See docs/security/MULTI_TENANT_GUARDS.md.
--
-- Rollback: the companion down.sql (not auto-applied by Prisma).

ALTER TABLE "RecurringPost" ENABLE ROW LEVEL SECURITY;

-- Idempotent on re-apply to a stale snapshot.
DROP POLICY IF EXISTS tenant_isolation ON "RecurringPost";

CREATE POLICY tenant_isolation ON "RecurringPost"
  USING (
    current_setting('app.account_id', true) = '__system__'
    OR "accountId" = current_setting('app.account_id', true)
  )
  WITH CHECK (
    current_setting('app.account_id', true) = '__system__'
    OR "accountId" = current_setting('app.account_id', true)
  );
