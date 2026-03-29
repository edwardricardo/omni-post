# Instagram Features Database Performance Monitoring

This document provides comprehensive monitoring and performance analysis for the Instagram-specific database schema extensions.

## Performance Benchmarks

### Target Performance Metrics

- **Query Response Time**: < 100ms for 95th percentile
- **Concurrent Connections**: Support for 1000+ concurrent users
- **Throughput**: 10,000+ operations per minute
- **Index Hit Ratio**: > 99%
- **Buffer Cache Hit Ratio**: > 95%

## Key Performance Indicators (KPIs)

### 1. Query Performance Monitoring

```sql
-- Monitor slow queries specific to Instagram features
SELECT
    query,
    calls,
    total_time,
    mean_time,
    max_time,
    stddev_time,
    rows
FROM pg_stat_statements
WHERE query ILIKE '%InstagramStory%'
   OR query ILIKE '%VideoProcessing%'
   OR query ILIKE '%InstagramAnalytics%'
ORDER BY mean_time DESC
LIMIT 20;
```

### 2. Index Usage Analysis

```sql
-- Check index usage for Instagram-specific tables
SELECT
    schemaname,
    tablename,
    indexname,
    idx_tup_read,
    idx_tup_fetch,
    idx_scan,
    ROUND(idx_tup_read::numeric / NULLIF(idx_scan, 0), 2) as tuples_per_scan
FROM pg_stat_user_indexes
WHERE tablename IN (
    'InstagramStoryProject',
    'InstagramStory',
    'VideoProcessingJob',
    'VideoSegment',
    'InstagramAnalytics',
    'SchedulingRule'
)
ORDER BY idx_scan DESC;
```

### 3. Table Size and Growth Monitoring

```sql
-- Monitor table sizes and growth patterns
SELECT
    schemaname,
    tablename,
    attname,
    n_distinct,
    most_common_vals,
    correlation,
    null_frac
FROM pg_stats
WHERE tablename LIKE '%Instagram%'
   OR tablename LIKE '%Video%'
ORDER BY tablename, attname;
```

## Critical Performance Areas

### 1. Video Processing Bottlenecks

**Potential Issues:**

- Large video files causing memory pressure
- Concurrent processing job limits
- Storage I/O bottlenecks

**Monitoring Query:**

```sql
-- Monitor video processing performance
SELECT
    status,
    COUNT(*) as job_count,
    AVG(original_size) as avg_file_size,
    AVG(EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - started_at))/60) as avg_duration_minutes,
    MAX(retry_count) as max_retries
FROM "VideoProcessingJob"
WHERE created_at >= NOW() - INTERVAL '24 hours'
GROUP BY status
ORDER BY job_count DESC;
```

### 2. Story Publishing Performance

**Key Metrics:**

- Story sequence processing time
- Media upload success rate
- Publishing queue throughput

**Monitoring Query:**

```sql
-- Story publishing performance metrics
SELECT
    DATE_TRUNC('hour', created_at) as hour,
    status,
    COUNT(*) as story_count,
    AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) as avg_processing_seconds
FROM "InstagramStory"
WHERE created_at >= NOW() - INTERVAL '24 hours'
GROUP BY DATE_TRUNC('hour', created_at), status
ORDER BY hour DESC, story_count DESC;
```

### 3. Analytics Collection Performance

**Optimization Focus:**

- Time-series data insertion rate
- Query performance for dashboard aggregations
- Data retention and cleanup efficiency

**Monitoring Query:**

```sql
-- Analytics collection performance
SELECT
    content_type,
    COUNT(*) as records_count,
    MIN(captured_at) as oldest_record,
    MAX(captured_at) as newest_record,
    AVG(impressions) as avg_impressions,
    AVG(reach) as avg_reach
FROM "InstagramAnalytics"
WHERE captured_at >= NOW() - INTERVAL '7 days'
GROUP BY content_type
ORDER BY records_count DESC;
```

## Index Performance Analysis

### High-Impact Indexes

1. **Multi-tenant Security Indexes**

   ```sql
   -- Account-based isolation performance
   EXPLAIN ANALYZE
   SELECT * FROM "InstagramStoryProject"
   WHERE account_id = 'uuid-here' AND status = 'PUBLISHED';
   ```

2. **Time-based Query Indexes**

   ```sql
   -- Scheduled publishing performance
   EXPLAIN ANALYZE
   SELECT * FROM "InstagramStoryProject"
   WHERE scheduled_at <= NOW() AND status = 'SCHEDULED';
   ```

3. **Analytics Aggregation Indexes**
   ```sql
   -- Analytics dashboard performance
   EXPLAIN ANALYZE
   SELECT content_type, AVG(impressions)
   FROM "InstagramAnalytics"
   WHERE project_id = 'uuid-here' AND captured_at >= NOW() - INTERVAL '30 days'
   GROUP BY content_type;
   ```

## Connection Pool Optimization

### Recommended Settings

