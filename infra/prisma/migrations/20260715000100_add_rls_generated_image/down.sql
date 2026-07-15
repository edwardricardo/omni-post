-- Rollback for 20260715000100_add_rls_generated_image (operator-run; not auto-applied by Prisma).
-- Removes the RLS policy and disables RLS on the table. The accountId column itself is dropped by
-- a separate down migration if needed.
DROP POLICY IF EXISTS tenant_isolation ON "GeneratedImage";
ALTER TABLE "GeneratedImage" DISABLE ROW LEVEL SECURITY;
