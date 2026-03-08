-- INSTAGRAM QUERY OPTIMIZATION PATTERNS
-- This file contains optimized query patterns for Instagram features
-- All queries are designed with multi-tenancy and performance in mind

-- ============================================================================
-- STORY PROJECT OPERATIONS
-- ============================================================================

-- 1. Dashboard: Get active story projects for an account
-- Uses index: idx_instagram_story_project_account_status
SELECT
    isp.id,
    isp.name,
    isp.status,
    isp.progress,
    isp.scheduledAt,
    isp.publishedStories,
    isp.failedStories,
    COUNT(is2.id) as totalStories,
    isp.createdAt
FROM "InstagramStoryProject" isp
LEFT JOIN "InstagramStory" is2 ON is2."storyProjectId" = isp.id
WHERE isp."accountId" = $1
    AND isp.status IN ('DRAFT', 'READY', 'SCHEDULED', 'PROCESSING')
GROUP BY isp.id, isp.name, isp.status, isp.progress, isp.scheduledAt,
         isp.publishedStories, isp.failedStories, isp.createdAt
ORDER BY isp."createdAt" DESC
LIMIT 50;

-- 2. Publishing Queue: Get scheduled story projects ready for publishing
-- Uses index: idx_instagram_story_project_scheduled
SELECT id, accountId, projectId, name, scheduledAt
FROM "InstagramStoryProject"
WHERE status = 'SCHEDULED'
    AND "scheduledAt" <= NOW()
    AND "scheduledAt" IS NOT NULL
ORDER BY "scheduledAt" ASC
LIMIT 100;

-- 3. Project Analytics: Get story project performance for a project
-- Uses index: idx_instagram_story_project_metrics
SELECT
    isp.id,
    isp.name,
    isp.publishedStories,
    isp.totalReach,
    isp.totalImpressions,
    AVG(is2.views) as avgViews,
    SUM(is2.replies) as totalReplies,
    isp.completedAt
FROM "InstagramStoryProject" isp
LEFT JOIN "InstagramStory" is2 ON is2."storyProjectId" = isp.id
WHERE isp."projectId" = $1
    AND isp.status = 'PUBLISHED'
    AND isp."completedAt" >= NOW() - INTERVAL '30 days'
GROUP BY isp.id, isp.name, isp.publishedStories, isp.totalReach,
         isp.totalImpressions, isp.completedAt
ORDER BY isp."completedAt" DESC;

-- ============================================================================
-- INDIVIDUAL STORY OPERATIONS
-- ============================================================================

-- 4. Get stories for a project in sequence order
-- Uses index: idx_instagram_story_sequence
SELECT
    id,
    sequence,
    text,
    duration,
    status,
    mediaId,
    processedMediaUrl,
    views,
    replies
FROM "InstagramStory"
WHERE "storyProjectId" = $1
ORDER BY sequence ASC;

-- 5. Story Processing Queue: Get pending stories for processing
-- Uses index: idx_instagram_story_status
SELECT
    is2.id,
    is2."storyProjectId",
    is2.sequence,
    is2.mediaId,
    is2.text,
    isp."accountId",
    isp."projectId"
FROM "InstagramStory" is2
JOIN "InstagramStoryProject" isp ON isp.id = is2."storyProjectId"
WHERE is2.status IN ('PENDING', 'PROCESSING')
ORDER BY is2."createdAt" ASC
LIMIT 20;

-- 6. Expired Stories Cleanup
-- Uses index: idx_instagram_story_expiration
UPDATE "InstagramStory"
SET status = 'EXPIRED'
WHERE status = 'PUBLISHED'
    AND "expiresAt" IS NOT NULL
    AND "expiresAt" <= NOW()
    AND status != 'EXPIRED';

-- ============================================================================
-- VIDEO PROCESSING OPERATIONS
-- ============================================================================

-- 7. Video Processing Queue: Get next jobs to process
-- Uses index: idx_video_processing_queue
SELECT
    vpj.id,
    vpj."accountId",
    vpj."projectId",
    vpj."originalMediaId",
    vpj."originalUrl",
    vpj."targetContentType",
    vpj."splitOptions"
FROM "VideoProcessingJob" vpj
WHERE vpj.status = 'QUEUED'
ORDER BY vpj."createdAt" ASC
LIMIT 5;

-- 8. Monitor Active Video Processing Jobs
-- Uses index: idx_video_processing_active
SELECT
    vpj.id,
    vpj."currentStep",
    vpj.progress,
    vpj."startedAt",
    vpj."targetContentType",
    COUNT(vs.id) as totalSegments,
    SUM(CASE WHEN vs.status = 'READY' THEN 1 ELSE 0 END) as readySegments
