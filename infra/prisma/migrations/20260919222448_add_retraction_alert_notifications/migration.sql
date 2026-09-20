-- The urgent retraction alert's notification type and its delivery ledger.
--
-- WHAT IS HERE BEYOND THE GENERATED DDL, and why each piece is not optional:
--
--   1. THE TIMEOUT PREAMBLE, FIRST. Two of the statements below take an ACCESS
--      EXCLUSIVE lock on "NotificationType", a type every Notification and
--      NotificationPreference row is typed against. Without a bounded lock_timeout a
--      deploy that meets a long-running transaction waits behind it while every
--      notification writer queues behind the waiter. The bound turns that into a
--      failed migration, which is a state an operator can see and retry.
--
--   2. NO ROW OF THE NEW ENUM VALUE IS WRITTEN HERE. PostgreSQL admits
--      ALTER TYPE ... ADD VALUE inside a transaction block from version 12, but the
--      added label cannot be USED until that transaction commits. This migration
--      therefore adds the label and stops; the first row carrying it is written by
--      application code, after the deploy.
--
--   3. NO ROW LEVEL SECURITY, and that is a decision rather than an omission.
--      "RetractionAlertDelivery" carries NO "accountId": it holds an opaque alert
--      hash, member ids and external-config ids, and every read of it is keyed by an
--      alertKey that only a tenant-bound event can produce. It is not a bearing
--      model, so it is deliberately absent from TENANT_SCOPED_MODELS and from the
--      guards document, exactly as "Notification" and "NotificationPreference" are.
--      Enrolling it would require an accountId column that no reader needs and that
--      would have to be kept in step with a post's account on every write.
--
--   4. "Notification" IS NOT TOUCHED. The alternative considered was a unique
--      dedupe column on that table — locking DDL on the hottest notification table,
--      and an index that would cover exactly one medium. This ledger covers every
--      medium instead, which is why it exists at all.
--
-- Rollback: the companion down.sql, which Prisma never applies automatically. It is
-- NOT a total inverse, and says so: PostgreSQL cannot drop an enum label in place.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- AlterEnum
--
-- AFTER the current last label rather than a bare append. The two produce the
-- IDENTICAL sort order today, so this is not a behaviour change — it is the
-- position being stated instead of inferred. An enum's sort order in PostgreSQL is
-- its declaration order, so a bare ADD VALUE makes every future reader work out
-- where the label landed by reading the type's history; naming the anchor makes the
-- file answer that on its own, and is what squawk's require-enum-value-ordering
-- asks for.
ALTER TYPE "NotificationType" ADD VALUE 'PUBLICATION_RETRACTION_PENDING' AFTER 'INBOX_MENTION_RECEIVED';

-- CreateEnum
CREATE TYPE "RetractionAlertMedium" AS ENUM ('IN_APP', 'EMAIL', 'SLACK_TEAMS', 'SMS', 'PUSH');

-- CreateTable
CREATE TABLE "RetractionAlertDelivery" (
    "id" TEXT NOT NULL,
    "alertKey" TEXT NOT NULL,
    "medium" "RetractionAlertMedium" NOT NULL,
    "target" TEXT NOT NULL,
    "notificationId" TEXT,
    "deliveredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetractionAlertDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RetractionAlertDelivery_alertKey_idx" ON "RetractionAlertDelivery"("alertKey");

-- CreateIndex
CREATE UNIQUE INDEX "RetractionAlertDelivery_alertKey_medium_target_key" ON "RetractionAlertDelivery"("alertKey", "medium", "target");
