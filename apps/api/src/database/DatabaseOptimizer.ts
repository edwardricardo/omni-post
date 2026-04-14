/**
 * @file DatabaseOptimizer.ts
 * @description Advanced database optimization service providing query performance monitoring,
 *              materialized view management, connection pool optimization, and health metrics.
 * @layer infrastructure
 */

import { prisma } from "@infra/prisma";
import { Logger } from "pino";

type PrismaClient = typeof prisma;

export interface QueryPerformanceMetrics {
  queryType: string;
  averageExecutionTime: number;
  maxExecutionTime: number;
  totalCalls: number;
  cacheHitRatio?: number;
}

export interface DatabaseHealthReport {
  overall: "healthy" | "warning" | "critical";
  connectionUsage: {
    total: number;
    active: number;
    idle: number;
    utilization: number;
  };
  queryPerformance: QueryPerformanceMetrics[];
  indexEfficiency: {
    tableName: string;
    indexName: string;
    scanCount: number;
    efficiency: number;
  }[];
  materializedViewStatus: {
    viewName: string;
    lastRefresh: Date;
    dataFreshness: number; // minutes since last refresh
  }[];
}

export interface PerformanceBaseline {
  metricName: string;
  currentValue: number;
  baselineValue: number;
  improvement: number; // percentage change
  status: "improved" | "degraded" | "stable";
}

