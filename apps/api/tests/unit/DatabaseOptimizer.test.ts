/**
 * DatabaseOptimizer - Comprehensive Test Suite
 *
 * These tests validate the enhanced database optimizer that provides
 * materialized view management, performance monitoring, and health checks.
 *
 * Key Features Tested:
 * 1. Materialized View Refresh - Automatic and manual refresh
 * 2. Health Reporting - Comprehensive database health assessment
 * 3. Dashboard Queries - Optimized post retrieval with custom functions
 * 4. Tenant Statistics - Materialized view queries for dashboards
 * 5. Analytics Summaries - Hourly aggregated metrics
 * 6. Performance Metrics - Baseline tracking and comparison
 * 7. Table Optimization - ANALYZE and statistics updates
 * 8. Connection Statistics - Pool usage and efficiency
 * 9. Query Performance - Slow query detection and metrics
 * 10. Index Efficiency - Usage tracking and recommendations
 */

import { describe, it, beforeEach } from "node:test";
import type { TestContext } from "node:test";
import * as assert from "node:assert/strict";
import { DatabaseOptimizer } from "../../src/database/DatabaseOptimizer";

// ============================================================================
// Mock Factories
// ============================================================================

function createMockPrismaClient(t: TestContext) {
  return {
    $executeRaw: t.mock.fn(async () => undefined),
    $queryRaw: t.mock.fn(async () => []),
  };
}

function createMockLogger(t: TestContext) {
  return {
    info: t.mock.fn(),
    error: t.mock.fn(),
    warn: t.mock.fn(),
    debug: t.mock.fn(),
  };
}

// ============================================================================
// DatabaseOptimizer - Initialization Tests
// ============================================================================

describe("DatabaseOptimizer - Initialization", () => {
  it("should initialize with prisma client and logger", (t) => {
    const prisma = createMockPrismaClient(t);
    const logger = createMockLogger(t);

    const optimizer = new DatabaseOptimizer(prisma as any, logger as any);

    assert.ok(optimizer, "Should create optimizer instance");
  });
});

// ============================================================================
// DatabaseOptimizer - Materialized View Tests
// ============================================================================

describe("DatabaseOptimizer - Materialized View Refresh", () => {
  let optimizer: DatabaseOptimizer;
  let mockPrisma: ReturnType<typeof createMockPrismaClient>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach((t) => {
    mockPrisma = createMockPrismaClient(t);
    mockLogger = createMockLogger(t);
    optimizer = new DatabaseOptimizer(mockPrisma as any, mockLogger as any);
  });

  it("should refresh materialized views successfully", async () => {
    await optimizer.refreshMaterializedViews();

    assert.strictEqual(
      mockPrisma.$executeRaw.mock.calls.length,
      1,
      "Should execute refresh function"
    );
    assert.strictEqual(mockLogger.info.mock.calls.length, 2, "Should log start and completion");
  });

  it("should log error on materialized view refresh failure", async (t) => {
    mockPrisma.$executeRaw = t.mock.fn(async () => {
      throw new Error("Refresh failed");
    });

    await assert.rejects(
      async () => {
        await optimizer.refreshMaterializedViews();
      },
      {
        message: "Refresh failed",
      }
    );

    assert.strictEqual(mockLogger.error.mock.calls.length, 1, "Should log error");
  });

  it("should use stored function for refresh", async () => {
    await optimizer.refreshMaterializedViews();

    const executeCall = mockPrisma.$executeRaw.mock.calls[0];
    assert.ok(executeCall, "Should call $executeRaw");
  });
});

// ============================================================================
// DatabaseOptimizer - Health Report Tests
// ============================================================================

