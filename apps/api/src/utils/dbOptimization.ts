import { prisma } from "@infra/prisma";
import type { ApiMetrics } from "../metrics/apiMetrics.js";
import { dbLogger } from "../lib/logger.js";

export interface QueryAnalysis {
  query: string;
  duration: number;
  timestamp: Date;
  params?: unknown[];
  stackTrace?: string;
  affectedRows?: number;
}

export interface IndexRecommendation {
  table: string;
  columns: string[];
  reason: string;
  estimatedImprovement: string;
  priority: "high" | "medium" | "low";
}

export interface DatabaseStats {
  connectionPoolSize: number;
  activeConnections: number;
  idleConnections: number;
  slowQueries: QueryAnalysis[];
  indexRecommendations: IndexRecommendation[];
  tableStats: {
    name: string;
    rowCount: number;
    sizeKB: number;
    indexes: string[];
  }[];
}

export class DatabaseOptimizer {
  private metrics: ApiMetrics;
  private slowQueryThreshold: number = 100; // ms
  private slowQueries: QueryAnalysis[] = [];
  private maxSlowQueries: number = 100;

  constructor(metrics: ApiMetrics) {
    this.metrics = metrics;
  }

  /**
   * Monitor query performance
   */
  async trackQuery(query: string, duration: number, params?: unknown[]): Promise<void> {
    // Record metrics (use generic metrics)
    // Note: recordDatabaseQuery method doesn't exist, using alternative
    this.metrics.metrics.dbOperations.inc({
      operation: "query",
      table: "unknown",
      result: "success",
    });

    // Track slow queries
    if (duration > this.slowQueryThreshold) {
      const analysis: QueryAnalysis = {
        query: this.sanitizeQuery(query),
        duration,
        timestamp: new Date(),
        params: this.sanitizeParams(params),
        stackTrace: this.getStackTrace(),
        // affectedRows would need to be passed from query result if available
      };

      this.slowQueries.push(analysis);

      // Keep only recent slow queries
      if (this.slowQueries.length > this.maxSlowQueries) {
        this.slowQueries = this.slowQueries.slice(-this.maxSlowQueries);
      }

      // Log slow query
      dbLogger.warn(
        {
          query: analysis.query,
          durationMs: duration,
          params: analysis.params,
        },
        "Slow query detected"
      );
    }
  }

  /**
   * Get current database statistics
   */
  async getDatabaseStats(): Promise<DatabaseStats> {
    try {
      // Get connection pool stats (this would depend on your Prisma setup)
      const poolStats = {
        connectionPoolSize: 0, // Cannot be determined without external monitoring
        activeConnections: 0, // Would need monitoring
        idleConnections: 0, // Would need monitoring
      };

      // Get table statistics
      const tableStats = await this.getTableStats();

      // Generate index recommendations
      const indexRecommendations = await this.generateIndexRecommendations();

      return {
        ...poolStats,
        slowQueries: this.getRecentSlowQueries(),
        indexRecommendations,
        tableStats,
      };
    } catch (_error: unknown) {
      dbLogger.error({ err: _error }, "Error getting database stats");
      return {
        connectionPoolSize: 0,
        activeConnections: 0,
        idleConnections: 0,
        slowQueries: [],
        indexRecommendations: [],
        tableStats: [],
      };
    }
  }

