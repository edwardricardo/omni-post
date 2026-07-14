-- RLS enrollment for Campaign — defense-in-depth layer 2 (tenant-guard rollout, Slice 2).
-- Mirrors the `tenant_isolation` policy shape from 20260527000000_add_rls_tenant_isolation (which
-- is NEVER edited in place): row visibility (USING) and mutation (WITH CHECK) gate on the session
-- GUC `app.account_id`, with a `__system__` bypass for withSystemContext() flows.
--
-- ORDER: this migration MUST sort AFTER 20260714030200_add_campaign_account_id — the policy
-- references the "accountId" column that migration adds. Prisma applies migrations in
-- lexicographic timestamp order (030300 > 030200). Final migration of Slice 2.
--
-- Note (honest layering): RLS binds only inside a UoW transaction (the GUC is set by
-- PrismaUnitOfWork). Read paths that run outside a UoW are guarded by layer 1 (the Prisma
-- $extends guard) alone at runtime; RLS backstops the UoW-wrapped mutations. Notably the untag
-- path mutates the CampaignPost JOIN table (no accountId column, not RLS-enrolled) — its tenant
-- protection is app-level (a guarded findById(campaignId) in UntagPostFromCampaignUseCase), not
-- this policy. See docs/security/MULTI_TENANT_GUARDS.md.
--
-- Rollback: the companion down.sql (not auto-applied by Prisma).

ALTER TABLE "Campaign" ENABLE ROW LEVEL SECURITY;

-- Idempotent on re-apply to a stale snapshot.
DROP POLICY IF EXISTS tenant_isolation ON "Campaign";

CREATE POLICY tenant_isolation ON "Campaign"
  USING (
    current_setting('app.account_id', true) = '__system__'
    OR "accountId" = current_setting('app.account_id', true)
  )
  WITH CHECK (
    current_setting('app.account_id', true) = '__system__'
    OR "accountId" = current_setting('app.account_id', true)
  );