export class DatabaseOptimizer {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logger: Logger
  ) {}

  /**
   * Refresh all materialized views for optimal query performance
   */
  async refreshMaterializedViews(): Promise<void> {
    try {
      this.logger.info("Starting materialized view refresh");

      // Use the stored function we created in the migration
      await this.prisma.$executeRaw`SELECT refresh_analytics_summary()`;

      this.logger.info("Materialized views refreshed successfully");
    } catch (error) {
      this.logger.error({ error }, "Failed to refresh materialized views");
      throw error;
    }
  }

  /**
   * Get comprehensive database health report
   */
  async getDatabaseHealthReport(): Promise<DatabaseHealthReport> {
    try {
      const [connectionStats, queryStats, indexStats, materializedViewStatus] = await Promise.all([
        this.getConnectionStatistics(),
        this.getQueryPerformanceMetrics(),
        this.getIndexEfficiencyReport(),
        this.getMaterializedViewStatus(),
      ]);

      const overall = this.calculateOverallHealth(connectionStats, queryStats);

      return {
        overall,
        connectionUsage: connectionStats,
        queryPerformance: queryStats,
        indexEfficiency: indexStats,
        materializedViewStatus,
      };
    } catch (error) {
      this.logger.error({ error }, "Failed to generate database health report");
      throw error;
    }
  }

  /**
   * Get optimized dashboard posts using the custom function
   */
  async getDashboardPosts(accountId: string, limit: number = 50, offset: number = 0) {
    try {
      const posts = await this.prisma.$queryRaw<
        Array<{
          post_id: string;
          title: string;
          status: string;
          scheduled_at: Date | null;
          created_at: Date;
          channel_count: number;
          total_views: number;
        }>
      >`
        SELECT * FROM get_dashboard_posts(${accountId}::uuid, ${limit}, ${offset})
      `;

      return posts.map((post) => ({
        id: post.post_id,
        title: post.title,
        status: post.status,
        scheduledAt: post.scheduled_at,
        createdAt: post.created_at,
        channelCount: Number(post.channel_count),
        totalViews: Number(post.total_views),
      }));
    } catch (error) {
      this.logger.error({ error, accountId }, "Failed to get dashboard posts");
      throw error;
    }
  }

  /**
   * Get tenant dashboard statistics from materialized view
   */
  async getTenantDashboardStats(accountId: string) {
    try {
      const stats = await this.prisma.$queryRaw<
        Array<{
          accountId: string;
          total_posts: number;
          published_posts: number;
          scheduled_posts: number;
          failed_posts: number;
          total_channels: number;
          last_activity: Date | null;
          avg_post_views: number;
        }>
      >`
        SELECT * FROM tenant_dashboard_stats WHERE "accountId" = ${accountId}::uuid
      `;

      return stats[0]
        ? {
            totalPosts: Number(stats[0].total_posts),
            publishedPosts: Number(stats[0].published_posts),
            scheduledPosts: Number(stats[0].scheduled_posts),
            failedPosts: Number(stats[0].failed_posts),
            totalChannels: Number(stats[0].total_channels),
            lastActivity: stats[0].last_activity,
            avgPostViews: Number(stats[0].avg_post_views),
          }
        : null;
    } catch (error) {
      this.logger.error({ error, accountId }, "Failed to get tenant dashboard stats");
      throw error;
    }
  }

  /**
   * Get total count of dashboard posts for pagination
   */
  async getDashboardPostsCount(accountId: string): Promise<number> {
    try {
      const countResult = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) as count
        FROM "Post" p
        INNER JOIN "Project" pr ON pr.id = p."projectId"
        WHERE pr."accountId"::text = ${accountId}
      `;
      const firstResult = countResult[0];
      return Number(firstResult?.count ?? 0);
    } catch (error) {
      this.logger.error({ error, accountId }, "Failed to get dashboard posts count");
      throw error;
    }
  }

  /**
   * Get hourly analytics summary from materialized view
   */
  async getHourlyAnalyticsSummary(channelId: string, hours: number = 24) {
    try {
      const summary = await this.prisma.$queryRaw<
        Array<{
          hour: Date;
          total_views: number;
          total_likes: number;
          total_comments: number;
          total_shares: number;
          data_points: number;
        }>
      >`
        SELECT
          hour,
          total_views,
          total_likes,
          total_comments,
          total_shares,
          data_points
        FROM hourly_analytics_summary
        WHERE "channelId" = ${channelId}::uuid
          AND hour >= NOW() - INTERVAL '${hours} hours'
        ORDER BY hour DESC
      `;

      return summary.map((row) => ({
        hour: row.hour,
        totalViews: Number(row.total_views),
        totalLikes: Number(row.total_likes),
        totalComments: Number(row.total_comments),
        totalShares: Number(row.total_shares),
        dataPoints: Number(row.data_points),
      }));
    } catch (error) {
      this.logger.error({ error, channelId }, "Failed to get hourly analytics summary");
      throw error;
    }
  }

  /**
   * Record performance metric
   */
  async recordPerformanceMetric(
    metricName: string,
    value: number,
    unit: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        SELECT record_performance_metric(
          ${metricName},
          ${value},
          ${unit},
          ${JSON.stringify(metadata || {})}::jsonb
        )
      `;
    } catch (error) {
      this.logger.error({ error, metricName }, "Failed to record performance metric");
      throw error;
    }
  }

  /**
   * Get performance baseline comparison
   */
  async getPerformanceBaselines(): Promise<PerformanceBaseline[]> {
    try {
      const baselines = await this.prisma.$queryRaw<
        Array<{
          metric_name: string;
          current_value: number;
          baseline_value: number;
          improvement: number;
        }>
      >`
        WITH baseline_metrics AS (
          SELECT
            metric_name,
            metric_value as baseline_value
          FROM performance_baseline
          WHERE phase = 'phase2_baseline'
        ),
        current_metrics AS (
          SELECT
            metric_name,
            metric_value as current_value,
            ROW_NUMBER() OVER (PARTITION BY metric_name ORDER BY recorded_at DESC) as rn
          FROM performance_baseline
          WHERE phase != 'phase2_baseline'
        )
        SELECT
          b.metric_name,
          COALESCE(c.current_value, b.baseline_value) as current_value,
          b.baseline_value,
          CASE
            WHEN b.baseline_value > 0
            THEN ((COALESCE(c.current_value, b.baseline_value) - b.baseline_value) / b.baseline_value) * 100
            ELSE 0
          END as improvement
        FROM baseline_metrics b
        LEFT JOIN current_metrics c ON b.metric_name = c.metric_name AND c.rn = 1
      `;

      return baselines.map((row) => ({
        metricName: row.metric_name,
        currentValue: Number(row.current_value),
        baselineValue: Number(row.baseline_value),
        improvement: Number(row.improvement),
        status: this.getPerformanceStatus(Number(row.improvement)),
      }));
    } catch (error) {
      this.logger.error({ error }, "Failed to get performance baselines");
      throw error;
    }
  }

  /**
   * Optimize database tables by updating statistics and reindexing if needed
   */
  async optimizeTables(): Promise<void> {
    try {
      this.logger.info("Starting table optimization");

      // Update table statistics
      await this.prisma.$executeRaw`ANALYZE`;

      // Collect updated connection pool stats
      await this.prisma.$executeRaw`SELECT collect_connection_pool_stats()`;

      this.logger.info("Table optimization completed");
    } catch (error) {
      this.logger.error({ error }, "Failed to optimize tables");
      throw error;
    }
  }

  /**
   * Get connection statistics
   */
  private async getConnectionStatistics() {
    const stats = await this.prisma.$queryRaw<
      Array<{
        total_connections: number;
        active_connections: number;
        idle_connections: number;
        pool_utilization: number;
      }>
    >`
      SELECT
        total_connections,
        active_connections,
        idle_connections,
        pool_utilization
      FROM connection_pool_stats
      ORDER BY timestamp DESC
      LIMIT 1
    `;

    const latest = stats[0];
    return {
      total: Number(latest?.total_connections ?? 0),
      active: Number(latest?.active_connections ?? 0),
      idle: Number(latest?.idle_connections ?? 0),
      utilization: Number(latest?.pool_utilization ?? 0),
    };
  }

  /**
   * Get query performance metrics
   */
  private async getQueryPerformanceMetrics(): Promise<QueryPerformanceMetrics[]> {
    const metrics = await this.prisma.$queryRaw<
      Array<{
        query: string;
        calls: number;
        mean_exec_time: number;
        max_exec_time: number;
      }>
    >`
      SELECT
        LEFT(query, 50) as query,
        calls,
        mean_exec_time,
        max_exec_time
      FROM pg_stat_statements
      WHERE calls > 10
      ORDER BY mean_exec_time DESC
      LIMIT 10
    `;

    return metrics.map((row) => ({
      queryType: row.query.replace(/\s+/g, " ").trim(),
      averageExecutionTime: Number(row.mean_exec_time),
      maxExecutionTime: Number(row.max_exec_time),
      totalCalls: Number(row.calls),
    }));
  }

  /**
   * Get index efficiency report
   */
  private async getIndexEfficiencyReport() {
    const indexes = await this.prisma.$queryRaw<
      Array<{
        schemaname: string;
        tablename: string;
        indexname: string;
        idx_scan: number;
        idx_tup_read: number;
      }>
    >`
      SELECT
        schemaname,
        tablename,
        indexname,
        idx_scan,
        idx_tup_read
      FROM pg_stat_user_indexes
      WHERE idx_scan > 0
      ORDER BY idx_scan DESC
      LIMIT 20
    `;

    return indexes.map((row) => ({
      tableName: row.tablename,
      indexName: row.indexname,
      scanCount: Number(row.idx_scan),
      efficiency: Number(row.idx_scan) > 0 ? Number(row.idx_tup_read) / Number(row.idx_scan) : 0,
    }));
  }

  /**
   * Get materialized view status
   */
  private async getMaterializedViewStatus() {
    // This would need to be implemented based on your specific materialized view tracking
    return [
      {
        viewName: "hourly_analytics_summary",
        lastRefresh: new Date(),
        dataFreshness: 0,
      },
      {
        viewName: "tenant_dashboard_stats",
        lastRefresh: new Date(),
        dataFreshness: 0,
      },
    ];
  }

  /**
   * Calculate overall database health
   */
  private calculateOverallHealth(
    connectionStats: { total: number; active: number; idle: number; utilization: number },
    queryStats: QueryPerformanceMetrics[]
  ): "healthy" | "warning" | "critical" {
    // Connection utilization check
    if (connectionStats.utilization > 90) return "critical";
    if (connectionStats.utilization > 70) return "warning";

    // Query performance check
    const slowQueries = queryStats.filter((q) => q.averageExecutionTime > 1000);
    if (slowQueries.length > 5) return "critical";
    if (slowQueries.length > 2) return "warning";

    return "healthy";
  }

  /**
   * Determine performance status based on improvement percentage
   */
  private getPerformanceStatus(improvement: number): "improved" | "degraded" | "stable" {
    // improvement = ((current - baseline) / baseline) * 100
    // For metrics where lower is better (latency, usage), negative change = improved
    if (improvement < -5) return "improved";
    if (improvement > 5) return "degraded";
    return "stable";
  }

  /**
   * Schedule automatic materialized view refresh
   */
  async scheduleAutomaticRefresh(): Promise<void> {
    const refreshInterval = parseInt(process.env.MATERIALIZED_VIEW_REFRESH_INTERVAL || "900000"); // 15 minutes default

    const interval = setInterval(async () => {
      try {
        await this.refreshMaterializedViews();
        await this.optimizeTables();
        this.logger.info("Automatic database optimization completed");
      } catch (error) {
        this.logger.error({ error }, "Automatic database optimization failed");
      }
    }, refreshInterval);
    interval.unref();

    this.logger.info({ refreshInterval }, "Automatic materialized view refresh scheduled");
  }
}
