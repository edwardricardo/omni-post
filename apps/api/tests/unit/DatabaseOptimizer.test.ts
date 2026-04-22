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

import { describe, it, beforeEach, vi, expect } from "vitest";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import { DatabaseOptimizer } from "../../src/database/DatabaseOptimizer";

const scheduler = new NoopBackgroundTaskScheduler();

// ============================================================================
// Mock Factories
// ============================================================================

function createMockPrismaClient() {
  return {
    $executeRaw: vi.fn(async () => undefined),
    $queryRaw: vi.fn(async () => []),
  };
}

function createMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
}

// ============================================================================
// DatabaseOptimizer - Initialization Tests
// ============================================================================

describe("DatabaseOptimizer - Initialization", () => {
  it("should initialize with prisma client and logger", (_t) => {
    const prisma = createMockPrismaClient();
    const logger = createMockLogger();

    const optimizer = new DatabaseOptimizer(prisma as any, logger as any, scheduler);

    expect(optimizer).toBeTruthy();
  });
});

// ============================================================================
// DatabaseOptimizer - Materialized View Tests
// ============================================================================

describe("DatabaseOptimizer - Materialized View Refresh", () => {
  let optimizer: DatabaseOptimizer;
  let mockPrisma: ReturnType<typeof createMockPrismaClient>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockPrisma = createMockPrismaClient();
    mockLogger = createMockLogger();
    optimizer = new DatabaseOptimizer(mockPrisma as any, mockLogger as any, scheduler);
  });

  it("should refresh materialized views successfully", async () => {
    await optimizer.refreshMaterializedViews();

    expect(mockPrisma.$executeRaw.mock.calls.length).toBe(1);
    expect(mockLogger.info.mock.calls.length).toBe(2);
  });

  it("should log error on materialized view refresh failure", async (_t) => {
    mockPrisma.$executeRaw = vi.fn(async () => {
      throw new Error("Refresh failed");
    });

    await expect(optimizer.refreshMaterializedViews()).rejects.toThrow("Refresh failed");

    expect(mockLogger.error.mock.calls.length).toBe(1);
  });

  it("should use stored function for refresh", async () => {
    await optimizer.refreshMaterializedViews();

    const executeCall = mockPrisma.$executeRaw.mock.calls[0];
    expect(executeCall).toBeTruthy();
  });
});

// ============================================================================
// DatabaseOptimizer - Health Report Tests
// ============================================================================

