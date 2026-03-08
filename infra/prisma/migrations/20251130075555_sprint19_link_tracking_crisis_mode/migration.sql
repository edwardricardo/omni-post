/*
  Warnings:

  - Added the required column `updatedAt` to the `Project` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable: Add crisis mode and updatedAt to Project
-- First add updatedAt with default, then remove the default
ALTER TABLE "public"."Project" ADD COLUMN     "crisisModeHistory" JSONB DEFAULT '[]',
ADD COLUMN     "crisisReason" TEXT,
ADD COLUMN     "crisisStartedAt" TIMESTAMP(3),
ADD COLUMN     "isInCrisisMode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "public"."TrackedLink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "originalUrl" TEXT NOT NULL,
    "shortCode" TEXT NOT NULL,
    "vanitySlug" TEXT,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackedLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LinkClick" (
    "id" TEXT NOT NULL,
    "trackedLinkId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "referrer" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "country" TEXT,
    "city" TEXT,

    CONSTRAINT "LinkClick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrackedLink_shortCode_key" ON "public"."TrackedLink"("shortCode");

-- CreateIndex
CREATE INDEX "TrackedLink_projectId_isActive_idx" ON "public"."TrackedLink"("projectId", "isActive");

-- CreateIndex
CREATE INDEX "TrackedLink_shortCode_idx" ON "public"."TrackedLink"("shortCode");

-- CreateIndex
CREATE INDEX "TrackedLink_vanitySlug_idx" ON "public"."TrackedLink"("vanitySlug");

-- CreateIndex
CREATE INDEX "TrackedLink_createdAt_idx" ON "public"."TrackedLink"("createdAt");

-- CreateIndex
CREATE INDEX "TrackedLink_clicks_idx" ON "public"."TrackedLink"("clicks");

-- CreateIndex
CREATE INDEX "LinkClick_trackedLinkId_timestamp_idx" ON "public"."LinkClick"("trackedLinkId", "timestamp");

-- CreateIndex
CREATE INDEX "LinkClick_country_idx" ON "public"."LinkClick"("country");

-- CreateIndex
CREATE INDEX "LinkClick_timestamp_idx" ON "public"."LinkClick"("timestamp");

-- CreateIndex
CREATE INDEX "Project_isInCrisisMode_idx" ON "public"."Project"("isInCrisisMode");

-- AddForeignKey
ALTER TABLE "public"."TrackedLink" ADD CONSTRAINT "TrackedLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LinkClick" ADD CONSTRAINT "LinkClick_trackedLinkId_fkey" FOREIGN KEY ("trackedLinkId") REFERENCES "public"."TrackedLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
