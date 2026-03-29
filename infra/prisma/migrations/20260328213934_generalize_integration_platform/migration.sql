/*
  Warnings:

  - You are about to drop the `ZapierApiKey` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ZapierSubscription` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "IntegrationPlatform" AS ENUM ('ZAPIER', 'MAKE');

-- DropForeignKey
ALTER TABLE "ZapierApiKey" DROP CONSTRAINT "ZapierApiKey_accountId_fkey";

-- DropForeignKey
ALTER TABLE "ZapierSubscription" DROP CONSTRAINT "ZapierSubscription_accountId_fkey";

-- DropTable
DROP TABLE "ZapierApiKey";

-- DropTable
DROP TABLE "ZapierSubscription";

-- CreateTable
CREATE TABLE "IntegrationApiKey" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "platform" "IntegrationPlatform" NOT NULL DEFAULT 'ZAPIER',
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "label" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "IntegrationApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationSubscription" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "platform" "IntegrationPlatform" NOT NULL DEFAULT 'ZAPIER',
    "event" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationApiKey_keyHash_key" ON "IntegrationApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "IntegrationApiKey_accountId_idx" ON "IntegrationApiKey"("accountId");

-- CreateIndex
CREATE INDEX "IntegrationApiKey_platform_idx" ON "IntegrationApiKey"("platform");

-- CreateIndex
CREATE INDEX "IntegrationSubscription_accountId_idx" ON "IntegrationSubscription"("accountId");

-- CreateIndex
CREATE INDEX "IntegrationSubscription_event_idx" ON "IntegrationSubscription"("event");

-- CreateIndex
CREATE INDEX "IntegrationSubscription_platform_idx" ON "IntegrationSubscription"("platform");

-- AddForeignKey
ALTER TABLE "IntegrationApiKey" ADD CONSTRAINT "IntegrationApiKey_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationSubscription" ADD CONSTRAINT "IntegrationSubscription_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
