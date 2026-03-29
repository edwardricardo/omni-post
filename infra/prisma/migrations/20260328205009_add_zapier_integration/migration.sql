-- CreateTable
CREATE TABLE "ZapierApiKey" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "label" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ZapierApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZapierSubscription" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZapierSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ZapierApiKey_keyHash_key" ON "ZapierApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ZapierApiKey_accountId_idx" ON "ZapierApiKey"("accountId");

-- CreateIndex
CREATE INDEX "ZapierSubscription_accountId_idx" ON "ZapierSubscription"("accountId");

-- CreateIndex
CREATE INDEX "ZapierSubscription_event_idx" ON "ZapierSubscription"("event");

-- AddForeignKey
ALTER TABLE "ZapierApiKey" ADD CONSTRAINT "ZapierApiKey_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZapierSubscription" ADD CONSTRAINT "ZapierSubscription_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