describe("DatabaseOptimizer - Database Health Report", () => {
  let optimizer: DatabaseOptimizer;
  let mockPrisma: ReturnType<typeof createMockPrismaClient>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach((t) => {
    mockPrisma = createMockPrismaClient(t);
    mockLogger = createMockLogger(t);
    optimizer = new DatabaseOptimizer(mockPrisma as any, mockLogger as any);

    // Mock connection stats
    mockPrisma.$queryRaw = t.mock.fn(async (query: any) => {
      const queryStr = query?.sql || String(query);

      if (queryStr.includes("connection_pool_stats")) {
        return [
          {
            total_connections: 20,
            active_connections: 5,
            idle_connections: 15,
            pool_utilization: 25,
          },
        ];
      }

      if (queryStr.includes("pg_stat_statements")) {
        return [
          {
            query: "SELECT * FROM posts",
            calls: 100,
            mean_exec_time: 50,
            max_exec_time: 200,
          },
        ];
      }

      if (queryStr.includes("pg_stat_user_indexes")) {
        return [
          {
            tablename: "posts",
            indexname: "idx_posts_project",
            idx_scan: 1000,
            idx_tup_read: 5000,
          },
        ];
      }

      return [];
    });
  });

  it("should generate comprehensive health report", async () => {
    const health = await optimizer.getDatabaseHealthReport();

    assert.ok(health, "Should return health report");
    assert.ok(
      ["healthy", "warning", "critical"].includes(health.overall),
      "Should have valid status"
    );
  });

  it("should include connection usage in health report", async () => {
    const health = await optimizer.getDatabaseHealthReport();

    assert.ok(health.connectionUsage, "Should include connection usage");
    assert.strictEqual(
      typeof health.connectionUsage.total,
      "number",
      "Should include total connections"
    );
    assert.strictEqual(
      typeof health.connectionUsage.active,
      "number",
      "Should include active connections"
    );
    assert.strictEqual(
      typeof health.connectionUsage.idle,
      "number",
      "Should include idle connections"
    );
    assert.strictEqual(
      typeof health.connectionUsage.utilization,
      "number",
      "Should include utilization"
    );
  });

  it("should include query performance metrics in health report", async () => {
    const health = await optimizer.getDatabaseHealthReport();

    assert.ok(Array.isArray(health.queryPerformance), "Should include query performance array");
  });

  it("should include index efficiency in health report", async () => {
    const health = await optimizer.getDatabaseHealthReport();

    assert.ok(Array.isArray(health.indexEfficiency), "Should include index efficiency array");
  });

  it("should include materialized view status in health report", async () => {
    const health = await optimizer.getDatabaseHealthReport();

    assert.ok(
      Array.isArray(health.materializedViewStatus),
      "Should include materialized view status"
    );
  });

  it("should report healthy status with good metrics", async () => {
    const health = await optimizer.getDatabaseHealthReport();

    assert.strictEqual(health.overall, "healthy", "Should report healthy status");
  });

  it("should report warning status with high utilization", async (t) => {
    mockPrisma.$queryRaw = t.mock.fn(async (query: any) => {
      const queryStr = query?.sql || String(query);

      if (queryStr.includes("connection_pool_stats")) {
        return [
          {
            total_connections: 20,
            active_connections: 15,
            idle_connections: 5,
            pool_utilization: 75,
          },
        ];
      }

      return [];
    });

    const health = await optimizer.getDatabaseHealthReport();

    assert.strictEqual(health.overall, "warning", "Should report warning status");
  });

  it("should report critical status with very high utilization", async (t) => {
    mockPrisma.$queryRaw = t.mock.fn(async (query: any) => {
      const queryStr = query?.sql || String(query);

      if (queryStr.includes("connection_pool_stats")) {
        return [
          {
            total_connections: 20,
            active_connections: 19,
            idle_connections: 1,
            pool_utilization: 95,
          },
        ];
      }

      return [];
    });

    const health = await optimizer.getDatabaseHealthReport();

    assert.strictEqual(health.overall, "critical", "Should report critical status");
  });

  it("should handle health check errors gracefully", async (t) => {
    mockPrisma.$queryRaw = t.mock.fn(async () => {
      throw new Error("Health check failed");
    });

    await assert.rejects(
      async () => {
        await optimizer.getDatabaseHealthReport();
      },
      {
        message: "Health check failed",
      }
    );

    assert.strictEqual(mockLogger.error.mock.calls.length, 1, "Should log error");
  });
});

// ============================================================================
// DatabaseOptimizer - Dashboard Posts Tests
// ============================================================================

