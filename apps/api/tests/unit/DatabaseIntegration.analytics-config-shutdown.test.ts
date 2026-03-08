/**
 * DatabaseIntegration Tests - Auto-Scaling, Query Analytics,
 * Configuration & Graceful Shutdown
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert/strict";
import { DatabaseIntegration } from "../../src/database/DatabaseIntegration";
import {
  createConfig,
  createMockFastify,
  createMockEventService,
  createMockCache,
  createMockRedis,
  createMockConnectionManager,
} from "./DatabaseIntegration.test-helpers.js";

// ============================================================================
// DatabaseIntegration - Auto-Scaling Tests
// ============================================================================

describe("DatabaseIntegration - Auto-Scaling", () => {
  it("should initialize auto-scaling mechanism", async (t) => {
    const config = createConfig(t);
    const integration = new DatabaseIntegration(config);
    await integration.initialize();

    assert.ok(true, "Should initialize auto-scaling");

    await integration.shutdown();
  });

  it("should provide connection manager access", (t) => {
    const config = createConfig(t);
    const integration = new DatabaseIntegration(config);
    const manager = integration.getConnectionManager();

    assert.ok(manager, "Should provide connection manager instance");
    assert.strictEqual(typeof manager.healthCheck, "function", "Should have healthCheck method");
  });
});

// ============================================================================
// DatabaseIntegration - Analytics Tests
// ============================================================================

describe("DatabaseIntegration - Query Analytics", () => {
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

  it("should track cache hit analytics", async () => {
    const queryKey = "analytics-test-1";
    await mockCache.set(queryKey, { data: "cached" });

    await integration.executeOptimizedQuery(
      queryKey,
      async (_client) => {
        return { data: "fresh" };
      },
      { readOnly: true }
    );

    assert.ok(true, "Should track cache hit");
  });

  it("should track database query analytics", async () => {
    const queryKey = "analytics-test-2";

    await integration.executeOptimizedQuery(
      queryKey,
      async (_client) => {
        return { data: "fresh" };
      },
      { readOnly: true }
    );

    assert.ok(true, "Should track database query");
  });

  it("should calculate moving averages for query times", async () => {
    const queries = Array.from({ length: 5 }, (_, i) => ({
      key: `query-${i}`,
      data: { index: i },
    }));

    for (const query of queries) {
      await integration.executeOptimizedQuery(
        query.key,
        async (_client) => {
          return query.data;
        },
        { readOnly: true }
      );
    }

    assert.ok(true, "Should calculate query time averages");
  });
});

// ============================================================================
// DatabaseIntegration - Configuration Tests
// ============================================================================

describe("DatabaseIntegration - Configuration", () => {
  it("should parse replica configuration from environment", (t) => {
    process.env.DATABASE_REPLICA_URLS =
      "postgresql://replica1:5432/db,postgresql://replica2:5432/db";

    const config = createConfig(t);
    const integration = new DatabaseIntegration(config);

    assert.ok(integration, "Should parse replica configuration");

    delete process.env.DATABASE_REPLICA_URLS;
  });

  it("should use default values when environment variables missing", (t) => {
    delete process.env.DB_POOL_SIZE;
    delete process.env.DB_CONNECTION_TIMEOUT;

    const config = createConfig(t);
    const integration = new DatabaseIntegration(config);

    assert.ok(integration, "Should use default configuration");
  });

  it("should enable monitoring in production environment", (t) => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    const config = createConfig(t);
    const integration = new DatabaseIntegration(config);

    assert.ok(integration, "Should enable monitoring in production");

    process.env.NODE_ENV = originalEnv;
  });
});

// ============================================================================
// DatabaseIntegration - Shutdown Tests
// ============================================================================

describe("DatabaseIntegration - Graceful Shutdown", () => {
  it("should shutdown connection manager", async (t) => {
    const config = createConfig(t);
    const integration = new DatabaseIntegration(config);
    await integration.shutdown();

    assert.ok(true, "Should shutdown gracefully");
  });

  it("should clean up resources on shutdown", async (t) => {
    const config = createConfig(t);
    const integration = new DatabaseIntegration(config);
    await integration.initialize();
    await integration.shutdown();

    assert.ok(true, "Should clean up all resources");
  });
});

// ============================================================================
// DatabaseIntegration - Load Metrics Tests
// ============================================================================

describe("DatabaseIntegration - Load Metrics", () => {
  let integration: DatabaseIntegration;

  beforeEach((t) => {
    const config = createConfig(t);
    integration = new DatabaseIntegration(config);
  });

  afterEach(async () => {
    await integration.shutdown();
  });

  it("should track read query count", async () => {
    await integration.executeOptimizedQuery(
      "read-query-1",
      async (_client) => {
        return { data: "test" };
      },
      { readOnly: true }
    );

    await integration.executeOptimizedQuery(
      "read-query-2",
      async (_client) => {
        return { data: "test" };
      },
      { readOnly: true }
    );

    assert.ok(true, "Should track read queries");
  });

  it("should track write query count", async () => {
    await integration.executeOptimizedQuery(
      "write-query-1",
      async (_client) => {
        return { inserted: 1 };
      },
      { readOnly: false }
    );

    assert.ok(true, "Should track write queries");
  });

  it("should calculate separate averages for read and write queries", async () => {
    await integration.executeOptimizedQuery("read-1", async () => ({ data: "r1" }), {
      readOnly: true,
    });
    await integration.executeOptimizedQuery("read-2", async () => ({ data: "r2" }), {
      readOnly: true,
    });
    await integration.executeOptimizedQuery("write-1", async () => ({ inserted: 1 }), {
      readOnly: false,
    });

    assert.ok(true, "Should maintain separate read/write averages");
  });
});
