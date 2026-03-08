-- CreateEnum
CREATE TYPE "public"."ABTestStatus" AS ENUM ('DRAFT', 'RUNNING', 'PAUSED', 'COMPLETED', 'STOPPED');

-- CreateEnum
CREATE TYPE "public"."TemplateUsageAction" AS ENUM ('VIEW', 'USE', 'COMPILE', 'LIKE', 'SHARE');

-- CreateEnum
CREATE TYPE "public"."TemplateComponentType" AS ENUM ('HEADER', 'BODY', 'FOOTER', 'MEDIA_BLOCK', 'CALL_TO_ACTION', 'HASHTAG_BLOCK', 'VARIABLE_BLOCK', 'CUSTOM');

-- CreateEnum
CREATE TYPE "public"."TemplatePermission" AS ENUM ('READ', 'WRITE', 'DELETE', 'SHARE', 'ADMIN');

-- CreateEnum
CREATE TYPE "public"."TemplateCollaboratorRole" AS ENUM ('VIEWER', 'EDITOR', 'ADMIN', 'OWNER');

-- DropIndex
DROP INDEX "public"."Account_createdAt_idx";

-- DropIndex
DROP INDEX "public"."Account_email_idx";

-- DropIndex
DROP INDEX "public"."Account_subscription_idx";

-- DropIndex
DROP INDEX "public"."Account_updatedAt_idx";

-- DropIndex
DROP INDEX "public"."AdminSession_createdAt_idx";

-- DropIndex
DROP INDEX "public"."AdminSession_expiresAt_idx";

-- DropIndex
DROP INDEX "public"."AdminSession_refreshToken_idx";

-- DropIndex
DROP INDEX "public"."AdminUser_createdAt_idx";

-- DropIndex
DROP INDEX "public"."AdminUser_email_idx";

-- DropIndex
DROP INDEX "public"."Analytics_capturedAt_idx";

-- DropIndex
DROP INDEX "public"."Analytics_postId_capturedAt_idx";

-- DropIndex
DROP INDEX "public"."ApiKey_keyHash_idx";

-- DropIndex
DROP INDEX "public"."AuditLog_createdAt_idx";

-- DropIndex
DROP INDEX "public"."ContentTemplate_createdAt_idx";

-- DropIndex
DROP INDEX "public"."ContentTemplate_updatedAt_idx";

-- DropIndex
DROP INDEX "public"."ContentVersion_postId_version_idx";

-- DropIndex
DROP INDEX "public"."InstagramStory_storyProjectId_sequence_idx";

-- DropIndex
DROP INDEX "public"."Post_createdAt_idx";

-- DropIndex
DROP INDEX "public"."Post_projectId_idx";

-- DropIndex
DROP INDEX "public"."Post_status_idx";

-- DropIndex
DROP INDEX "public"."PostContent_locale_idx";

-- DropIndex
DROP INDEX "public"."PostContent_postId_idx";

-- DropIndex
DROP INDEX "public"."PublishLog_createdAt_idx";

-- DropIndex
DROP INDEX "public"."Thread_postId_idx";

-- DropIndex
DROP INDEX "public"."Tweet_threadId_sequenceNumber_idx";

-- DropIndex
DROP INDEX "public"."VideoSegment_processingJobId_sequence_idx";

-- CreateTable
CREATE TABLE "public"."Template" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "platforms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "content" TEXT NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "variants" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TemplateVersion" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "variables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "platforms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "changeLog" TEXT NOT NULL,
    "commitMessage" TEXT,
    "author" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "parentVersionId" TEXT,
    "branchName" TEXT NOT NULL DEFAULT 'main',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ABTest" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "config" JSONB NOT NULL,
    "status" "public"."ABTestStatus" NOT NULL DEFAULT 'DRAFT',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "results" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ABTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TemplateUsageEvent" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "action" "public"."TemplateUsageAction" NOT NULL,
    "context" JSONB NOT NULL DEFAULT '{}',
    "variantId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateUsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TemplateComponent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "public"."TemplateComponentType" NOT NULL,
    "content" JSONB NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "platforms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isReusable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplateComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TemplateComponentUsage" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "overrides" JSONB,

    CONSTRAINT "TemplateComponentUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TemplateCommit" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "parentCommitId" TEXT,
    "branch" TEXT NOT NULL DEFAULT 'main',
    "message" TEXT NOT NULL,
    "author" JSONB NOT NULL,
    "changes" JSONB NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateCommit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TemplateCollaboration" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permissions" "public"."TemplatePermission"[],
    "role" "public"."TemplateCollaboratorRole" NOT NULL DEFAULT 'EDITOR',
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "lastActiveAt" TIMESTAMP(3),

    CONSTRAINT "TemplateCollaboration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TemplateAnalytics" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "totalUses" INTEGER NOT NULL DEFAULT 0,
    "uniqueUsers" INTEGER NOT NULL DEFAULT 0,
    "successRate" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "avgRating" DOUBLE PRECISION,
    "avgEngagement" DOUBLE PRECISION,
    "conversionRate" DOUBLE PRECISION,
    "revenueGenerated" DOUBLE PRECISION,
    "period" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplateAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Template_projectId_isActive_idx" ON "public"."Template"("projectId", "isActive");

-- CreateIndex
CREATE INDEX "Template_accountId_isActive_idx" ON "public"."Template"("accountId", "isActive");

-- CreateIndex
CREATE INDEX "Template_category_idx" ON "public"."Template"("category");

-- CreateIndex
CREATE INDEX "Template_platforms_idx" ON "public"."Template"("platforms");

-- CreateIndex
CREATE INDEX "Template_tags_idx" ON "public"."Template"("tags");

