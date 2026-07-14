-- Rollback for 20260714040300_add_rls_recurring_post (operator-run; not auto-applied by Prisma).
-- Removes the RLS policy and disables RLS on the table. The accountId column itself is dropped by
-- a separate down migration if needed.
DROP POLICY IF EXISTS tenant_isolation ON "RecurringPost";
ALTER TABLE "RecurringPost" DISABLE ROW LEVEL SECURITY;
