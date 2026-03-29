-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "ssoEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SamlConfiguration" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "idpEntityId" TEXT NOT NULL,
    "idpSsoUrl" TEXT NOT NULL,
    "idpCertificate" TEXT NOT NULL,
    "attributeMapping" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SamlConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SamlSession" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "relayState" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SamlSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SamlConfiguration_accountId_key" ON "SamlConfiguration"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "SamlSession_relayState_key" ON "SamlSession"("relayState");

-- CreateIndex
CREATE INDEX "SamlSession_relayState_idx" ON "SamlSession"("relayState");

-- CreateIndex
CREATE INDEX "SamlSession_expiresAt_idx" ON "SamlSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "SamlConfiguration" ADD CONSTRAINT "SamlConfiguration_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
