-- Inverse of 20260919222448_add_retraction_alert_notifications.
--
-- Prisma NEVER applies a down.sql automatically; it exists so the rollback is a
-- reviewed artefact rather than something improvised during an incident.
--
-- THE INVERSE IS NOT TOTAL, and that is stated here rather than discovered later.
-- The table and the "RetractionAlertMedium" type drop cleanly — both are created by
-- the companion migration and referenced by nothing else. The enum LABEL
-- 'PUBLICATION_RETRACTION_PENDING' does NOT: PostgreSQL offers no way to remove a
-- label from an existing type in place, and the only route is to build a replacement
-- type, repoint every column that uses it, and drop the original — a rewrite of the
-- whole "Notification" and "NotificationPreference" surface to remove one unused
-- label. The label therefore STAYS after a rollback. It is harmless: no row carries
-- it once the application code that writes it is reverted, and re-applying this
-- migration is idempotent in the only way that matters, because a second
-- ALTER TYPE ... ADD VALUE of the same label errors instead of silently duplicating.
--
-- DROP TYPE is deliberately NOT "IF EXISTS": a type already gone is drift, and the
-- idempotent form would report success over it.
--
-- WHAT THIS FILE CANNOT UNDO, stated rather than implied: the rows. A rollback that
-- drops the ledger drops the record of which alerts were already delivered, so a
-- re-apply would deliver them again. That is the correct trade for a rollback — a
-- duplicate alert is recoverable, a missed one is not — but it is not free.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DROP TABLE "RetractionAlertDelivery";

DROP TYPE "RetractionAlertMedium";
