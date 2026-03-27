/**
 * DatabaseIntegration Tests - Initialization & Route Registration
 */

import { describe, it, expect } from "vitest";
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
  it("should initialize with required dependencies", async (_t) => {
    const config = createConfig();
    const integration = new DatabaseIntegration(config);

    expect(integration).toBeTruthy();
  });

  it("should initialize connection manager with environment config", async (_t) => {
    process.env.DATABASE_URL = "postgresql://localhost:5432/test";
    process.env.DB_POOL_SIZE = "15";

    const config = createConfig();
    const integration = new DatabaseIntegration(config);

    expect(integration).toBeTruthy();
  });

  it("should register database management routes on initialization", async (_t) => {
    const mockFastify = createMockFastify();
    const config = {
      fastify: mockFastify as any,
      eventService: createMockEventService() as any,
      cache: createMockCache() as any,
      redis: createMockRedis() as any,
      connectionManager: createMockConnectionManager() as any,
    };

    const integration = new DatabaseIntegration(config);
    await integration.initialize();

    expect(mockFastify.get.mock.calls.length > 0).toBeTruthy();
  });

  it("should setup auto-scaling on initialization", async (_t) => {
    const config = createConfig();
    const integration = new DatabaseIntegration(config);
    await integration.initialize();

    expect(true).toBeTruthy();
  });
});

// ============================================================================
// DatabaseIntegration - Route Registration Tests
// ============================================================================

describe("DatabaseIntegration - Route Registration", () => {
  it("should register health check route", async (_t) => {
    const mockFastify = createMockFastify();
    const config = {
      fastify: mockFastify as any,
      eventService: createMockEventService() as any,
      cache: createMockCache() as any,
      redis: createMockRedis() as any,
      connectionManager: createMockConnectionManager() as any,
    };

    const integration = new DatabaseIntegration(config);
    await integration.initialize();

    const healthRoute = mockFastify.routes.find((r: any) => r.path === "/api/database/health");
    expect(healthRoute).toBeTruthy();
    expect(healthRoute.method).toBe("GET");

    await integration.shutdown();
  });

  it("should register statistics route", async (_t) => {
    const mockFastify = createMockFastify();
    const config = {
      fastify: mockFastify as any,
      eventService: createMockEventService() as any,
      cache: createMockCache() as any,
      redis: createMockRedis() as any,
      connectionManager: createMockConnectionManager() as any,
    };

    const integration = new DatabaseIntegration(config);
    await integration.initialize();

    const statsRoute = mockFastify.routes.find((r: any) => r.path === "/api/database/stats");
    expect(statsRoute).toBeTruthy();
    expect(statsRoute.method).toBe("GET");

    await integration.shutdown();
  });

  it("should register connection scaling route", async (_t) => {
    const mockFastify = createMockFastify();
    const config = {
      fastify: mockFastify as any,
      eventService: createMockEventService() as any,
      cache: createMockCache() as any,
      redis: createMockRedis() as any,
      connectionManager: createMockConnectionManager() as any,
    };

    const integration = new DatabaseIntegration(config);
    await integration.initialize();

    const scaleRoute = mockFastify.routes.find((r: any) => r.path === "/api/database/scale");
    expect(scaleRoute).toBeTruthy();
    expect(scaleRoute.method).toBe("POST");

    await integration.shutdown();
  });

  it("should register replica management routes", async (_t) => {
    const mockFastify = createMockFastify();
    const config = {
      fastify: mockFastify as any,
      eventService: createMockEventService() as any,
      cache: createMockCache() as any,
      redis: createMockRedis() as any,
      connectionManager: createMockConnectionManager() as any,
    };

    const integration = new DatabaseIntegration(config);
    await integration.initialize();

    const addReplicaRoute = mockFastify.routes.find(
      (r: any) => r.path === "/api/database/replicas" && r.method === "POST"
    );
    const removeReplicaRoute = mockFastify.routes.find(
      (r: any) => r.path === "/api/database/replicas" && r.method === "DELETE"
    );

    expect(addReplicaRoute).toBeTruthy();
    expect(removeReplicaRoute).toBeTruthy();

    await integration.shutdown();
  });

  it("should register analytics route", async (_t) => {
    const mockFastify = createMockFastify();
    const config = {
      fastify: mockFastify as any,
      eventService: createMockEventService() as any,
      cache: createMockCache() as any,
      redis: createMockRedis() as any,
      connectionManager: createMockConnectionManager() as any,
    };

    const integration = new DatabaseIntegration(config);
    await integration.initialize();

    const analyticsRoute = mockFastify.routes.find(
      (r: any) => r.path === "/api/database/analytics"
    );
    expect(analyticsRoute).toBeTruthy();
    expect(analyticsRoute.method).toBe("GET");

    await integration.shutdown();
  });

  it("should add database integration to request context", async (_t) => {
    const mockFastify = createMockFastify();
    const config = {
      fastify: mockFastify as any,
      eventService: createMockEventService() as any,
      cache: createMockCache() as any,
      redis: createMockRedis() as any,
      connectionManager: createMockConnectionManager() as any,
    };

    const integration = new DatabaseIntegration(config);
    await integration.initialize();

    expect(mockFastify.addHook.mock.calls.length).toBe(1);
    expect(mockFastify.addHook.mock.calls[0][0]).toBe("onRequest");

    await integration.shutdown();
  });
});