describe("DatabaseOptimizer - Dashboard Posts", () => {
  let optimizer: DatabaseOptimizer;
  let mockPrisma: ReturnType<typeof createMockPrismaClient>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach((t) => {
    mockPrisma = createMockPrismaClient(t);
    mockLogger = createMockLogger(t);
    optimizer = new DatabaseOptimizer(mockPrisma as any, mockLogger as any);

    mockPrisma.$queryRaw = t.mock.fn(async () => [
      {
        post_id: "post-123",
        title: "Test Post",
        status: "PUBLISHED",
        scheduled_at: null,
        created_at: new Date("2024-01-01"),
        channel_count: 3,
        total_views: 1000,
      },
    ]);
  });

  it("should retrieve dashboard posts using optimized function", async () => {
    const accountId = "account-123";
    const posts = await optimizer.getDashboardPosts(accountId);

    assert.ok(Array.isArray(posts), "Should return array of posts");
    assert.strictEqual(posts.length, 1, "Should return posts");
  });

  it("should format post data correctly", async () => {
    const accountId = "account-123";
    const posts = await optimizer.getDashboardPosts(accountId);

    const post = posts[0];
    assert.strictEqual(post?.id, "post-123", "Should have correct ID");
    assert.strictEqual(post?.title, "Test Post", "Should have title");
    assert.strictEqual(post?.status, "PUBLISHED", "Should have status");
    assert.strictEqual(post?.channelCount, 3, "Should have channel count");
    assert.strictEqual(post?.totalViews, 1000, "Should have total views");
  });

  it("should use custom limit and offset", async () => {
    const accountId = "account-123";
    await optimizer.getDashboardPosts(accountId, 100, 50);

    assert.strictEqual(mockPrisma.$queryRaw.mock.calls.length, 1, "Should execute query");
  });

  it("should handle empty results", async (t) => {
    mockPrisma.$queryRaw = t.mock.fn(async () => []);

    const posts = await optimizer.getDashboardPosts("account-123");

    assert.strictEqual(posts.length, 0, "Should return empty array");
  });

  it("should log error on query failure", async (t) => {
    mockPrisma.$queryRaw = t.mock.fn(async () => {
      throw new Error("Query failed");
    });

    await assert.rejects(
      async () => {
        await optimizer.getDashboardPosts("account-123");
      },
      {
        message: "Query failed",
      }
    );

    assert.strictEqual(mockLogger.error.mock.calls.length, 1, "Should log error");
  });
});

// ============================================================================
// DatabaseOptimizer - Tenant Dashboard Stats Tests
// ============================================================================

describe("DatabaseOptimizer - Tenant Dashboard Stats", () => {
  let optimizer: DatabaseOptimizer;
  let mockPrisma: ReturnType<typeof createMockPrismaClient>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach((t) => {
    mockPrisma = createMockPrismaClient(t);
    mockLogger = createMockLogger(t);
    optimizer = new DatabaseOptimizer(mockPrisma as any, mockLogger as any);

    mockPrisma.$queryRaw = t.mock.fn(async () => [
      {
        accountId: "account-123",
        total_posts: 50,
        published_posts: 30,
        scheduled_posts: 15,
        failed_posts: 5,
        total_channels: 5,
        last_activity: new Date("2024-01-15"),
        avg_post_views: 500,
      },
    ]);
  });

  it("should retrieve tenant dashboard statistics", async () => {
    const stats = await optimizer.getTenantDashboardStats("account-123");

    assert.ok(stats, "Should return statistics");
    assert.strictEqual(stats?.totalPosts, 50, "Should have total posts");
    assert.strictEqual(stats?.publishedPosts, 30, "Should have published posts");
    assert.strictEqual(stats?.scheduledPosts, 15, "Should have scheduled posts");
  });

  it("should format statistics correctly", async () => {
    const stats = await optimizer.getTenantDashboardStats("account-123");

    assert.ok(stats, "Should return stats");
    assert.strictEqual(typeof stats?.totalPosts, "number", "Total posts should be number");
    assert.strictEqual(typeof stats?.avgPostViews, "number", "Average views should be number");
  });

  it("should return null when no stats found", async (t) => {
    mockPrisma.$queryRaw = t.mock.fn(async () => []);

    const stats = await optimizer.getTenantDashboardStats("account-123");

    assert.strictEqual(stats, null, "Should return null for no results");
  });

  it("should handle query errors", async (t) => {
    mockPrisma.$queryRaw = t.mock.fn(async () => {
      throw new Error("Stats query failed");
    });

    await assert.rejects(
      async () => {
        await optimizer.getTenantDashboardStats("account-123");
      },
      {
        message: "Stats query failed",
      }
    );

    assert.strictEqual(mockLogger.error.mock.calls.length, 1, "Should log error");
  });
});

