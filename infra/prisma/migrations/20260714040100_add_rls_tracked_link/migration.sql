-- RLS enrollment for TrackedLink — defense-in-depth layer 2 (tenant-guard rollout, Slice 3).
-- Mirrors the `tenant_isolation` policy shape from 20260527000000_add_rls_tenant_isolation (which
-- is NEVER edited in place): row visibility (USING) and mutation (WITH CHECK) gate on the session
-- GUC `app.account_id`, with a `__system__` bypass for withSystemContext() flows.
--
-- ORDER: this migration MUST sort AFTER 20260714040000_add_tracked_link_account_id — the policy
-- references the "accountId" column that migration adds. Prisma applies migrations in
-- lexicographic timestamp order (040100 > 040000).
--
-- Note (honest layering): RLS binds only inside a UoW transaction (the GUC is set by
-- PrismaUnitOfWork). The public redirect read-path (GET /r/:shortCode) resolves shortCode OUTSIDE
-- a UoW under an explicit withSystemContext("public-link-redirect") bypass (a canon-verified
-- capability-URL decision) — at runtime that lookup is layer-1 system-context, never gated by this
-- policy. Its abuse control is rate limiting on the redirect namespace, not RLS. See
-- docs/security/MULTI_TENANT_GUARDS.md.
--
-- Rollback: the companion down.sql (not auto-applied by Prisma).

ALTER TABLE "TrackedLink" ENABLE ROW LEVEL SECURITY;

-- Idempotent on re-apply to a stale snapshot.
DROP POLICY IF EXISTS tenant_isolation ON "TrackedLink";

CREATE POLICY tenant_isolation ON "TrackedLink"
  USING (
    current_setting('app.account_id', true) = '__system__'
    OR "accountId" = current_setting('app.account_id', true)
  )
  WITH CHECK (
    current_setting('app.account_id', true) = '__system__'
    OR "accountId" = current_setting('app.account_id', true)
  );
