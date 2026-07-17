-- Rollback for 20260714020135_add_rls_external_notification_config (operator-run; not
-- auto-applied by Prisma). Removes the RLS policy and disables RLS on the table. The
-- accountId column itself is dropped by a separate down migration if needed.
DROP POLICY IF EXISTS tenant_isolation ON "ExternalNotificationConfig";
ALTER TABLE "ExternalNotificationConfig" DISABLE ROW LEVEL SECURITY;
