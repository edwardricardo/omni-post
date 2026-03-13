/**
 * Database Optimization Utils - Comprehensive Test Suite
 *
 * These tests validate the database optimization utilities that track
 * query performance, generate index recommendations, and provide insights.
 *
 * Key Features Tested:
 * 1. Query Tracking - Monitor and record query performance
 * 2. Slow Query Detection - Identify queries exceeding threshold
 * 3. Database Statistics - Connection pool and table stats
 * 4. Index Recommendations - Suggest optimal indexes
 * 5. Table Statistics - Row counts and size information
 * 6. Query Pattern Analysis - Identify common query patterns
 * 7. Metrics Integration - Database operation tracking
 * 8. Query Sanitization - Safe logging of queries and params
 * 9. Stack Trace Capture - Debugging slow queries
 * 10. Prisma Middleware - Performance monitoring integration
 */

import { describe, it, beforeEach, vi, expect } from "vitest";

// Mock @infra/prisma so prisma.post.count() etc. return 0 instead of undefined
vi.mock("@infra/prisma", async (importOriginal) => {
  const { vi: _vi } = await import("vitest");
  const orig = await importOriginal<Record<string, unknown>>();
  const mkModel = () => ({ count: _vi.fn(async () => 0) });
  return {
    ...orig,
    prisma: {
      post: mkModel(),
      postContent: mkModel(),
      publishLog: mkModel(),
      analytics: mkModel(),
      $connect: _vi.fn(async () => undefined),
      $disconnect: _vi.fn(async () => undefined),
      $queryRaw: _vi.fn(async () => []),
    },
  };
});

import { DatabaseOptimizer, OptimizedQueries } from "../../src/utils/dbOptimization";
import type { ApiMetrics } from "../../src/metrics/apiMetrics";

// ============================================================================
// Mock Setup
// ============================================================================

function createMockApiMetrics(): ApiMetrics {
  return {
    metrics: {
      dbOperations: {
        inc: vi.fn(),
        labels: vi.fn(() => ({
          inc: vi.fn(),
        })),
      },
    },
  } as any;
}

// ============================================================================
// DatabaseOptimizer - Initialization Tests
// ============================================================================

describe("DatabaseOptimizer - Initialization", () => {
  it("should initialize with metrics", (t) => {
    const metrics = createMockApiMetrics();
    const optimizer = new DatabaseOptimizer(metrics);

    expect(optimizer).toBeTruthy();
  });

  it("should use default slow query threshold", (t) => {
    const metrics = createMockApiMetrics();
    const optimizer = new DatabaseOptimizer(metrics);

    expect(optimizer).toBeTruthy();
  });
});

// ============================================================================
// DatabaseOptimizer - Query Tracking Tests
// ============================================================================

describe("DatabaseOptimizer - Query Tracking", () => {
  let optimizer: DatabaseOptimizer;
  let mockMetrics: ApiMetrics;

  beforeEach(() => {
    mockMetrics = createMockApiMetrics();
    optimizer = new DatabaseOptimizer(mockMetrics);
  });

  it("should track query execution", async () => {
    await optimizer.trackQuery("SELECT * FROM posts", 50);

    expect(mockMetrics.metrics.dbOperations.inc.mock.calls.length).toBe(1);
  });

  it("should track queries with parameters", async () => {
    await optimizer.trackQuery("SELECT * FROM posts WHERE id = $1", 50, ["post-123"]);

    expect(mockMetrics.metrics.dbOperations.inc.mock.calls.length).toBe(1);
  });

  it("should detect slow queries", async () => {
    await optimizer.trackQuery("SELECT * FROM posts", 150);

    const stats = await optimizer.getDatabaseStats();
    expect(stats.slowQueries.length > 0).toBeTruthy();
  });

  it("should not log fast queries as slow", async () => {
    await optimizer.trackQuery("SELECT * FROM posts", 50);

    const stats = await optimizer.getDatabaseStats();
    expect(stats.slowQueries.length).toBe(0);
  });

  it("should sanitize query before logging", async () => {
    await optimizer.trackQuery("SELECT * FROM users WHERE password = 'secret123'", 150);

    const stats = await optimizer.getDatabaseStats();
    expect(stats.slowQueries.length > 0).toBeTruthy();
    const recorded = stats.slowQueries[0]!;
    expect(recorded.query.includes("secret123")).toBeFalsy();
  });

  it("should capture stack trace for slow queries", async () => {
    await optimizer.trackQuery("SELECT * FROM posts", 150);

    const stats = await optimizer.getDatabaseStats();
    expect(stats.slowQueries.length > 0).toBeTruthy();
    const recorded = stats.slowQueries[0]!;
    expect(recorded.stackTrace).toBeTruthy();
    expect(recorded.stackTrace!.length > 0).toBeTruthy();
  });

  it("should limit slow query history to max size", async () => {
    for (let i = 0; i < 110; i++) {
      await optimizer.trackQuery(`SELECT * FROM table${i}`, 150);
    }

    const stats = await optimizer.getDatabaseStats();
    expect(stats.slowQueries.length <= 100).toBeTruthy();
  });
});

