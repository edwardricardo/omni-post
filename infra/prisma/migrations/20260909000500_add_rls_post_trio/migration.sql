-- Tenant column for the Post trio, step 6 of 6: RLS enrollment for the three tables.
--
-- Defense-in-depth layer 2. The policy shape is COPIED from
-- 20260527000000_add_rls_tenant_isolation, which is never edited in place: row visibility
-- (USING) and row mutation (WITH CHECK) both gate on the transaction-local GUC
-- `app.account_id`, with a `__system__` value as the deliberate cross-tenant bypass for
-- withSystemContext() flows. An unset GUC makes `current_setting(..., true)` return NULL,
-- the policy evaluates false, and the query returns no rows and rejects writes — the
-- fail-closed default.
--
-- ORDER. This file MUST sort after the column, the NOT NULL and the composite FK: the
-- policy reads "accountId" as a LOCAL column, which is the whole reason the column had to
-- exist first. Before this change, "Post", "PostContent" and "PostMedia" were the tenant
-- tables that could NOT carry a policy at all — their tenant identity lived on "Project",
-- and a policy cannot be written against a column a table does not have. Recorded at
-- relrowsecurity = false with zero policies in the pre-migration capture
-- (docs/reports/TENANT_RLS_AB_MEASUREMENT.md).
--
-- LAYERING, STATED PLAINLY. RLS and the composite FK are independent guarantees and must
-- not be reported as one. The FK holds even against a BYPASSRLS role, because it is
-- referential integrity rather than row filtering; RLS holds against raw SQL and future
-- ORM changes, but only for a role that is subject to it and only when the GUC is bound.
-- Neither substitutes for the other, and neither substitutes for the application guard.
--
-- ROLE POSTURE. Migrations and the seed connect on the owner channel, which is not subject
-- to these policies (the tables are not FORCE'd, by decision — see
-- docs/technical/ADR-0022-rls-enforcement-posture.md). Application traffic connects as the
-- non-owner `omnipost_app` role, which is NOSUPERUSER / NOBYPASSRLS and therefore IS
-- subject to them.
--
-- Rollback: the companion down.sql, which Prisma never applies automatically.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE "Post" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PostContent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PostMedia" ENABLE ROW LEVEL SECURITY;

-- Idempotent on re-apply to a stale snapshot.
DROP POLICY IF EXISTS tenant_isolation ON "Post";
DROP POLICY IF EXISTS tenant_isolation ON "PostContent";
DROP POLICY IF EXISTS tenant_isolation ON "PostMedia";

CREATE POLICY tenant_isolation ON "Post"
  USING (
    current_setting('app.account_id', true) = '__system__'
    OR "accountId" = current_setting('app.account_id', true)
  )
  WITH CHECK (
    current_setting('app.account_id', true) = '__system__'
    OR "accountId" = current_setting('app.account_id', true)
  );

CREATE POLICY tenant_isolation ON "PostContent"
  USING (
    current_setting('app.account_id', true) = '__system__'
    OR "accountId" = current_setting('app.account_id', true)
  )
  WITH CHECK (
    current_setting('app.account_id', true) = '__system__'
    OR "accountId" = current_setting('app.account_id', true)
  );

CREATE POLICY tenant_isolation ON "PostMedia"
  USING (
    current_setting('app.account_id', true) = '__system__'
    OR "accountId" = current_setting('app.account_id', true)
  )
  WITH CHECK (
    current_setting('app.account_id', true) = '__system__'
    OR "accountId" = current_setting('app.account_id', true)
  );