describe("DatabaseOptimizer - Database Health Report", () => {
  let optimizer: DatabaseOptimizer;
  let mockPrisma: ReturnType<typeof createMockPrismaClient>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockPrisma = createMockPrismaClient();
    mockLogger = createMockLogger();
    optimizer = new DatabaseOptimizer(mockPrisma as any, mockLogger as any, scheduler);

    // Mock connection stats
    mockPrisma.$queryRaw = vi.fn(async (query: any) => {
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

    expect(health).toBeTruthy();
    expect(["healthy", "warning", "critical"].includes(health.overall)).toBeTruthy();
  });

  it("should include connection usage in health report", async () => {
    const health = await optimizer.getDatabaseHealthReport();

    expect(health.connectionUsage).toBeTruthy();
    expect(typeof health.connectionUsage.total).toBe("number");
    expect(typeof health.connectionUsage.active).toBe("number");
    expect(typeof health.connectionUsage.idle).toBe("number");
    expect(typeof health.connectionUsage.utilization).toBe("number");
  });

  it("should include query performance metrics in health report", async () => {
    const health = await optimizer.getDatabaseHealthReport();

    expect(Array.isArray(health.queryPerformance)).toBeTruthy();
  });

  it("should include index efficiency in health report", async () => {
    const health = await optimizer.getDatabaseHealthReport();

    expect(Array.isArray(health.indexEfficiency)).toBeTruthy();
  });

  it("should include materialized view status in health report", async () => {
    const health = await optimizer.getDatabaseHealthReport();

    expect(Array.isArray(health.materializedViewStatus)).toBeTruthy();
  });

  it("should report healthy status with good metrics", async () => {
    const health = await optimizer.getDatabaseHealthReport();

    expect(health.overall).toBe("healthy");
  });

  it("should report warning status with high utilization", async (_t) => {
    mockPrisma.$queryRaw = vi.fn(async (query: any) => {
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

    expect(health.overall).toBe("warning");
  });

  it("should report critical status with very high utilization", async (_t) => {
    mockPrisma.$queryRaw = vi.fn(async (query: any) => {
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

    expect(health.overall).toBe("critical");
  });

  it("should handle health check errors gracefully", async (_t) => {
    mockPrisma.$queryRaw = vi.fn(async () => {
      throw new Error("Health check failed");
    });

    await expect(optimizer.getDatabaseHealthReport()).rejects.toThrow("Health check failed");

    expect(mockLogger.error.mock.calls.length).toBe(1);
  });
});

// ============================================================================
// DatabaseOptimizer - Dashboard Posts Tests
// ============================================================================

describe("DatabaseOptimizer - Dashboard Posts", () => {
  let optimizer: DatabaseOptimizer;
  let mockPrisma: ReturnType<typeof createMockPrismaClient>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockPrisma = createMockPrismaClient();
    mockLogger = createMockLogger();
    optimizer = new DatabaseOptimizer(mockPrisma as any, mockLogger as any, scheduler);

    mockPrisma.$queryRaw = vi.fn(async () => [
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

    expect(Array.isArray(posts)).toBeTruthy();
    expect(posts.length).toBe(1);
  });

  it("should format post data correctly", async () => {
    const accountId = "account-123";
    const posts = await optimizer.getDashboardPosts(accountId);

    const post = posts[0];
    expect(post?.id).toBe("post-123");
    expect(post?.title).toBe("Test Post");
    expect(post?.status).toBe("PUBLISHED");
    expect(post?.channelCount).toBe(3);
    expect(post?.totalViews).toBe(1000);
  });

  it("should use custom limit and offset", async () => {
    const accountId = "account-123";
    await optimizer.getDashboardPosts(accountId, 100, 50);

    expect(mockPrisma.$queryRaw.mock.calls.length).toBe(1);
  });

  it("should handle empty results", async (_t) => {
    mockPrisma.$queryRaw = vi.fn(async () => []);

    const posts = await optimizer.getDashboardPosts("account-123");

    expect(posts.length).toBe(0);
  });

  it("should log error on query failure", async (_t) => {
    mockPrisma.$queryRaw = vi.fn(async () => {
      throw new Error("Query failed");
    });

    await expect(optimizer.getDashboardPosts("account-123")).rejects.toThrow("Query failed");

    expect(mockLogger.error.mock.calls.length).toBe(1);
  });
});

// ============================================================================
// DatabaseOptimizer - Tenant Dashboard Stats Tests
// ============================================================================

describe("DatabaseOptimizer - Tenant Dashboard Stats", () => {
  let optimizer: DatabaseOptimizer;
  let mockPrisma: ReturnType<typeof createMockPrismaClient>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockPrisma = createMockPrismaClient();
    mockLogger = createMockLogger();
    optimizer = new DatabaseOptimizer(mockPrisma as any, mockLogger as any, scheduler);

    mockPrisma.$queryRaw = vi.fn(async () => [
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

    expect(stats).toBeTruthy();
    expect(stats?.totalPosts).toBe(50);
    expect(stats?.publishedPosts).toBe(30);
    expect(stats?.scheduledPosts).toBe(15);
  });

  it("should format statistics correctly", async () => {
    const stats = await optimizer.getTenantDashboardStats("account-123");

    expect(stats).toBeTruthy();
    expect(typeof stats?.totalPosts).toBe("number");
    expect(typeof stats?.avgPostViews).toBe("number");
  });

  it("should return null when no stats found", async (_t) => {
    mockPrisma.$queryRaw = vi.fn(async () => []);

    const stats = await optimizer.getTenantDashboardStats("account-123");

    expect(stats).toBe(null);
  });

  it("should handle query errors", async (_t) => {
    mockPrisma.$queryRaw = vi.fn(async () => {
      throw new Error("Stats query failed");
    });

    await expect(optimizer.getTenantDashboardStats("account-123")).rejects.toThrow(
      "Stats query failed"
    );

    expect(mockLogger.error.mock.calls.length).toBe(1);
  });
});

// ============================================================================
// DatabaseOptimizer - Hourly Analytics Tests
// ============================================================================

describe("DatabaseOptimizer - Hourly Analytics Summary", () => {
  let optimizer: DatabaseOptimizer;
  let mockPrisma: ReturnType<typeof createMockPrismaClient>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockPrisma = createMockPrismaClient();
    mockLogger = createMockLogger();
    optimizer = new DatabaseOptimizer(mockPrisma as any, mockLogger as any, scheduler);

    mockPrisma.$queryRaw = vi.fn(async () => [
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

    expect(Array.isArray(summary)).toBeTruthy();
    expect(summary.length).toBe(2);
  });

  it("should format analytics data correctly", async () => {
    const summary = await optimizer.getHourlyAnalyticsSummary("channel-123");

    const firstHour = summary[0];
    expect(firstHour).toBeTruthy();
    expect(firstHour.totalViews).toBe(1000);
    expect(firstHour.totalLikes).toBe(50);
    expect(firstHour.totalComments).toBe(20);
    expect(firstHour.totalShares).toBe(10);
  });

  it("should use custom hours parameter", async () => {
    await optimizer.getHourlyAnalyticsSummary("channel-123", 48);

    expect(mockPrisma.$queryRaw.mock.calls.length).toBe(1);
  });

  it("should handle empty analytics", async (_t) => {
    mockPrisma.$queryRaw = vi.fn(async () => []);

    const summary = await optimizer.getHourlyAnalyticsSummary("channel-123");

    expect(summary.length).toBe(0);
  });

  it("should log error on query failure", async (_t) => {
    mockPrisma.$queryRaw = vi.fn(async () => {
      throw new Error("Analytics query failed");
    });

    await expect(optimizer.getHourlyAnalyticsSummary("channel-123")).rejects.toThrow(
      "Analytics query failed"
    );

    expect(mockLogger.error.mock.calls.length).toBe(1);
  });
});

// ============================================================================
// DatabaseOptimizer - Performance Metrics Tests
// ============================================================================

describe("DatabaseOptimizer - Performance Metrics", () => {
  let optimizer: DatabaseOptimizer;
  let mockPrisma: ReturnType<typeof createMockPrismaClient>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockPrisma = createMockPrismaClient();
    mockLogger = createMockLogger();
    optimizer = new DatabaseOptimizer(mockPrisma as any, mockLogger as any, scheduler);
  });

  it("should record performance metric", async () => {
    await optimizer.recordPerformanceMetric("query_time", 50, "ms", { query: "SELECT posts" });

    expect(mockPrisma.$executeRaw.mock.calls.length).toBe(1);
  });

  it("should handle metric recording errors", async (_t) => {
    mockPrisma.$executeRaw = vi.fn(async () => {
      throw new Error("Metric recording failed");
    });

    await expect(optimizer.recordPerformanceMetric("query_time", 50, "ms")).rejects.toThrow(
      "Metric recording failed"
    );

    expect(mockLogger.error.mock.calls.length).toBe(1);
  });
});

// ============================================================================
// DatabaseOptimizer - Performance Baselines Tests
// ============================================================================

describe("DatabaseOptimizer - Performance Baselines", () => {
  let optimizer: DatabaseOptimizer;
  let mockPrisma: ReturnType<typeof createMockPrismaClient>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockPrisma = createMockPrismaClient();
    mockLogger = createMockLogger();
    optimizer = new DatabaseOptimizer(mockPrisma as any, mockLogger as any, scheduler);

    mockPrisma.$queryRaw = vi.fn(async () => [
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

    expect(Array.isArray(baselines)).toBeTruthy();
    expect(baselines.length).toBe(2);
  });

  it("should format baseline data with status", async () => {
    const baselines = await optimizer.getPerformanceBaselines();

    const improved = baselines.find((b) => b.metricName === "query_time");
    expect(improved).toBeTruthy();
    expect(improved.status).toBe("improved");

    const degraded = baselines.find((b) => b.metricName === "connection_pool_usage");
    expect(degraded).toBeTruthy();
    expect(degraded.status).toBe("degraded");
  });

  it("should handle baseline query errors", async (_t) => {
    mockPrisma.$queryRaw = vi.fn(async () => {
      throw new Error("Baseline query failed");
    });

    await expect(optimizer.getPerformanceBaselines()).rejects.toThrow("Baseline query failed");

    expect(mockLogger.error.mock.calls.length).toBe(1);
  });
});

// ============================================================================
// DatabaseOptimizer - Table Optimization Tests
// ============================================================================

describe("DatabaseOptimizer - Table Optimization", () => {
  let optimizer: DatabaseOptimizer;
  let mockPrisma: ReturnType<typeof createMockPrismaClient>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockPrisma = createMockPrismaClient();
    mockLogger = createMockLogger();
    optimizer = new DatabaseOptimizer(mockPrisma as any, mockLogger as any, scheduler);
  });

  it("should optimize tables successfully", async () => {
    await optimizer.optimizeTables();

    expect(mockPrisma.$executeRaw.mock.calls.length).toBe(2);
    expect(mockLogger.info.mock.calls.length).toBe(2);
  });

  it("should handle optimization errors", async (_t) => {
    mockPrisma.$executeRaw = vi.fn(async () => {
      throw new Error("Optimization failed");
    });

    await expect(optimizer.optimizeTables()).rejects.toThrow("Optimization failed");

    expect(mockLogger.error.mock.calls.length).toBe(1);
  });
});

// ============================================================================
// DatabaseOptimizer - Automatic Refresh Tests
// ============================================================================

describe("DatabaseOptimizer - Automatic Refresh", () => {
  let optimizer: DatabaseOptimizer;
  let mockPrisma: ReturnType<typeof createMockPrismaClient>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockPrisma = createMockPrismaClient();
    mockLogger = createMockLogger();
    optimizer = new DatabaseOptimizer(mockPrisma as any, mockLogger as any, scheduler);
  });

  it("should schedule automatic refresh", async () => {
    process.env.MATERIALIZED_VIEW_REFRESH_INTERVAL = "60000";

    await optimizer.scheduleAutomaticRefresh();

    expect(mockLogger.info.mock.calls.length).toBe(1);

    delete process.env.MATERIALIZED_VIEW_REFRESH_INTERVAL;
  });

  it("should use default refresh interval when not configured", async () => {
    delete process.env.MATERIALIZED_VIEW_REFRESH_INTERVAL;

    await optimizer.scheduleAutomaticRefresh();

    expect(mockLogger.info.mock.calls.length).toBe(1);
  });
});
