-- Rollback for 20260723000100_add_rls_channel (operator-run; not auto-applied by Prisma).
-- Removes the RLS policy and disables RLS on the table. The accountId column itself is dropped by
-- a separate down migration if needed.
DROP POLICY IF EXISTS tenant_isolation ON "Channel";
ALTER TABLE "Channel" DISABLE ROW LEVEL SECURITY;
