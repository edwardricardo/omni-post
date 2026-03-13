-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Provider" ADD VALUE 'SNAPCHAT';
ALTER TYPE "Provider" ADD VALUE 'TELEGRAM';
ALTER TYPE "Provider" ADD VALUE 'PINTEREST';
ALTER TYPE "Provider" ADD VALUE 'LINKEDIN';
ALTER TYPE "Provider" ADD VALUE 'BLUESKY';

-- CreateTable
CREATE TABLE "ExternalNotificationConfig" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "webhookUrl" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "events" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalNotificationConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FirstComment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "publishedAt" TIMESTAMP(3),
    "providerCommentId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FirstComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedImage" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "revisedPrompt" TEXT,
    "imageUrl" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "quality" TEXT NOT NULL,
    "style" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringPost" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "templatePostId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cronExpression" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "maxOccurrences" INTEGER,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastScheduledAt" TIMESTAMP(3),
    "nextScheduledAt" TIMESTAMP(3),
    "channels" TEXT[],
    "contentVariation" TEXT NOT NULL DEFAULT 'EXACT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalNotificationConfig_projectId_isActive_idx" ON "ExternalNotificationConfig"("projectId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "FirstComment_postId_key" ON "FirstComment"("postId");

-- CreateIndex
CREATE INDEX "GeneratedImage_projectId_createdAt_idx" ON "GeneratedImage"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "RecurringPost_projectId_isActive_idx" ON "RecurringPost"("projectId", "isActive");

-- CreateIndex
CREATE INDEX "RecurringPost_nextScheduledAt_isActive_idx" ON "RecurringPost"("nextScheduledAt", "isActive");

-- AddForeignKey
ALTER TABLE "ExternalNotificationConfig" ADD CONSTRAINT "ExternalNotificationConfig_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FirstComment" ADD CONSTRAINT "FirstComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedImage" ADD CONSTRAINT "GeneratedImage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringPost" ADD CONSTRAINT "RecurringPost_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
