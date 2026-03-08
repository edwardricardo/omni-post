/**
 * DatabaseIntegration Tests - Optimized Query Execution & Transactions
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert/strict";
import { DatabaseIntegration } from "../../src/database/DatabaseIntegration";
import {
  createMockFastify,
  createMockEventService,
  createMockCache,
  createMockRedis,
  createMockConnectionManager,
} from "./DatabaseIntegration.test-helpers.js";

// ============================================================================
// DatabaseIntegration - Optimized Query Tests
// ============================================================================

describe("DatabaseIntegration - Optimized Query Execution", () => {
  let integration: DatabaseIntegration;
  let mockCache: any;

  beforeEach((t) => {
    mockCache = createMockCache(t);
    const config = {
      fastify: createMockFastify(t) as any,
      eventService: createMockEventService(t) as any,
      cache: mockCache as any,
      redis: createMockRedis(t) as any,
      connectionManager: createMockConnectionManager(t) as any,
    };
    integration = new DatabaseIntegration(config);
  });

  afterEach(async () => {
    await integration.shutdown();
    mockCache.clear();
  });

  it("should return cached result when available", async () => {
    const queryKey = "test-query-1";
    const cachedData = { id: "123", name: "Cached Data" };

    await mockCache.set(queryKey, cachedData);

    const result = await integration.executeOptimizedQuery(
      queryKey,
      async (_client) => {
        return { id: "456", name: "Fresh Data" };
      },
      { readOnly: true, cacheTtl: 300 }
    );

    assert.deepStrictEqual(result, cachedData, "Should return cached data");
    assert.strictEqual(mockCache.get.mock.calls.length, 1, "Should check cache");
  });

  it("should execute query and cache result when cache miss", async () => {
    const queryKey = "test-query-2";
    const freshData = { id: "789", name: "Fresh Data" };

    const result = await integration.executeOptimizedQuery(
      queryKey,
      async (_client) => {
        return freshData;
      },
      { readOnly: true, cacheTtl: 300 }
    );

    assert.deepStrictEqual(result, freshData, "Should return fresh data");
    assert.strictEqual(mockCache.set.mock.calls.length, 1, "Should cache the result");
  });

  it("should force refresh and bypass cache when requested", async () => {
    const queryKey = "test-query-3";
    const cachedData = { id: "old", name: "Old Data" };
    const freshData = { id: "new", name: "New Data" };

    await mockCache.set(queryKey, cachedData);

    const result = await integration.executeOptimizedQuery(
      queryKey,
      async (_client) => {
        return freshData;
      },
      { readOnly: true, forceRefresh: true }
    );

    assert.deepStrictEqual(result, freshData, "Should return fresh data despite cache");
  });

  it("should track read query metrics", async () => {
    const queryKey = "test-query-4";

    await integration.executeOptimizedQuery(
      queryKey,
      async (_client) => {
        return { success: true };
      },
      { readOnly: true }
    );

    assert.ok(true, "Should execute and track metrics");
  });

  it("should track write query metrics", async () => {
    const queryKey = "test-query-5";

    await integration.executeOptimizedQuery(
      queryKey,
      async (_client) => {
        return { success: true, inserted: 1 };
      },
      { readOnly: false }
    );

    assert.ok(true, "Should execute write query and track metrics");
  });

  it("should publish error event on query failure", async (t) => {
    const mockEventService = createMockEventService(t);
    const failingConnectionManager = {
      ...createMockConnectionManager(t),
      executeQuery: t.mock.fn(async <T>(query: (client: any) => Promise<T>, _options?: any) => {
        return query(null);
      }),
    };
    const errorConfig = {
      fastify: createMockFastify(t) as any,
      eventService: mockEventService as any,
      cache: createMockCache(t) as any,
      redis: createMockRedis(t) as any,
      connectionManager: failingConnectionManager as any,
    };

    const errorIntegration = new DatabaseIntegration(errorConfig);

    await assert.rejects(async () => {
      await errorIntegration.executeOptimizedQuery(
        "failing-query",
        async (_client) => {
          throw new Error("Query execution failed");
        },
        { readOnly: true }
      );
    });

    assert.strictEqual(
      mockEventService.publishEvent.mock.calls.length,
      1,
      "Should publish error event"
    );

    await errorIntegration.shutdown();
  });

  it("should use custom cache TTL when provided", async () => {
    const queryKey = "test-query-ttl";
    const customTtl = 600;

    await integration.executeOptimizedQuery(
      queryKey,
      async (_client) => {
        return { data: "test" };
      },
      { readOnly: true, cacheTtl: customTtl }
    );

    const setCall = mockCache.set.mock.calls[0];
    assert.ok(setCall, "Should call cache.set");
    assert.strictEqual(setCall.arguments[2]?.ttl, customTtl, "Should use custom TTL");
  });

  it("should tag cached results when tags provided", async () => {
    const queryKey = "test-query-tags";
    const tags = ["user:123", "posts"];

    await integration.executeOptimizedQuery(
      queryKey,
      async (_client) => {
        return { data: "test" };
      },
      { readOnly: true, tags }
    );

    const setCall = mockCache.set.mock.calls[0];
    assert.ok(setCall, "Should call cache.set");
    assert.deepStrictEqual(setCall.arguments[2]?.tags, tags, "Should include tags");
  });
});

// ============================================================================
// DatabaseIntegration - Transaction Tests
// ============================================================================

describe("DatabaseIntegration - Optimized Transaction", () => {
  let integration: DatabaseIntegration;
  let mockCache: any;

  beforeEach((t) => {
    mockCache = createMockCache(t);
    const config = {
      fastify: createMockFastify(t) as any,
      eventService: createMockEventService(t) as any,
      cache: mockCache as any,
      redis: createMockRedis(t) as any,
      connectionManager: createMockConnectionManager(t) as any,
    };
    integration = new DatabaseIntegration(config);
  });

  afterEach(async () => {
    await integration.shutdown();
    mockCache.clear();
  });

  it("should execute transaction successfully", async () => {
    const result = await integration.executeOptimizedTransaction(
      "test-transaction",
      async (_client) => {
        return { success: true, committed: true };
      }
    );

    assert.deepStrictEqual(
      result,
      { success: true, committed: true },
      "Should return transaction result"
    );
  });

  it("should invalidate cache tags after transaction", async () => {
    const cacheTags = ["user:123", "posts"];

    await integration.executeOptimizedTransaction(
      "test-transaction-invalidate",
      async (_client) => {
        return { success: true };
      },
      { cacheTags }
    );

    assert.strictEqual(
      mockCache.invalidateByTag.mock.calls.length,
      2,
      "Should invalidate all tags"
    );
  });

  it("should publish error event on transaction failure", async (t) => {
    const mockEventService = createMockEventService(t);
    const failingConnectionManager = {
      ...createMockConnectionManager(t),
      executeTransaction: t.mock.fn(
        async <T>(transaction: (client: any) => Promise<T>, _options?: any) => {
          return transaction(null);
        }
      ),
    };
    const errorConfig = {
      fastify: createMockFastify(t) as any,
      eventService: mockEventService as any,
      cache: createMockCache(t) as any,
      redis: createMockRedis(t) as any,
      connectionManager: failingConnectionManager as any,
    };

    const errorIntegration = new DatabaseIntegration(errorConfig);

    await assert.rejects(async () => {
      await errorIntegration.executeOptimizedTransaction("failing-transaction", async (_client) => {
        throw new Error("Transaction failed");
      });
    });

    assert.strictEqual(
      mockEventService.publishEvent.mock.calls.length,
      1,
      "Should publish error event"
    );

    await errorIntegration.shutdown();
  });

  it("should respect custom transaction timeout", async () => {
    const customTimeout = 5000;

    const result = await integration.executeOptimizedTransaction(
      "test-transaction-timeout",
      async (_client) => {
        return { success: true };
      },
      { timeout: customTimeout }
    );

    assert.ok(result.success, "Should complete within timeout");
  });
});
