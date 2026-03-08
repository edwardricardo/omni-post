-- CreateTable
CREATE TABLE "public"."OutboxEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 5,
    "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutboxEvent_publishedAt_nextRetryAt_idx" ON "public"."OutboxEvent"("publishedAt", "nextRetryAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_aggregateId_aggregateType_idx" ON "public"."OutboxEvent"("aggregateId", "aggregateType");

-- CreateIndex
CREATE INDEX "OutboxEvent_eventType_idx" ON "public"."OutboxEvent"("eventType");

-- CreateIndex
CREATE INDEX "OutboxEvent_createdAt_idx" ON "public"."OutboxEvent"("createdAt");
