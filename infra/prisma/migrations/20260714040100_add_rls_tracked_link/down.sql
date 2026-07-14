-- Rollback for 20260714040100_add_rls_tracked_link (operator-run; not auto-applied by Prisma).
-- Removes the RLS policy and disables RLS on the table. The accountId column itself is dropped by
-- a separate down migration if needed.
DROP POLICY IF EXISTS tenant_isolation ON "TrackedLink";
ALTER TABLE "TrackedLink" DISABLE ROW LEVEL SECURITY;
