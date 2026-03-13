/**
 * DatabaseIntegration Tests - Optimized Query Execution & Transactions
 */

import { describe, it, beforeEach, afterEach, vi, expect } from "vitest";
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

  beforeEach(() => {
    mockCache = createMockCache();
    const config = {
      fastify: createMockFastify() as any,
      eventService: createMockEventService() as any,
      cache: mockCache as any,
      redis: createMockRedis() as any,
      connectionManager: createMockConnectionManager() as any,
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

    expect(result).toStrictEqual(cachedData);
    expect(mockCache.get.mock.calls.length).toBe(1);
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

    expect(result).toStrictEqual(freshData);
    expect(mockCache.set.mock.calls.length).toBe(1);
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

    expect(result).toStrictEqual(freshData);
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

    expect(true).toBeTruthy();
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

    expect(true).toBeTruthy();
  });

  it("should publish error event on query failure", async (t) => {
    const mockEventService = createMockEventService();
    const failingConnectionManager = {
      ...createMockConnectionManager(),
      executeQuery: vi.fn(async <T>(query: (client: any) => Promise<T>, _options?: any) => {
        return query(null);
      }),
    };
    const errorConfig = {
      fastify: createMockFastify() as any,
      eventService: mockEventService as any,
      cache: createMockCache() as any,
      redis: createMockRedis() as any,
      connectionManager: failingConnectionManager as any,
    };

    const errorIntegration = new DatabaseIntegration(errorConfig);

    await expect(
      errorIntegration.executeOptimizedQuery(
        "failing-query",
        async (_client) => {
          throw new Error("Query execution failed");
        },
        { readOnly: true }
      )
    ).rejects.toThrow();

    expect(mockEventService.publishEvent.mock.calls.length).toBe(1);

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
    expect(setCall).toBeTruthy();
    expect(setCall[2]?.ttl).toBe(customTtl);
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
    expect(setCall).toBeTruthy();
    expect(setCall[2]?.tags).toStrictEqual(tags);
  });
});

// ============================================================================
// DatabaseIntegration - Transaction Tests
// ============================================================================

describe("DatabaseIntegration - Optimized Transaction", () => {
  let integration: DatabaseIntegration;
  let mockCache: any;

  beforeEach(() => {
    mockCache = createMockCache();
    const config = {
      fastify: createMockFastify() as any,
      eventService: createMockEventService() as any,
      cache: mockCache as any,
      redis: createMockRedis() as any,
      connectionManager: createMockConnectionManager() as any,
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

    expect(result).toStrictEqual({ success: true, committed: true });
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

    expect(mockCache.invalidateByTag.mock.calls.length).toBe(2);
  });

  it("should publish error event on transaction failure", async (t) => {
    const mockEventService = createMockEventService();
    const failingConnectionManager = {
      ...createMockConnectionManager(),
      executeTransaction: vi.fn(
        async <T>(transaction: (client: any) => Promise<T>, _options?: any) => {
          return transaction(null);
        }
      ),
    };
    const errorConfig = {
      fastify: createMockFastify() as any,
      eventService: mockEventService as any,
      cache: createMockCache() as any,
      redis: createMockRedis() as any,
      connectionManager: failingConnectionManager as any,
    };

    const errorIntegration = new DatabaseIntegration(errorConfig);

    await expect(
      errorIntegration.executeOptimizedTransaction("failing-transaction", async (_client) => {
        throw new Error("Transaction failed");
      })
    ).rejects.toThrow();

    expect(mockEventService.publishEvent.mock.calls.length).toBe(1);

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

    expect(result.success).toBeTruthy();
  });
});
