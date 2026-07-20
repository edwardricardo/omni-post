-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK companion for 20260717000100_add_customer_mfa_backup_codes.
--
-- Prisma migrate does NOT auto-apply down.sql files. Operator-driven only:
--   psql "$DATABASE_URL" < down.sql
--
-- Drops exactly the two columns added by the up migration
-- (`mfaBackupCodes`, `mfaBackupUsedAt` on `CustomerUser`) and nothing else —
-- data-safe rollback: no other `CustomerUser` column or row is touched.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "CustomerUser" DROP COLUMN IF EXISTS "mfaBackupCodes";
ALTER TABLE "CustomerUser" DROP COLUMN IF EXISTS "mfaBackupUsedAt";
