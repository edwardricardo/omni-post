# Instagram Features Database Schema Implementation - Handoff Document

## Overview

This document provides a comprehensive handoff of the Instagram-specific database schema implementation for the omni-post multi-tenant social media CMS platform. All Instagram features have been implemented with a focus on performance, security, and scalability.

## Implementation Summary

### ✅ Completed Deliverables

1. **Enhanced Prisma Schema** - Complete Instagram feature integration
2. **Migration Files** - Safe production deployment migrations
3. **Performance Indexes** - Optimized for Instagram operations at scale
4. **Query Patterns** - Pre-optimized queries for common operations
5. **Multi-Tenant Security** - Account-level isolation enforcement
6. **Performance Monitoring** - Comprehensive monitoring and optimization guide

## Database Schema Extensions

### Core Instagram Models

#### 1. InstagramStoryProject

- **Purpose**: Manages Instagram Stories as cohesive projects
- **Key Features**: Auto-transitions, scheduling, analytics tracking
- **Relationships**: Account → Project → Story Project → Individual Stories
- **Multi-tenancy**: Account-level isolation with CASCADE cleanup

#### 2. InstagramStory

- **Purpose**: Individual story content with rich metadata
- **Key Features**: Sequence ordering, styling options, analytics
- **Media Integration**: Links to PostMedia with processing status
- **Lifecycle**: PENDING → PROCESSING → READY → PUBLISHED → EXPIRED

#### 3. VideoProcessingJob

- **Purpose**: Async video processing for Instagram content types
- **Key Features**: Progress tracking, retry logic, segment management
- **Content Types**: FEED, STORIES, REELS, CAROUSEL, IGTV
- **Workflow**: QUEUED → ANALYZING → SPLITTING → OPTIMIZING → COMPLETED

#### 4. VideoSegment

- **Purpose**: Individual video segments from processing jobs
- **Key Features**: Sequence ordering, quality metadata, upload tracking
- **Integration**: Links to VideoProcessingJob with CASCADE cleanup

#### 5. InstagramAnalytics

- **Purpose**: Content performance metrics and audience insights
- **Key Features**: Content-type specific metrics, time-series data
- **Aggregation**: Project-level and account-level reporting
- **Retention**: Configurable data retention policies

#### 6. SchedulingRule

- **Purpose**: AI-powered optimal posting time management
- **Key Features**: Platform-specific rules, blackout periods, limits
- **Intelligence**: Performance-based rule optimization
- **Integration**: Cross-platform scheduling coordination

### Enhanced Publishing Queue

The existing PublishingQueue has been extended with Instagram-specific features:

- **contentType**: Instagram content type specification
- **storyProjectId**: Link to Instagram Story projects
- **videoProcessingJobId**: Link to video processing jobs
- **priority**: Queue priority management (URGENT, HIGH, MEDIUM, LOW)

## Performance Architecture

### Strategic Indexing

#### Multi-Tenant Optimized Indexes

```sql
-- Account-level isolation (primary access pattern)
CREATE INDEX "idx_instagram_story_project_account_status"
ON "InstagramStoryProject" ("accountId", "status");

-- Time-based operations (scheduled publishing)
CREATE INDEX "idx_instagram_story_project_scheduled"
ON "InstagramStoryProject" ("scheduledAt", "status");
```

#### High-Throughput Operations

```sql
-- Video processing queue optimization
CREATE INDEX "idx_video_processing_queue"
ON "VideoProcessingJob" ("status", "createdAt");

-- Analytics time-series queries
CREATE INDEX "idx_instagram_analytics_metrics"
ON "InstagramAnalytics" ("projectId", "contentType", "capturedAt");
```

### Query Performance Targets

- **Dashboard Queries**: < 50ms average response time
- **Publishing Operations**: < 100ms for queue processing
- **Analytics Aggregation**: < 200ms for 90-day reports
- **Video Processing**: < 5 seconds for job creation

## Migration Strategy

### Production-Safe Deployment

#### Phase 1: Schema Creation (Zero Downtime)

```bash
# Apply Instagram features migration
pnpm --filter @infra/prisma migrate deploy
```

#### Phase 2: Index Creation (Non-blocking)

```bash
# Apply performance indexes (uses CONCURRENTLY)
psql $DATABASE_URL -f migrations/20250923000002_instagram_performance_indexes/migration.sql
```

#### Phase 3: Data Population

- Existing posts can be gradually migrated to new content types
- No breaking changes to existing X/Twitter functionality
- Backward compatibility maintained

### Rollback Procedures

Complete rollback script provided at:
`/infra/prisma/migrations/rollback_instagram_features.sql`

**Rollback Safety**: All rollback operations are tested and documented.

## Multi-Tenant Security Implementation

### Row Level Security (RLS)

All Instagram tables implement account-level isolation:

```sql
-- Example policy for InstagramStoryProject
CREATE POLICY "instagram_story_project_isolation"
ON "InstagramStoryProject"
FOR ALL TO instagram_api_user
USING (account_id = current_setting('app.current_account_id')::uuid);
```

### Security Verification

- ✅ All tables have RLS enabled
- ✅ Isolation policies prevent cross-tenant access
- ✅ Foreign key relationships maintain isolation chain
- ✅ Admin access controls with audit logging
- ✅ Security violation monitoring

### Application Integration

```typescript
// Set tenant context for all database operations
await prisma.$executeRaw`SELECT set_tenant_context(${accountId}::uuid)`;

// All subsequent queries are automatically filtered by RLS
const stories = await prisma.instagramStoryProject.findMany({
  where: { status: "PUBLISHED" },
}); // Only returns stories for current account
```