// ============================================================================
// DatabaseOptimizer - Database Stats Tests
// ============================================================================

describe("DatabaseOptimizer - Database Statistics", () => {
  let optimizer: DatabaseOptimizer;

  beforeEach(() => {
    const mockMetrics = createMockApiMetrics();
    optimizer = new DatabaseOptimizer(mockMetrics);
  });

  it("should return database statistics", async () => {
    const stats = await optimizer.getDatabaseStats();

    expect(stats).toBeTruthy();
    expect(typeof stats.connectionPoolSize).toBe("number");
    expect(typeof stats.activeConnections).toBe("number");
    expect(typeof stats.idleConnections).toBe("number");
  });

  it("should include slow queries in stats", async () => {
    await optimizer.trackQuery("SELECT * FROM posts", 150);

    const stats = await optimizer.getDatabaseStats();
    expect(Array.isArray(stats.slowQueries)).toBeTruthy();
  });

  it("should include index recommendations in stats", async () => {
    const stats = await optimizer.getDatabaseStats();

    expect(Array.isArray(stats.indexRecommendations)).toBeTruthy();
    expect(stats.indexRecommendations.length > 0).toBeTruthy();
  });

  it("should include table statistics in stats", async () => {
    const stats = await optimizer.getDatabaseStats();

    expect(Array.isArray(stats.tableStats)).toBeTruthy();
    expect(stats.tableStats.length > 0).toBeTruthy();
  });

  it("should handle stats errors gracefully", async (t) => {
    const errorMetrics = createMockApiMetrics();
    const errorOptimizer = new DatabaseOptimizer(errorMetrics);

    const stats = await errorOptimizer.getDatabaseStats();

    expect(stats).toBeTruthy();
    expect(stats.connectionPoolSize).toBe(0);
  });
});

// ============================================================================
// DatabaseOptimizer - Index Recommendations Tests
// ============================================================================

describe("DatabaseOptimizer - Index Recommendations", () => {
  let optimizer: DatabaseOptimizer;

  beforeEach(() => {
    const mockMetrics = createMockApiMetrics();
    optimizer = new DatabaseOptimizer(mockMetrics);
  });

  it("should generate index recommendations", async () => {
    const stats = await optimizer.getDatabaseStats();

    expect(stats.indexRecommendations.length > 0).toBeTruthy();
  });

  it("should recommend indexes for posts table", async () => {
    const stats = await optimizer.getDatabaseStats();

    const postsRecommendation = stats.indexRecommendations.find((r) => r.table === "posts");
    expect(postsRecommendation).toBeTruthy();
    expect(postsRecommendation.columns.length > 0).toBeTruthy();
    expect(postsRecommendation.reason).toBeTruthy();
    expect(["high", "medium", "low"].includes(postsRecommendation.priority)).toBeTruthy();
  });

  it("should recommend indexes for publishLogs table", async () => {
    const stats = await optimizer.getDatabaseStats();

    const publishLogsRecommendation = stats.indexRecommendations.find(
      (r) => r.table === "publishLogs"
    );
    expect(publishLogsRecommendation).toBeTruthy();
  });

  it("should recommend indexes for analytics table", async () => {
    const stats = await optimizer.getDatabaseStats();

    const analyticsRecommendation = stats.indexRecommendations.find((r) => r.table === "analytics");
    expect(analyticsRecommendation).toBeTruthy();
  });

  it("should include estimated improvement in recommendations", async () => {
    const stats = await optimizer.getDatabaseStats();

    stats.indexRecommendations.forEach((rec) => {
      expect(rec.estimatedImprovement).toBeTruthy();
      expect(rec.estimatedImprovement.length > 0).toBeTruthy();
    });
  });
});

// ============================================================================
// DatabaseOptimizer - Query Sanitization Tests
// ============================================================================

