#!/usr/bin/env tsx
/**
 * Unit Tests for healthRoutes
 * Testing health check endpoints for monitoring and Kubernetes probes
 *
 * Coverage Target: 95%+
 */

import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import Fastify, { FastifyInstance } from "fastify";
import type Redis from "ioredis";
import type { RedisCacheManager } from "@adapters/cache-redis";

// ─── Mock Types ─────────────────────────────────────────────────────
type MockRedis = Pick<Redis, "ping" | "get" | "set" | "del" | "keys">;
type MockCacheManager = Pick<
  RedisCacheManager,
  "healthCheck" | "getStats" | "flush" | "invalidateByTag" | "invalidateByPattern" | "warmCache"
>;

// Mock dependencies
const createMockRedis = (): MockRedis => {
  return {
    ping: mock.fn(async () => "PONG"),
    get: mock.fn(async () => null),
    set: mock.fn(async () => "OK"),
    del: mock.fn(async () => 1),
    keys: mock.fn(async () => []),
  };
};

const createMockCacheManager = (healthy = true): MockCacheManager => {
  return {
    healthCheck: mock.fn(async () => ({
      ok: true,
      value: {
        status: healthy ? "healthy" : "unhealthy",
        latency: 10,
      },
    })),
    getStats: mock.fn(async () => ({
      ok: true,
      value: {
        hits: 100,
        misses: 20,
        hitRate: 0.83,
        totalKeys: 150,
        memoryUsage: 1024000,
        l1Hits: 80,
        l2Hits: 20,
        l1Size: 100,
        avgTtl: 300,
        hotKeys: [
          { key: "key1", hits: 50 },
          { key: "key2", hits: 30 },
        ],
      },
    })),
    flush: mock.fn(async () => ({ ok: true, value: undefined })),
    invalidateByTag: mock.fn(async () => ({ ok: true, value: 5 })),
    invalidateByPattern: mock.fn(async () => ({ ok: true, value: 3 })),
    warmCache: mock.fn(async () => ({ ok: true, value: 10 })),
  };
};

// Mock health check manager
const createMockHealthCheckManager = (status: "healthy" | "degraded" | "unhealthy" = "healthy") => {
  return {
    getCurrentStatus: mock.fn(() => ({
      overall: status,
      timestamp: new Date(),
      uptime: 12345,
      score: status === "healthy" ? 100 : status === "degraded" ? 75 : 30,
      dependencies: [
        {
          name: "database",
          type: "database",
          status: status === "unhealthy" ? "unhealthy" : "healthy",
          latency: 5,
          message: "Database is operational",
          critical: true,
          lastChecked: new Date(),
        },
        {
          name: "redis",
          type: "cache",
          status: "healthy",
          latency: 2,
          message: "Redis is operational",
          critical: true,
          lastChecked: new Date(),
        },
      ],
      metrics: {
        memory: {
          heapUsed: 100000000,
          heapTotal: 200000000,
          external: 5000000,
          rss: 150000000,
        },
        cpu: {
          user: 1000,
          system: 500,
        },
      },
      alerts: [],
    })),
    checkAll: mock.fn(async () => ({
      overall: status,
      timestamp: new Date(),
      uptime: 12345,
      score: status === "healthy" ? 100 : status === "degraded" ? 75 : 30,
      dependencies: [
        {
          name: "database",
          type: "database",
          status: status === "unhealthy" ? "unhealthy" : "healthy",
          latency: 5,
          message: "Database is operational",
          critical: true,
          lastChecked: new Date(),
          details: { connected: true },
        },
      ],
      metrics: {
        memory: {
          heapUsed: 100000000,
          heapTotal: 200000000,
          external: 5000000,
          rss: 150000000,
        },
        cpu: {
          user: 1000,
          system: 500,
        },
      },
      alerts: [],
    })),
    checkDependency: mock.fn(async (name: string) => {
      if (name === "database" || name === "redis" || name === "queue") {
        return {
          ok: true,
          value: {
            name,
            type: "database",
            status: "healthy",
            latency: 5,
            message: `${name} is operational`,
            critical: true,
            lastChecked: new Date(),
          },
        };
      }
      return { ok: false, error: "Not found" };
    }),
    register: mock.fn(),
    start: mock.fn(),
    stop: mock.fn(),
    checkers: new Map([
      ["database", {}],
      ["redis", {}],
      ["cache", {}],
      ["queue", {}],
      ["storage", {}],
      ["providers", {}],
    ]),
  };
};

