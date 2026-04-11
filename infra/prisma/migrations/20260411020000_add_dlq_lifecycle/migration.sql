-- AlterTable
ALTER TABLE "WebhookDeadLetter" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "OutboxDeadLetter" (
    "id" TEXT NOT NULL,
    "originalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "failureReason" TEXT NOT NULL,
    "retryCount" INTEGER NOT NULL,
    "firstFailedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,

    CONSTRAINT "OutboxDeadLetter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutboxDeadLetter_originalEventId_key" ON "OutboxDeadLetter"("originalEventId");

-- CreateIndex
CREATE INDEX "OutboxDeadLetter_resolvedAt_idx" ON "OutboxDeadLetter"("resolvedAt");