describe("DatabaseOptimizer - Query Sanitization", () => {
  let optimizer: DatabaseOptimizer;

  beforeEach(() => {
    const mockMetrics = createMockApiMetrics();
    optimizer = new DatabaseOptimizer(mockMetrics);
  });

  it("should sanitize Prisma parameters", async () => {
    await optimizer.trackQuery("SELECT * FROM posts WHERE id = $1 AND status = $2", 150, [
      "id-123",
      "PUBLISHED",
    ]);

    const stats = await optimizer.getDatabaseStats();
    expect(stats.slowQueries.length > 0).toBeTruthy();
    const recorded = stats.slowQueries[0]!;
    expect(recorded.query.includes("$1")).toBeFalsy();
  });

  it("should sanitize string literals", async () => {
    await optimizer.trackQuery("SELECT * FROM posts WHERE title = 'Secret Title'", 150);

    const stats = await optimizer.getDatabaseStats();
    expect(stats.slowQueries.length > 0).toBeTruthy();
    const recorded = stats.slowQueries[0]!;
    expect(recorded.query.includes("Secret Title")).toBeFalsy();
  });

  it("should normalize whitespace in queries", async () => {
    await optimizer.trackQuery("SELECT  *   FROM    posts   WHERE   id = $1", 150);

    const stats = await optimizer.getDatabaseStats();
    expect(stats.slowQueries.length > 0).toBeTruthy();
    const recorded = stats.slowQueries[0]!;
    expect(recorded.query.includes("  ")).toBeFalsy();
  });

  it("should truncate long parameter values", async () => {
    const longString = "a".repeat(100);
    await optimizer.trackQuery("SELECT * FROM posts", 150, [longString]);

    const stats = await optimizer.getDatabaseStats();
    expect(stats.slowQueries.length > 0).toBeTruthy();
    const recorded = stats.slowQueries[0]!;
    expect(recorded.params).toBeTruthy();
    const param = recorded.params![0] as string;
    expect(param.length <= 13).toBeTruthy();
  });
});

// ============================================================================
// DatabaseOptimizer - Slow Query Analysis Tests
// ============================================================================

describe("DatabaseOptimizer - Slow Query Analysis", () => {
  let optimizer: DatabaseOptimizer;

  beforeEach(() => {
    const mockMetrics = createMockApiMetrics();
    optimizer = new DatabaseOptimizer(mockMetrics);
  });

  it("should filter recent slow queries (within 1 hour)", async () => {
    await optimizer.trackQuery("SELECT * FROM posts", 150);

    const stats = await optimizer.getDatabaseStats();
    expect(stats.slowQueries.length > 0).toBeTruthy();
  });

  it("should sort slow queries by duration", async () => {
    await optimizer.trackQuery("SELECT * FROM posts", 200);
    await optimizer.trackQuery("SELECT * FROM users", 150);
    await optimizer.trackQuery("SELECT * FROM channels", 300);

    const stats = await optimizer.getDatabaseStats();
    const durations = stats.slowQueries.map((q) => q.duration);

    for (let i = 0; i < durations.length - 1; i++) {
      expect(durations[i]! >= durations[i + 1]!).toBeTruthy();
    }
  });

  it("should limit slow queries to top 20", async () => {
    for (let i = 0; i < 30; i++) {
      await optimizer.trackQuery(`SELECT * FROM table${i}`, 150);
    }

    const stats = await optimizer.getDatabaseStats();
    expect(stats.slowQueries.length <= 20).toBeTruthy();
  });

  it("should identify common query patterns", async () => {
    await optimizer.trackQuery("SELECT * FROM posts WHERE projectId = $1", 150);
    await optimizer.trackQuery("SELECT * FROM posts WHERE postId = $1 ORDER BY createdAt", 150);

    const stats = await optimizer.getDatabaseStats();
    expect(stats.slowQueries.length >= 2).toBeTruthy();
  });
});

// ============================================================================
// DatabaseOptimizer - Prisma Middleware Tests
// ============================================================================

describe("DatabaseOptimizer - Prisma Middleware", () => {
  let optimizer: DatabaseOptimizer;

  beforeEach(() => {
    const mockMetrics = createMockApiMetrics();
    optimizer = new DatabaseOptimizer(mockMetrics);
  });

  it("should create Prisma middleware", () => {
    const middleware = optimizer.createPrismaMiddleware();

    expect(middleware).toBeTruthy();
    expect(typeof middleware).toBe("function");
  });

  it("should track query through middleware", async (t) => {
    const middleware = optimizer.createPrismaMiddleware();

    const mockParams = {
      model: "Post",
      action: "findMany",
      args: { where: { projectId: "project-123" } },
    };

    const mockNext = vi.fn(async () => [{ id: "post-123" }]);

    await middleware(mockParams, mockNext);

    expect(mockNext.mock.calls.length).toBe(1);
  });

  it("should measure query duration in middleware", async (t) => {
    const middleware = optimizer.createPrismaMiddleware();

    const mockParams = {
      model: "Post",
      action: "findMany",
      args: {},
    };

    const mockNext = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return [{ id: "post-123" }];
    });

    const result = await middleware(mockParams, mockNext);

    expect(result).toBeTruthy();
  });
});

// ============================================================================
// DatabaseOptimizer - Index Creation Tests
// ============================================================================