```typescript
// Prisma connection pool configuration for Instagram workloads
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: `${DATABASE_URL}?connection_limit=25&pool_timeout=20&schema_cache_size=200`,
    },
  },
});
```

### Pool Monitoring

```sql
-- Monitor connection usage
SELECT
    state,
    COUNT(*) as connection_count,
    MAX(NOW() - state_change) as max_duration
FROM pg_stat_activity
WHERE application_name LIKE '%prisma%'
GROUP BY state
ORDER BY connection_count DESC;
```

## Memory and Storage Optimization

### 1. Buffer Pool Analysis

```sql
-- Check buffer hit ratios for Instagram tables
SELECT
    schemaname,
    tablename,
    heap_blks_read,
    heap_blks_hit,
    ROUND(heap_blks_hit::numeric / NULLIF(heap_blks_hit + heap_blks_read, 0) * 100, 2) as hit_ratio
FROM pg_statio_user_tables
WHERE tablename IN (
    'InstagramStoryProject',
    'InstagramStory',
    'VideoProcessingJob',
    'VideoSegment',
    'InstagramAnalytics'
)
ORDER BY hit_ratio ASC;
```

### 2. JSONB Column Performance

```sql
-- Monitor JSONB column usage and size
SELECT
    tablename,
    attname,
    avg_width,
    n_distinct,
    correlation
FROM pg_stats
WHERE tablename IN ('InstagramStory', 'VideoProcessingJob', 'InstagramAnalytics')
  AND (attname LIKE '%json%' OR atttypid = 'jsonb'::regtype::oid);
```

## Automated Maintenance

### 1. Vacuum and Analyze Schedule

```sql
-- Check table bloat for high-activity Instagram tables
SELECT
    schemaname,
    tablename,
    n_tup_ins,
    n_tup_upd,
    n_tup_del,
    last_vacuum,
    last_autovacuum,
    last_analyze,
    last_autoanalyze
FROM pg_stat_user_tables
WHERE tablename LIKE '%Instagram%'
   OR tablename LIKE '%Video%'
ORDER BY n_tup_upd + n_tup_del DESC;
```

### 2. Index Maintenance

```sql
-- Identify unused indexes (potential for removal)
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan,
    pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes
WHERE tablename LIKE '%Instagram%'
   OR tablename LIKE '%Video%'
ORDER BY idx_scan ASC, pg_relation_size(indexrelid) DESC;
```

## Performance Alerts and Thresholds

### Critical Alerts

1. **Query Performance**: Mean query time > 100ms
2. **Connection Pool**: > 80% pool utilization
3. **Index Hit Ratio**: < 99%
4. **Video Processing**: Queue depth > 50 jobs
5. **Story Publishing**: Failure rate > 5%

### Warning Alerts

1. **Query Performance**: Mean query time > 50ms
2. **Connection Pool**: > 60% pool utilization
3. **Table Bloat**: > 20% bloat ratio
4. **Analytics Lag**: Data older than 1 hour

## Scaling Considerations

### Horizontal Scaling Preparation

1. **Read Replicas**: Configure for analytics queries
2. **Connection Pooling**: Implement PgBouncer for high concurrency
3. **Caching**: Redis for frequently accessed data
4. **Partitioning**: Time-based partitioning for analytics tables

### Vertical Scaling Indicators

- Consistent CPU usage > 70%
- Memory usage > 85%
- Disk I/O wait times > 10%
- Connection pool exhaustion

## Emergency Performance Recovery

### Quick Fixes

```sql
-- Emergency index creation (if missing)
CREATE INDEX CONCURRENTLY IF NOT EXISTS emergency_instagram_story_status
ON "InstagramStory" (status) WHERE status IN ('PENDING', 'PROCESSING');

-- Clear stuck processing jobs
UPDATE "VideoProcessingJob"
SET status = 'FAILED', error = 'Emergency reset'
WHERE status IN ('PROCESSING', 'ANALYZING', 'SPLITTING')
  AND started_at < NOW() - INTERVAL '2 hours';

-- Archive old analytics data
DELETE FROM "InstagramAnalytics"
WHERE captured_at < NOW() - INTERVAL '1 year'
  AND content_type = 'STORIES';
```

### Performance Incident Response

1. **Identify**: Use monitoring queries to find bottlenecks
2. **Isolate**: Disable non-critical features if needed
3. **Scale**: Add read replicas or increase resources
4. **Fix**: Apply targeted optimizations
5. **Monitor**: Verify performance recovery

## Continuous Optimization

### Weekly Reviews

- Analyze slow query logs
- Review index usage statistics
- Check table growth patterns
- Validate backup performance

### Monthly Optimizations

- Rebuild fragmented indexes
- Update table statistics
- Review and optimize connection pooling
- Capacity planning based on growth trends

### Quarterly Assessments

- Full performance benchmarking
- Schema optimization review
- Hardware upgrade planning
- Disaster recovery testing
