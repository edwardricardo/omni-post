-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('OWNER', 'MANAGER', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('APPROVAL_REQUESTED', 'POST_APPROVED', 'POST_REJECTED', 'COMMENT_ADDED', 'COMMENT_REPLY', 'MENTION', 'TEAM_INVITE', 'INBOX_MESSAGE_RECEIVED', 'INBOX_MENTION_RECEIVED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED');

-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('X', 'INSTAGRAM', 'FACEBOOK', 'YOUTUBE', 'TIKTOK', 'SNAPCHAT', 'TELEGRAM', 'PINTEREST', 'LINKEDIN', 'BLUESKY', 'THREADS');

-- CreateEnum
CREATE TYPE "LogStatus" AS ENUM ('QUEUED', 'RUNNING', 'OK', 'ERR');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('image', 'video', 'gif');

-- CreateEnum
CREATE TYPE "ThreadStrategy" AS ENUM ('AUTO', 'MANUAL', 'SINGLE');

-- CreateEnum
CREATE TYPE "TweetStatus" AS ENUM ('PENDING', 'PUBLISHING', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'ERROR', 'EXPIRED', 'PENDING');

-- CreateEnum
CREATE TYPE "PublishingStatus" AS ENUM ('PENDING', 'QUEUED', 'PROCESSING', 'PUBLISHED', 'FAILED', 'CANCELLED', 'RETRYING');

-- CreateEnum
CREATE TYPE "VersionChangeType" AS ENUM ('CREATE', 'EDIT', 'PUBLISH', 'SCHEDULE', 'ADAPT', 'ROLLBACK');

-- CreateEnum
CREATE TYPE "StoryProjectStatus" AS ENUM ('DRAFT', 'READY', 'SCHEDULED', 'PROCESSING', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StoryStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'PUBLISHING', 'PUBLISHED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "VideoProcessingStatus" AS ENUM ('QUEUED', 'DOWNLOADING', 'ANALYZING', 'SPLITTING', 'OPTIMIZING', 'UPLOADING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SegmentStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'UPLOADED', 'FAILED');

-- CreateEnum
CREATE TYPE "InstagramContentType" AS ENUM ('FEED', 'STORIES', 'REELS', 'CAROUSEL', 'IGTV');

-- CreateEnum
CREATE TYPE "QueuePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "WebhookEventType" AS ENUM ('POST_PUBLISHED', 'POST_UPDATED', 'POST_DELETED', 'POST_ENGAGEMENT_UPDATE', 'STORY_PUBLISHED', 'STORY_EXPIRED', 'REEL_PUBLISHED', 'LIKE_RECEIVED', 'COMMENT_RECEIVED', 'SHARE_RECEIVED', 'MENTION_RECEIVED', 'ACCOUNT_CONNECTED', 'ACCOUNT_DISCONNECTED', 'PERMISSION_CHANGED', 'RATE_LIMIT_REACHED', 'QUOTA_EXCEEDED', 'API_ERROR', 'VIDEO_PROCESSED', 'VIDEO_MONETIZED', 'LIVE_STREAM_STARTED', 'LIVE_STREAM_ENDED', 'MILESTONE_REACHED', 'VIRAL_CONTENT_DETECTED');

-- CreateEnum
CREATE TYPE "WebhookProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER', 'RETRYING');

-- CreateEnum
CREATE TYPE "ABTestStatus" AS ENUM ('DRAFT', 'RUNNING', 'PAUSED', 'COMPLETED', 'STOPPED');

-- CreateEnum
CREATE TYPE "TemplateUsageAction" AS ENUM ('VIEW', 'USE', 'COMPILE', 'LIKE', 'SHARE');

-- CreateEnum
CREATE TYPE "TemplateComponentType" AS ENUM ('HEADER', 'BODY', 'FOOTER', 'MEDIA_BLOCK', 'CALL_TO_ACTION', 'HASHTAG_BLOCK', 'VARIABLE_BLOCK', 'CUSTOM');

-- CreateEnum
CREATE TYPE "TemplatePermission" AS ENUM ('READ', 'WRITE', 'DELETE', 'SHARE', 'ADMIN');

-- CreateEnum
CREATE TYPE "TemplateCollaboratorRole" AS ENUM ('VIEWER', 'EDITOR', 'ADMIN', 'OWNER');

-- CreateEnum
CREATE TYPE "SocialMessageType" AS ENUM ('COMMENT', 'MENTION', 'DIRECT_MESSAGE', 'REPLY');

-- CreateEnum
CREATE TYPE "SocialMessageStatus" AS ENUM ('UNREAD', 'READ', 'REPLIED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OutboundReplyStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ReportFormat" AS ENUM ('CSV', 'JSON', 'PDF', 'XLSX', 'XML');

-- CreateEnum
CREATE TYPE "IntegrationPlatform" AS ENUM ('ZAPIER', 'MAKE');

-- CreateEnum
CREATE TYPE "SsoProvider" AS ENUM ('NONE', 'SAML', 'OIDC');

-- CreateEnum
CREATE TYPE "ReportChartType" AS ENUM ('LINE', 'BAR', 'AREA', 'PIE', 'TABLE');

-- CreateEnum
CREATE TYPE "CrmPlatform" AS ENUM ('HUBSPOT', 'SALESFORCE');

-- CreateEnum
CREATE TYPE "CrmActivityType" AS ENUM ('POST_PUBLISHED', 'POST_SCHEDULED', 'CAMPAIGN_CREATED', 'CAMPAIGN_COMPLETED', 'APPROVAL_APPROVED');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'GRANDFATHERED');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "GatewayProvider" AS ENUM ('STRIPE', 'PADDLE');

-- CreateEnum
CREATE TYPE "SwitchStatus" AS ENUM ('SCHEDULED', 'PENDING_CHECKOUT', 'COMPLETED', 'CANCELLED', 'SUSPENDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "DpoType" AS ENUM ('INTERNAL', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "DsarRequestType" AS ENUM ('EXPORT', 'DELETION', 'ACCESS');

-- CreateEnum
CREATE TYPE "DsarStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "JurisdictionType" AS ENUM ('GDPR', 'LGPD', 'CCPA', 'PIPEDA', 'OTHER');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'CONVERTED', 'REWARDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RepurposeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "MessagePriority" AS ENUM ('URGENT', 'HIGH', 'NORMAL', 'LOW');

-- CreateEnum
CREATE TYPE "TrendUrgency" AS ENUM ('NOW', 'TODAY', 'THIS_WEEK');

-- CreateEnum
CREATE TYPE "CredentialGroup" AS ENUM ('STRIPE', 'PADDLE', 'RESEND', 'STORAGE', 'MONITORING', 'AI_POOL', 'PLATFORM', 'SOCIAL_FACEBOOK', 'SOCIAL_INSTAGRAM', 'SOCIAL_X', 'SOCIAL_YOUTUBE', 'SOCIAL_TIKTOK', 'SOCIAL_LINKEDIN', 'SOCIAL_SNAPCHAT', 'SOCIAL_TELEGRAM', 'SOCIAL_PINTEREST', 'SOCIAL_BLUESKY', 'SOCIAL_THREADS');

-- CreateEnum
CREATE TYPE "AccountCredentialGroup" AS ENUM ('AI_BYOK');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
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
    "slug" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "phone" TEXT,
    "maxTeamMembers" INTEGER NOT NULL DEFAULT 5,
    "maxStorageBytes" BIGINT NOT NULL DEFAULT 5368709120,
    "maxRecurringPosts" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "ssoEnabled" BOOLEAN NOT NULL DEFAULT false,
    "ssoProvider" "SsoProvider" NOT NULL DEFAULT 'NONE',
    "gatewayProvider" "GatewayProvider" NOT NULL DEFAULT 'STRIPE',
    "gatewayCustomerId" TEXT,
    "pendingGatewayProvider" "GatewayProvider",
    "pendingGatewaySwitch" BOOLEAN NOT NULL DEFAULT false,
    "gatewaySwitchAt" TIMESTAMP(3),

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "level" INTEGER NOT NULL DEFAULT 1,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "passwordResetToken" TEXT,
    "passwordResetExpires" TIMESTAMP(3),
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "passwordHashAlgo" TEXT NOT NULL DEFAULT 'argon2id',
    "passwordChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "passwordHistory" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "mfaBackupCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mfaBackupUsedAt" JSONB DEFAULT '{}',
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lockReason" TEXT,
    "maxConcurrentSessions" INTEGER NOT NULL DEFAULT 3,
    "timezone" TEXT DEFAULT 'UTC',
    "locale" TEXT DEFAULT 'en',
    "department" TEXT,
    "team" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminSession" (
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
    "csrfToken" TEXT NOT NULL,
    "deviceId" TEXT,
    "deviceName" TEXT,
    "location" JSONB,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedBy" TEXT,
    "revokeReason" TEXT,

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
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
CREATE TABLE "AdminUserPermission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "scope" TEXT DEFAULT '*',
    "conditions" JSONB,
    "grantedBy" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AdminUserPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminRoleHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "oldRole" TEXT NOT NULL,
    "newRole" TEXT NOT NULL,
    "reason" TEXT,
    "changedBy" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),

    CONSTRAINT "AdminRoleHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL DEFAULT 'MEMBER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "invitedBy" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerUser" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL DEFAULT 'MEMBER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailVerifyToken" TEXT,
    "emailVerifyExpiry" TIMESTAMP(3),
    "resetToken" TEXT,
    "resetTokenExpiry" TIMESTAMP(3),
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CustomerUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY['READ', 'WRITE']::TEXT[],
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "actorId" TEXT,
    "actorName" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalWorkflow" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalWorkflowLevel" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "role" TEXT,
    "assigneeId" TEXT,
    "requireAll" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalWorkflowLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "submitterId" TEXT NOT NULL,
    "workflowId" TEXT,
    "currentLevel" INTEGER NOT NULL DEFAULT 1,
    "totalLevels" INTEGER NOT NULL DEFAULT 1,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalReview" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "decision" "ReviewDecision" NOT NULL,
    "comment" TEXT,
    "level" INTEGER NOT NULL DEFAULT 1,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "assigneeId" TEXT,
    "createdById" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "postId" TEXT,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostComment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "parentId" TEXT,
    "body" TEXT NOT NULL,
    "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isEdited" BOOLEAN NOT NULL DEFAULT false,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminLoginAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "failureReason" TEXT,
    "mfaAttempted" BOOLEAN NOT NULL DEFAULT false,
    "mfaSuccess" BOOLEAN,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "deviceId" TEXT,
    "location" JSONB,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "blockReason" TEXT,
    "threatScore" INTEGER DEFAULT 0,
    "requiresCaptcha" BOOLEAN NOT NULL DEFAULT false,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminLoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'es',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "accountId" TEXT NOT NULL,
    "isInCrisisMode" BOOLEAN NOT NULL DEFAULT false,
    "crisisStartedAt" TIMESTAMP(3),
    "crisisReason" TEXT,
    "crisisModeHistory" JSONB DEFAULT '[]',
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostContent" (
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
CREATE TABLE "PostMedia" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "alt" TEXT,
    "hash" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "MediaKind" NOT NULL,

    CONSTRAINT "PostMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "handle" TEXT NOT NULL,
    "credentials" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackedLink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "originalUrl" TEXT NOT NULL,
    "shortCode" TEXT NOT NULL,
    "vanitySlug" TEXT,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "utmTerm" TEXT,
    "campaignId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackedLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkClick" (
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

-- CreateTable
CREATE TABLE "PublishLog" (
    "id" TEXT NOT NULL,
    "postId" TEXT,
    "provider" "Provider" NOT NULL,
    "channelId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "LogStatus" NOT NULL,

    CONSTRAINT "PublishLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Analytics" (
    "id" TEXT NOT NULL,
    "postId" TEXT,
    "channelId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "views" INTEGER DEFAULT 0,
    "likes" INTEGER DEFAULT 0,
    "comments" INTEGER DEFAULT 0,
    "shares" INTEGER DEFAULT 0,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Analytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Thread" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "strategy" "ThreadStrategy" NOT NULL DEFAULT 'AUTO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Thread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tweet" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "media" JSONB,
    "tweetId" TEXT,
    "parentTweetId" TEXT,
    "status" "TweetStatus" NOT NULL DEFAULT 'PENDING',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tweet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
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
CREATE TABLE "ProviderConnection" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "providerId" "Provider" NOT NULL,
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
    "status" "ConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
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
CREATE TABLE "ContentTemplate" (
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
CREATE TABLE "PublishingQueue" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "postId" TEXT,
    "templateId" TEXT,
    "content" JSONB NOT NULL,
    "originalContent" JSONB,
    "providers" "Provider"[],
    "contentType" "InstagramContentType",
    "scheduledAt" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "publishImmediately" BOOLEAN NOT NULL DEFAULT false,
    "storyProjectId" TEXT,
    "videoProcessingJobId" TEXT,
    "priority" "QueuePriority" NOT NULL DEFAULT 'MEDIUM',
    "optimizeForEngagement" BOOLEAN NOT NULL DEFAULT false,
    "respectRateLimits" BOOLEAN NOT NULL DEFAULT true,
    "autoRetry" BOOLEAN NOT NULL DEFAULT true,
    "adaptContent" BOOLEAN NOT NULL DEFAULT true,
    "optimizeMedia" BOOLEAN NOT NULL DEFAULT true,
    "status" "PublishingStatus" NOT NULL DEFAULT 'PENDING',
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
CREATE TABLE "ContentVersion" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "templateId" TEXT,
    "queueId" TEXT,
    "version" INTEGER NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "changeType" "VersionChangeType" NOT NULL DEFAULT 'EDIT',
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
CREATE TABLE "InstagramStoryProject" (
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
    "status" "StoryProjectStatus" NOT NULL DEFAULT 'DRAFT',
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
CREATE TABLE "InstagramStory" (
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
    "status" "StoryStatus" NOT NULL DEFAULT 'PENDING',
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
CREATE TABLE "VideoProcessingJob" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "originalMediaId" TEXT NOT NULL,
    "originalUrl" TEXT NOT NULL,
    "originalDuration" DOUBLE PRECISION NOT NULL,
    "originalSize" INTEGER NOT NULL,
    "targetContentType" "InstagramContentType" NOT NULL,
    "splitOptions" JSONB,
    "qualitySettings" JSONB,
    "status" "VideoProcessingStatus" NOT NULL DEFAULT 'QUEUED',
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
CREATE TABLE "VideoSegment" (
    "id" TEXT NOT NULL,
    "processingJobId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "duration" DOUBLE PRECISION NOT NULL,
    "startTime" DOUBLE PRECISION NOT NULL,
    "endTime" DOUBLE PRECISION NOT NULL,
    "fileSize" INTEGER,
    "status" "SegmentStatus" NOT NULL DEFAULT 'PENDING',
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
CREATE TABLE "InstagramAnalytics" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "contentType" "InstagramContentType" NOT NULL,
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
CREATE TABLE "SchedulingRule" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "contentTypes" "InstagramContentType"[],
    "platforms" "Provider"[],
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
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "projectId" TEXT,
    "provider" "Provider" NOT NULL,
    "eventType" "WebhookEventType" NOT NULL,
    "eventId" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "headers" JSONB NOT NULL,
    "normalizedData" JSONB,
    "status" "WebhookProcessingStatus" NOT NULL DEFAULT 'PENDING',
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
CREATE TABLE "WebhookSubscription" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT,
    "provider" "Provider" NOT NULL,
    "webhookUrl" TEXT NOT NULL,
    "secretKey" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "subscriptionId" TEXT,
    "verifyToken" TEXT,
    "eventTypes" "WebhookEventType"[],
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
CREATE TABLE "WebhookDeadLetter" (
    "id" TEXT NOT NULL,
    "originalEventId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "eventType" "WebhookEventType" NOT NULL,
    "payload" JSONB NOT NULL,
    "headers" JSONB NOT NULL,
    "failureReason" TEXT NOT NULL,
    "finalError" TEXT,
    "retryCount" INTEGER NOT NULL,
    "firstFailedAt" TIMESTAMP(3) NOT NULL,
    "lastRetryAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookDeadLetter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxDeadLetter" (
    "id" TEXT NOT NULL,
    "originalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "failureReason" TEXT NOT NULL,
    "retryCount" INTEGER NOT NULL,
    "firstFailedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,

    CONSTRAINT "OutboxDeadLetter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
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
CREATE TABLE "TemplateVersion" (
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
CREATE TABLE "ABTest" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "config" JSONB NOT NULL,
    "status" "ABTestStatus" NOT NULL DEFAULT 'DRAFT',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "results" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ABTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateUsageEvent" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "action" "TemplateUsageAction" NOT NULL,
    "context" JSONB NOT NULL DEFAULT '{}',
    "variantId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateUsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateComponent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "TemplateComponentType" NOT NULL,
    "content" JSONB NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "platforms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isReusable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplateComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateComponentUsage" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "overrides" JSONB,

    CONSTRAINT "TemplateComponentUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateCommit" (
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
CREATE TABLE "TemplateCollaboration" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permissions" "TemplatePermission"[],
    "role" "TemplateCollaboratorRole" NOT NULL DEFAULT 'EDITOR',
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "lastActiveAt" TIMESTAMP(3),

    CONSTRAINT "TemplateCollaboration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateAnalytics" (
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

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 5,
    "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SagaInstance" (
    "id" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "context" JSONB NOT NULL,
    "stepResults" JSONB NOT NULL DEFAULT '[]',
    "compensationResults" JSONB NOT NULL DEFAULT '[]',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "accountId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SagaInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialMessage" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "conversationId" TEXT,
    "provider" "Provider" NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "providerParentId" TEXT,
    "messageType" "SocialMessageType" NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorHandle" TEXT,
    "authorAvatarUrl" TEXT,
    "authorProviderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mediaUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "webhookEventId" TEXT,
    "relatedPostId" TEXT,
    "status" "SocialMessageStatus" NOT NULL DEFAULT 'UNREAD',
    "assigneeId" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "priority" "MessagePriority" NOT NULL DEFAULT 'NORMAL',
    "suggestedReplies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "crmContactId" TEXT,
    "aiProcessedAt" TIMESTAMP(3),
    "sentimentScore" DECIMAL(3,2),
    "providerCreatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialConversation" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "subject" TEXT,
    "participantCount" INTEGER NOT NULL DEFAULT 1,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3) NOT NULL,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "rootProviderMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationNote" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ConversationNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialOutboundReply" (
    "id" TEXT NOT NULL,
    "socialMessageId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "providerReplyId" TEXT,
    "status" "OutboundReplyStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialOutboundReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignPost" (
    "campaignId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "taggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignPost_pkey" PRIMARY KEY ("campaignId","postId")
);

-- CreateTable
CREATE TABLE "AnalyticsDailySummary" (
    "id" TEXT NOT NULL,
    "postId" TEXT,
    "channelId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "date" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "records" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AnalyticsDailySummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsMonthlySummary" (
    "id" TEXT NOT NULL,
    "postId" TEXT,
    "channelId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "month" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "records" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AnalyticsMonthlySummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledReport" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cronSchedule" TEXT NOT NULL,
    "format" "ReportFormat" NOT NULL DEFAULT 'CSV',
    "recipients" TEXT[],
    "filters" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledReport_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "AIPromptTemplate" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "platforms" TEXT[],
    "prompt" TEXT NOT NULL,
    "variables" JSONB NOT NULL,
    "tone" TEXT[],
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIPromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageMetric" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "postsPublished" INTEGER NOT NULL DEFAULT 0,
    "aiCallsMade" INTEGER NOT NULL DEFAULT 0,
    "storageGb" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "teamMemberCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandVoice" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "tone" TEXT[],
    "examples" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandVoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandKit" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "primaryColor" TEXT,
    "secondaryColor" TEXT,
    "accentColor" TEXT,
    "logoUrl" TEXT,
    "logoStorageKey" TEXT,
    "fontPrimary" TEXT,
    "fontSecondary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandKit_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "OidcConfiguration" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "issuerUrl" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY['openid', 'email', 'profile']::TEXT[],
    "attributeMapping" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OidcConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomReport" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "metrics" TEXT[],
    "dimensions" TEXT[],
    "dateRange" TEXT NOT NULL DEFAULT 'LAST_30_DAYS',
    "dateRangeStart" TIMESTAMP(3),
    "dateRangeEnd" TIMESTAMP(3),
    "chartType" "ReportChartType" NOT NULL DEFAULT 'LINE',
    "filters" JSONB,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "shareToken" TEXT,
    "shareEnabled" BOOLEAN NOT NULL DEFAULT false,
    "shareExpiresAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSchedule" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "cronExpression" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "format" "ReportFormat" NOT NULL DEFAULT 'PDF',
    "recipients" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "url" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "duration" INTEGER,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "folderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetFolder" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetTag" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT DEFAULT '#6366f1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetTagOnAsset" (
    "assetId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "AssetTagOnAsset_pkey" PRIMARY KEY ("assetId","tagId")
);

-- CreateTable
CREATE TABLE "ProviderPricingTier" (
    "id" TEXT NOT NULL,
    "minProviders" INTEGER NOT NULL,
    "maxProviders" INTEGER,
    "pricePerProviderMonth" DECIMAL(10,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderPricingTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountPricingTier" (
    "id" TEXT NOT NULL,
    "minAccounts" INTEGER NOT NULL,
    "maxAccounts" INTEGER,
    "multiplier" DECIMAL(4,3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountPricingTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderBundle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "providers" "Provider"[],
    "pricePerAccountMonth" DECIMAL(10,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderBundle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BundleFeatureFlag" (
    "id" TEXT NOT NULL,
    "bundleId" TEXT,
    "featureKey" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BundleFeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountSubscription" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "bundleId" TEXT,
    "providers" "Provider"[],
    "accountCount" INTEGER NOT NULL DEFAULT 1,
    "maxProjects" INTEGER NOT NULL DEFAULT 3,
    "pricePerMonth" DECIMAL(10,2) NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "externalSubscriptionId" TEXT,
    "externalCustomerId" TEXT,
    "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "gatewayProvider" "GatewayProvider" NOT NULL DEFAULT 'STRIPE',
    "gatewaySubscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPriceHistory" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "previousPrice" DECIMAL(10,2) NOT NULL,
    "newPrice" DECIMAL(10,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionPriceHistory_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "gatewayProvider" "GatewayProvider" NOT NULL,
    "gatewayEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "rawEventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "ReferralCode" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "referralCodeId" TEXT NOT NULL,
    "referredAccountId" TEXT,
    "referredEmail" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "rewardGranted" BOOLEAN NOT NULL DEFAULT false,
    "convertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepurposeProposal" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "sourcePostId" TEXT NOT NULL,
    "sourcePlatform" "Provider" NOT NULL,
    "status" "RepurposeStatus" NOT NULL DEFAULT 'PENDING',
    "engagementRate" DECIMAL(8,4) NOT NULL,
    "engagementMultiplier" DECIMAL(6,2) NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,

    CONSTRAINT "RepurposeProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepurposeVariant" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "platform" "Provider" NOT NULL,
    "content" TEXT NOT NULL,
    "hashtags" TEXT[],
    "status" "RepurposeStatus" NOT NULL DEFAULT 'PENDING',
    "postId" TEXT,

    CONSTRAINT "RepurposeVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendRadarResult" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "platform" "Provider" NOT NULL,
    "relevanceScore" INTEGER NOT NULL,
    "postIdea" TEXT,
    "bestPlatform" "Provider",
    "urgency" "TrendUrgency" NOT NULL,
    "volume" INTEGER,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrendRadarResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformCredential" (
    "id" TEXT NOT NULL,
    "group" "CredentialGroup" NOT NULL,
    "key" TEXT NOT NULL,
    "encryptedValue" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "PlatformCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountCredential" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "group" "AccountCredentialGroup" NOT NULL,
    "key" TEXT NOT NULL,
    "encryptedValue" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformEncryptionKey" (
    "id" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "rotatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedBy" TEXT NOT NULL,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PlatformEncryptionKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_email_key" ON "Account"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_slug_key" ON "Account"("slug");

-- CreateIndex
CREATE INDEX "Account_isOnTrial_trialEndDate_idx" ON "Account"("isOnTrial", "trialEndDate");

-- CreateIndex
CREATE INDEX "Account_nextBillingDate_idx" ON "Account"("nextBillingDate");

-- CreateIndex
CREATE INDEX "Account_deletedAt_idx" ON "Account"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE INDEX "Role_isActive_idx" ON "Role"("isActive");

-- CreateIndex
CREATE INDEX "RolePermission_roleId_idx" ON "RolePermission"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_roleId_permission_key" ON "RolePermission"("roleId", "permission");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE INDEX "AdminUser_roleId_isActive_idx" ON "AdminUser"("roleId", "isActive");

-- CreateIndex
CREATE INDEX "AdminUser_lastLoginAt_idx" ON "AdminUser"("lastLoginAt");

-- CreateIndex
CREATE INDEX "AdminUser_failedLoginAttempts_lockedUntil_idx" ON "AdminUser"("failedLoginAttempts", "lockedUntil");

-- CreateIndex
CREATE INDEX "AdminUser_passwordChangedAt_idx" ON "AdminUser"("passwordChangedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminSession_refreshToken_key" ON "AdminSession"("refreshToken");

-- CreateIndex
CREATE UNIQUE INDEX "AdminSession_csrfToken_key" ON "AdminSession"("csrfToken");

-- CreateIndex
CREATE INDEX "AdminSession_userId_isActive_idx" ON "AdminSession"("userId", "isActive");

-- CreateIndex
CREATE INDEX "AdminSession_isActive_expiresAt_idx" ON "AdminSession"("isActive", "expiresAt");

-- CreateIndex
CREATE INDEX "AdminSession_deviceId_idx" ON "AdminSession"("deviceId");

-- CreateIndex
CREATE INDEX "AdminSession_lastActivityAt_idx" ON "AdminSession"("lastActivityAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_resource_resourceId_idx" ON "AuditLog"("resource", "resourceId");

-- CreateIndex
CREATE INDEX "AuditLog_success_createdAt_idx" ON "AuditLog"("success", "createdAt");

-- CreateIndex
CREATE INDEX "AdminUserPermission_userId_isActive_idx" ON "AdminUserPermission"("userId", "isActive");

-- CreateIndex
CREATE INDEX "AdminUserPermission_resource_action_idx" ON "AdminUserPermission"("resource", "action");

-- CreateIndex
CREATE INDEX "AdminUserPermission_expiresAt_idx" ON "AdminUserPermission"("expiresAt");

-- CreateIndex
CREATE INDEX "AdminUserPermission_grantedAt_idx" ON "AdminUserPermission"("grantedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUserPermission_userId_resource_action_scope_key" ON "AdminUserPermission"("userId", "resource", "action", "scope");

-- CreateIndex
CREATE INDEX "AdminRoleHistory_userId_changedAt_idx" ON "AdminRoleHistory"("userId", "changedAt");

-- CreateIndex
CREATE INDEX "AdminRoleHistory_changedBy_idx" ON "AdminRoleHistory"("changedBy");

-- CreateIndex
CREATE INDEX "AdminRoleHistory_effectiveFrom_effectiveUntil_idx" ON "AdminRoleHistory"("effectiveFrom", "effectiveUntil");

-- CreateIndex
CREATE INDEX "TeamMember_accountId_isActive_idx" ON "TeamMember"("accountId", "isActive");

-- CreateIndex
CREATE INDEX "TeamMember_email_idx" ON "TeamMember"("email");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_accountId_email_key" ON "TeamMember"("accountId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerUser_emailVerifyToken_key" ON "CustomerUser"("emailVerifyToken");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerUser_resetToken_key" ON "CustomerUser"("resetToken");

-- CreateIndex
CREATE INDEX "CustomerUser_accountId_idx" ON "CustomerUser"("accountId");

-- CreateIndex
CREATE INDEX "CustomerUser_email_idx" ON "CustomerUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerUser_accountId_email_key" ON "CustomerUser"("accountId", "email");

-- CreateIndex
CREATE INDEX "ProjectMember_memberId_idx" ON "ProjectMember"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_projectId_memberId_key" ON "ProjectMember"("projectId", "memberId");

-- CreateIndex
CREATE INDEX "Notification_recipientId_isRead_createdAt_idx" ON "Notification"("recipientId", "isRead", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_recipientId_createdAt_idx" ON "Notification"("recipientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_memberId_type_key" ON "NotificationPreference"("memberId", "type");

-- CreateIndex
CREATE INDEX "ApprovalWorkflow_accountId_idx" ON "ApprovalWorkflow"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalWorkflow_accountId_name_key" ON "ApprovalWorkflow"("accountId", "name");

-- CreateIndex
CREATE INDEX "ApprovalWorkflowLevel_workflowId_idx" ON "ApprovalWorkflowLevel"("workflowId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalWorkflowLevel_workflowId_order_key" ON "ApprovalWorkflowLevel"("workflowId", "order");

-- CreateIndex
CREATE INDEX "ApprovalRequest_postId_status_idx" ON "ApprovalRequest"("postId", "status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_submitterId_createdAt_idx" ON "ApprovalRequest"("submitterId", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_workflowId_idx" ON "ApprovalRequest"("workflowId");

-- CreateIndex
CREATE INDEX "ApprovalReview_requestId_idx" ON "ApprovalReview"("requestId");

-- CreateIndex
CREATE INDEX "ApprovalReview_reviewerId_idx" ON "ApprovalReview"("reviewerId");

-- CreateIndex
CREATE INDEX "Task_accountId_idx" ON "Task"("accountId");

-- CreateIndex
CREATE INDEX "Task_assigneeId_idx" ON "Task"("assigneeId");

-- CreateIndex
CREATE INDEX "Task_status_idx" ON "Task"("status");

-- CreateIndex
CREATE INDEX "Task_createdById_idx" ON "Task"("createdById");

-- CreateIndex
CREATE INDEX "PostComment_postId_deletedAt_createdAt_idx" ON "PostComment"("postId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "PostComment_parentId_idx" ON "PostComment"("parentId");

-- CreateIndex
CREATE INDEX "PostComment_authorId_idx" ON "PostComment"("authorId");

-- CreateIndex
CREATE INDEX "AdminLoginAttempt_email_attemptedAt_idx" ON "AdminLoginAttempt"("email", "attemptedAt");

-- CreateIndex
CREATE INDEX "AdminLoginAttempt_ipAddress_attemptedAt_idx" ON "AdminLoginAttempt"("ipAddress", "attemptedAt");

-- CreateIndex
CREATE INDEX "AdminLoginAttempt_userId_attemptedAt_idx" ON "AdminLoginAttempt"("userId", "attemptedAt");

-- CreateIndex
CREATE INDEX "AdminLoginAttempt_success_attemptedAt_idx" ON "AdminLoginAttempt"("success", "attemptedAt");

-- CreateIndex
CREATE INDEX "AdminLoginAttempt_isBlocked_threatScore_idx" ON "AdminLoginAttempt"("isBlocked", "threatScore");

-- CreateIndex
CREATE INDEX "AdminLoginAttempt_deviceId_idx" ON "AdminLoginAttempt"("deviceId");

-- CreateIndex
CREATE INDEX "Project_accountId_idx" ON "Project"("accountId");

-- CreateIndex
CREATE INDEX "Project_createdAt_idx" ON "Project"("createdAt");

-- CreateIndex
CREATE INDEX "Project_locale_idx" ON "Project"("locale");

-- CreateIndex
CREATE INDEX "Project_isInCrisisMode_idx" ON "Project"("isInCrisisMode");

-- CreateIndex
CREATE INDEX "Project_deletedAt_idx" ON "Project"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Project_accountId_name_key" ON "Project"("accountId", "name");

-- CreateIndex
CREATE INDEX "Post_scheduledAt_idx" ON "Post"("scheduledAt");

-- CreateIndex
CREATE INDEX "Post_projectId_status_idx" ON "Post"("projectId", "status");

-- CreateIndex
CREATE INDEX "Post_projectId_createdAt_idx" ON "Post"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Post_projectId_publishedAt_idx" ON "Post"("projectId", "publishedAt");

-- CreateIndex
CREATE INDEX "Post_projectId_scheduledAt_status_idx" ON "Post"("projectId", "scheduledAt", "status");

-- CreateIndex
CREATE INDEX "Post_deletedAt_idx" ON "Post"("deletedAt");

-- CreateIndex
CREATE INDEX "PostContent_tags_idx" ON "PostContent"("tags");

-- CreateIndex
CREATE INDEX "PostContent_postId_locale_idx" ON "PostContent"("postId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "PostContent_postId_locale_revision_key" ON "PostContent"("postId", "locale", "revision");

-- CreateIndex
CREATE INDEX "PostMedia_postId_idx" ON "PostMedia"("postId");

-- CreateIndex
CREATE INDEX "PostMedia_type_idx" ON "PostMedia"("type");

-- CreateIndex
CREATE INDEX "PostMedia_hash_idx" ON "PostMedia"("hash");

-- CreateIndex
CREATE INDEX "PostMedia_createdAt_idx" ON "PostMedia"("createdAt");

-- CreateIndex
CREATE INDEX "Channel_projectId_idx" ON "Channel"("projectId");

-- CreateIndex
CREATE INDEX "Channel_provider_idx" ON "Channel"("provider");

-- CreateIndex
CREATE INDEX "Channel_projectId_provider_idx" ON "Channel"("projectId", "provider");

-- CreateIndex
CREATE INDEX "Channel_createdAt_idx" ON "Channel"("createdAt");

-- CreateIndex
CREATE INDEX "Channel_deletedAt_idx" ON "Channel"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedLink_shortCode_key" ON "TrackedLink"("shortCode");

-- CreateIndex
CREATE INDEX "TrackedLink_projectId_isActive_idx" ON "TrackedLink"("projectId", "isActive");

-- CreateIndex
CREATE INDEX "TrackedLink_shortCode_idx" ON "TrackedLink"("shortCode");

-- CreateIndex
CREATE INDEX "TrackedLink_vanitySlug_idx" ON "TrackedLink"("vanitySlug");

-- CreateIndex
CREATE INDEX "TrackedLink_createdAt_idx" ON "TrackedLink"("createdAt");

-- CreateIndex
CREATE INDEX "TrackedLink_clicks_idx" ON "TrackedLink"("clicks");

-- CreateIndex
CREATE INDEX "LinkClick_trackedLinkId_timestamp_idx" ON "LinkClick"("trackedLinkId", "timestamp");

-- CreateIndex
CREATE INDEX "LinkClick_country_idx" ON "LinkClick"("country");

-- CreateIndex
CREATE INDEX "LinkClick_timestamp_idx" ON "LinkClick"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "PublishLog_dedupeKey_key" ON "PublishLog"("dedupeKey");

-- CreateIndex
CREATE INDEX "PublishLog_channelId_status_createdAt_idx" ON "PublishLog"("channelId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PublishLog_postId_provider_createdAt_idx" ON "PublishLog"("postId", "provider", "createdAt");

-- CreateIndex
CREATE INDEX "PublishLog_status_createdAt_idx" ON "PublishLog"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PublishLog_provider_createdAt_idx" ON "PublishLog"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "PublishLog_postId_createdAt_idx" ON "PublishLog"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "Analytics_postId_provider_capturedAt_idx" ON "Analytics"("postId", "provider", "capturedAt");

-- CreateIndex
CREATE INDEX "Analytics_channelId_capturedAt_idx" ON "Analytics"("channelId", "capturedAt");

-- CreateIndex
CREATE INDEX "Analytics_provider_capturedAt_idx" ON "Analytics"("provider", "capturedAt");

-- CreateIndex
CREATE INDEX "Analytics_channelId_provider_capturedAt_idx" ON "Analytics"("channelId", "provider", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Thread_postId_key" ON "Thread"("postId");

-- CreateIndex
CREATE INDEX "Thread_strategy_idx" ON "Thread"("strategy");

-- CreateIndex
CREATE INDEX "Thread_createdAt_idx" ON "Thread"("createdAt");

-- CreateIndex
CREATE INDEX "Thread_updatedAt_idx" ON "Thread"("updatedAt");

-- CreateIndex
CREATE INDEX "Tweet_threadId_status_idx" ON "Tweet"("threadId", "status");

-- CreateIndex
CREATE INDEX "Tweet_tweetId_idx" ON "Tweet"("tweetId");

-- CreateIndex
CREATE INDEX "Tweet_status_idx" ON "Tweet"("status");

-- CreateIndex
CREATE INDEX "Tweet_publishedAt_idx" ON "Tweet"("publishedAt");

-- CreateIndex
CREATE INDEX "Tweet_createdAt_idx" ON "Tweet"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Tweet_threadId_sequenceNumber_key" ON "Tweet"("threadId", "sequenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_accountId_isActive_idx" ON "ApiKey"("accountId", "isActive");

-- CreateIndex
CREATE INDEX "ApiKey_expiresAt_idx" ON "ApiKey"("expiresAt");

-- CreateIndex
CREATE INDEX "ApiKey_lastUsedAt_idx" ON "ApiKey"("lastUsedAt");

-- CreateIndex
CREATE INDEX "ProviderConnection_accountId_isActive_idx" ON "ProviderConnection"("accountId", "isActive");

-- CreateIndex
CREATE INDEX "ProviderConnection_projectId_isActive_idx" ON "ProviderConnection"("projectId", "isActive");

-- CreateIndex
CREATE INDEX "ProviderConnection_providerId_status_idx" ON "ProviderConnection"("providerId", "status");

-- CreateIndex
CREATE INDEX "ProviderConnection_expiresAt_idx" ON "ProviderConnection"("expiresAt");

-- CreateIndex
CREATE INDEX "ProviderConnection_lastUsedAt_idx" ON "ProviderConnection"("lastUsedAt");

-- CreateIndex
CREATE INDEX "ProviderConnection_healthScore_idx" ON "ProviderConnection"("healthScore");

-- CreateIndex
CREATE INDEX "ProviderConnection_createdAt_idx" ON "ProviderConnection"("createdAt");

-- CreateIndex
CREATE INDEX "ProviderConnection_updatedAt_idx" ON "ProviderConnection"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderConnection_accountId_projectId_providerId_key" ON "ProviderConnection"("accountId", "projectId", "providerId");

-- CreateIndex
CREATE INDEX "ContentTemplate_accountId_isActive_idx" ON "ContentTemplate"("accountId", "isActive");

-- CreateIndex
CREATE INDEX "ContentTemplate_projectId_isActive_idx" ON "ContentTemplate"("projectId", "isActive");

-- CreateIndex
CREATE INDEX "ContentTemplate_category_idx" ON "ContentTemplate"("category");

-- CreateIndex
CREATE INDEX "ContentTemplate_tags_idx" ON "ContentTemplate"("tags");

-- CreateIndex
CREATE INDEX "ContentTemplate_usageCount_idx" ON "ContentTemplate"("usageCount");

-- CreateIndex
CREATE INDEX "ContentTemplate_lastUsedAt_idx" ON "ContentTemplate"("lastUsedAt");

-- CreateIndex
CREATE INDEX "ContentTemplate_parentId_version_idx" ON "ContentTemplate"("parentId", "version");

-- CreateIndex
CREATE INDEX "PublishingQueue_accountId_status_idx" ON "PublishingQueue"("accountId", "status");

-- CreateIndex
CREATE INDEX "PublishingQueue_projectId_status_idx" ON "PublishingQueue"("projectId", "status");

-- CreateIndex
CREATE INDEX "PublishingQueue_scheduledAt_status_idx" ON "PublishingQueue"("scheduledAt", "status");

-- CreateIndex
CREATE INDEX "PublishingQueue_status_createdAt_idx" ON "PublishingQueue"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PublishingQueue_providers_idx" ON "PublishingQueue"("providers");

-- CreateIndex
CREATE INDEX "PublishingQueue_parentQueueId_sequenceNumber_idx" ON "PublishingQueue"("parentQueueId", "sequenceNumber");

-- CreateIndex
CREATE INDEX "PublishingQueue_contentType_idx" ON "PublishingQueue"("contentType");

-- CreateIndex
CREATE INDEX "PublishingQueue_priority_idx" ON "PublishingQueue"("priority");

-- CreateIndex
CREATE INDEX "PublishingQueue_storyProjectId_idx" ON "PublishingQueue"("storyProjectId");

-- CreateIndex
CREATE INDEX "PublishingQueue_videoProcessingJobId_idx" ON "PublishingQueue"("videoProcessingJobId");

-- CreateIndex
CREATE INDEX "PublishingQueue_createdAt_idx" ON "PublishingQueue"("createdAt");

-- CreateIndex
CREATE INDEX "PublishingQueue_updatedAt_idx" ON "PublishingQueue"("updatedAt");

-- CreateIndex
CREATE INDEX "PublishingQueue_completedAt_idx" ON "PublishingQueue"("completedAt");

-- CreateIndex
CREATE INDEX "ContentVersion_templateId_idx" ON "ContentVersion"("templateId");

-- CreateIndex
CREATE INDEX "ContentVersion_queueId_idx" ON "ContentVersion"("queueId");

-- CreateIndex
CREATE INDEX "ContentVersion_changeType_idx" ON "ContentVersion"("changeType");

-- CreateIndex
CREATE INDEX "ContentVersion_createdBy_idx" ON "ContentVersion"("createdBy");

-- CreateIndex
CREATE INDEX "ContentVersion_approvedAt_idx" ON "ContentVersion"("approvedAt");

-- CreateIndex
CREATE INDEX "ContentVersion_createdAt_idx" ON "ContentVersion"("createdAt");

-- CreateIndex
CREATE INDEX "ContentVersion_updatedAt_idx" ON "ContentVersion"("updatedAt");

-- CreateIndex
CREATE INDEX "ContentVersion_postId_createdAt_idx" ON "ContentVersion"("postId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContentVersion_postId_version_key" ON "ContentVersion"("postId", "version");

-- CreateIndex
CREATE INDEX "InstagramStoryProject_accountId_status_idx" ON "InstagramStoryProject"("accountId", "status");

-- CreateIndex
CREATE INDEX "InstagramStoryProject_projectId_status_idx" ON "InstagramStoryProject"("projectId", "status");

-- CreateIndex
CREATE INDEX "InstagramStoryProject_scheduledAt_status_idx" ON "InstagramStoryProject"("scheduledAt", "status");

-- CreateIndex
CREATE INDEX "InstagramStoryProject_status_createdAt_idx" ON "InstagramStoryProject"("status", "createdAt");

-- CreateIndex
CREATE INDEX "InstagramStoryProject_createdAt_idx" ON "InstagramStoryProject"("createdAt");

-- CreateIndex
CREATE INDEX "InstagramStoryProject_updatedAt_idx" ON "InstagramStoryProject"("updatedAt");

-- CreateIndex
CREATE INDEX "InstagramStory_status_idx" ON "InstagramStory"("status");

-- CreateIndex
CREATE INDEX "InstagramStory_publishedAt_idx" ON "InstagramStory"("publishedAt");

-- CreateIndex
CREATE INDEX "InstagramStory_expiresAt_idx" ON "InstagramStory"("expiresAt");

-- CreateIndex
CREATE INDEX "InstagramStory_createdAt_idx" ON "InstagramStory"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramStory_storyProjectId_sequence_key" ON "InstagramStory"("storyProjectId", "sequence");

-- CreateIndex
CREATE INDEX "VideoProcessingJob_accountId_status_idx" ON "VideoProcessingJob"("accountId", "status");

-- CreateIndex
CREATE INDEX "VideoProcessingJob_projectId_status_idx" ON "VideoProcessingJob"("projectId", "status");

-- CreateIndex
CREATE INDEX "VideoProcessingJob_status_createdAt_idx" ON "VideoProcessingJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "VideoProcessingJob_targetContentType_idx" ON "VideoProcessingJob"("targetContentType");

-- CreateIndex
CREATE INDEX "VideoProcessingJob_createdAt_idx" ON "VideoProcessingJob"("createdAt");

-- CreateIndex
CREATE INDEX "VideoProcessingJob_updatedAt_idx" ON "VideoProcessingJob"("updatedAt");

-- CreateIndex
CREATE INDEX "VideoSegment_status_idx" ON "VideoSegment"("status");

-- CreateIndex
CREATE INDEX "VideoSegment_publishedAt_idx" ON "VideoSegment"("publishedAt");

-- CreateIndex
CREATE INDEX "VideoSegment_createdAt_idx" ON "VideoSegment"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VideoSegment_processingJobId_sequence_key" ON "VideoSegment"("processingJobId", "sequence");

-- CreateIndex
CREATE INDEX "InstagramAnalytics_accountId_contentType_idx" ON "InstagramAnalytics"("accountId", "contentType");

-- CreateIndex
CREATE INDEX "InstagramAnalytics_projectId_contentType_idx" ON "InstagramAnalytics"("projectId", "contentType");

-- CreateIndex
CREATE INDEX "InstagramAnalytics_contentType_contentId_idx" ON "InstagramAnalytics"("contentType", "contentId");

-- CreateIndex
CREATE INDEX "InstagramAnalytics_instagramId_idx" ON "InstagramAnalytics"("instagramId");

-- CreateIndex
CREATE INDEX "InstagramAnalytics_capturedAt_idx" ON "InstagramAnalytics"("capturedAt");

-- CreateIndex
CREATE INDEX "InstagramAnalytics_createdAt_idx" ON "InstagramAnalytics"("createdAt");

-- CreateIndex
CREATE INDEX "InstagramAnalytics_updatedAt_idx" ON "InstagramAnalytics"("updatedAt");

-- CreateIndex
CREATE INDEX "SchedulingRule_accountId_isActive_idx" ON "SchedulingRule"("accountId", "isActive");

-- CreateIndex
CREATE INDEX "SchedulingRule_projectId_isActive_idx" ON "SchedulingRule"("projectId", "isActive");

-- CreateIndex
CREATE INDEX "SchedulingRule_contentTypes_idx" ON "SchedulingRule"("contentTypes");

-- CreateIndex
CREATE INDEX "SchedulingRule_platforms_idx" ON "SchedulingRule"("platforms");

-- CreateIndex
CREATE INDEX "SchedulingRule_createdAt_idx" ON "SchedulingRule"("createdAt");

-- CreateIndex
CREATE INDEX "SchedulingRule_updatedAt_idx" ON "SchedulingRule"("updatedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_provider_eventType_idx" ON "WebhookEvent"("provider", "eventType");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_nextRetryAt_idx" ON "WebhookEvent"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_accountId_provider_idx" ON "WebhookEvent"("accountId", "provider");

-- CreateIndex
CREATE INDEX "WebhookEvent_receivedAt_idx" ON "WebhookEvent"("receivedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_processed_status_idx" ON "WebhookEvent"("processed", "status");

-- CreateIndex
CREATE INDEX "WebhookEvent_channelId_eventType_idx" ON "WebhookEvent"("channelId", "eventType");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_provider_eventId_key" ON "WebhookEvent"("provider", "eventId");

-- CreateIndex
CREATE INDEX "WebhookSubscription_provider_isActive_idx" ON "WebhookSubscription"("provider", "isActive");

-- CreateIndex
CREATE INDEX "WebhookSubscription_expiresAt_idx" ON "WebhookSubscription"("expiresAt");

-- CreateIndex
CREATE INDEX "WebhookSubscription_lastEventAt_idx" ON "WebhookSubscription"("lastEventAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookSubscription_accountId_provider_projectId_key" ON "WebhookSubscription"("accountId", "provider", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDeadLetter_originalEventId_key" ON "WebhookDeadLetter"("originalEventId");

-- CreateIndex
CREATE INDEX "WebhookDeadLetter_provider_eventType_idx" ON "WebhookDeadLetter"("provider", "eventType");

-- CreateIndex
CREATE INDEX "WebhookDeadLetter_firstFailedAt_idx" ON "WebhookDeadLetter"("firstFailedAt");

-- CreateIndex
CREATE INDEX "WebhookDeadLetter_resolvedAt_idx" ON "WebhookDeadLetter"("resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxDeadLetter_originalEventId_key" ON "OutboxDeadLetter"("originalEventId");

-- CreateIndex
CREATE INDEX "OutboxDeadLetter_resolvedAt_idx" ON "OutboxDeadLetter"("resolvedAt");

-- CreateIndex
CREATE INDEX "Template_projectId_isActive_idx" ON "Template"("projectId", "isActive");

-- CreateIndex
CREATE INDEX "Template_accountId_isActive_idx" ON "Template"("accountId", "isActive");

-- CreateIndex
CREATE INDEX "Template_category_idx" ON "Template"("category");

-- CreateIndex
CREATE INDEX "Template_platforms_idx" ON "Template"("platforms");

-- CreateIndex
CREATE INDEX "Template_tags_idx" ON "Template"("tags");

-- CreateIndex
CREATE INDEX "Template_deletedAt_idx" ON "Template"("deletedAt");

-- CreateIndex
CREATE INDEX "TemplateVersion_templateId_isActive_idx" ON "TemplateVersion"("templateId", "isActive");

-- CreateIndex
CREATE INDEX "TemplateVersion_templateId_branchName_idx" ON "TemplateVersion"("templateId", "branchName");

-- CreateIndex
CREATE INDEX "TemplateVersion_parentVersionId_idx" ON "TemplateVersion"("parentVersionId");

-- CreateIndex
CREATE INDEX "TemplateVersion_createdAt_idx" ON "TemplateVersion"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateVersion_templateId_version_key" ON "TemplateVersion"("templateId", "version");

-- CreateIndex
CREATE INDEX "ABTest_templateId_status_idx" ON "ABTest"("templateId", "status");

-- CreateIndex
CREATE INDEX "ABTest_status_startDate_endDate_idx" ON "ABTest"("status", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "ABTest_createdAt_idx" ON "ABTest"("createdAt");

-- CreateIndex
CREATE INDEX "TemplateUsageEvent_templateId_action_idx" ON "TemplateUsageEvent"("templateId", "action");

-- CreateIndex
CREATE INDEX "TemplateUsageEvent_templateId_timestamp_idx" ON "TemplateUsageEvent"("templateId", "timestamp");

-- CreateIndex
CREATE INDEX "TemplateUsageEvent_action_timestamp_idx" ON "TemplateUsageEvent"("action", "timestamp");

-- CreateIndex
CREATE INDEX "TemplateUsageEvent_variantId_idx" ON "TemplateUsageEvent"("variantId");

-- CreateIndex
CREATE INDEX "TemplateComponent_type_idx" ON "TemplateComponent"("type");

-- CreateIndex
CREATE INDEX "TemplateComponent_isReusable_idx" ON "TemplateComponent"("isReusable");

-- CreateIndex
CREATE INDEX "TemplateComponent_platforms_idx" ON "TemplateComponent"("platforms");

-- CreateIndex
CREATE INDEX "TemplateComponent_createdAt_idx" ON "TemplateComponent"("createdAt");

-- CreateIndex
CREATE INDEX "TemplateComponentUsage_templateId_idx" ON "TemplateComponentUsage"("templateId");

-- CreateIndex
CREATE INDEX "TemplateComponentUsage_componentId_idx" ON "TemplateComponentUsage"("componentId");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateComponentUsage_templateId_componentId_position_key" ON "TemplateComponentUsage"("templateId", "componentId", "position");

-- CreateIndex
CREATE INDEX "TemplateCommit_templateId_branch_idx" ON "TemplateCommit"("templateId", "branch");

-- CreateIndex
CREATE INDEX "TemplateCommit_parentCommitId_idx" ON "TemplateCommit"("parentCommitId");

-- CreateIndex
CREATE INDEX "TemplateCommit_createdAt_idx" ON "TemplateCommit"("createdAt");

-- CreateIndex
CREATE INDEX "TemplateCollaboration_templateId_idx" ON "TemplateCollaboration"("templateId");

-- CreateIndex
CREATE INDEX "TemplateCollaboration_userId_idx" ON "TemplateCollaboration"("userId");

-- CreateIndex
CREATE INDEX "TemplateCollaboration_role_idx" ON "TemplateCollaboration"("role");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateCollaboration_templateId_userId_key" ON "TemplateCollaboration"("templateId", "userId");

-- CreateIndex
CREATE INDEX "TemplateAnalytics_templateId_idx" ON "TemplateAnalytics"("templateId");

-- CreateIndex
CREATE INDEX "TemplateAnalytics_period_startDate_idx" ON "TemplateAnalytics"("period", "startDate");

-- CreateIndex
CREATE INDEX "TemplateAnalytics_createdAt_idx" ON "TemplateAnalytics"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateAnalytics_templateId_period_startDate_key" ON "TemplateAnalytics"("templateId", "period", "startDate");

-- CreateIndex
CREATE INDEX "OutboxEvent_publishedAt_nextRetryAt_idx" ON "OutboxEvent"("publishedAt", "nextRetryAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_aggregateId_aggregateType_idx" ON "OutboxEvent"("aggregateId", "aggregateType");

-- CreateIndex
CREATE INDEX "OutboxEvent_eventType_idx" ON "OutboxEvent"("eventType");

-- CreateIndex
CREATE INDEX "OutboxEvent_createdAt_idx" ON "OutboxEvent"("createdAt");

-- CreateIndex
CREATE INDEX "SagaInstance_status_startedAt_idx" ON "SagaInstance"("status", "startedAt");

-- CreateIndex
CREATE INDEX "SagaInstance_definitionId_status_idx" ON "SagaInstance"("definitionId", "status");

-- CreateIndex
CREATE INDEX "SagaInstance_accountId_status_idx" ON "SagaInstance"("accountId", "status");

-- CreateIndex
CREATE INDEX "SagaInstance_completedAt_idx" ON "SagaInstance"("completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SocialMessage_webhookEventId_key" ON "SocialMessage"("webhookEventId");

-- CreateIndex
CREATE INDEX "SocialMessage_accountId_projectId_status_idx" ON "SocialMessage"("accountId", "projectId", "status");

-- CreateIndex
CREATE INDEX "SocialMessage_conversationId_idx" ON "SocialMessage"("conversationId");

-- CreateIndex
CREATE INDEX "SocialMessage_channelId_messageType_idx" ON "SocialMessage"("channelId", "messageType");

-- CreateIndex
CREATE INDEX "SocialMessage_assigneeId_status_idx" ON "SocialMessage"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "SocialMessage_providerCreatedAt_idx" ON "SocialMessage"("providerCreatedAt");

-- CreateIndex
CREATE INDEX "SocialMessage_relatedPostId_idx" ON "SocialMessage"("relatedPostId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialMessage_provider_providerMessageId_key" ON "SocialMessage"("provider", "providerMessageId");

-- CreateIndex
CREATE INDEX "SocialConversation_accountId_projectId_isResolved_idx" ON "SocialConversation"("accountId", "projectId", "isResolved");

-- CreateIndex
CREATE INDEX "SocialConversation_channelId_provider_idx" ON "SocialConversation"("channelId", "provider");

-- CreateIndex
CREATE INDEX "SocialConversation_lastMessageAt_idx" ON "SocialConversation"("lastMessageAt");

-- CreateIndex
CREATE INDEX "ConversationNote_conversationId_idx" ON "ConversationNote"("conversationId");

-- CreateIndex
CREATE INDEX "ConversationNote_authorId_idx" ON "ConversationNote"("authorId");

-- CreateIndex
CREATE INDEX "SocialOutboundReply_socialMessageId_idx" ON "SocialOutboundReply"("socialMessageId");

-- CreateIndex
CREATE INDEX "SocialOutboundReply_authorId_idx" ON "SocialOutboundReply"("authorId");

-- CreateIndex
CREATE INDEX "SocialOutboundReply_status_idx" ON "SocialOutboundReply"("status");

-- CreateIndex
CREATE INDEX "Campaign_projectId_status_idx" ON "Campaign"("projectId", "status");

-- CreateIndex
CREATE INDEX "Campaign_projectId_createdAt_idx" ON "Campaign"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "CampaignPost_postId_idx" ON "CampaignPost"("postId");

-- CreateIndex
CREATE INDEX "AnalyticsDailySummary_channelId_date_idx" ON "AnalyticsDailySummary"("channelId", "date");

-- CreateIndex
CREATE INDEX "AnalyticsDailySummary_provider_date_idx" ON "AnalyticsDailySummary"("provider", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsDailySummary_postId_channelId_provider_date_key" ON "AnalyticsDailySummary"("postId", "channelId", "provider", "date");

-- CreateIndex
CREATE INDEX "AnalyticsMonthlySummary_channelId_month_idx" ON "AnalyticsMonthlySummary"("channelId", "month");

-- CreateIndex
CREATE INDEX "AnalyticsMonthlySummary_provider_month_idx" ON "AnalyticsMonthlySummary"("provider", "month");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsMonthlySummary_postId_channelId_provider_month_key" ON "AnalyticsMonthlySummary"("postId", "channelId", "provider", "month");

-- CreateIndex
CREATE INDEX "ScheduledReport_projectId_isActive_idx" ON "ScheduledReport"("projectId", "isActive");

-- CreateIndex
CREATE INDEX "ScheduledReport_nextRunAt_isActive_idx" ON "ScheduledReport"("nextRunAt", "isActive");

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

-- CreateIndex
CREATE INDEX "AIPromptTemplate_accountId_idx" ON "AIPromptTemplate"("accountId");

-- CreateIndex
CREATE INDEX "UsageMetric_accountId_periodYear_periodMonth_idx" ON "UsageMetric"("accountId", "periodYear", "periodMonth");

-- CreateIndex
CREATE UNIQUE INDEX "UsageMetric_accountId_periodYear_periodMonth_key" ON "UsageMetric"("accountId", "periodYear", "periodMonth");

-- CreateIndex
CREATE UNIQUE INDEX "BrandVoice_accountId_key" ON "BrandVoice"("accountId");

-- CreateIndex
CREATE INDEX "BrandVoice_accountId_idx" ON "BrandVoice"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "BrandKit_accountId_key" ON "BrandKit"("accountId");

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

-- CreateIndex
CREATE UNIQUE INDEX "SamlConfiguration_accountId_key" ON "SamlConfiguration"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "SamlSession_relayState_key" ON "SamlSession"("relayState");

-- CreateIndex
CREATE INDEX "SamlSession_relayState_idx" ON "SamlSession"("relayState");

-- CreateIndex
CREATE INDEX "SamlSession_expiresAt_idx" ON "SamlSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "OidcConfiguration_accountId_key" ON "OidcConfiguration"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomReport_shareToken_key" ON "CustomReport"("shareToken");

-- CreateIndex
CREATE INDEX "CustomReport_accountId_idx" ON "CustomReport"("accountId");

-- CreateIndex
CREATE INDEX "CustomReport_createdById_idx" ON "CustomReport"("createdById");

-- CreateIndex
CREATE INDEX "ReportSchedule_reportId_idx" ON "ReportSchedule"("reportId");

-- CreateIndex
CREATE INDEX "ReportSchedule_nextRunAt_idx" ON "ReportSchedule"("nextRunAt");

-- CreateIndex
CREATE INDEX "CrmConnection_accountId_idx" ON "CrmConnection"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmConnection_accountId_platform_key" ON "CrmConnection"("accountId", "platform");

-- CreateIndex
CREATE INDEX "CrmContact_accountId_idx" ON "CrmContact"("accountId");

-- CreateIndex
CREATE INDEX "CrmContact_email_idx" ON "CrmContact"("email");

-- CreateIndex
CREATE UNIQUE INDEX "CrmContact_accountId_platform_externalId_key" ON "CrmContact"("accountId", "platform", "externalId");

-- CreateIndex
CREATE INDEX "CrmActivity_accountId_syncedAt_idx" ON "CrmActivity"("accountId", "syncedAt");

-- CreateIndex
CREATE INDEX "CrmActivity_contactEmail_idx" ON "CrmActivity"("contactEmail");

-- CreateIndex
CREATE INDEX "CrmSyncLog_connectionId_idx" ON "CrmSyncLog"("connectionId");

-- CreateIndex
CREATE INDEX "MediaAsset_accountId_idx" ON "MediaAsset"("accountId");

-- CreateIndex
CREATE INDEX "MediaAsset_projectId_idx" ON "MediaAsset"("projectId");

-- CreateIndex
CREATE INDEX "MediaAsset_folderId_idx" ON "MediaAsset"("folderId");

-- CreateIndex
CREATE INDEX "MediaAsset_mimeType_idx" ON "MediaAsset"("mimeType");

-- CreateIndex
CREATE INDEX "MediaAsset_deletedAt_idx" ON "MediaAsset"("deletedAt");

-- CreateIndex
CREATE INDEX "AssetFolder_accountId_idx" ON "AssetFolder"("accountId");

-- CreateIndex
CREATE INDEX "AssetFolder_parentId_idx" ON "AssetFolder"("parentId");

-- CreateIndex
CREATE INDEX "AssetTag_accountId_idx" ON "AssetTag"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetTag_accountId_name_key" ON "AssetTag"("accountId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderPricingTier_minProviders_isActive_key" ON "ProviderPricingTier"("minProviders", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "AccountPricingTier_minAccounts_isActive_key" ON "AccountPricingTier"("minAccounts", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderBundle_slug_key" ON "ProviderBundle"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "BundleFeatureFlag_bundleId_featureKey_key" ON "BundleFeatureFlag"("bundleId", "featureKey");

-- CreateIndex
CREATE UNIQUE INDEX "AccountSubscription_accountId_key" ON "AccountSubscription"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountSubscription_gatewaySubscriptionId_key" ON "AccountSubscription"("gatewaySubscriptionId");

-- CreateIndex
CREATE INDEX "AccountSubscription_status_idx" ON "AccountSubscription"("status");

-- CreateIndex
CREATE INDEX "SubscriptionPriceHistory_subscriptionId_idx" ON "SubscriptionPriceHistory"("subscriptionId");

-- CreateIndex
CREATE INDEX "GatewaySwitchEvent_accountId_idx" ON "GatewaySwitchEvent"("accountId");

-- CreateIndex
CREATE INDEX "GatewaySwitchEvent_status_idx" ON "GatewaySwitchEvent"("status");

-- CreateIndex
CREATE INDEX "GatewaySwitchEvent_scheduledFor_idx" ON "GatewaySwitchEvent"("scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "BillingEvent_gatewayEventId_key" ON "BillingEvent"("gatewayEventId");

-- CreateIndex
CREATE INDEX "BillingEvent_gatewayProvider_createdAt_idx" ON "BillingEvent"("gatewayProvider", "createdAt");

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

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCode_accountId_key" ON "ReferralCode"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralCode_code_key" ON "ReferralCode"("code");

-- CreateIndex
CREATE INDEX "Referral_referralCodeId_idx" ON "Referral"("referralCodeId");

-- CreateIndex
CREATE INDEX "Referral_referredAccountId_idx" ON "Referral"("referredAccountId");

-- CreateIndex
CREATE INDEX "RepurposeProposal_accountId_status_idx" ON "RepurposeProposal"("accountId", "status");

-- CreateIndex
CREATE INDEX "RepurposeProposal_sourcePostId_idx" ON "RepurposeProposal"("sourcePostId");

-- CreateIndex
CREATE INDEX "RepurposeVariant_proposalId_idx" ON "RepurposeVariant"("proposalId");

-- CreateIndex
CREATE INDEX "TrendRadarResult_accountId_expiresAt_idx" ON "TrendRadarResult"("accountId", "expiresAt");

-- CreateIndex
CREATE INDEX "PlatformCredential_group_idx" ON "PlatformCredential"("group");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformCredential_group_key_key" ON "PlatformCredential"("group", "key");

-- CreateIndex
CREATE INDEX "AccountCredential_accountId_group_idx" ON "AccountCredential"("accountId", "group");

-- CreateIndex
CREATE UNIQUE INDEX "AccountCredential_accountId_group_key_key" ON "AccountCredential"("accountId", "group", "key");

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminUser" ADD CONSTRAINT "AdminUser_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminSession" ADD CONSTRAINT "AdminSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminUserPermission" ADD CONSTRAINT "AdminUserPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminRoleHistory" ADD CONSTRAINT "AdminRoleHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerUser" ADD CONSTRAINT "CustomerUser_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalWorkflow" ADD CONSTRAINT "ApprovalWorkflow_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalWorkflowLevel" ADD CONSTRAINT "ApprovalWorkflowLevel_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "ApprovalWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_submitterId_fkey" FOREIGN KEY ("submitterId") REFERENCES "TeamMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "ApprovalWorkflow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalReview" ADD CONSTRAINT "ApprovalReview_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalReview" ADD CONSTRAINT "ApprovalReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "TeamMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "TeamMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "TeamMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "PostComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminLoginAttempt" ADD CONSTRAINT "AdminLoginAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostContent" ADD CONSTRAINT "PostContent_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostMedia" ADD CONSTRAINT "PostMedia_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackedLink" ADD CONSTRAINT "TrackedLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkClick" ADD CONSTRAINT "LinkClick_trackedLinkId_fkey" FOREIGN KEY ("trackedLinkId") REFERENCES "TrackedLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishLog" ADD CONSTRAINT "PublishLog_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishLog" ADD CONSTRAINT "PublishLog_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analytics" ADD CONSTRAINT "Analytics_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Analytics" ADD CONSTRAINT "Analytics_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Thread" ADD CONSTRAINT "Thread_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tweet" ADD CONSTRAINT "Tweet_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "Thread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderConnection" ADD CONSTRAINT "ProviderConnection_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderConnection" ADD CONSTRAINT "ProviderConnection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentTemplate" ADD CONSTRAINT "ContentTemplate_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentTemplate" ADD CONSTRAINT "ContentTemplate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentTemplate" ADD CONSTRAINT "ContentTemplate_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ContentTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishingQueue" ADD CONSTRAINT "PublishingQueue_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishingQueue" ADD CONSTRAINT "PublishingQueue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishingQueue" ADD CONSTRAINT "PublishingQueue_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishingQueue" ADD CONSTRAINT "PublishingQueue_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ContentTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishingQueue" ADD CONSTRAINT "PublishingQueue_parentQueueId_fkey" FOREIGN KEY ("parentQueueId") REFERENCES "PublishingQueue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishingQueue" ADD CONSTRAINT "PublishingQueue_storyProjectId_fkey" FOREIGN KEY ("storyProjectId") REFERENCES "InstagramStoryProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublishingQueue" ADD CONSTRAINT "PublishingQueue_videoProcessingJobId_fkey" FOREIGN KEY ("videoProcessingJobId") REFERENCES "VideoProcessingJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentVersion" ADD CONSTRAINT "ContentVersion_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentVersion" ADD CONSTRAINT "ContentVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ContentTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentVersion" ADD CONSTRAINT "ContentVersion_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "PublishingQueue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramStoryProject" ADD CONSTRAINT "InstagramStoryProject_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramStoryProject" ADD CONSTRAINT "InstagramStoryProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramStory" ADD CONSTRAINT "InstagramStory_storyProjectId_fkey" FOREIGN KEY ("storyProjectId") REFERENCES "InstagramStoryProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramStory" ADD CONSTRAINT "InstagramStory_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "PostMedia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoProcessingJob" ADD CONSTRAINT "VideoProcessingJob_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoProcessingJob" ADD CONSTRAINT "VideoProcessingJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoProcessingJob" ADD CONSTRAINT "VideoProcessingJob_originalMediaId_fkey" FOREIGN KEY ("originalMediaId") REFERENCES "PostMedia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoSegment" ADD CONSTRAINT "VideoSegment_processingJobId_fkey" FOREIGN KEY ("processingJobId") REFERENCES "VideoProcessingJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramAnalytics" ADD CONSTRAINT "InstagramAnalytics_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstagramAnalytics" ADD CONSTRAINT "InstagramAnalytics_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulingRule" ADD CONSTRAINT "SchedulingRule_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchedulingRule" ADD CONSTRAINT "SchedulingRule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookSubscription" ADD CONSTRAINT "WebhookSubscription_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookSubscription" ADD CONSTRAINT "WebhookSubscription_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateVersion" ADD CONSTRAINT "TemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateVersion" ADD CONSTRAINT "TemplateVersion_parentVersionId_fkey" FOREIGN KEY ("parentVersionId") REFERENCES "TemplateVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ABTest" ADD CONSTRAINT "ABTest_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateUsageEvent" ADD CONSTRAINT "TemplateUsageEvent_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateComponentUsage" ADD CONSTRAINT "TemplateComponentUsage_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateComponentUsage" ADD CONSTRAINT "TemplateComponentUsage_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "TemplateComponent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateCommit" ADD CONSTRAINT "TemplateCommit_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateCommit" ADD CONSTRAINT "TemplateCommit_parentCommitId_fkey" FOREIGN KEY ("parentCommitId") REFERENCES "TemplateCommit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateCollaboration" ADD CONSTRAINT "TemplateCollaboration_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateAnalytics" ADD CONSTRAINT "TemplateAnalytics_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMessage" ADD CONSTRAINT "SocialMessage_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMessage" ADD CONSTRAINT "SocialMessage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMessage" ADD CONSTRAINT "SocialMessage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMessage" ADD CONSTRAINT "SocialMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SocialConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMessage" ADD CONSTRAINT "SocialMessage_webhookEventId_fkey" FOREIGN KEY ("webhookEventId") REFERENCES "WebhookEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMessage" ADD CONSTRAINT "SocialMessage_relatedPostId_fkey" FOREIGN KEY ("relatedPostId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialMessage" ADD CONSTRAINT "SocialMessage_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialConversation" ADD CONSTRAINT "SocialConversation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialConversation" ADD CONSTRAINT "SocialConversation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialConversation" ADD CONSTRAINT "SocialConversation_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialConversation" ADD CONSTRAINT "SocialConversation_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationNote" ADD CONSTRAINT "ConversationNote_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SocialConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationNote" ADD CONSTRAINT "ConversationNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "TeamMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialOutboundReply" ADD CONSTRAINT "SocialOutboundReply_socialMessageId_fkey" FOREIGN KEY ("socialMessageId") REFERENCES "SocialMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialOutboundReply" ADD CONSTRAINT "SocialOutboundReply_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "TeamMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignPost" ADD CONSTRAINT "CampaignPost_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignPost" ADD CONSTRAINT "CampaignPost_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledReport" ADD CONSTRAINT "ScheduledReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalNotificationConfig" ADD CONSTRAINT "ExternalNotificationConfig_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FirstComment" ADD CONSTRAINT "FirstComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedImage" ADD CONSTRAINT "GeneratedImage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringPost" ADD CONSTRAINT "RecurringPost_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIPromptTemplate" ADD CONSTRAINT "AIPromptTemplate_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageMetric" ADD CONSTRAINT "UsageMetric_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandVoice" ADD CONSTRAINT "BrandVoice_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandKit" ADD CONSTRAINT "BrandKit_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationApiKey" ADD CONSTRAINT "IntegrationApiKey_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationSubscription" ADD CONSTRAINT "IntegrationSubscription_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SamlConfiguration" ADD CONSTRAINT "SamlConfiguration_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OidcConfiguration" ADD CONSTRAINT "OidcConfiguration_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomReport" ADD CONSTRAINT "CustomReport_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomReport" ADD CONSTRAINT "CustomReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "CustomReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmConnection" ADD CONSTRAINT "CrmConnection_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmActivity" ADD CONSTRAINT "CrmActivity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmSyncLog" ADD CONSTRAINT "CrmSyncLog_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "CrmConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "AssetFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetFolder" ADD CONSTRAINT "AssetFolder_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetFolder" ADD CONSTRAINT "AssetFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "AssetFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetTag" ADD CONSTRAINT "AssetTag_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetTagOnAsset" ADD CONSTRAINT "AssetTagOnAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetTagOnAsset" ADD CONSTRAINT "AssetTagOnAsset_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "AssetTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleFeatureFlag" ADD CONSTRAINT "BundleFeatureFlag_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "ProviderBundle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountSubscription" ADD CONSTRAINT "AccountSubscription_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountSubscription" ADD CONSTRAINT "AccountSubscription_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "ProviderBundle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPriceHistory" ADD CONSTRAINT "SubscriptionPriceHistory_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "AccountSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatewaySwitchEvent" ADD CONSTRAINT "GatewaySwitchEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingEvent" ADD CONSTRAINT "BillingEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DsarRequest" ADD CONSTRAINT "DsarRequest_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralCode" ADD CONSTRAINT "ReferralCode_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referralCodeId_fkey" FOREIGN KEY ("referralCodeId") REFERENCES "ReferralCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepurposeProposal" ADD CONSTRAINT "RepurposeProposal_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepurposeProposal" ADD CONSTRAINT "RepurposeProposal_sourcePostId_fkey" FOREIGN KEY ("sourcePostId") REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepurposeVariant" ADD CONSTRAINT "RepurposeVariant_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "RepurposeProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepurposeVariant" ADD CONSTRAINT "RepurposeVariant_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrendRadarResult" ADD CONSTRAINT "TrendRadarResult_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountCredential" ADD CONSTRAINT "AccountCredential_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