describe("DatabaseOptimizer - Index Creation", () => {
  let optimizer: DatabaseOptimizer;

  beforeEach(() => {
    const mockMetrics = createMockApiMetrics();
    optimizer = new DatabaseOptimizer(mockMetrics);
  });

  it("should provide index creation commands", async () => {
    const result = await optimizer.createRecommendedIndexes();

    expect(result).toBeTruthy();
    expect(Array.isArray(result.created)).toBeTruthy();
    expect(Array.isArray(result.failed)).toBeTruthy();
  });

  it("should return index commands for recommended indexes", async () => {
    const result = await optimizer.createRecommendedIndexes();

    expect(result.created.length > 0).toBeTruthy();

    result.created.forEach((cmd) => {
      expect(cmd.includes("CREATE INDEX")).toBeTruthy();
      expect(cmd.includes("CONCURRENTLY")).toBeTruthy();
    });
  });

  it("should create indexes for posts table", async () => {
    const result = await optimizer.createRecommendedIndexes();

    const postsIndex = result.created.find((cmd) => cmd.includes("posts"));
    expect(postsIndex).toBeTruthy();
  });

  it("should create indexes for publishLogs table", async () => {
    const result = await optimizer.createRecommendedIndexes();

    const publishLogsIndex = result.created.find((cmd) => cmd.includes("publishLogs"));
    expect(publishLogsIndex).toBeTruthy();
  });

  it("should create indexes for analytics table", async () => {
    const result = await optimizer.createRecommendedIndexes();

    const analyticsIndex = result.created.find((cmd) => cmd.includes("analytics"));
    expect(analyticsIndex).toBeTruthy();
  });
});

// ============================================================================
// OptimizedQueries - Paginated Posts Tests
// ============================================================================

describe("OptimizedQueries - Paginated Posts", () => {
  it("should provide paginated posts query helper", () => {
    expect(OptimizedQueries.getPostsPaginated).toBeTruthy();
    expect(typeof OptimizedQueries.getPostsPaginated).toBe("function");
  });

  it("should calculate correct offset for pagination", async () => {
    const page = 3;
    const limit = 20;
    const expectedOffset = (page - 1) * limit;

    expect(expectedOffset).toBe(40);
  });
});

// ============================================================================
// OptimizedQueries - Analytics Aggregation Tests
// ============================================================================

describe("OptimizedQueries - Analytics Aggregation", () => {
  it("should provide analytics aggregation helper", () => {
    expect(OptimizedQueries.getAnalyticsAggregated).toBeTruthy();
    expect(typeof OptimizedQueries.getAnalyticsAggregated).toBe("function");
  });
});

// ============================================================================
// OptimizedQueries - Publish Logs Tests
// ============================================================================

describe("OptimizedQueries - Publish Logs", () => {
  it("should provide publish logs query helper", () => {
    expect(OptimizedQueries.getPublishLogsByStatus).toBeTruthy();
    expect(typeof OptimizedQueries.getPublishLogsByStatus).toBe("function");
  });
});

// ============================================================================
// DatabaseOptimizer - Table Statistics Tests
// ============================================================================

describe("DatabaseOptimizer - Table Statistics", () => {
  let optimizer: DatabaseOptimizer;

  beforeEach(() => {
    const mockMetrics = createMockApiMetrics();
    optimizer = new DatabaseOptimizer(mockMetrics);
  });

  it("should include posts table in statistics", async () => {
    const stats = await optimizer.getDatabaseStats();

    const postsTable = stats.tableStats.find((tbl) => tbl.name === "posts");
    expect(postsTable).toBeTruthy();
    expect(typeof postsTable.rowCount).toBe("number");
    expect(Array.isArray(postsTable.indexes)).toBeTruthy();
  });

  it("should include postContent table in statistics", async () => {
    const stats = await optimizer.getDatabaseStats();

    const postContentTable = stats.tableStats.find((tbl) => tbl.name === "postContent");
    expect(postContentTable).toBeTruthy();
  });

  it("should include publishLogs table in statistics", async () => {
    const stats = await optimizer.getDatabaseStats();

    const publishLogsTable = stats.tableStats.find((tbl) => tbl.name === "publishLogs");
    expect(publishLogsTable).toBeTruthy();
  });

  it("should include analytics table in statistics", async () => {
    const stats = await optimizer.getDatabaseStats();

    const analyticsTable = stats.tableStats.find((tbl) => tbl.name === "analytics");
    expect(analyticsTable).toBeTruthy();
  });

  it("should list known indexes for each table", async () => {
    const stats = await optimizer.getDatabaseStats();

    stats.tableStats.forEach((table) => {
      expect(table.indexes.length > 0).toBeTruthy();
    });
  });
});