// ============================================================================
// DatabaseOptimizer - Hourly Analytics Tests
// ============================================================================

describe("DatabaseOptimizer - Hourly Analytics Summary", () => {
  let optimizer: DatabaseOptimizer;
  let mockPrisma: ReturnType<typeof createMockPrismaClient>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach((t) => {
    mockPrisma = createMockPrismaClient(t);
    mockLogger = createMockLogger(t);
    optimizer = new DatabaseOptimizer(mockPrisma as any, mockLogger as any);

    mockPrisma.$queryRaw = t.mock.fn(async () => [
      {
        hour: new Date("2024-01-01T10:00:00Z"),
        total_views: 1000,
        total_likes: 50,
        total_comments: 20,
        total_shares: 10,
        data_points: 5,
      },
      {
        hour: new Date("2024-01-01T11:00:00Z"),
        total_views: 1200,
        total_likes: 60,
        total_comments: 25,
        total_shares: 15,
        data_points: 7,
      },
    ]);
  });

  it("should retrieve hourly analytics summary", async () => {
    const summary = await optimizer.getHourlyAnalyticsSummary("channel-123");

    assert.ok(Array.isArray(summary), "Should return array");
    assert.strictEqual(summary.length, 2, "Should return 2 hourly summaries");
  });

  it("should format analytics data correctly", async () => {
    const summary = await optimizer.getHourlyAnalyticsSummary("channel-123");

    const firstHour = summary[0];
    assert.ok(firstHour, "Should have first hour data");
    assert.strictEqual(firstHour.totalViews, 1000, "Should have views");
    assert.strictEqual(firstHour.totalLikes, 50, "Should have likes");
    assert.strictEqual(firstHour.totalComments, 20, "Should have comments");
    assert.strictEqual(firstHour.totalShares, 10, "Should have shares");
  });

  it("should use custom hours parameter", async () => {
    await optimizer.getHourlyAnalyticsSummary("channel-123", 48);

    assert.strictEqual(mockPrisma.$queryRaw.mock.calls.length, 1, "Should execute query");
  });

  it("should handle empty analytics", async (t) => {
    mockPrisma.$queryRaw = t.mock.fn(async () => []);

    const summary = await optimizer.getHourlyAnalyticsSummary("channel-123");

    assert.strictEqual(summary.length, 0, "Should return empty array");
  });

  it("should log error on query failure", async (t) => {
    mockPrisma.$queryRaw = t.mock.fn(async () => {
      throw new Error("Analytics query failed");
    });

    await assert.rejects(
      async () => {
        await optimizer.getHourlyAnalyticsSummary("channel-123");
      },
      {
        message: "Analytics query failed",
      }
    );

    assert.strictEqual(mockLogger.error.mock.calls.length, 1, "Should log error");
  });
});

// ============================================================================
// DatabaseOptimizer - Performance Metrics Tests
// ============================================================================

describe("DatabaseOptimizer - Performance Metrics", () => {
  let optimizer: DatabaseOptimizer;
  let mockPrisma: ReturnType<typeof createMockPrismaClient>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach((t) => {
    mockPrisma = createMockPrismaClient(t);
    mockLogger = createMockLogger(t);
    optimizer = new DatabaseOptimizer(mockPrisma as any, mockLogger as any);
  });

  it("should record performance metric", async () => {
    await optimizer.recordPerformanceMetric("query_time", 50, "ms", { query: "SELECT posts" });

    assert.strictEqual(
      mockPrisma.$executeRaw.mock.calls.length,
      1,
      "Should execute metric recording"
    );
  });

  it("should handle metric recording errors", async (t) => {
    mockPrisma.$executeRaw = t.mock.fn(async () => {
      throw new Error("Metric recording failed");
    });

    await assert.rejects(
      async () => {
        await optimizer.recordPerformanceMetric("query_time", 50, "ms");
      },
      {
        message: "Metric recording failed",
      }
    );

    assert.strictEqual(mockLogger.error.mock.calls.length, 1, "Should log error");
  });
});

// ============================================================================
// DatabaseOptimizer - Performance Baselines Tests
// ============================================================================

