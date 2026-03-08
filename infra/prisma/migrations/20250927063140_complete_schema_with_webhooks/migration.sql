-- CreateEnum
CREATE TYPE "public"."Provider" AS ENUM ('X', 'INSTAGRAM', 'FACEBOOK', 'YOUTUBE', 'TIKTOK');

-- CreateEnum
CREATE TYPE "public"."SubscriptionTier" AS ENUM ('BASIC', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "public"."LogStatus" AS ENUM ('QUEUED', 'RUNNING', 'OK', 'ERR');

-- CreateEnum
CREATE TYPE "public"."MediaKind" AS ENUM ('image', 'video', 'gif');

-- CreateEnum
CREATE TYPE "public"."ThreadStrategy" AS ENUM ('AUTO', 'MANUAL', 'SINGLE');

-- CreateEnum
CREATE TYPE "public"."TweetStatus" AS ENUM ('PENDING', 'PUBLISHING', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."AdminRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'SUPPORT');

-- CreateEnum
CREATE TYPE "public"."ConnectionStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'ERROR', 'EXPIRED', 'PENDING');

-- CreateEnum
CREATE TYPE "public"."PublishingStatus" AS ENUM ('PENDING', 'QUEUED', 'PROCESSING', 'PUBLISHED', 'FAILED', 'CANCELLED', 'RETRYING');

-- CreateEnum
CREATE TYPE "public"."VersionChangeType" AS ENUM ('CREATE', 'EDIT', 'PUBLISH', 'SCHEDULE', 'ADAPT', 'ROLLBACK');

-- CreateEnum
CREATE TYPE "public"."StoryProjectStatus" AS ENUM ('DRAFT', 'READY', 'SCHEDULED', 'PROCESSING', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."StoryStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'PUBLISHING', 'PUBLISHED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."VideoProcessingStatus" AS ENUM ('QUEUED', 'DOWNLOADING', 'ANALYZING', 'SPLITTING', 'OPTIMIZING', 'UPLOADING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."SegmentStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'UPLOADED', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."InstagramContentType" AS ENUM ('FEED', 'STORIES', 'REELS', 'CAROUSEL', 'IGTV');

-- CreateEnum
CREATE TYPE "public"."QueuePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "public"."WebhookEventType" AS ENUM ('POST_PUBLISHED', 'POST_UPDATED', 'POST_DELETED', 'POST_ENGAGEMENT_UPDATE', 'STORY_PUBLISHED', 'STORY_EXPIRED', 'REEL_PUBLISHED', 'LIKE_RECEIVED', 'COMMENT_RECEIVED', 'SHARE_RECEIVED', 'MENTION_RECEIVED', 'ACCOUNT_CONNECTED', 'ACCOUNT_DISCONNECTED', 'PERMISSION_CHANGED', 'RATE_LIMIT_REACHED', 'QUOTA_EXCEEDED', 'API_ERROR', 'VIDEO_PROCESSED', 'VIDEO_MONETIZED', 'LIVE_STREAM_STARTED', 'LIVE_STREAM_ENDED', 'MILESTONE_REACHED', 'VIRAL_CONTENT_DETECTED');

-- CreateEnum
CREATE TYPE "public"."WebhookProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER', 'RETRYING');

-- CreateTable
CREATE TABLE "public"."Account" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subscription" "public"."SubscriptionTier" NOT NULL DEFAULT 'BASIC',
    "maxProjects" INTEGER NOT NULL DEFAULT 1,
    "isOnTrial" BOOLEAN NOT NULL DEFAULT true,
    "trialStartDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trialEndDate" TIMESTAMP(3),
    "autoRenewal" BOOLEAN NOT NULL DEFAULT false,
    "billingCycle" TEXT NOT NULL DEFAULT 'monthly',
    "lastBillingDate" TIMESTAMP(3),
    "nextBillingDate" TIMESTAMP(3),
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "public"."AdminRole" NOT NULL DEFAULT 'ADMIN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "passwordResetToken" TEXT,
    "passwordResetExpires" TIMESTAMP(3),
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AdminSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessToken" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT,
    "resourceId" TEXT,
    "details" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'es',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accountId" TEXT NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Post" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PostContent" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT,
    "summary" TEXT,
    "body" TEXT NOT NULL,
    "tags" TEXT[],
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PostMedia" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "alt" TEXT,
    "hash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "public"."MediaKind" NOT NULL,

    CONSTRAINT "PostMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Channel" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "provider" "public"."Provider" NOT NULL,
    "handle" TEXT NOT NULL,
    "credentials" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PublishLog" (
    "id" TEXT NOT NULL,
    "postId" TEXT,
    "provider" "public"."Provider" NOT NULL,
    "channelId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "public"."LogStatus" NOT NULL,

    CONSTRAINT "PublishLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Analytics" (
    "id" TEXT NOT NULL,
    "postId" TEXT,
    "channelId" TEXT NOT NULL,
    "provider" "public"."Provider" NOT NULL,
    "views" INTEGER DEFAULT 0,
    "likes" INTEGER DEFAULT 0,
    "comments" INTEGER DEFAULT 0,
    "shares" INTEGER DEFAULT 0,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Analytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Thread" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "strategy" "public"."ThreadStrategy" NOT NULL DEFAULT 'AUTO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Thread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Tweet" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "media" JSONB,
    "tweetId" TEXT,
    "parentTweetId" TEXT,
    "status" "public"."TweetStatus" NOT NULL DEFAULT 'PENDING',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tweet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ApiKey" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY['read']::TEXT[],
    "rateLimit" INTEGER NOT NULL DEFAULT 1000,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "rotationSchedule" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProviderConnection" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "providerId" "public"."Provider" NOT NULL,
    "providerName" TEXT NOT NULL,
    "accountName" TEXT,
    "providerAccountId" TEXT,
    "profileImage" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "apiKey" TEXT,
    "apiSecret" TEXT,
    "tokenType" TEXT DEFAULT 'Bearer',
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "capabilities" JSONB NOT NULL,
    "limits" JSONB NOT NULL,
    "constraints" JSONB,
    "status" "public"."ConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "lastHealthCheck" TIMESTAMP(3),
    "healthScore" INTEGER DEFAULT 100,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ContentTemplate" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "content" JSONB NOT NULL,
    "variables" JSONB,
    "providerOptimizations" JSONB,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "performance" JSONB,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PublishingQueue" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "postId" TEXT,
    "templateId" TEXT,
    "content" JSONB NOT NULL,
    "originalContent" JSONB,
    "providers" "public"."Provider"[],
    "contentType" "public"."InstagramContentType",
    "scheduledAt" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "publishImmediately" BOOLEAN NOT NULL DEFAULT false,
    "storyProjectId" TEXT,
    "videoProcessingJobId" TEXT,
    "priority" "public"."QueuePriority" NOT NULL DEFAULT 'MEDIUM',
    "optimizeForEngagement" BOOLEAN NOT NULL DEFAULT false,
    "respectRateLimits" BOOLEAN NOT NULL DEFAULT true,
    "autoRetry" BOOLEAN NOT NULL DEFAULT true,
    "adaptContent" BOOLEAN NOT NULL DEFAULT true,
    "optimizeMedia" BOOLEAN NOT NULL DEFAULT true,
    "status" "public"."PublishingStatus" NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "results" JSONB,
    "totalProviders" INTEGER NOT NULL DEFAULT 0,
    "successfulProviders" INTEGER NOT NULL DEFAULT 0,
    "failedProviders" INTEGER NOT NULL DEFAULT 0,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "parentQueueId" TEXT,
    "sequenceNumber" INTEGER,
    "dependsOn" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublishingQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ContentVersion" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "templateId" TEXT,
    "queueId" TEXT,
    "version" INTEGER NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "changeType" "public"."VersionChangeType" NOT NULL DEFAULT 'EDIT',
    "content" JSONB NOT NULL,
    "diff" JSONB,
    "metadata" JSONB,
    "providerContent" JSONB,
    "createdBy" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "analytics" JSONB,
    "feedback" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InstagramStoryProject" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "totalDuration" INTEGER NOT NULL DEFAULT 0,
    "autoTransitions" BOOLEAN NOT NULL DEFAULT false,
    "scheduledAt" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "publishImmediately" BOOLEAN NOT NULL DEFAULT false,
    "status" "public"."StoryProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "publishedStories" INTEGER NOT NULL DEFAULT 0,
    "failedStories" INTEGER NOT NULL DEFAULT 0,
    "totalReach" INTEGER,
    "totalImpressions" INTEGER,
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstagramStoryProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InstagramStory" (
    "id" TEXT NOT NULL,
    "storyProjectId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "mediaId" TEXT,
    "text" TEXT,
    "duration" INTEGER NOT NULL DEFAULT 5,
    "backgroundColor" TEXT,
    "backgroundGradient" TEXT,
    "textColor" TEXT,
    "textPosition" JSONB,
    "textStyle" JSONB,
    "stickers" JSONB,
    "status" "public"."StoryStatus" NOT NULL DEFAULT 'PENDING',
    "processedMediaUrl" TEXT,
    "thumbnailUrl" TEXT,
    "instagramStoryId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "views" INTEGER,
    "replies" INTEGER,
    "shares" INTEGER,
    "taps_forward" INTEGER,
    "taps_back" INTEGER,
    "exits" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstagramStory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."VideoProcessingJob" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "originalMediaId" TEXT NOT NULL,
    "originalUrl" TEXT NOT NULL,
    "originalDuration" DOUBLE PRECISION NOT NULL,
    "originalSize" INTEGER NOT NULL,
    "targetContentType" "public"."InstagramContentType" NOT NULL,
    "splitOptions" JSONB,
    "qualitySettings" JSONB,
    "status" "public"."VideoProcessingStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "currentStep" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "totalSegments" INTEGER NOT NULL DEFAULT 0,
    "processedSegments" INTEGER NOT NULL DEFAULT 0,
    "failedSegments" INTEGER NOT NULL DEFAULT 0,
    "outputFolder" TEXT,
    "totalOutputSize" INTEGER,
    "error" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoProcessingJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."VideoSegment" (
    "id" TEXT NOT NULL,
    "processingJobId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "duration" DOUBLE PRECISION NOT NULL,
    "startTime" DOUBLE PRECISION NOT NULL,
    "endTime" DOUBLE PRECISION NOT NULL,
    "fileSize" INTEGER,
    "status" "public"."SegmentStatus" NOT NULL DEFAULT 'PENDING',
    "thumbnailUrl" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "bitrate" INTEGER,
    "fps" INTEGER,
    "format" TEXT,
    "instagramMediaId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."InstagramAnalytics" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contentType" "public"."InstagramContentType" NOT NULL,
    "contentId" TEXT NOT NULL,
    "instagramId" TEXT,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "saves" INTEGER NOT NULL DEFAULT 0,
    "replies" INTEGER,
    "taps_forward" INTEGER,
    "taps_back" INTEGER,
    "exits" INTEGER,
    "plays" INTEGER,
    "completion_rate" DOUBLE PRECISION,
    "audience_data" JSONB,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstagramAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SchedulingRule" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "contentTypes" "public"."InstagramContentType"[],
    "platforms" "public"."Provider"[],
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "optimalTimes" JSONB NOT NULL,
    "blackoutPeriods" JSONB,
    "maxPostsPerDay" INTEGER,
    "maxPostsPerHour" INTEGER,
    "minIntervalMinutes" INTEGER,
    "priorityBoost" JSONB,
    "hashtagRules" JSONB,
    "timesApplied" INTEGER NOT NULL DEFAULT 0,
    "successRate" DOUBLE PRECISION,
    "avgPerformance" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchedulingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WebhookEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "projectId" TEXT,
    "provider" "public"."Provider" NOT NULL,
    "eventType" "public"."WebhookEventType" NOT NULL,
    "eventId" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "headers" JSONB NOT NULL,
    "normalizedData" JSONB,
    "status" "public"."WebhookProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "nextRetryAt" TIMESTAMP(3),
    "lastError" TEXT,
    "processingTime" INTEGER,
    "postId" TEXT,
    "channelId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WebhookSubscription" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT,
    "provider" "public"."Provider" NOT NULL,
    "webhookUrl" TEXT NOT NULL,
    "secretKey" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "subscriptionId" TEXT,
    "verifyToken" TEXT,
    "eventTypes" "public"."WebhookEventType"[],
    "expiresAt" TIMESTAMP(3),
    "lastVerified" TIMESTAMP(3),
    "eventsReceived" INTEGER NOT NULL DEFAULT 0,
    "eventsProcessed" INTEGER NOT NULL DEFAULT 0,
    "lastEventAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WebhookDeadLetter" (
    "id" TEXT NOT NULL,
    "originalEventId" TEXT NOT NULL,
    "provider" "public"."Provider" NOT NULL,
    "eventType" "public"."WebhookEventType" NOT NULL,
    "payload" JSONB NOT NULL,
    "headers" JSONB NOT NULL,
    "failureReason" TEXT NOT NULL,
    "finalError" TEXT,
    "retryCount" INTEGER NOT NULL,
    "firstFailedAt" TIMESTAMP(3) NOT NULL,
    "lastRetryAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookDeadLetter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_email_key" ON "public"."Account"("email");

-- CreateIndex
CREATE INDEX "Account_email_idx" ON "public"."Account"("email");

-- CreateIndex
CREATE INDEX "Account_isOnTrial_trialEndDate_idx" ON "public"."Account"("isOnTrial", "trialEndDate");

-- CreateIndex
CREATE INDEX "Account_nextBillingDate_idx" ON "public"."Account"("nextBillingDate");

-- CreateIndex
CREATE INDEX "Account_subscription_idx" ON "public"."Account"("subscription");

-- CreateIndex
CREATE INDEX "Account_createdAt_idx" ON "public"."Account"("createdAt");

-- CreateIndex
CREATE INDEX "Account_updatedAt_idx" ON "public"."Account"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "public"."AdminUser"("email");

-- CreateIndex
CREATE INDEX "AdminUser_email_idx" ON "public"."AdminUser"("email");

-- CreateIndex
CREATE INDEX "AdminUser_role_isActive_idx" ON "public"."AdminUser"("role", "isActive");

-- CreateIndex
CREATE INDEX "AdminUser_lastLoginAt_idx" ON "public"."AdminUser"("lastLoginAt");

-- CreateIndex
CREATE INDEX "AdminUser_createdAt_idx" ON "public"."AdminUser"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminSession_refreshToken_key" ON "public"."AdminSession"("refreshToken");

-- CreateIndex
CREATE INDEX "AdminSession_userId_isActive_idx" ON "public"."AdminSession"("userId", "isActive");

-- CreateIndex
CREATE INDEX "AdminSession_refreshToken_idx" ON "public"."AdminSession"("refreshToken");

-- CreateIndex
CREATE INDEX "AdminSession_expiresAt_idx" ON "public"."AdminSession"("expiresAt");

-- CreateIndex
CREATE INDEX "AdminSession_createdAt_idx" ON "public"."AdminSession"("createdAt");

-- CreateIndex
CREATE INDEX "AdminSession_isActive_expiresAt_idx" ON "public"."AdminSession"("isActive", "expiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "public"."AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "public"."AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_resource_resourceId_idx" ON "public"."AuditLog"("resource", "resourceId");

-- CreateIndex
CREATE INDEX "AuditLog_success_createdAt_idx" ON "public"."AuditLog"("success", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "public"."AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Project_accountId_idx" ON "public"."Project"("accountId");

-- CreateIndex
CREATE INDEX "Project_createdAt_idx" ON "public"."Project"("createdAt");

-- CreateIndex
CREATE INDEX "Project_locale_idx" ON "public"."Project"("locale");

-- CreateIndex
CREATE UNIQUE INDEX "Project_accountId_name_key" ON "public"."Project"("accountId", "name");

-- CreateIndex
CREATE INDEX "Post_projectId_idx" ON "public"."Post"("projectId");

-- CreateIndex
CREATE INDEX "Post_status_idx" ON "public"."Post"("status");

-- CreateIndex
CREATE INDEX "Post_scheduledAt_idx" ON "public"."Post"("scheduledAt");

-- CreateIndex
CREATE INDEX "Post_createdAt_idx" ON "public"."Post"("createdAt");

-- CreateIndex
CREATE INDEX "Post_projectId_status_idx" ON "public"."Post"("projectId", "status");

-- CreateIndex
CREATE INDEX "Post_projectId_createdAt_idx" ON "public"."Post"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "PostContent_postId_idx" ON "public"."PostContent"("postId");

-- CreateIndex
CREATE INDEX "PostContent_locale_idx" ON "public"."PostContent"("locale");

-- CreateIndex
CREATE INDEX "PostContent_tags_idx" ON "public"."PostContent"("tags");

-- CreateIndex
CREATE INDEX "PostContent_postId_locale_idx" ON "public"."PostContent"("postId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "PostContent_postId_locale_revision_key" ON "public"."PostContent"("postId", "locale", "revision");

-- CreateIndex
CREATE INDEX "PostMedia_postId_idx" ON "public"."PostMedia"("postId");

-- CreateIndex
CREATE INDEX "PostMedia_type_idx" ON "public"."PostMedia"("type");

-- CreateIndex
CREATE INDEX "PostMedia_hash_idx" ON "public"."PostMedia"("hash");

-- CreateIndex
CREATE INDEX "PostMedia_createdAt_idx" ON "public"."PostMedia"("createdAt");

-- CreateIndex
CREATE INDEX "Channel_projectId_idx" ON "public"."Channel"("projectId");

-- CreateIndex
CREATE INDEX "Channel_provider_idx" ON "public"."Channel"("provider");

-- CreateIndex
CREATE INDEX "Channel_projectId_provider_idx" ON "public"."Channel"("projectId", "provider");

-- CreateIndex
CREATE INDEX "Channel_createdAt_idx" ON "public"."Channel"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PublishLog_dedupeKey_key" ON "public"."PublishLog"("dedupeKey");

-- CreateIndex
CREATE INDEX "PublishLog_channelId_status_createdAt_idx" ON "public"."PublishLog"("channelId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PublishLog_postId_provider_createdAt_idx" ON "public"."PublishLog"("postId", "provider", "createdAt");

-- CreateIndex
CREATE INDEX "PublishLog_status_createdAt_idx" ON "public"."PublishLog"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PublishLog_provider_createdAt_idx" ON "public"."PublishLog"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "PublishLog_createdAt_idx" ON "public"."PublishLog"("createdAt");

-- CreateIndex
CREATE INDEX "Analytics_postId_provider_capturedAt_idx" ON "public"."Analytics"("postId", "provider", "capturedAt");

-- CreateIndex
CREATE INDEX "Analytics_channelId_capturedAt_idx" ON "public"."Analytics"("channelId", "capturedAt");

-- CreateIndex
CREATE INDEX "Analytics_provider_capturedAt_idx" ON "public"."Analytics"("provider", "capturedAt");

-- CreateIndex
CREATE INDEX "Analytics_capturedAt_idx" ON "public"."Analytics"("capturedAt");

-- CreateIndex
CREATE INDEX "Analytics_postId_capturedAt_idx" ON "public"."Analytics"("postId", "capturedAt");

-- CreateIndex
CREATE INDEX "Analytics_channelId_provider_capturedAt_idx" ON "public"."Analytics"("channelId", "provider", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Thread_postId_key" ON "public"."Thread"("postId");

-- CreateIndex
CREATE INDEX "Thread_postId_idx" ON "public"."Thread"("postId");

-- CreateIndex
CREATE INDEX "Thread_strategy_idx" ON "public"."Thread"("strategy");

-- CreateIndex
CREATE INDEX "Thread_createdAt_idx" ON "public"."Thread"("createdAt");

-- CreateIndex
CREATE INDEX "Thread_updatedAt_idx" ON "public"."Thread"("updatedAt");

-- CreateIndex
CREATE INDEX "Tweet_threadId_status_idx" ON "public"."Tweet"("threadId", "status");

-- CreateIndex
CREATE INDEX "Tweet_tweetId_idx" ON "public"."Tweet"("tweetId");

-- CreateIndex
CREATE INDEX "Tweet_status_idx" ON "public"."Tweet"("status");

-- CreateIndex
CREATE INDEX "Tweet_publishedAt_idx" ON "public"."Tweet"("publishedAt");

-- CreateIndex
CREATE INDEX "Tweet_createdAt_idx" ON "public"."Tweet"("createdAt");

-- CreateIndex
CREATE INDEX "Tweet_threadId_sequenceNumber_idx" ON "public"."Tweet"("threadId", "sequenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Tweet_threadId_sequenceNumber_key" ON "public"."Tweet"("threadId", "sequenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "public"."ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_accountId_isActive_idx" ON "public"."ApiKey"("accountId", "isActive");

-- CreateIndex
CREATE INDEX "ApiKey_keyHash_idx" ON "public"."ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_expiresAt_idx" ON "public"."ApiKey"("expiresAt");

-- CreateIndex
CREATE INDEX "ApiKey_lastUsedAt_idx" ON "public"."ApiKey"("lastUsedAt");

-- CreateIndex
CREATE INDEX "ProviderConnection_accountId_isActive_idx" ON "public"."ProviderConnection"("accountId", "isActive");

-- CreateIndex
CREATE INDEX "ProviderConnection_projectId_isActive_idx" ON "public"."ProviderConnection"("projectId", "isActive");

-- CreateIndex
CREATE INDEX "ProviderConnection_providerId_status_idx" ON "public"."ProviderConnection"("providerId", "status");

-- CreateIndex
CREATE INDEX "ProviderConnection_expiresAt_idx" ON "public"."ProviderConnection"("expiresAt");

-- CreateIndex
CREATE INDEX "ProviderConnection_lastUsedAt_idx" ON "public"."ProviderConnection"("lastUsedAt");

-- CreateIndex
CREATE INDEX "ProviderConnection_healthScore_idx" ON "public"."ProviderConnection"("healthScore");

-- CreateIndex
CREATE INDEX "ProviderConnection_createdAt_idx" ON "public"."ProviderConnection"("createdAt");

-- CreateIndex
CREATE INDEX "ProviderConnection_updatedAt_idx" ON "public"."ProviderConnection"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderConnection_accountId_projectId_providerId_key" ON "public"."ProviderConnection"("accountId", "projectId", "providerId");

-- CreateIndex
CREATE INDEX "ContentTemplate_accountId_isActive_idx" ON "public"."ContentTemplate"("accountId", "isActive");

-- CreateIndex
CREATE INDEX "ContentTemplate_projectId_isActive_idx" ON "public"."ContentTemplate"("projectId", "isActive");

-- CreateIndex
CREATE INDEX "ContentTemplate_category_idx" ON "public"."ContentTemplate"("category");

-- CreateIndex
CREATE INDEX "ContentTemplate_tags_idx" ON "public"."ContentTemplate"("tags");

-- CreateIndex
CREATE INDEX "ContentTemplate_usageCount_idx" ON "public"."ContentTemplate"("usageCount");

-- CreateIndex
CREATE INDEX "ContentTemplate_lastUsedAt_idx" ON "public"."ContentTemplate"("lastUsedAt");

-- CreateIndex
CREATE INDEX "ContentTemplate_createdAt_idx" ON "public"."ContentTemplate"("createdAt");

-- CreateIndex
CREATE INDEX "ContentTemplate_updatedAt_idx" ON "public"."ContentTemplate"("updatedAt");

-- CreateIndex
CREATE INDEX "ContentTemplate_parentId_version_idx" ON "public"."ContentTemplate"("parentId", "version");

-- CreateIndex
CREATE INDEX "PublishingQueue_accountId_status_idx" ON "public"."PublishingQueue"("accountId", "status");

-- CreateIndex
CREATE INDEX "PublishingQueue_projectId_status_idx" ON "public"."PublishingQueue"("projectId", "status");

-- CreateIndex
CREATE INDEX "PublishingQueue_scheduledAt_status_idx" ON "public"."PublishingQueue"("scheduledAt", "status");

-- CreateIndex
CREATE INDEX "PublishingQueue_status_createdAt_idx" ON "public"."PublishingQueue"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PublishingQueue_providers_idx" ON "public"."PublishingQueue"("providers");

-- CreateIndex
CREATE INDEX "PublishingQueue_parentQueueId_sequenceNumber_idx" ON "public"."PublishingQueue"("parentQueueId", "sequenceNumber");

-- CreateIndex
CREATE INDEX "PublishingQueue_contentType_idx" ON "public"."PublishingQueue"("contentType");

-- CreateIndex
CREATE INDEX "PublishingQueue_priority_idx" ON "public"."PublishingQueue"("priority");

-- CreateIndex
CREATE INDEX "PublishingQueue_storyProjectId_idx" ON "public"."PublishingQueue"("storyProjectId");

-- CreateIndex
CREATE INDEX "PublishingQueue_videoProcessingJobId_idx" ON "public"."PublishingQueue"("videoProcessingJobId");

-- CreateIndex
CREATE INDEX "PublishingQueue_createdAt_idx" ON "public"."PublishingQueue"("createdAt");

-- CreateIndex
CREATE INDEX "PublishingQueue_updatedAt_idx" ON "public"."PublishingQueue"("updatedAt");

-- CreateIndex
CREATE INDEX "PublishingQueue_completedAt_idx" ON "public"."PublishingQueue"("completedAt");

-- CreateIndex
CREATE INDEX "ContentVersion_postId_version_idx" ON "public"."ContentVersion"("postId", "version");

-- CreateIndex
CREATE INDEX "ContentVersion_templateId_idx" ON "public"."ContentVersion"("templateId");

-- CreateIndex
CREATE INDEX "ContentVersion_queueId_idx" ON "public"."ContentVersion"("queueId");

-- CreateIndex
CREATE INDEX "ContentVersion_changeType_idx" ON "public"."ContentVersion"("changeType");

-- CreateIndex
CREATE INDEX "ContentVersion_createdBy_idx" ON "public"."ContentVersion"("createdBy");

-- CreateIndex
CREATE INDEX "ContentVersion_approvedAt_idx" ON "public"."ContentVersion"("approvedAt");

-- CreateIndex
CREATE INDEX "ContentVersion_createdAt_idx" ON "public"."ContentVersion"("createdAt");

-- CreateIndex
CREATE INDEX "ContentVersion_updatedAt_idx" ON "public"."ContentVersion"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContentVersion_postId_version_key" ON "public"."ContentVersion"("postId", "version");

-- CreateIndex
CREATE INDEX "InstagramStoryProject_accountId_status_idx" ON "public"."InstagramStoryProject"("accountId", "status");

-- CreateIndex
CREATE INDEX "InstagramStoryProject_projectId_status_idx" ON "public"."InstagramStoryProject"("projectId", "status");

-- CreateIndex
CREATE INDEX "InstagramStoryProject_scheduledAt_status_idx" ON "public"."InstagramStoryProject"("scheduledAt", "status");

-- CreateIndex
CREATE INDEX "InstagramStoryProject_status_createdAt_idx" ON "public"."InstagramStoryProject"("status", "createdAt");

-- CreateIndex
CREATE INDEX "InstagramStoryProject_createdAt_idx" ON "public"."InstagramStoryProject"("createdAt");

-- CreateIndex
CREATE INDEX "InstagramStoryProject_updatedAt_idx" ON "public"."InstagramStoryProject"("updatedAt");

-- CreateIndex
CREATE INDEX "InstagramStory_storyProjectId_sequence_idx" ON "public"."InstagramStory"("storyProjectId", "sequence");

-- CreateIndex
CREATE INDEX "InstagramStory_status_idx" ON "public"."InstagramStory"("status");

-- CreateIndex
CREATE INDEX "InstagramStory_publishedAt_idx" ON "public"."InstagramStory"("publishedAt");

-- CreateIndex
CREATE INDEX "InstagramStory_expiresAt_idx" ON "public"."InstagramStory"("expiresAt");

-- CreateIndex
CREATE INDEX "InstagramStory_createdAt_idx" ON "public"."InstagramStory"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramStory_storyProjectId_sequence_key" ON "public"."InstagramStory"("storyProjectId", "sequence");

-- CreateIndex
CREATE INDEX "VideoProcessingJob_accountId_status_idx" ON "public"."VideoProcessingJob"("accountId", "status");

-- CreateIndex
CREATE INDEX "VideoProcessingJob_projectId_status_idx" ON "public"."VideoProcessingJob"("projectId", "status");

-- CreateIndex
CREATE INDEX "VideoProcessingJob_status_createdAt_idx" ON "public"."VideoProcessingJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "VideoProcessingJob_targetContentType_idx" ON "public"."VideoProcessingJob"("targetContentType");

-- CreateIndex
CREATE INDEX "VideoProcessingJob_createdAt_idx" ON "public"."VideoProcessingJob"("createdAt");

-- CreateIndex
CREATE INDEX "VideoProcessingJob_updatedAt_idx" ON "public"."VideoProcessingJob"("updatedAt");

-- CreateIndex
CREATE INDEX "VideoSegment_processingJobId_sequence_idx" ON "public"."VideoSegment"("processingJobId", "sequence");

-- CreateIndex
CREATE INDEX "VideoSegment_status_idx" ON "public"."VideoSegment"("status");

-- CreateIndex
CREATE INDEX "VideoSegment_publishedAt_idx" ON "public"."VideoSegment"("publishedAt");

-- CreateIndex
CREATE INDEX "VideoSegment_createdAt_idx" ON "public"."VideoSegment"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VideoSegment_processingJobId_sequence_key" ON "public"."VideoSegment"("processingJobId", "sequence");

-- CreateIndex
CREATE INDEX "InstagramAnalytics_accountId_contentType_idx" ON "public"."InstagramAnalytics"("accountId", "contentType");

-- CreateIndex
CREATE INDEX "InstagramAnalytics_projectId_contentType_idx" ON "public"."InstagramAnalytics"("projectId", "contentType");

-- CreateIndex
CREATE INDEX "InstagramAnalytics_contentType_contentId_idx" ON "public"."InstagramAnalytics"("contentType", "contentId");

-- CreateIndex
CREATE INDEX "InstagramAnalytics_instagramId_idx" ON "public"."InstagramAnalytics"("instagramId");

-- CreateIndex
CREATE INDEX "InstagramAnalytics_capturedAt_idx" ON "public"."InstagramAnalytics"("capturedAt");

-- CreateIndex
CREATE INDEX "InstagramAnalytics_createdAt_idx" ON "public"."InstagramAnalytics"("createdAt");

-- CreateIndex
CREATE INDEX "InstagramAnalytics_updatedAt_idx" ON "public"."InstagramAnalytics"("updatedAt");

-- CreateIndex
CREATE INDEX "SchedulingRule_accountId_isActive_idx" ON "public"."SchedulingRule"("accountId", "isActive");

-- CreateIndex
CREATE INDEX "SchedulingRule_projectId_isActive_idx" ON "public"."SchedulingRule"("projectId", "isActive");

-- CreateIndex
CREATE INDEX "SchedulingRule_contentTypes_idx" ON "public"."SchedulingRule"("contentTypes");

-- CreateIndex
CREATE INDEX "SchedulingRule_platforms_idx" ON "public"."SchedulingRule"("platforms");

-- CreateIndex
CREATE INDEX "SchedulingRule_createdAt_idx" ON "public"."SchedulingRule"("createdAt");

-- CreateIndex
CREATE INDEX "SchedulingRule_updatedAt_idx" ON "public"."SchedulingRule"("updatedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_provider_eventType_idx" ON "public"."WebhookEvent"("provider", "eventType");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_nextRetryAt_idx" ON "public"."WebhookEvent"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_accountId_provider_idx" ON "public"."WebhookEvent"("accountId", "provider");

-- CreateIndex
CREATE INDEX "WebhookEvent_receivedAt_idx" ON "public"."WebhookEvent"("receivedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_processed_status_idx" ON "public"."WebhookEvent"("processed", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_eventId_key" ON "public"."WebhookEvent"("provider", "eventId");

-- CreateIndex
CREATE INDEX "WebhookSubscription_provider_isActive_idx" ON "public"."WebhookSubscription"("provider", "isActive");

-- CreateIndex
CREATE INDEX "WebhookSubscription_expiresAt_idx" ON "public"."WebhookSubscription"("expiresAt");

-- CreateIndex
CREATE INDEX "WebhookSubscription_lastEventAt_idx" ON "public"."WebhookSubscription"("lastEventAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookSubscription_accountId_provider_projectId_key" ON "public"."WebhookSubscription"("accountId", "provider", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDeadLetter_originalEventId_key" ON "public"."WebhookDeadLetter"("originalEventId");

-- CreateIndex
CREATE INDEX "WebhookDeadLetter_provider_eventType_idx" ON "public"."WebhookDeadLetter"("provider", "eventType");

-- CreateIndex
CREATE INDEX "WebhookDeadLetter_firstFailedAt_idx" ON "public"."WebhookDeadLetter"("firstFailedAt");

-- CreateIndex
CREATE INDEX "WebhookDeadLetter_resolvedAt_idx" ON "public"."WebhookDeadLetter"("resolvedAt");

-- AddForeignKey
ALTER TABLE "public"."AdminSession" ADD CONSTRAINT "AdminSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Project" ADD CONSTRAINT "Project_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Post" ADD CONSTRAINT "Post_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PostContent" ADD CONSTRAINT "PostContent_postId_fkey" FOREIGN KEY ("postId") REFERENCES "public"."Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PostMedia" ADD CONSTRAINT "PostMedia_postId_fkey" FOREIGN KEY ("postId") REFERENCES "public"."Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Channel" ADD CONSTRAINT "Channel_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Thread" ADD CONSTRAINT "Thread_postId_fkey" FOREIGN KEY ("postId") REFERENCES "public"."Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Tweet" ADD CONSTRAINT "Tweet_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "public"."Thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ApiKey" ADD CONSTRAINT "ApiKey_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProviderConnection" ADD CONSTRAINT "ProviderConnection_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProviderConnection" ADD CONSTRAINT "ProviderConnection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ContentTemplate" ADD CONSTRAINT "ContentTemplate_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ContentTemplate" ADD CONSTRAINT "ContentTemplate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ContentTemplate" ADD CONSTRAINT "ContentTemplate_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "public"."ContentTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PublishingQueue" ADD CONSTRAINT "PublishingQueue_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PublishingQueue" ADD CONSTRAINT "PublishingQueue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PublishingQueue" ADD CONSTRAINT "PublishingQueue_postId_fkey" FOREIGN KEY ("postId") REFERENCES "public"."Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PublishingQueue" ADD CONSTRAINT "PublishingQueue_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "public"."ContentTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PublishingQueue" ADD CONSTRAINT "PublishingQueue_parentQueueId_fkey" FOREIGN KEY ("parentQueueId") REFERENCES "public"."PublishingQueue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PublishingQueue" ADD CONSTRAINT "PublishingQueue_storyProjectId_fkey" FOREIGN KEY ("storyProjectId") REFERENCES "public"."InstagramStoryProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PublishingQueue" ADD CONSTRAINT "PublishingQueue_videoProcessingJobId_fkey" FOREIGN KEY ("videoProcessingJobId") REFERENCES "public"."VideoProcessingJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ContentVersion" ADD CONSTRAINT "ContentVersion_postId_fkey" FOREIGN KEY ("postId") REFERENCES "public"."Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ContentVersion" ADD CONSTRAINT "ContentVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "public"."ContentTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ContentVersion" ADD CONSTRAINT "ContentVersion_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "public"."PublishingQueue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InstagramStoryProject" ADD CONSTRAINT "InstagramStoryProject_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InstagramStoryProject" ADD CONSTRAINT "InstagramStoryProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InstagramStory" ADD CONSTRAINT "InstagramStory_storyProjectId_fkey" FOREIGN KEY ("storyProjectId") REFERENCES "public"."InstagramStoryProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InstagramStory" ADD CONSTRAINT "InstagramStory_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "public"."PostMedia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VideoProcessingJob" ADD CONSTRAINT "VideoProcessingJob_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VideoProcessingJob" ADD CONSTRAINT "VideoProcessingJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VideoProcessingJob" ADD CONSTRAINT "VideoProcessingJob_originalMediaId_fkey" FOREIGN KEY ("originalMediaId") REFERENCES "public"."PostMedia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."VideoSegment" ADD CONSTRAINT "VideoSegment_processingJobId_fkey" FOREIGN KEY ("processingJobId") REFERENCES "public"."VideoProcessingJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InstagramAnalytics" ADD CONSTRAINT "InstagramAnalytics_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."InstagramAnalytics" ADD CONSTRAINT "InstagramAnalytics_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SchedulingRule" ADD CONSTRAINT "SchedulingRule_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SchedulingRule" ADD CONSTRAINT "SchedulingRule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WebhookEvent" ADD CONSTRAINT "WebhookEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WebhookEvent" ADD CONSTRAINT "WebhookEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WebhookEvent" ADD CONSTRAINT "WebhookEvent_postId_fkey" FOREIGN KEY ("postId") REFERENCES "public"."Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WebhookSubscription" ADD CONSTRAINT "WebhookSubscription_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WebhookSubscription" ADD CONSTRAINT "WebhookSubscription_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