FROM "VideoProcessingJob" vpj
LEFT JOIN "VideoSegment" vs ON vs."processingJobId" = vpj.id
WHERE vpj.status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')
    AND vpj."startedAt" IS NOT NULL
GROUP BY vpj.id, vpj."currentStep", vpj.progress, vpj."startedAt", vpj."targetContentType"
ORDER BY vpj."startedAt" ASC;

-- 9. Get processed video segments for publishing
-- Uses index: idx_video_segment_sequence
SELECT
    vs.id,
    vs.sequence,
    vs.url,
    vs.duration,
    vs.width,
    vs.height,
    vs.thumbnailUrl
FROM "VideoSegment" vs
WHERE vs."processingJobId" = $1
    AND vs.status = 'READY'
ORDER BY vs.sequence ASC;

-- ============================================================================
-- ANALYTICS AND REPORTING
-- ============================================================================

-- 10. Instagram Analytics Dashboard
-- Uses index: idx_instagram_analytics_project_content
SELECT
    ia."contentType",
    COUNT(*) as contentCount,
    AVG(ia.impressions) as avgImpressions,
    AVG(ia.reach) as avgReach,
    AVG(ia.likes) as avgLikes,
    SUM(ia.impressions) as totalImpressions,
    SUM(ia.reach) as totalReach
FROM "InstagramAnalytics" ia
WHERE ia."projectId" = $1
    AND ia."capturedAt" >= NOW() - INTERVAL '30 days'
GROUP BY ia."contentType"
ORDER BY totalImpressions DESC;

-- 11. Time-series Analytics for Charts
-- Uses index: idx_instagram_analytics_metrics
SELECT
    DATE_TRUNC('day', ia."capturedAt") as date,
    ia."contentType",
    AVG(ia.impressions) as impressions,
    AVG(ia.reach) as reach,
    AVG(ia.likes) as likes,
    AVG(ia.comments) as comments
FROM "InstagramAnalytics" ia
WHERE ia."projectId" = $1
    AND ia."contentType" = $2
    AND ia."capturedAt" >= NOW() - INTERVAL '90 days'
GROUP BY DATE_TRUNC('day', ia."capturedAt"), ia."contentType"
ORDER BY date ASC;

-- 12. Top Performing Content
-- Uses index: idx_instagram_analytics_content
SELECT
    ia."contentId",
    ia."contentType",
    ia.impressions,
    ia.reach,
    ia.likes,
    ia.comments,
    ia.shares,
    ia.saves,
    (ia.likes + ia.comments + ia.shares + ia.saves)::float / NULLIF(ia.impressions, 0) as engagementRate
FROM "InstagramAnalytics" ia
WHERE ia."projectId" = $1
    AND ia."capturedAt" >= NOW() - INTERVAL '30 days'
ORDER BY engagementRate DESC NULLS LAST
LIMIT 20;

-- ============================================================================
-- PUBLISHING QUEUE OPERATIONS
-- ============================================================================

-- 13. Instagram Publishing Queue with Priority
-- Uses index: idx_publishing_queue_instagram_scheduled
SELECT
    pq.id,
    pq."accountId",
    pq."projectId",
    pq."contentType",
    pq.priority,
    pq."scheduledAt",
    pq.content,
    pq.status
FROM "PublishingQueue" pq
WHERE 'INSTAGRAM'::text = ANY(pq.providers)
    AND pq.status IN ('PENDING', 'QUEUED')
    AND (pq."scheduledAt" IS NULL OR pq."scheduledAt" <= NOW())
ORDER BY
    CASE pq.priority
        WHEN 'URGENT' THEN 1
        WHEN 'HIGH' THEN 2
        WHEN 'MEDIUM' THEN 3
        WHEN 'LOW' THEN 4
    END,
    pq."createdAt" ASC
LIMIT 50;

-- 14. Story Publishing Queue Integration
-- Uses index: idx_publishing_queue_story_project
SELECT
    pq.id as queueId,
    pq."storyProjectId",
    isp.name as projectName,
    isp.status as projectStatus,
    pq.priority,
    pq."scheduledAt"
FROM "PublishingQueue" pq
JOIN "InstagramStoryProject" isp ON isp.id = pq."storyProjectId"
WHERE pq."storyProjectId" IS NOT NULL
    AND pq.status IN ('PENDING', 'QUEUED')
ORDER BY pq.priority, pq."createdAt";

-- ============================================================================
-- SCHEDULING OPTIMIZATION
-- ============================================================================

-- 15. Get Active Scheduling Rules for Instagram
-- Uses index: idx_scheduling_rule_platforms
SELECT
    sr.id,
    sr.name,
    sr."contentTypes",
    sr."optimalTimes",
    sr."maxPostsPerDay",
    sr."minIntervalMinutes",
    sr.timezone