describe("DatabaseOptimizer - Performance Baselines", () => {
  let optimizer: DatabaseOptimizer;
  let mockPrisma: ReturnType<typeof createMockPrismaClient>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach((t) => {
    mockPrisma = createMockPrismaClient(t);
    mockLogger = createMockLogger(t);
    optimizer = new DatabaseOptimizer(mockPrisma as any, mockLogger as any);

    mockPrisma.$queryRaw = t.mock.fn(async () => [
      {
        metric_name: "query_time",
        current_value: 45,
        baseline_value: 50,
        improvement: -10,
      },
      {
        metric_name: "connection_pool_usage",
        current_value: 80,
        baseline_value: 70,
        improvement: 14.28,
      },
    ]);
  });

  it("should retrieve performance baselines", async () => {
    const baselines = await optimizer.getPerformanceBaselines();

    assert.ok(Array.isArray(baselines), "Should return array");
    assert.strictEqual(baselines.length, 2, "Should return 2 baselines");
  });

  it("should format baseline data with status", async () => {
    const baselines = await optimizer.getPerformanceBaselines();

    const improved = baselines.find((b) => b.metricName === "query_time");
    assert.ok(improved, "Should have query_time baseline");
    assert.strictEqual(improved.status, "improved", "Should mark as improved");

    const degraded = baselines.find((b) => b.metricName === "connection_pool_usage");
    assert.ok(degraded, "Should have connection_pool_usage baseline");
    assert.strictEqual(degraded.status, "degraded", "Should mark as degraded");
  });

  it("should handle baseline query errors", async (t) => {
    mockPrisma.$queryRaw = t.mock.fn(async () => {
      throw new Error("Baseline query failed");
    });

    await assert.rejects(
      async () => {
        await optimizer.getPerformanceBaselines();
      },
      {
        message: "Baseline query failed",
      }
    );

    assert.strictEqual(mockLogger.error.mock.calls.length, 1, "Should log error");
  });
});

// ============================================================================
// DatabaseOptimizer - Table Optimization Tests
// ============================================================================

describe("DatabaseOptimizer - Table Optimization", () => {
  let optimizer: DatabaseOptimizer;
  let mockPrisma: ReturnType<typeof createMockPrismaClient>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach((t) => {
    mockPrisma = createMockPrismaClient(t);
    mockLogger = createMockLogger(t);
    optimizer = new DatabaseOptimizer(mockPrisma as any, mockLogger as any);
  });

  it("should optimize tables successfully", async () => {
    await optimizer.optimizeTables();

    assert.strictEqual(
      mockPrisma.$executeRaw.mock.calls.length,
      2,
      "Should execute ANALYZE and stats collection"
    );
    assert.strictEqual(mockLogger.info.mock.calls.length, 2, "Should log start and completion");
  });

  it("should handle optimization errors", async (t) => {
    mockPrisma.$executeRaw = t.mock.fn(async () => {
      throw new Error("Optimization failed");
    });

    await assert.rejects(
      async () => {
        await optimizer.optimizeTables();
      },
      {
        message: "Optimization failed",
      }
    );

    assert.strictEqual(mockLogger.error.mock.calls.length, 1, "Should log error");
  });
});

// ============================================================================
// DatabaseOptimizer - Automatic Refresh Tests
// ============================================================================

describe("DatabaseOptimizer - Automatic Refresh", () => {
  let optimizer: DatabaseOptimizer;
  let mockPrisma: ReturnType<typeof createMockPrismaClient>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach((t) => {
    mockPrisma = createMockPrismaClient(t);
    mockLogger = createMockLogger(t);
    optimizer = new DatabaseOptimizer(mockPrisma as any, mockLogger as any);
  });

  it("should schedule automatic refresh", async () => {
    process.env.MATERIALIZED_VIEW_REFRESH_INTERVAL = "60000";

    await optimizer.scheduleAutomaticRefresh();

    assert.strictEqual(mockLogger.info.mock.calls.length, 1, "Should log scheduling");

    delete process.env.MATERIALIZED_VIEW_REFRESH_INTERVAL;
  });

  it("should use default refresh interval when not configured", async () => {
    delete process.env.MATERIALIZED_VIEW_REFRESH_INTERVAL;

    await optimizer.scheduleAutomaticRefresh();

    assert.strictEqual(mockLogger.info.mock.calls.length, 1, "Should log scheduling with default");
  });
});
