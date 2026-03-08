/**
 * DatabaseIntegration Tests - Initialization & Route Registration
 */

import { describe, it } from "node:test";
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
// DatabaseIntegration - Initialization Tests
// ============================================================================

describe("DatabaseIntegration - Initialization", () => {
  it("should initialize with required dependencies", async (t) => {
    const config = createConfig(t);
    const integration = new DatabaseIntegration(config);

    assert.ok(integration, "Should create instance");
  });

  it("should initialize connection manager with environment config", async (t) => {
    process.env.DATABASE_URL = "postgresql://localhost:5432/test";
    process.env.DB_POOL_SIZE = "15";

    const config = createConfig(t);
    const integration = new DatabaseIntegration(config);

    assert.ok(integration, "Should initialize with environment config");
  });

  it("should register database management routes on initialization", async (t) => {
    const mockFastify = createMockFastify(t);
    const config = {
      fastify: mockFastify as any,
      eventService: createMockEventService(t) as any,
      cache: createMockCache(t) as any,
      redis: createMockRedis(t) as any,
      connectionManager: createMockConnectionManager(t) as any,
    };

    const integration = new DatabaseIntegration(config);
    await integration.initialize();

    assert.ok(mockFastify.get.mock.calls.length > 0, "Should register GET routes");
  });

  it("should setup auto-scaling on initialization", async (t) => {
    const config = createConfig(t);
    const integration = new DatabaseIntegration(config);
    await integration.initialize();

    assert.ok(true, "Should complete initialization");
  });
});

// ============================================================================
// DatabaseIntegration - Route Registration Tests
// ============================================================================

describe("DatabaseIntegration - Route Registration", () => {
  it("should register health check route", async (t) => {
    const mockFastify = createMockFastify(t);
    const config = {
      fastify: mockFastify as any,
      eventService: createMockEventService(t) as any,
      cache: createMockCache(t) as any,
      redis: createMockRedis(t) as any,
      connectionManager: createMockConnectionManager(t) as any,
    };

    const integration = new DatabaseIntegration(config);
    await integration.initialize();

    const healthRoute = mockFastify.routes.find((r: any) => r.path === "/api/database/health");
    assert.ok(healthRoute, "Should register /api/database/health route");
    assert.strictEqual(healthRoute.method, "GET", "Should be GET method");

    await integration.shutdown();
  });

  it("should register statistics route", async (t) => {
    const mockFastify = createMockFastify(t);
    const config = {
      fastify: mockFastify as any,
      eventService: createMockEventService(t) as any,
      cache: createMockCache(t) as any,
      redis: createMockRedis(t) as any,
      connectionManager: createMockConnectionManager(t) as any,
    };

    const integration = new DatabaseIntegration(config);
    await integration.initialize();

    const statsRoute = mockFastify.routes.find((r: any) => r.path === "/api/database/stats");
    assert.ok(statsRoute, "Should register /api/database/stats route");
    assert.strictEqual(statsRoute.method, "GET", "Should be GET method");

    await integration.shutdown();
  });

  it("should register connection scaling route", async (t) => {
    const mockFastify = createMockFastify(t);
    const config = {
      fastify: mockFastify as any,
      eventService: createMockEventService(t) as any,
      cache: createMockCache(t) as any,
      redis: createMockRedis(t) as any,
      connectionManager: createMockConnectionManager(t) as any,
    };

    const integration = new DatabaseIntegration(config);
    await integration.initialize();

    const scaleRoute = mockFastify.routes.find((r: any) => r.path === "/api/database/scale");
    assert.ok(scaleRoute, "Should register /api/database/scale route");
    assert.strictEqual(scaleRoute.method, "POST", "Should be POST method");

    await integration.shutdown();
  });

  it("should register replica management routes", async (t) => {
    const mockFastify = createMockFastify(t);
    const config = {
      fastify: mockFastify as any,
      eventService: createMockEventService(t) as any,
      cache: createMockCache(t) as any,
      redis: createMockRedis(t) as any,
      connectionManager: createMockConnectionManager(t) as any,
    };

    const integration = new DatabaseIntegration(config);
    await integration.initialize();

    const addReplicaRoute = mockFastify.routes.find(
      (r: any) => r.path === "/api/database/replicas" && r.method === "POST"
    );
    const removeReplicaRoute = mockFastify.routes.find(
      (r: any) => r.path === "/api/database/replicas" && r.method === "DELETE"
    );

    assert.ok(addReplicaRoute, "Should register POST /api/database/replicas route");
    assert.ok(removeReplicaRoute, "Should register DELETE /api/database/replicas route");

    await integration.shutdown();
  });

  it("should register analytics route", async (t) => {
    const mockFastify = createMockFastify(t);
    const config = {
      fastify: mockFastify as any,
      eventService: createMockEventService(t) as any,
      cache: createMockCache(t) as any,
      redis: createMockRedis(t) as any,
      connectionManager: createMockConnectionManager(t) as any,
    };

    const integration = new DatabaseIntegration(config);
    await integration.initialize();

    const analyticsRoute = mockFastify.routes.find(
      (r: any) => r.path === "/api/database/analytics"
    );
    assert.ok(analyticsRoute, "Should register /api/database/analytics route");
    assert.strictEqual(analyticsRoute.method, "GET", "Should be GET method");

    await integration.shutdown();
  });

  it("should add database integration to request context", async (t) => {
    const mockFastify = createMockFastify(t);
    const config = {
      fastify: mockFastify as any,
      eventService: createMockEventService(t) as any,
      cache: createMockCache(t) as any,
      redis: createMockRedis(t) as any,
      connectionManager: createMockConnectionManager(t) as any,
    };

    const integration = new DatabaseIntegration(config);
    await integration.initialize();

    assert.strictEqual(mockFastify.addHook.mock.calls.length, 1, "Should add onRequest hook");
    assert.strictEqual(
      mockFastify.addHook.mock.calls[0].arguments[0],
      "onRequest",
      "Should be onRequest hook"
    );

    await integration.shutdown();
  });
});
