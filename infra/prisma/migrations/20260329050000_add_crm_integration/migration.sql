-- CreateEnum
CREATE TYPE "CrmPlatform" AS ENUM ('HUBSPOT', 'SALESFORCE');
CREATE TYPE "CrmActivityType" AS ENUM ('POST_PUBLISHED', 'POST_SCHEDULED', 'CAMPAIGN_CREATED', 'CAMPAIGN_COMPLETED', 'APPROVAL_APPROVED');
CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'PARTIAL');

-- CreateTable
CREATE TABLE "CrmConnection" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "platform" "CrmPlatform" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "portalId" TEXT,
    "instanceUrl" TEXT,
    "sandboxMode" BOOLEAN NOT NULL DEFAULT false,
    "syncContacts" BOOLEAN NOT NULL DEFAULT true,
    "syncActivities" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CrmConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CrmContact" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "platform" "CrmPlatform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "company" TEXT,
    "title" TEXT,
    "phone" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CrmContact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CrmActivity" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "platform" "CrmPlatform" NOT NULL,
    "externalId" TEXT,
    "type" "CrmActivityType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "contactEmail" TEXT,
    "postId" TEXT,
    "campaignId" TEXT,
    "syncedAt" TIMESTAMP(3),
    "syncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CrmActivity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CrmSyncLog" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "contactsSynced" INTEGER NOT NULL DEFAULT 0,
    "activitiesSynced" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "status" "SyncStatus" NOT NULL DEFAULT 'RUNNING',
    CONSTRAINT "CrmSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrmConnection_accountId_platform_key" ON "CrmConnection"("accountId", "platform");
CREATE INDEX "CrmConnection_accountId_idx" ON "CrmConnection"("accountId");
CREATE UNIQUE INDEX "CrmContact_accountId_platform_externalId_key" ON "CrmContact"("accountId", "platform", "externalId");
CREATE INDEX "CrmContact_accountId_idx" ON "CrmContact"("accountId");
CREATE INDEX "CrmContact_email_idx" ON "CrmContact"("email");
CREATE INDEX "CrmActivity_accountId_syncedAt_idx" ON "CrmActivity"("accountId", "syncedAt");
CREATE INDEX "CrmActivity_contactEmail_idx" ON "CrmActivity"("contactEmail");
CREATE INDEX "CrmSyncLog_connectionId_idx" ON "CrmSyncLog"("connectionId");

-- AddForeignKey
ALTER TABLE "CrmConnection" ADD CONSTRAINT "CrmConnection_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrmSyncLog" ADD CONSTRAINT "CrmSyncLog_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "CrmConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
