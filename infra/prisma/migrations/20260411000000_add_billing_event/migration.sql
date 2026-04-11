-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "gatewayProvider" "GatewayProvider" NOT NULL,
    "gatewayEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "rawEventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingEvent_gatewayEventId_key" ON "BillingEvent"("gatewayEventId");

-- CreateIndex
CREATE INDEX "BillingEvent_gatewayProvider_createdAt_idx" ON "BillingEvent"("gatewayProvider", "createdAt");

-- AddForeignKey
ALTER TABLE "BillingEvent" ADD CONSTRAINT "BillingEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
