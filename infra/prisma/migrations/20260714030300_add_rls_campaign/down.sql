-- Rollback for 20260714030300_add_rls_campaign (operator-run; not auto-applied by Prisma).
-- Removes the RLS policy and disables RLS on the table. The accountId column itself is dropped by
-- a separate down migration if needed.
DROP POLICY IF EXISTS tenant_isolation ON "Campaign";
ALTER TABLE "Campaign" DISABLE ROW LEVEL SECURITY;
