-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK companion for 20260710032601_add_mfa_last_used_totp_step.
--
-- Prisma migrate does NOT auto-apply down.sql files. Operator-driven only:
--   psql "$DATABASE_URL" < down.sql
--
-- Drops exactly the two columns added by the up migration
-- (`mfaLastUsedTotpStep` on `AdminUser` and `CustomerUser`) and nothing else —
-- data-safe rollback: no other column or row on either table is touched.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE "AdminUser" DROP COLUMN IF EXISTS "mfaLastUsedTotpStep";
ALTER TABLE "CustomerUser" DROP COLUMN IF EXISTS "mfaLastUsedTotpStep";
