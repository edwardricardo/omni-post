-- Rollback for 20260714030100_add_rls_scheduled_report (operator-run; not auto-applied by
-- Prisma). Removes the RLS policy and disables RLS on the table. The accountId column itself is
-- dropped by a separate down migration if needed.
DROP POLICY IF EXISTS tenant_isolation ON "ScheduledReport";
ALTER TABLE "ScheduledReport" DISABLE ROW LEVEL SECURITY;
