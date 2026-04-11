-- CreateEnum
CREATE TYPE "GatewayProvider" AS ENUM ('STRIPE', 'PADDLE');

-- CreateEnum
CREATE TYPE "SwitchStatus" AS ENUM ('SCHEDULED', 'PENDING_CHECKOUT', 'COMPLETED', 'CANCELLED', 'SUSPENDED', 'EXPIRED');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "gatewayCustomerId" TEXT,
ADD COLUMN     "gatewayProvider" "GatewayProvider" NOT NULL DEFAULT 'STRIPE',
ADD COLUMN     "gatewaySwitchAt" TIMESTAMP(3),
ADD COLUMN     "pendingGatewayProvider" "GatewayProvider",
ADD COLUMN     "pendingGatewaySwitch" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "AccountSubscription" ADD COLUMN     "gatewayProvider" "GatewayProvider" NOT NULL DEFAULT 'STRIPE',
ADD COLUMN     "gatewaySubscriptionId" TEXT;

-- CreateTable
CREATE TABLE "GatewaySwitchEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "fromGateway" "GatewayProvider" NOT NULL,
    "toGateway" "GatewayProvider" NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "extendedUntil" TIMESTAMP(3),
    "extendedBy" TEXT,
    "status" "SwitchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GatewaySwitchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GatewaySwitchEvent_accountId_idx" ON "GatewaySwitchEvent"("accountId");

-- CreateIndex
CREATE INDEX "GatewaySwitchEvent_status_idx" ON "GatewaySwitchEvent"("status");

-- CreateIndex
CREATE INDEX "GatewaySwitchEvent_scheduledFor_idx" ON "GatewaySwitchEvent"("scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "AccountSubscription_gatewaySubscriptionId_key" ON "AccountSubscription"("gatewaySubscriptionId");

-- AddForeignKey
ALTER TABLE "GatewaySwitchEvent" ADD CONSTRAINT "GatewaySwitchEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