## API Integration Points

### Key Prisma Client Operations

#### 1. Story Project Management

```typescript
// Create story project with automatic account isolation
const storyProject = await prisma.instagramStoryProject.create({
  data: {
    accountId,
    projectId,
    name: "Holiday Campaign",
    stories: {
      create: [
        { sequence: 1, text: "Story 1", duration: 5 },
        { sequence: 2, text: "Story 2", duration: 7 },
      ],
    },
  },
  include: { stories: true },
});
```

#### 2. Video Processing Workflow

```typescript
// Initiate video processing job
const processingJob = await prisma.videoProcessingJob.create({
  data: {
    accountId,
    projectId,
    originalMediaId,
    originalUrl,
    targetContentType: "REELS",
    splitOptions: { maxDuration: 60, quality: "high" },
  },
});

// Monitor processing progress
const job = await prisma.videoProcessingJob.findUnique({
  where: { id: processingJobId },
  include: { segments: true },
});
```

#### 3. Analytics Collection

```typescript
// Store Instagram analytics data
await prisma.instagramAnalytics.create({
  data: {
    accountId,
    projectId,
    contentType: "STORIES",
    contentId: storyId,
    impressions: 1500,
    reach: 1200,
    likes: 89,
    replies: 12,
  },
});
```

### Publishing Queue Integration

```typescript
// Queue Instagram content with priority
await prisma.publishingQueue.create({
  data: {
    accountId,
    projectId,
    content: canonicalPost,
    providers: ["INSTAGRAM"],
    contentType: "STORIES",
    storyProjectId,
    priority: "HIGH",
    scheduledAt: optimizedTime,
  },
});
```

## Performance Monitoring Integration

### Key Metrics to Track

1. **Query Performance**
   - Average response time per operation type
   - 95th percentile latency for dashboard queries
   - Slow query identification and optimization

2. **Video Processing Performance**
   - Processing job throughput (jobs/minute)
   - Average processing time per content type
   - Error rates and retry patterns

3. **Storage and Growth**
   - Table size growth rates
   - Index hit ratios and usage patterns
   - Connection pool utilization

### Alerting Thresholds

- **Critical**: Query response > 1 second
- **Warning**: Query response > 100ms
- **Info**: New performance optimization opportunity

## Backup and Recovery

### Data Protection Strategy

1. **Regular Backups**: Full database backups every 6 hours
2. **Point-in-Time Recovery**: Transaction log backup every 15 minutes
3. **Cross-Region Replication**: Disaster recovery replica
4. **Data Retention**: Instagram analytics retained for 2 years

### Recovery Testing

- Monthly disaster recovery drills
- Quarterly full restore testing
- Annual cross-region failover testing

## Production Readiness Checklist

### ✅ Schema Implementation

- [x] All Instagram models implemented
- [x] Foreign key relationships established
- [x] Proper CASCADE behaviors configured
- [x] Enum types for status management

### ✅ Performance Optimization

- [x] Strategic indexes for all query patterns
- [x] JSONB indexes for flexible metadata
- [x] Time-series optimization for analytics
- [x] Multi-tenant query optimization

### ✅ Security Implementation

- [x] Row Level Security policies
- [x] Account-level isolation verification
- [x] Admin access controls
- [x] Security audit logging

### ✅ Operational Excellence

- [x] Migration scripts tested
- [x] Rollback procedures validated
- [x] Performance monitoring setup
- [x] Backup and recovery procedures

## Next Steps for Backend Developer

### Immediate Actions

1. **Review Schema**: Examine the Prisma schema changes in `/infra/prisma/schema.prisma`
2. **Run Migrations**: Apply the Instagram feature migrations in development
3. **Generate Client**: Run `pnpm --filter @infra/prisma generate` to update Prisma client
4. **Test Queries**: Validate query patterns using the provided SQL examples

### Implementation Priorities

1. **Story Project API**: Implement CRUD operations for Instagram story projects
2. **Video Processing**: Integrate with video processing job workflow
3. **Analytics Collection**: Set up background jobs for Instagram analytics
4. **Scheduling Integration**: Connect scheduling rules with publishing queue

### Key Integration Points

1. **Provider Registry**: Extend to include Instagram content type handling
2. **Publishing Workers**: Add Instagram-specific publishing logic
3. **Analytics Collectors**: Implement Instagram API data collection
4. **Admin Dashboard**: Add Instagram-specific monitoring panels

## Support and Documentation

### File Locations

- **Schema**: `/infra/prisma/schema.prisma`
- **Migrations**: `/infra/prisma/migrations/20250923000001_instagram_features/`
- **Query Patterns**: `/infra/prisma/docs/instagram-query-patterns.sql`
- **Performance Guide**: `/infra/prisma/docs/performance-monitoring.md`
- **Security Docs**: `/infra/prisma/docs/multi-tenant-security.sql`

### Performance Baselines

- **Connection Pool**: 25 connections for Instagram workloads
- **Query Timeout**: 30 seconds maximum
- **Batch Size**: 100 records for bulk operations
- **Index Hit Ratio**: Target > 99% for all operations

### Contact and Handoff

This database schema implementation provides a solid foundation for Instagram provider integration. The schema is designed for production scale with proper security, performance optimization, and operational excellence.

**Schema Architect Handoff Complete** ✅

All database requirements for Instagram provider integration have been implemented and are ready for backend service integration.