FROM "SchedulingRule" sr
WHERE sr."isActive" = true
    AND sr."projectId" = $1
    AND 'INSTAGRAM'::text = ANY(sr.platforms)
ORDER BY sr."timesApplied" DESC;

-- 16. Check Posting Limits for Account
-- Uses composite queries across multiple tables
WITH recent_posts AS (
    SELECT COUNT(*) as posts_today
    FROM "PublishingQueue" pq
    WHERE pq."accountId" = $1
        AND 'INSTAGRAM'::text = ANY(pq.providers)
        AND pq.status = 'PUBLISHED'
        AND pq."completedAt" >= CURRENT_DATE
),
hourly_posts AS (
    SELECT COUNT(*) as posts_this_hour
    FROM "PublishingQueue" pq
    WHERE pq."accountId" = $1
        AND 'INSTAGRAM'::text = ANY(pq.providers)
        AND pq.status = 'PUBLISHED'
        AND pq."completedAt" >= DATE_TRUNC('hour', NOW())
)
SELECT
    rp.posts_today,
    hp.posts_this_hour,
    sr."maxPostsPerDay",
    sr."maxPostsPerHour"
FROM recent_posts rp
CROSS JOIN hourly_posts hp
LEFT JOIN "SchedulingRule" sr ON sr."accountId" = $1
    AND sr."isActive" = true
    AND 'INSTAGRAM'::text = ANY(sr.platforms)
LIMIT 1;

-- ============================================================================
-- PERFORMANCE MONITORING QUERIES
-- ============================================================================

-- 17. Video Processing Performance
-- Uses index: idx_video_processing_completed
SELECT
    vpj."targetContentType",
    COUNT(*) as total_jobs,
    AVG(EXTRACT(EPOCH FROM (vpj."completedAt" - vpj."startedAt"))/60) as avg_processing_minutes,
    COUNT(CASE WHEN vpj.status = 'COMPLETED' THEN 1 END) as successful_jobs,
    COUNT(CASE WHEN vpj.status = 'FAILED' THEN 1 END) as failed_jobs
FROM "VideoProcessingJob" vpj
WHERE vpj."completedAt" >= NOW() - INTERVAL '7 days'
GROUP BY vpj."targetContentType"
ORDER BY total_jobs DESC;

-- 18. Story Publishing Success Rate
-- Uses index: idx_instagram_story_project_activity
SELECT
    DATE_TRUNC('day', isp."createdAt") as date,
    COUNT(*) as total_projects,
    COUNT(CASE WHEN isp.status = 'PUBLISHED' THEN 1 END) as successful_projects,
    ROUND(COUNT(CASE WHEN isp.status = 'PUBLISHED' THEN 1 END)::numeric / COUNT(*)::numeric * 100, 2) as success_rate
FROM "InstagramStoryProject" isp
WHERE isp."createdAt" >= NOW() - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', isp."createdAt")
ORDER BY date DESC;

-- ============================================================================
-- MAINTENANCE AND CLEANUP QUERIES
-- ============================================================================

-- 19. Archive Old Completed Video Processing Jobs
-- Moves old data to archive table or marks for deletion
UPDATE "VideoProcessingJob"
SET status = 'ARCHIVED'
WHERE status = 'COMPLETED'
    AND "completedAt" < NOW() - INTERVAL '90 days'
    AND status != 'ARCHIVED';

-- 20. Cleanup Expired Stories Analytics
-- Removes analytics data for expired stories
DELETE FROM "InstagramAnalytics"
WHERE "contentType" = 'STORIES'
    AND "capturedAt" < NOW() - INTERVAL '30 days'
    AND "contentId" IN (
        SELECT "instagramStoryId"
        FROM "InstagramStory"
        WHERE status = 'EXPIRED'
            AND "expiresAt" < NOW() - INTERVAL '7 days'
    );

-- ============================================================================
-- MULTI-TENANT SECURITY EXAMPLES
-- ============================================================================

-- All queries should include account or project filtering for security
-- Example of secure query pattern:

-- SECURE: Always filter by accountId for tenant isolation
SELECT * FROM "InstagramStoryProject"
WHERE "accountId" = $account_id AND status = 'PUBLISHED';

-- INSECURE: Never query without tenant filtering
-- SELECT * FROM "InstagramStoryProject" WHERE status = 'PUBLISHED';

-- Use Row Level Security (RLS) policies as additional protection:
/*
ALTER TABLE "InstagramStoryProject" ENABLE ROW LEVEL SECURITY;

CREATE POLICY instagram_story_project_isolation ON "InstagramStoryProject"
    FOR ALL
    TO application_role
    USING (account_id = current_setting('app.current_account_id')::uuid);
*/