-- CreateIndex
CREATE INDEX "Template_deletedAt_idx" ON "public"."Template"("deletedAt");

-- CreateIndex
CREATE INDEX "TemplateVersion_templateId_isActive_idx" ON "public"."TemplateVersion"("templateId", "isActive");

-- CreateIndex
CREATE INDEX "TemplateVersion_templateId_branchName_idx" ON "public"."TemplateVersion"("templateId", "branchName");

-- CreateIndex
CREATE INDEX "TemplateVersion_parentVersionId_idx" ON "public"."TemplateVersion"("parentVersionId");

-- CreateIndex
CREATE INDEX "TemplateVersion_createdAt_idx" ON "public"."TemplateVersion"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateVersion_templateId_version_key" ON "public"."TemplateVersion"("templateId", "version");

-- CreateIndex
CREATE INDEX "ABTest_templateId_status_idx" ON "public"."ABTest"("templateId", "status");

-- CreateIndex
CREATE INDEX "ABTest_status_startDate_endDate_idx" ON "public"."ABTest"("status", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "ABTest_createdAt_idx" ON "public"."ABTest"("createdAt");

-- CreateIndex
CREATE INDEX "TemplateUsageEvent_templateId_action_idx" ON "public"."TemplateUsageEvent"("templateId", "action");

-- CreateIndex
CREATE INDEX "TemplateUsageEvent_templateId_timestamp_idx" ON "public"."TemplateUsageEvent"("templateId", "timestamp");

-- CreateIndex
CREATE INDEX "TemplateUsageEvent_action_timestamp_idx" ON "public"."TemplateUsageEvent"("action", "timestamp");

-- CreateIndex
CREATE INDEX "TemplateUsageEvent_variantId_idx" ON "public"."TemplateUsageEvent"("variantId");

-- CreateIndex
CREATE INDEX "TemplateComponent_type_idx" ON "public"."TemplateComponent"("type");

-- CreateIndex
CREATE INDEX "TemplateComponent_isReusable_idx" ON "public"."TemplateComponent"("isReusable");

-- CreateIndex
CREATE INDEX "TemplateComponent_platforms_idx" ON "public"."TemplateComponent"("platforms");

-- CreateIndex
CREATE INDEX "TemplateComponent_createdAt_idx" ON "public"."TemplateComponent"("createdAt");

-- CreateIndex
CREATE INDEX "TemplateComponentUsage_templateId_idx" ON "public"."TemplateComponentUsage"("templateId");

-- CreateIndex
CREATE INDEX "TemplateComponentUsage_componentId_idx" ON "public"."TemplateComponentUsage"("componentId");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateComponentUsage_templateId_componentId_position_key" ON "public"."TemplateComponentUsage"("templateId", "componentId", "position");

-- CreateIndex
CREATE INDEX "TemplateCommit_templateId_branch_idx" ON "public"."TemplateCommit"("templateId", "branch");

-- CreateIndex
CREATE INDEX "TemplateCommit_parentCommitId_idx" ON "public"."TemplateCommit"("parentCommitId");

-- CreateIndex
CREATE INDEX "TemplateCommit_createdAt_idx" ON "public"."TemplateCommit"("createdAt");

-- CreateIndex
CREATE INDEX "TemplateCollaboration_templateId_idx" ON "public"."TemplateCollaboration"("templateId");

-- CreateIndex
CREATE INDEX "TemplateCollaboration_userId_idx" ON "public"."TemplateCollaboration"("userId");

-- CreateIndex
CREATE INDEX "TemplateCollaboration_role_idx" ON "public"."TemplateCollaboration"("role");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateCollaboration_templateId_userId_key" ON "public"."TemplateCollaboration"("templateId", "userId");

-- CreateIndex
CREATE INDEX "TemplateAnalytics_templateId_idx" ON "public"."TemplateAnalytics"("templateId");

-- CreateIndex
CREATE INDEX "TemplateAnalytics_period_startDate_idx" ON "public"."TemplateAnalytics"("period", "startDate");

-- CreateIndex
CREATE INDEX "TemplateAnalytics_createdAt_idx" ON "public"."TemplateAnalytics"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateAnalytics_templateId_period_startDate_key" ON "public"."TemplateAnalytics"("templateId", "period", "startDate");

-- CreateIndex
CREATE INDEX "WebhookEvent_channelId_eventType_idx" ON "public"."WebhookEvent"("channelId", "eventType");

-- AddForeignKey
ALTER TABLE "public"."Template" ADD CONSTRAINT "Template_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Template" ADD CONSTRAINT "Template_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TemplateVersion" ADD CONSTRAINT "TemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "public"."Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TemplateVersion" ADD CONSTRAINT "TemplateVersion_parentVersionId_fkey" FOREIGN KEY ("parentVersionId") REFERENCES "public"."TemplateVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ABTest" ADD CONSTRAINT "ABTest_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "public"."Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TemplateUsageEvent" ADD CONSTRAINT "TemplateUsageEvent_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "public"."Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TemplateComponentUsage" ADD CONSTRAINT "TemplateComponentUsage_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "public"."Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TemplateComponentUsage" ADD CONSTRAINT "TemplateComponentUsage_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "public"."TemplateComponent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TemplateCommit" ADD CONSTRAINT "TemplateCommit_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "public"."Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TemplateCommit" ADD CONSTRAINT "TemplateCommit_parentCommitId_fkey" FOREIGN KEY ("parentCommitId") REFERENCES "public"."TemplateCommit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TemplateCollaboration" ADD CONSTRAINT "TemplateCollaboration_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "public"."Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TemplateAnalytics" ADD CONSTRAINT "TemplateAnalytics_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "public"."Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;
