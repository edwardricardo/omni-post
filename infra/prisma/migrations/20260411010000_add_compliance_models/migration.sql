-- CreateEnum
CREATE TYPE "DpoType" AS ENUM ('INTERNAL', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "DsarRequestType" AS ENUM ('EXPORT', 'DELETION', 'ACCESS');

-- CreateEnum
CREATE TYPE "DsarStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "JurisdictionType" AS ENUM ('GDPR', 'LGPD', 'CCPA', 'PIPEDA', 'OTHER');

-- CreateTable
CREATE TABLE "GdprSettings" (
    "id" TEXT NOT NULL,
    "privacyPolicyUrl" TEXT,
    "cookiePolicyUrl" TEXT,
    "termsOfServiceUrl" TEXT,
    "dpoType" "DpoType" NOT NULL DEFAULT 'INTERNAL',
    "dpoEmail" TEXT,
    "dpoUrl" TEXT,
    "dataRetentionDays" INTEGER NOT NULL DEFAULT 365,
    "auditLogRetentionDays" INTEGER NOT NULL DEFAULT 90,
    "enableAutoDataDeletion" BOOLEAN NOT NULL DEFAULT false,
    "dsarResponseDays" INTEGER NOT NULL DEFAULT 30,
    "defaultJurisdiction" "JurisdictionType" NOT NULL DEFAULT 'GDPR',
    "enableRightToErasure" BOOLEAN NOT NULL DEFAULT true,
    "enableDataExport" BOOLEAN NOT NULL DEFAULT true,
    "enableDataAccess" BOOLEAN NOT NULL DEFAULT true,
    "enableBreachNotification" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    CONSTRAINT "GdprSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecuritySettings" (
    "id" TEXT NOT NULL,
    "require2FA" BOOLEAN NOT NULL DEFAULT false,
    "sessionTimeoutMinutes" INTEGER NOT NULL DEFAULT 1440,
    "maxLoginAttempts" INTEGER NOT NULL DEFAULT 5,
    "passwordMinLength" INTEGER NOT NULL DEFAULT 8,
    "requireUppercase" BOOLEAN NOT NULL DEFAULT false,
    "requireSpecialChar" BOOLEAN NOT NULL DEFAULT false,
    "ipAllowlistEnabled" BOOLEAN NOT NULL DEFAULT false,
    "ipAllowlist" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    CONSTRAINT "SecuritySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "accountId" TEXT,
    "consentType" TEXT NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "withdrawn" BOOLEAN NOT NULL DEFAULT false,
    "withdrawnAt" TIMESTAMP(3),
    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DsarRequest" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "requestorEmail" TEXT NOT NULL,
    "requestorName" TEXT,
    "type" "DsarRequestType" NOT NULL,
    "jurisdiction" "JurisdictionType" NOT NULL DEFAULT 'GDPR',
    "status" "DsarStatus" NOT NULL DEFAULT 'PENDING',
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectionReason" TEXT,
    "exportUrl" TEXT,
    "exportExpiresAt" TIMESTAMP(3),
    "notes" TEXT,
    "ipAddress" TEXT,
    "verificationToken" TEXT,
    CONSTRAINT "DsarRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataBreachReport" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reportedBy" TEXT NOT NULL,
    "affectedUserCount" INTEGER,
    "dataTypesAffected" TEXT[],
    "severity" TEXT NOT NULL,
    "notificationSentAt" TIMESTAMP(3),
    "notificationSentBy" TEXT,
    "regulatoryReportedAt" TIMESTAMP(3),
    "regulatoryReportedTo" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "internalNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DataBreachReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsentRecord_userId_consentType_idx" ON "ConsentRecord"("userId", "consentType");

-- CreateIndex
CREATE INDEX "ConsentRecord_accountId_idx" ON "ConsentRecord"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "DsarRequest_verificationToken_key" ON "DsarRequest"("verificationToken");

-- CreateIndex
CREATE INDEX "DsarRequest_status_deadlineAt_idx" ON "DsarRequest"("status", "deadlineAt");

-- CreateIndex
CREATE INDEX "DsarRequest_requestorEmail_idx" ON "DsarRequest"("requestorEmail");

-- AddForeignKey
ALTER TABLE "DsarRequest" ADD CONSTRAINT "DsarRequest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
