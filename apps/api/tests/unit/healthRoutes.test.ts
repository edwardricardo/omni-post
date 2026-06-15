#!/usr/bin/env tsx
/**
 * Unit Tests for healthRoutes
 * Testing health check endpoints for monitoring and Kubernetes probes
 *
 * Coverage Target: 95%+
 *
 * @file healthRoutes.test.ts
 * @description Tests for healthRoutes - Unit Tests
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, vi, expect } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { Redis } from "ioredis";
import type { RedisCacheManager } from "@adapters/cache-redis";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import { createTestContainer } from "../../src/infrastructure/container/setup.js";
import { TOKENS } from "../../src/infrastructure/container/types.js";
import type { PrismaClient } from "@infra/prisma";

// ─── Mock Types ─────────────────────────────────────────────────────
type MockRedis = Pick<Redis, "ping" | "get" | "set" | "del" | "keys">;
type MockCacheManager = Pick<
  RedisCacheManager,
  "healthCheck" | "getStats" | "flush" | "invalidateByTag" | "invalidateByPattern" | "warmCache"
>;

// Mock dependencies
const createMockRedis = (): MockRedis => {
  return {
    ping: vi.fn(async () => "PONG"),
    get: vi.fn(async () => null),
    set: vi.fn(async () => "OK"),
    del: vi.fn(async () => 1),
    keys: vi.fn(async () => []),
  };
};

const createMockCacheManager = (healthy = true): MockCacheManager => {
  return {
    healthCheck: vi.fn(async () => ({
      ok: true,
      value: {
        status: healthy ? "healthy" : "unhealthy",
        latency: 10,
      },
    })),
    getStats: vi.fn(async () => ({
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
    flush: vi.fn(async () => ({ ok: true, value: undefined })),
    invalidateByTag: vi.fn(async () => ({ ok: true, value: 5 })),
    invalidateByPattern: vi.fn(async () => ({ ok: true, value: 3 })),
    warmCache: vi.fn(async () => ({ ok: true, value: 10 })),
  };
};

// Mock health check manager
const createMockHealthCheckManager = (status: "healthy" | "degraded" | "unhealthy" = "healthy") => {
  return {
    getCurrentStatus: vi.fn(() => ({
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
    checkAll: vi.fn(async () => ({
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
    checkDependency: vi.fn(async (name: string) => {
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
    register: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
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

vi.mock("@monitoring/health-checks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@monitoring/health-checks")>();
  return {
    ...actual,
    createHealthCheckManager: vi.fn(),
    DatabaseHealthChecker: class {},
    RedisHealthChecker: class {},
    CacheHealthChecker: class {},
    QueueHealthChecker: class {},
    StorageHealthChecker: class {},
    ProviderHealthChecker: class {},
  };
});

vi.mock("@adapters/db-prisma", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@adapters/db-prisma")>();
  return {
    ...actual,
    createPrismaRepoAdapter: vi.fn(() => ({})),
  };
});

vi.mock("@adapters/queue-bullmq", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@adapters/queue-bullmq")>();
  return { ...actual };
});

// Full REPLACE intentional — storage-s3 has import-time side effects.
vi.mock("@adapters/storage-s3", () => ({
  createS3StorageAdapter: vi.fn(() => ({})),
}));

vi.mock("../../src/providers/providerRegistry.js", () => ({
  providerRegistry: {},
}));

describe("healthRoutes - Unit Tests", () => {
  let app: FastifyInstance;
  let mockRedis: MockRedis;
  let mockCacheManager: MockCacheManager;

  beforeAll(async () => {
    mockRedis = createMockRedis();
    mockCacheManager = createMockCacheManager(true);

    // Configure the mocked createHealthCheckManager
    const healthChecks = await import("@monitoring/health-checks");
    vi.mocked(healthChecks.createHealthCheckManager).mockImplementation(() =>
      createMockHealthCheckManager("healthy")
    );

    app = Fastify({ logger: false });
    // healthRoutes uses Zod response schemas — register the type-provider
    // compilers so Fastify can serialize them. Mirrors apps/api/src/index.ts.
    app.withTypeProvider<ZodTypeProvider>();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    // Provide a DI container so healthRoutes can resolve BackgroundTaskScheduler.
    const container = createTestContainer();
    // healthRoutes resolves PrismaClient from the container to build its repo adapter.
    container.registerInstance(TOKENS.PrismaClient, {} as unknown as PrismaClient);
    container.registerInstance(TOKENS.BackgroundTaskScheduler, new NoopBackgroundTaskScheduler());
    // healthRoutes resolves a queue adapter via the registry. Provide a
    // stub that exercises the QueuePortRegistry contract without touching
    // BullMQ or Redis.
    const stubQueuePort = {
      enqueue: vi.fn(async () => ({ ok: true as const, value: "stub-id" })),
      enqueueBulk: vi.fn(async () => ({ ok: true as const, value: [] as string[] })),
      health: vi.fn(async () => ({
        ok: true as const,
        value: { connected: true, waiting: 0, active: 0, completed: 0, failed: 0 },
      })),
      remove: vi.fn(async () => ({ ok: true as const, value: true })),
      getJobStates: vi.fn(async () => ({
        ok: true as const,
        value: { completed: 0, failed: 0, pending: 0 },
      })),
    };
    container.registerInstance(TOKENS.QueuePortRegistry, {
      forQueue: () => stubQueuePort,
      close: async () => {},
    });
    app.decorate("container", container);

    const { healthRoutes } = await import("../../src/health/healthRoutes.js");
    await app.register(healthRoutes, {
      redis: mockRedis as Redis,
      cacheManager: mockCacheManager as RedisCacheManager,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /health", () => {
    it("should return 200 with healthy status", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.status).toBe("healthy");
      expect(body.timestamp).toBeTruthy();
      expect(typeof body.uptime === "number").toBeTruthy();
    });

    it("should include uptime in response", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health",
      });

      const body = JSON.parse(response.body);
      expect(body.uptime).toBeTruthy();
      expect(typeof body.uptime).toBe("number");
    });

    it("should return ISO timestamp format", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health",
      });

      const body = JSON.parse(response.body);
      expect(body.timestamp).toBeTruthy();
      expect(Date.parse(body.timestamp)).toBeTruthy();
    });
  });

  describe("GET /health/detailed", () => {
    it("should return comprehensive health information", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health/detailed",
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.status).toBe("healthy");
      expect(body.score >= 0 && body.score <= 100).toBeTruthy();
      expect(body.timestamp).toBeTruthy();
      expect(body.uptime).toBeTruthy();
      expect(Array.isArray(body.dependencies)).toBeTruthy();
      expect(body.metrics).toBeTruthy();
    });

    it("should include all dependency information", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health/detailed",
      });

      const body = JSON.parse(response.body);
      expect(Array.isArray(body.dependencies)).toBeTruthy();

      const dependency = body.dependencies[0];
      expect(dependency.name).toBeTruthy();
      expect(dependency.type).toBeTruthy();
      expect(dependency.status).toBeTruthy();
      expect(typeof dependency.latency === "number").toBeTruthy();
      expect(dependency.message).toBeTruthy();
      expect(typeof dependency.critical === "boolean").toBeTruthy();
      expect(dependency.lastChecked).toBeTruthy();
    });

    it("should include memory metrics", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health/detailed",
      });

      const body = JSON.parse(response.body);
      expect(body.metrics.memory).toBeTruthy();
      expect(typeof body.metrics.memory.heapUsed === "number").toBeTruthy();
      expect(typeof body.metrics.memory.heapTotal === "number").toBeTruthy();
      expect(typeof body.metrics.memory.external === "number").toBeTruthy();
      expect(typeof body.metrics.memory.rss === "number").toBeTruthy();
    });

    it("should include CPU metrics", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health/detailed",
      });

      const body = JSON.parse(response.body);
      expect(body.metrics.cpu).toBeTruthy();
      expect(typeof body.metrics.cpu.user === "number").toBeTruthy();
      expect(typeof body.metrics.cpu.system === "number").toBeTruthy();
    });

    it("should include alerts array", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health/detailed",
      });

      const body = JSON.parse(response.body);
      expect(Array.isArray(body.alerts)).toBeTruthy();
    });
  });

  describe("GET /health/live", () => {
    it("should always return 200 for liveness probe", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health/live",
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.status).toBe("alive");
      expect(body.timestamp).toBeTruthy();
      expect(typeof body.uptime === "number").toBeTruthy();
    });

    it("should include process uptime", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health/live",
      });

      const body = JSON.parse(response.body);
      expect(typeof body.uptime === "number").toBeTruthy();
      expect(body.uptime >= 0).toBeTruthy();
    });
  });

  describe("GET /health/ready", () => {
    it("should return 200 when critical dependencies are healthy", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health/ready",
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.status).toBe("ready");
      expect(body.timestamp).toBeTruthy();
    });

    it("should include timestamp in response", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health/ready",
      });

      const body = JSON.parse(response.body);
      expect(body.timestamp).toBeTruthy();
      expect(Date.parse(body.timestamp)).toBeTruthy();
    });
  });

  describe("GET /health/dependency/:name", () => {
    it("should return specific dependency health", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health/dependency/database",
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.dependency).toBe("database");
      expect(body.status).toBe("healthy");
      expect(typeof body.latency === "number").toBeTruthy();
      expect(body.message).toBeTruthy();
      expect(typeof body.critical === "boolean").toBeTruthy();
      expect(body.lastChecked).toBeTruthy();
    });

    it("should return 404 for unknown dependency", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health/dependency/unknown",
      });

      expect(response.statusCode).toBe(404);

      const body = JSON.parse(response.body);
      expect(body.error).toBeTruthy();
      expect(Array.isArray(body.availableDependencies)).toBeTruthy();
    });

    it("should return available dependencies on 404", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health/dependency/invalid",
      });

      const body = JSON.parse(response.body);
      expect(Array.isArray(body.availableDependencies)).toBeTruthy();
      expect(body.availableDependencies.length > 0).toBeTruthy();
    });
  });
});
