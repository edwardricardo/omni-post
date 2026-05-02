-- B3 PR-4: publishing core family — DateTime → TIMESTAMPTZ(6) migration.
--
-- Affected models (19): Project, Post, PostContent, PostMedia, Channel,
-- PublishLog, PublishingQueue, Thread, Tweet, ProviderConnection,
-- ContentTemplate, ContentVersion, PostComment, Task, RecurringPost,
-- SchedulingRule, Campaign, CampaignPost, TrackedLink, LinkClick.
--
-- 66 columns flipped. Scheduling, publishing, content lifecycle,
-- recurrence windows, campaign date ranges — all UTC instants.
--
-- Note: RecurringPost.startDate/endDate represent the activation window of
-- a recurring schedule (UTC instants when it becomes active/inactive); the
-- actual fire-time computation uses cronExpression + timezone fields.
-- These are NOT wall-clock semantics — they are moments in time.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL TIMEZONE = 'UTC';

-- AlterTable
ALTER TABLE "Campaign" ALTER COLUMN "startDate" TYPE TIMESTAMPTZ(6) USING "startDate" AT TIME ZONE 'UTC',
ALTER COLUMN "endDate" TYPE TIMESTAMPTZ(6) USING "endDate" AT TIME ZONE 'UTC',
ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "CampaignPost" ALTER COLUMN "taggedAt" TYPE TIMESTAMPTZ(6) USING "taggedAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "Channel" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "deletedAt" TYPE TIMESTAMPTZ(6) USING "deletedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "authFailedAt" TYPE TIMESTAMPTZ(6) USING "authFailedAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "ContentTemplate" ALTER COLUMN "lastUsedAt" TYPE TIMESTAMPTZ(6) USING "lastUsedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "ContentVersion" ALTER COLUMN "approvedAt" TYPE TIMESTAMPTZ(6) USING "approvedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "LinkClick" ALTER COLUMN "timestamp" TYPE TIMESTAMPTZ(6) USING "timestamp" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "Post" ALTER COLUMN "scheduledAt" TYPE TIMESTAMPTZ(6) USING "scheduledAt" AT TIME ZONE 'UTC',
ALTER COLUMN "publishedAt" TYPE TIMESTAMPTZ(6) USING "publishedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "deletedAt" TYPE TIMESTAMPTZ(6) USING "deletedAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "PostComment" ALTER COLUMN "editedAt" TYPE TIMESTAMPTZ(6) USING "editedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "deletedAt" TYPE TIMESTAMPTZ(6) USING "deletedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "PostContent" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "PostMedia" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "Project" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "crisisStartedAt" TYPE TIMESTAMPTZ(6) USING "crisisStartedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "deletedAt" TYPE TIMESTAMPTZ(6) USING "deletedAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "ProviderConnection" ALTER COLUMN "connectedAt" TYPE TIMESTAMPTZ(6) USING "connectedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "lastUsedAt" TYPE TIMESTAMPTZ(6) USING "lastUsedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "expiresAt" TYPE TIMESTAMPTZ(6) USING "expiresAt" AT TIME ZONE 'UTC',
ALTER COLUMN "lastHealthCheck" TYPE TIMESTAMPTZ(6) USING "lastHealthCheck" AT TIME ZONE 'UTC',
ALTER COLUMN "lastErrorAt" TYPE TIMESTAMPTZ(6) USING "lastErrorAt" AT TIME ZONE 'UTC',
ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "PublishLog" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "PublishingQueue" ALTER COLUMN "scheduledAt" TYPE TIMESTAMPTZ(6) USING "scheduledAt" AT TIME ZONE 'UTC',
ALTER COLUMN "startedAt" TYPE TIMESTAMPTZ(6) USING "startedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "completedAt" TYPE TIMESTAMPTZ(6) USING "completedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "lastErrorAt" TYPE TIMESTAMPTZ(6) USING "lastErrorAt" AT TIME ZONE 'UTC',
ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "RecurringPost" ALTER COLUMN "startDate" TYPE TIMESTAMPTZ(6) USING "startDate" AT TIME ZONE 'UTC',
ALTER COLUMN "endDate" TYPE TIMESTAMPTZ(6) USING "endDate" AT TIME ZONE 'UTC',
ALTER COLUMN "lastScheduledAt" TYPE TIMESTAMPTZ(6) USING "lastScheduledAt" AT TIME ZONE 'UTC',
ALTER COLUMN "nextScheduledAt" TYPE TIMESTAMPTZ(6) USING "nextScheduledAt" AT TIME ZONE 'UTC',
ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "SchedulingRule" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "Task" ALTER COLUMN "dueDate" TYPE TIMESTAMPTZ(6) USING "dueDate" AT TIME ZONE 'UTC',
ALTER COLUMN "completedAt" TYPE TIMESTAMPTZ(6) USING "completedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "deletedAt" TYPE TIMESTAMPTZ(6) USING "deletedAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "Thread" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "TrackedLink" ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "Tweet" ALTER COLUMN "publishedAt" TYPE TIMESTAMPTZ(6) USING "publishedAt" AT TIME ZONE 'UTC',
ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(6) USING "createdAt" AT TIME ZONE 'UTC',
ALTER COLUMN "updatedAt" TYPE TIMESTAMPTZ(6) USING "updatedAt" AT TIME ZONE 'UTC';