describe("healthRoutes - Unit Tests", { concurrency: 1 }, () => {
  let app: FastifyInstance;
  let mockRedis: MockRedis;
  let mockCacheManager: MockCacheManager;

  before(async () => {
    mockRedis = createMockRedis();
    mockCacheManager = createMockCacheManager(true);

    // Mock the health check module
    mock.module("@monitoring/health-checks", {
      namedExports: {
        createHealthCheckManager: () => createMockHealthCheckManager("healthy"),
        DatabaseHealthChecker: class {},
        RedisHealthChecker: class {},
        CacheHealthChecker: class {},
        QueueHealthChecker: class {},
        StorageHealthChecker: class {},
        ProviderHealthChecker: class {},
      },
    });

    // Mock adapters
    mock.module("@adapters/db-prisma", {
      namedExports: {
        createPrismaRepoAdapter: () => ({}),
      },
    });

    mock.module("@adapters/queue-bullmq", {
      namedExports: {
        createBullMQQueueAdapter: () => ({}),
      },
    });

    mock.module("@adapters/storage-s3", {
      namedExports: {
        createS3StorageAdapter: () => ({}),
      },
    });

    // Mock provider registry
    mock.module("../../src/providers/providerRegistry.js", {
      namedExports: {
        providerRegistry: {},
      },
    });

    app = Fastify({ logger: false });

    const { healthRoutes } = await import("../../src/health/healthRoutes.js");
    await app.register(healthRoutes, {
      redis: mockRedis as Redis,
      cacheManager: mockCacheManager as RedisCacheManager,
    });
  });

  after(async () => {
    await app.close();
  });

  describe("GET /health", () => {
    it("should return 200 with healthy status", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health",
      });

      assert.strictEqual(response.statusCode, 200);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.status, "healthy");
      assert.ok(body.timestamp);
      assert.ok(typeof body.uptime === "number");
    });

    it("should include uptime in response", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health",
      });

      const body = JSON.parse(response.body);
      assert.ok(body.uptime);
      assert.strictEqual(typeof body.uptime, "number");
    });

    it("should return ISO timestamp format", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health",
      });

      const body = JSON.parse(response.body);
      assert.ok(body.timestamp);
      assert.ok(Date.parse(body.timestamp));
    });
  });

  describe("GET /health/detailed", () => {
    it("should return comprehensive health information", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health/detailed",
      });

      assert.strictEqual(response.statusCode, 200);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.ok, true);
      assert.strictEqual(body.status, "healthy");
      assert.ok(body.score >= 0 && body.score <= 100);
      assert.ok(body.timestamp);
      assert.ok(body.uptime);
      assert.ok(Array.isArray(body.dependencies));
      assert.ok(body.metrics);
    });

    it("should include all dependency information", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health/detailed",
      });

      const body = JSON.parse(response.body);
      assert.ok(Array.isArray(body.dependencies));

      const dependency = body.dependencies[0];
      assert.ok(dependency.name);
      assert.ok(dependency.type);
      assert.ok(dependency.status);
      assert.ok(typeof dependency.latency === "number");
      assert.ok(dependency.message);
      assert.ok(typeof dependency.critical === "boolean");
      assert.ok(dependency.lastChecked);
    });

    it("should include memory metrics", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health/detailed",
      });

      const body = JSON.parse(response.body);
      assert.ok(body.metrics.memory);
      assert.ok(typeof body.metrics.memory.heapUsed === "number");
      assert.ok(typeof body.metrics.memory.heapTotal === "number");
      assert.ok(typeof body.metrics.memory.external === "number");
      assert.ok(typeof body.metrics.memory.rss === "number");
    });

    it("should include CPU metrics", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health/detailed",
      });

      const body = JSON.parse(response.body);
      assert.ok(body.metrics.cpu);
      assert.ok(typeof body.metrics.cpu.user === "number");
      assert.ok(typeof body.metrics.cpu.system === "number");
    });

    it("should include alerts array", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health/detailed",
      });

      const body = JSON.parse(response.body);
      assert.ok(Array.isArray(body.alerts));
    });
  });

  describe("GET /health/live", () => {
    it("should always return 200 for liveness probe", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health/live",
      });

      assert.strictEqual(response.statusCode, 200);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.status, "alive");
      assert.ok(body.timestamp);
      assert.ok(typeof body.uptime === "number");
    });

    it("should include process uptime", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health/live",
      });

      const body = JSON.parse(response.body);
      assert.ok(typeof body.uptime === "number");
      assert.ok(body.uptime >= 0);
    });
  });

  describe("GET /health/ready", () => {
    it("should return 200 when critical dependencies are healthy", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health/ready",
      });

      assert.strictEqual(response.statusCode, 200);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.status, "ready");
      assert.ok(body.timestamp);
    });

    it("should include timestamp in response", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health/ready",
      });

      const body = JSON.parse(response.body);
      assert.ok(body.timestamp);
      assert.ok(Date.parse(body.timestamp));
    });
  });

  describe("GET /health/dependency/:name", () => {
    it("should return specific dependency health", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health/dependency/database",
      });

      assert.strictEqual(response.statusCode, 200);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.ok, true);
      assert.strictEqual(body.dependency, "database");
      assert.strictEqual(body.status, "healthy");
      assert.ok(typeof body.latency === "number");
      assert.ok(body.message);
      assert.ok(typeof body.critical === "boolean");
      assert.ok(body.lastChecked);
    });

    it("should return 404 for unknown dependency", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health/dependency/unknown",
      });

      assert.strictEqual(response.statusCode, 404);

      const body = JSON.parse(response.body);
      assert.ok(body.error);
      assert.ok(Array.isArray(body.availableDependencies));
    });

    it("should return available dependencies on 404", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health/dependency/invalid",
      });

      const body = JSON.parse(response.body);
      assert.ok(Array.isArray(body.availableDependencies));
      assert.ok(body.availableDependencies.length > 0);
    });
  });
});
