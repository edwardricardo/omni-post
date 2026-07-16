-- Rollback for 20260716000100_add_rls_project_member (operator-run; not auto-applied by Prisma).
-- Removes the RLS policy and disables RLS on the table. The accountId column itself is dropped by
-- a separate down migration if needed.
DROP POLICY IF EXISTS tenant_isolation ON "ProjectMember";
ALTER TABLE "ProjectMember" DISABLE ROW LEVEL SECURITY;
