#!/usr/bin/env tsx
/**
 * Unit Tests for healthRoutes
 * Testing health check endpoints for monitoring and Kubernetes probes
 *
 * Coverage Target: 95%+
 *
 * @file healthRoutes.test.ts
 * @description Tests for healthRoutes - Unit Tests. The plugin receives its health checkers and
 *              its scheduler from the composition root through its options, so the suite passes
 *              doubles there and decorates no DI container.
 * @layer infrastructure
 */

import { describe, it, beforeAll, beforeEach, afterAll, vi, expect } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { HealthChecker } from "@monitoring/health-checks";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";

// One checker double per dependency the composition root probes. The route registers each one
// under its dependency name, and the doubles are told apart by identity.
const createChecker = (): HealthChecker => ({
  check: vi.fn(async () => ({ status: "healthy" as const, latency: 1 })),
});
const checkers = {
  database: createChecker(),
  redis: createChecker(),
  cache: createChecker(),
  queue: createChecker(),
  storage: createChecker(),
  providers: createChecker(),
};

// What the route registered on the manager, by name. A plain map rather than the spy's own
// record, because `vi.clearAllMocks()` empties that record before every test.
const registrations = new Map<string, unknown>();

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
      // The real HealthCheckManager.checkDependency distinguishes these two,
      // and the route now answers them differently, so the mock has to speak
      // the same contract instead of a lookalike string.
      if (name === "exploding") {
        return { ok: false, error: "CHECK_FAILED" };
      }
      return { ok: false, error: "NOT_FOUND" };
    }),
    register: vi.fn((name: string, checker: unknown) => {
      registrations.set(name, checker);
    }),
    start: vi.fn(),
    stop: vi.fn(),
  };
};

vi.mock("@monitoring/health-checks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@monitoring/health-checks")>();
  return {
    ...actual,
    createHealthCheckManager: vi.fn(),
  };
});

describe("healthRoutes - Unit Tests", () => {
  let app: FastifyInstance;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  beforeAll(async () => {
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

    const { healthRoutes } = await import("../../src/health/healthRoutes.js");
    // The manager double records at registration, so the record holds this registration only.
    registrations.clear();
    await app.register(healthRoutes, { scheduler: new NoopBackgroundTaskScheduler(), checkers });
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
      expect(body.ok).toBe(false);
      expect(body.dependency).toBe("unknown");
      expect(body.error).toBeTruthy();
    });

    it("should not enumerate registered dependencies to an unauthenticated caller", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health/dependency/invalid",
      });

      // The route is public. Any field here that lists what IS registered hands
      // the caller the internal dependency topology it could not otherwise
      // discover, so the 404 body must never grow one back.
      const body = JSON.parse(response.body);
      expect(body.availableDependencies).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain("database");
      expect(JSON.stringify(body)).not.toContain("storage");
    });

    it("should return 503 rather than 404 when a registered dependency's check fails", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/health/dependency/exploding",
      });

      // A failing checker means the dependency EXISTS and is down. Reporting it
      // as 404 sends the reader to check their spelling during an outage.
      expect(response.statusCode).toBe(503);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);
      expect(body.dependency).toBe("exploding");
      expect(body.status).toBe("unhealthy");
    });
  });

  describe("composition-root wiring", () => {
    it("registers each checker the composition root built under its dependency name", () => {
      expect([...registrations.keys()].sort()).toEqual(Object.keys(checkers).sort());
      for (const [name, checker] of Object.entries(checkers)) {
        expect(registrations.get(name), name).toBe(checker);
      }
    });

    it("serves its routes from the options alone, with no DI container on the instance", () => {
      expect(app.hasDecorator("container")).toBe(false);
    });
  });
});
