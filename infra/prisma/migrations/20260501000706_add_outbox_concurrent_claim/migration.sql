-- T4-C: Outbox concurrent claim + idempotency + backoff
--
-- Adds the columns and partial index needed for `OutboxClaimService` to do
-- atomic lease-based claiming via `UPDATE ... WHERE id IN (SELECT ... FOR
-- UPDATE SKIP LOCKED LIMIT N) RETURNING ...`. Also creates the consumer-side
-- inbox dedupe table and preserves `aggregateType` on dead-letter rows so the
-- admin retry path can reconstruct events correctly.
--
-- The `aggregateType` DEFAULT 'unknown' on `OutboxDeadLetter` exists ONLY to
-- back-fill rows that may already exist in dev/staging environments (prod
-- DLQ is empty pre-T4-C). New rows post-migration always carry the real
-- aggregateType from the originating outbox event.

-- DropIndex
DROP INDEX "OutboxEvent_publishedAt_nextRetryAt_idx";

-- AlterTable
ALTER TABLE "OutboxDeadLetter" ADD COLUMN     "aggregateType" TEXT NOT NULL DEFAULT 'unknown';

-- AlterTable
ALTER TABLE "OutboxEvent" ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "claimedBy" TEXT;

-- CreateIndex (partial index on the claim hot path — only unpublished, retriable rows)
-- This index covers the WHERE clause of `OutboxClaimService.claim()` and keeps the
-- working set small even as `OutboxEvent` accumulates published rows.
CREATE INDEX "idx_outbox_claim_hot" ON "OutboxEvent" ("nextRetryAt", "occurredAt")
  WHERE "publishedAt" IS NULL AND "retryCount" < "maxRetries";

-- CreateTable
CREATE TABLE "outbox_inbox" (
    "messageId" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumerId" TEXT NOT NULL,

    CONSTRAINT "outbox_inbox_pkey" PRIMARY KEY ("messageId")
);

-- CreateIndex
CREATE INDEX "outbox_inbox_processedAt_idx" ON "outbox_inbox"("processedAt");