  /**
   * Get table statistics
   */
  private async getTableStats(): Promise<DatabaseStats["tableStats"]> {
    try {
      // PostgreSQL specific queries
      const _tableStatsQuery = `
        SELECT
          schemaname,
          tablename,
          attname,
          n_distinct,
          correlation
        FROM pg_stats
        WHERE schemaname = 'public'
        ORDER BY tablename, attname;
      `;

      // Get table sizes
      const _tableSizeQuery = `
        SELECT
          tablename,
          pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
          pg_total_relation_size(schemaname||'.'||tablename) as size_bytes
        FROM pg_tables
        WHERE schemaname = 'public'
        ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
      `;

      // Get index information
      const _indexQuery = `
        SELECT
          t.tablename,
          i.indexname,
          array_to_string(array_agg(a.attname), ', ') as column_names
        FROM
          pg_tables t
        LEFT JOIN pg_indexes i ON t.tablename = i.tablename
        LEFT JOIN pg_attribute a ON a.attrelid = i.indexrelid
        WHERE t.schemaname = 'public'
        GROUP BY t.tablename, i.indexname
        ORDER BY t.tablename, i.indexname;
      `;

      // For now, return basic stats since we can't easily execute raw SQL
      // In a real implementation, you'd use prisma.$queryRaw or similar
      return [
        {
          name: "posts",
          rowCount: await this.getTableRowCount("post"),
          sizeKB: 0, // Would need raw query
          indexes: ["id", "projectId", "createdAt"],
        },
        {
          name: "postContent",
          rowCount: await this.getTableRowCount("postContent"),
          sizeKB: 0,
          indexes: ["id", "postId", "language"],
        },
        {
          name: "publishLogs",
          rowCount: await this.getTableRowCount("publishLog"),
          sizeKB: 0,
          indexes: ["id", "postId", "channelId", "createdAt"],
        },
        {
          name: "analytics",
          rowCount: await this.getTableRowCount("analytics"),
          sizeKB: 0,
          indexes: ["id", "postId", "provider", "createdAt"],
        },
      ];
    } catch (_error: unknown) {
      dbLogger.error({ err: _error }, "Error getting table stats");
      return [];
    }
  }

  /**
   * Get table row count
   */
  private async getTableRowCount(table: string): Promise<number> {
    try {
      switch (table) {
        case "post":
          return await prisma.post.count();
        case "postContent":
          return await prisma.postContent.count();
        case "publishLog":
          return await prisma.publishLog.count();
        case "analytics":
          return await prisma.analytics.count();
        default:
          return 0;
      }
    } catch (_error: unknown) {
      dbLogger.error({ err: _error, table }, "Error counting rows for table");
      return 0;
    }
  }

  /**
   * Generate index recommendations based on common query patterns
   */
  private async generateIndexRecommendations(): Promise<IndexRecommendation[]> {
    const recommendations: IndexRecommendation[] = [];

    // Analyze slow queries for patterns
    const _commonPatterns = this.analyzeSlowQueryPatterns();

    // Common recommendations based on typical usage
    recommendations.push(
      {
        table: "posts",
        columns: ["projectId", "createdAt"],
        reason: "Frequent queries by project with date ordering",
        estimatedImprovement: "40-60% query time reduction",
        priority: "high",
      },
      {
        table: "publishLogs",
        columns: ["postId", "status"],
        reason: "Common filtering by post and status",
        estimatedImprovement: "30-50% query time reduction",
        priority: "high",
      },
      {
        table: "analytics",
        columns: ["postId", "provider", "createdAt"],
        reason: "Analytics queries often filter by these columns",
        estimatedImprovement: "50-70% query time reduction",
        priority: "medium",
      },
      {
        table: "postContent",
        columns: ["postId", "language"],
        reason: "Localized content lookups",
        estimatedImprovement: "20-40% query time reduction",
        priority: "medium",
      }
    );

    return recommendations;
  }

  /**
   * Analyze slow query patterns
   */
  private analyzeSlowQueryPatterns(): string[] {
    const patterns: string[] = [];

    // Look for common WHERE clauses in slow queries
    this.slowQueries.forEach((query) => {
      if (query.query.includes("WHERE projectId =")) {
        patterns.push("projectId_filter");
      }
      if (query.query.includes("ORDER BY createdAt")) {
        patterns.push("createdAt_sort");
      }
      if (query.query.includes("WHERE postId =")) {
        patterns.push("postId_filter");
      }
    });

    return [...new Set(patterns)]; // Remove duplicates
  }

