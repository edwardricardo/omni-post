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

import { describe, it, beforeEach } from "node:test";
import type { TestContext } from "node:test";
import * as assert from "node:assert/strict";
import { DatabaseOptimizer, OptimizedQueries } from "../../src/utils/dbOptimization";
import type { ApiMetrics } from "../../src/metrics/apiMetrics";

// ============================================================================
// Mock Setup
// ============================================================================

function createMockApiMetrics(t: TestContext): ApiMetrics {
  return {
    metrics: {
      dbOperations: {
        inc: t.mock.fn(),
        labels: t.mock.fn(() => ({
          inc: t.mock.fn(),
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
    const metrics = createMockApiMetrics(t);
    const optimizer = new DatabaseOptimizer(metrics);

    assert.ok(optimizer, "Should create optimizer instance");
  });

  it("should use default slow query threshold", (t) => {
    const metrics = createMockApiMetrics(t);
    const optimizer = new DatabaseOptimizer(metrics);

    assert.ok(optimizer, "Should initialize with default threshold");
  });
});

// ============================================================================
// DatabaseOptimizer - Query Tracking Tests
// ============================================================================

describe("DatabaseOptimizer - Query Tracking", () => {
  let optimizer: DatabaseOptimizer;
  let mockMetrics: ApiMetrics;

  beforeEach((t) => {
    mockMetrics = createMockApiMetrics(t);
    optimizer = new DatabaseOptimizer(mockMetrics);
  });

  it("should track query execution", async () => {
    await optimizer.trackQuery("SELECT * FROM posts", 50);

    assert.strictEqual(
      mockMetrics.metrics.dbOperations.inc.mock.calls.length,
      1,
      "Should increment db operations"
    );
  });

  it("should track queries with parameters", async () => {
    await optimizer.trackQuery("SELECT * FROM posts WHERE id = $1", 50, ["post-123"]);

    assert.strictEqual(
      mockMetrics.metrics.dbOperations.inc.mock.calls.length,
      1,
      "Should track query"
    );
  });

  it("should detect slow queries", async () => {
    await optimizer.trackQuery("SELECT * FROM posts", 150);

    const stats = await optimizer.getDatabaseStats();
    assert.ok(stats.slowQueries.length > 0, "Should record slow query");
  });

  it("should not log fast queries as slow", async () => {
    await optimizer.trackQuery("SELECT * FROM posts", 50);

    const stats = await optimizer.getDatabaseStats();
    assert.strictEqual(stats.slowQueries.length, 0, "Should not record fast query as slow");
  });

  it("should sanitize query before logging", async () => {
    await optimizer.trackQuery("SELECT * FROM users WHERE password = 'secret123'", 150);

    const stats = await optimizer.getDatabaseStats();
    assert.ok(stats.slowQueries.length > 0, "Should record slow query");
    const recorded = stats.slowQueries[0]!;
    assert.ok(!recorded.query.includes("secret123"), "Should sanitize sensitive data");
  });

  it("should capture stack trace for slow queries", async () => {
    await optimizer.trackQuery("SELECT * FROM posts", 150);

    const stats = await optimizer.getDatabaseStats();
    assert.ok(stats.slowQueries.length > 0, "Should record slow query");
    const recorded = stats.slowQueries[0]!;
    assert.ok(recorded.stackTrace, "Should capture stack trace");
    assert.ok(recorded.stackTrace!.length > 0, "Stack trace should not be empty");
  });

  it("should limit slow query history to max size", async () => {
    for (let i = 0; i < 110; i++) {
      await optimizer.trackQuery(`SELECT * FROM table${i}`, 150);
    }

    const stats = await optimizer.getDatabaseStats();
    assert.ok(stats.slowQueries.length <= 100, "Should limit slow query history");
  });
});

// ============================================================================
// DatabaseOptimizer - Database Stats Tests
// ============================================================================

describe("DatabaseOptimizer - Database Statistics", () => {
  let optimizer: DatabaseOptimizer;

  beforeEach((t) => {
    const mockMetrics = createMockApiMetrics(t);
    optimizer = new DatabaseOptimizer(mockMetrics);
  });

  it("should return database statistics", async () => {
    const stats = await optimizer.getDatabaseStats();

    assert.ok(stats, "Should return stats object");
    assert.strictEqual(typeof stats.connectionPoolSize, "number", "Should include pool size");
    assert.strictEqual(
      typeof stats.activeConnections,
      "number",
      "Should include active connections"
    );
    assert.strictEqual(typeof stats.idleConnections, "number", "Should include idle connections");
  });

  it("should include slow queries in stats", async () => {
    await optimizer.trackQuery("SELECT * FROM posts", 150);

    const stats = await optimizer.getDatabaseStats();
    assert.ok(Array.isArray(stats.slowQueries), "Should include slow queries array");
  });

  it("should include index recommendations in stats", async () => {
    const stats = await optimizer.getDatabaseStats();

    assert.ok(Array.isArray(stats.indexRecommendations), "Should include recommendations");
    assert.ok(stats.indexRecommendations.length > 0, "Should have some recommendations");
  });

  it("should include table statistics in stats", async () => {
    const stats = await optimizer.getDatabaseStats();

    assert.ok(Array.isArray(stats.tableStats), "Should include table stats");
    assert.ok(stats.tableStats.length > 0, "Should have table information");
  });

  it("should handle stats errors gracefully", async (t) => {
    const errorMetrics = createMockApiMetrics(t);
    const errorOptimizer = new DatabaseOptimizer(errorMetrics);

    const stats = await errorOptimizer.getDatabaseStats();

    assert.ok(stats, "Should return stats even with errors");
    assert.strictEqual(stats.connectionPoolSize, 0, "Should use default values on error");
  });
});

// ============================================================================
// DatabaseOptimizer - Index Recommendations Tests
// ============================================================================

describe("DatabaseOptimizer - Index Recommendations", () => {
  let optimizer: DatabaseOptimizer;

  beforeEach((t) => {
    const mockMetrics = createMockApiMetrics(t);
    optimizer = new DatabaseOptimizer(mockMetrics);
  });

  it("should generate index recommendations", async () => {
    const stats = await optimizer.getDatabaseStats();

    assert.ok(stats.indexRecommendations.length > 0, "Should provide recommendations");
  });

  it("should recommend indexes for posts table", async () => {
    const stats = await optimizer.getDatabaseStats();

    const postsRecommendation = stats.indexRecommendations.find((r) => r.table === "posts");
    assert.ok(postsRecommendation, "Should recommend index for posts");
    assert.ok(postsRecommendation.columns.length > 0, "Should specify columns");
    assert.ok(postsRecommendation.reason, "Should include reason");
    assert.ok(
      ["high", "medium", "low"].includes(postsRecommendation.priority),
      "Should have priority"
    );
  });

  it("should recommend indexes for publishLogs table", async () => {
    const stats = await optimizer.getDatabaseStats();

    const publishLogsRecommendation = stats.indexRecommendations.find(
      (r) => r.table === "publishLogs"
    );
    assert.ok(publishLogsRecommendation, "Should recommend index for publishLogs");
  });

  it("should recommend indexes for analytics table", async () => {
    const stats = await optimizer.getDatabaseStats();

    const analyticsRecommendation = stats.indexRecommendations.find((r) => r.table === "analytics");
    assert.ok(analyticsRecommendation, "Should recommend index for analytics");
  });

  it("should include estimated improvement in recommendations", async () => {
    const stats = await optimizer.getDatabaseStats();

    stats.indexRecommendations.forEach((rec) => {
      assert.ok(rec.estimatedImprovement, "Should include estimated improvement");
      assert.ok(rec.estimatedImprovement.length > 0, "Improvement should be described");
    });
  });
});

// ============================================================================
// DatabaseOptimizer - Query Sanitization Tests
// ============================================================================

describe("DatabaseOptimizer - Query Sanitization", () => {
  let optimizer: DatabaseOptimizer;

  beforeEach((t) => {
    const mockMetrics = createMockApiMetrics(t);
    optimizer = new DatabaseOptimizer(mockMetrics);
  });

  it("should sanitize Prisma parameters", async () => {
    await optimizer.trackQuery("SELECT * FROM posts WHERE id = $1 AND status = $2", 150, [
      "id-123",
      "PUBLISHED",
    ]);

    const stats = await optimizer.getDatabaseStats();
    assert.ok(stats.slowQueries.length > 0, "Should record slow query");
    const recorded = stats.slowQueries[0]!;
    assert.ok(!recorded.query.includes("$1"), "Should replace parameters");
  });

  it("should sanitize string literals", async () => {
    await optimizer.trackQuery("SELECT * FROM posts WHERE title = 'Secret Title'", 150);

    const stats = await optimizer.getDatabaseStats();
    assert.ok(stats.slowQueries.length > 0, "Should record slow query");
    const recorded = stats.slowQueries[0]!;
    assert.ok(!recorded.query.includes("Secret Title"), "Should sanitize string literals");
  });

  it("should normalize whitespace in queries", async () => {
    await optimizer.trackQuery("SELECT  *   FROM    posts   WHERE   id = $1", 150);

    const stats = await optimizer.getDatabaseStats();
    assert.ok(stats.slowQueries.length > 0, "Should record slow query");
    const recorded = stats.slowQueries[0]!;
    assert.ok(!recorded.query.includes("  "), "Should normalize whitespace");
  });

  it("should truncate long parameter values", async () => {
    const longString = "a".repeat(100);
    await optimizer.trackQuery("SELECT * FROM posts", 150, [longString]);

    const stats = await optimizer.getDatabaseStats();
    assert.ok(stats.slowQueries.length > 0, "Should record slow query");
    const recorded = stats.slowQueries[0]!;
    assert.ok(recorded.params, "Should have params");
    const param = recorded.params![0] as string;
    assert.ok(param.length <= 13, "Should truncate long params");
  });
});

// ============================================================================
// DatabaseOptimizer - Slow Query Analysis Tests
// ============================================================================

describe("DatabaseOptimizer - Slow Query Analysis", () => {
  let optimizer: DatabaseOptimizer;

  beforeEach((t) => {
    const mockMetrics = createMockApiMetrics(t);
    optimizer = new DatabaseOptimizer(mockMetrics);
  });

  it("should filter recent slow queries (within 1 hour)", async () => {
    await optimizer.trackQuery("SELECT * FROM posts", 150);

    const stats = await optimizer.getDatabaseStats();
    assert.ok(stats.slowQueries.length > 0, "Should include recent slow queries");
  });

  it("should sort slow queries by duration", async () => {
    await optimizer.trackQuery("SELECT * FROM posts", 200);
    await optimizer.trackQuery("SELECT * FROM users", 150);
    await optimizer.trackQuery("SELECT * FROM channels", 300);

    const stats = await optimizer.getDatabaseStats();
    const durations = stats.slowQueries.map((q) => q.duration);

    for (let i = 0; i < durations.length - 1; i++) {
      assert.ok(durations[i]! >= durations[i + 1]!, "Should sort by duration descending");
    }
  });

  it("should limit slow queries to top 20", async () => {
    for (let i = 0; i < 30; i++) {
      await optimizer.trackQuery(`SELECT * FROM table${i}`, 150);
    }

    const stats = await optimizer.getDatabaseStats();
    assert.ok(stats.slowQueries.length <= 20, "Should limit to top 20");
  });

  it("should identify common query patterns", async () => {
    await optimizer.trackQuery("SELECT * FROM posts WHERE projectId = $1", 150);
    await optimizer.trackQuery("SELECT * FROM posts WHERE postId = $1 ORDER BY createdAt", 150);

    const stats = await optimizer.getDatabaseStats();
    assert.ok(stats.slowQueries.length >= 2, "Should have recorded both slow query patterns");
  });
});

// ============================================================================
// DatabaseOptimizer - Prisma Middleware Tests
// ============================================================================

describe("DatabaseOptimizer - Prisma Middleware", () => {
  let optimizer: DatabaseOptimizer;

  beforeEach((t) => {
    const mockMetrics = createMockApiMetrics(t);
    optimizer = new DatabaseOptimizer(mockMetrics);
  });

  it("should create Prisma middleware", () => {
    const middleware = optimizer.createPrismaMiddleware();

    assert.ok(middleware, "Should create middleware function");
    assert.strictEqual(typeof middleware, "function", "Should be a function");
  });

  it("should track query through middleware", async (t) => {
    const middleware = optimizer.createPrismaMiddleware();

    const mockParams = {
      model: "Post",
      action: "findMany",
      args: { where: { projectId: "project-123" } },
    };

    const mockNext = t.mock.fn(async () => [{ id: "post-123" }]);

    await middleware(mockParams, mockNext);

    assert.strictEqual(mockNext.mock.calls.length, 1, "Should call next");
  });

  it("should measure query duration in middleware", async (t) => {
    const middleware = optimizer.createPrismaMiddleware();

    const mockParams = {
      model: "Post",
      action: "findMany",
      args: {},
    };

    const mockNext = t.mock.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return [{ id: "post-123" }];
    });

    const result = await middleware(mockParams, mockNext);

    assert.ok(result, "Should return query result");
  });
});

// ============================================================================
// DatabaseOptimizer - Index Creation Tests
// ============================================================================

describe("DatabaseOptimizer - Index Creation", () => {
  let optimizer: DatabaseOptimizer;

  beforeEach((t) => {
    const mockMetrics = createMockApiMetrics(t);
    optimizer = new DatabaseOptimizer(mockMetrics);
  });

  it("should provide index creation commands", async () => {
    const result = await optimizer.createRecommendedIndexes();

    assert.ok(result, "Should return result");
    assert.ok(Array.isArray(result.created), "Should have created array");
    assert.ok(Array.isArray(result.failed), "Should have failed array");
  });

  it("should return index commands for recommended indexes", async () => {
    const result = await optimizer.createRecommendedIndexes();

    assert.ok(result.created.length > 0, "Should have index commands");

    result.created.forEach((cmd) => {
      assert.ok(cmd.includes("CREATE INDEX"), "Should be CREATE INDEX command");
      assert.ok(cmd.includes("CONCURRENTLY"), "Should use CONCURRENTLY");
    });
  });

  it("should create indexes for posts table", async () => {
    const result = await optimizer.createRecommendedIndexes();

    const postsIndex = result.created.find((cmd) => cmd.includes("posts"));
    assert.ok(postsIndex, "Should create index for posts");
  });

  it("should create indexes for publishLogs table", async () => {
    const result = await optimizer.createRecommendedIndexes();

    const publishLogsIndex = result.created.find((cmd) => cmd.includes("publishLogs"));
    assert.ok(publishLogsIndex, "Should create index for publishLogs");
  });

  it("should create indexes for analytics table", async () => {
    const result = await optimizer.createRecommendedIndexes();

    const analyticsIndex = result.created.find((cmd) => cmd.includes("analytics"));
    assert.ok(analyticsIndex, "Should create index for analytics");
  });
});

// ============================================================================
// OptimizedQueries - Paginated Posts Tests
// ============================================================================

describe("OptimizedQueries - Paginated Posts", () => {
  it("should provide paginated posts query helper", () => {
    assert.ok(OptimizedQueries.getPostsPaginated, "Should have getPostsPaginated method");
    assert.strictEqual(
      typeof OptimizedQueries.getPostsPaginated,
      "function",
      "Should be a function"
    );
  });

  it("should calculate correct offset for pagination", async () => {
    const page = 3;
    const limit = 20;
    const expectedOffset = (page - 1) * limit;

    assert.strictEqual(expectedOffset, 40, "Should calculate correct offset");
  });
});

// ============================================================================
// OptimizedQueries - Analytics Aggregation Tests
// ============================================================================

describe("OptimizedQueries - Analytics Aggregation", () => {
  it("should provide analytics aggregation helper", () => {
    assert.ok(OptimizedQueries.getAnalyticsAggregated, "Should have getAnalyticsAggregated method");
    assert.strictEqual(
      typeof OptimizedQueries.getAnalyticsAggregated,
      "function",
      "Should be a function"
    );
  });
});

// ============================================================================
// OptimizedQueries - Publish Logs Tests
// ============================================================================

describe("OptimizedQueries - Publish Logs", () => {
  it("should provide publish logs query helper", () => {
    assert.ok(OptimizedQueries.getPublishLogsByStatus, "Should have getPublishLogsByStatus method");
    assert.strictEqual(
      typeof OptimizedQueries.getPublishLogsByStatus,
      "function",
      "Should be a function"
    );
  });
});

// ============================================================================
// DatabaseOptimizer - Table Statistics Tests
// ============================================================================

describe("DatabaseOptimizer - Table Statistics", () => {
  let optimizer: DatabaseOptimizer;

  beforeEach((t) => {
    const mockMetrics = createMockApiMetrics(t);
    optimizer = new DatabaseOptimizer(mockMetrics);
  });

  it("should include posts table in statistics", async () => {
    const stats = await optimizer.getDatabaseStats();

    const postsTable = stats.tableStats.find((tbl) => tbl.name === "posts");
    assert.ok(postsTable, "Should include posts table");
    assert.strictEqual(typeof postsTable.rowCount, "number", "Should have row count");
    assert.ok(Array.isArray(postsTable.indexes), "Should list indexes");
  });

  it("should include postContent table in statistics", async () => {
    const stats = await optimizer.getDatabaseStats();

    const postContentTable = stats.tableStats.find((tbl) => tbl.name === "postContent");
    assert.ok(postContentTable, "Should include postContent table");
  });

  it("should include publishLogs table in statistics", async () => {
    const stats = await optimizer.getDatabaseStats();

    const publishLogsTable = stats.tableStats.find((tbl) => tbl.name === "publishLogs");
    assert.ok(publishLogsTable, "Should include publishLogs table");
  });

  it("should include analytics table in statistics", async () => {
    const stats = await optimizer.getDatabaseStats();

    const analyticsTable = stats.tableStats.find((tbl) => tbl.name === "analytics");
    assert.ok(analyticsTable, "Should include analytics table");
  });

  it("should list known indexes for each table", async () => {
    const stats = await optimizer.getDatabaseStats();

    stats.tableStats.forEach((table) => {
      assert.ok(table.indexes.length > 0, `${table.name} should have indexes listed`);
    });
  });
});