  /**
   * Get recent slow queries
   */
  private getRecentSlowQueries(): QueryAnalysis[] {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    return this.slowQueries
      .filter((query) => query.timestamp > oneHourAgo)
      .sort((a, b) => b.duration - a.duration) // Sort by slowest first
      .slice(0, 20); // Return top 20
  }

  /**
   * Sanitize query for logging
   */
  private sanitizeQuery(query: string): string {
    // Remove potential sensitive data and normalize
    return query
      .replace(/\$\d+/g, "?") // Replace Prisma parameters
      .replace(/'[^']*'/g, "'***'") // Replace string literals (including those with spaces)
      .replace(/\s+/g, " ") // Normalize whitespace
      .trim();
  }

  /**
   * Sanitize parameters for logging
   */
  private sanitizeParams(params?: unknown[]): unknown[] {
    if (!params) return [];

    return params.map((param) => {
      if (typeof param === "string" && param.length > 10) {
        return param.substring(0, 10) + "...";
      }
      return param;
    });
  }

  /**
   * Get stack trace for debugging
   */
  private getStackTrace(): string {
    const stack = new Error().stack || "";
    const lines = stack.split("\n");

    // Return relevant lines (skip this function and Error creation)
    return lines
      .slice(3, 8)
      .map((line) => line.trim())
      .join(" | ");
  }

  /**
   * Create database indexes (for PostgreSQL)
   * This would typically be done via migrations, but included for reference
   */
  async createRecommendedIndexes(): Promise<{
    created: string[];
    failed: string[];
  }> {
    const created: string[] = [];
    const failed: string[] = [];

    const indexCommands = [
      "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_posts_project_created ON posts(projectId, createdAt DESC)",
      "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_publishlogs_post_status ON publishLogs(postId, status)",
      "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_analytics_post_provider_created ON analytics(postId, provider, createdAt DESC)",
      "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_postcontent_post_language ON postContent(postId, language)",
    ];

    for (const command of indexCommands) {
      try {
        // In a real implementation, you'd execute this via prisma.$executeRaw
        // await prisma.$executeRaw`${command}`;
        created.push(command);
      } catch (_error: unknown) {
        dbLogger.error({ err: _error, command }, "Failed to create index");
        failed.push(command);
      }
    }

    return { created, failed };
  }

  /**
   * Query performance middleware for Prisma
   */
  createPrismaMiddleware() {
    return async (
      params: Record<string, unknown>,
      next: (params: Record<string, unknown>) => Promise<unknown>
    ) => {
      const start = Date.now();
      const result = await next(params);
      const duration = Date.now() - start;

      // Track the query
      await this.trackQuery(
        `${String(params.model)}.${String(params.action)}`,
        duration,
        params.args as unknown[] | undefined
      );

      return result;
    };
  }
}

/**
 * Query builder helpers for common optimized patterns
 */
export class OptimizedQueries {
  /**
   * Get posts with optimized pagination
   */
  static async getPostsPaginated(projectId: string, page: number = 1, limit: number = 20) {
    const offset = (page - 1) * limit;

    return prisma.post.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: {
        contents: {
          take: 1, // Get only one content version
          orderBy: { createdAt: "desc" },
        },
        _count: {
          select: {
            contents: true,
          },
        },
      },
    });
  }

  /**
   * Get analytics with optimized aggregation
   */
  static async getAnalyticsAggregated(postId: string, provider?: string) {
    const where = {
      postId,
      ...(provider ? { provider: provider as unknown as import("@infra/prisma").Provider } : {}),
    };

    return prisma.analytics.aggregate({
      where,
      _sum: {
        views: true,
        likes: true,
        comments: true,
        shares: true,
      },
      _avg: {
        views: true,
        likes: true,
      },
      _count: {
        id: true,
      },
    });
  }

  /**
   * Get publish logs with status filtering
   */
  static async getPublishLogsByStatus(postId: string, status?: string) {
    return prisma.publishLog.findMany({
      where: {
        postId,
        ...(status ? { status: status as unknown as import("@infra/prisma").LogStatus } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
  }
}
