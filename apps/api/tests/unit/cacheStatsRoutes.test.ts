#!/usr/bin/env tsx
/**
 * Unit Tests for cacheStatsRoutes
 * Testing cache statistics and monitoring endpoints plus their authorization.
 *
 * The cache routes drive the GLOBAL cross-tenant/cross-pod RedisCacheManager,
 * so they are admin system-ops endpoints: read routes require SYSTEM_MONITOR,
 * destructive routes (flush/invalidate/warm) require SYSTEM_CONFIGURE. These
 * tests exercise both the behavior (authenticated as SUPER_ADMIN) and the
 * authorization boundary (client rejected, ADMIN blocked from destructive ops).
 *
 * @file cacheStatsRoutes.test.ts
 * @description Tests for cacheStatsRoutes - Unit Tests
 * @layer infrastructure
 */

import { describe, it, beforeEach, afterEach, vi, expect } from "vitest";
import { createMockPrismaModule } from "./helpers/mockPrisma.js";
import { InMemoryAuditLogRepository } from "./helpers/InMemoryAuditLogRepository.js";

// ─── Mock setup (must precede any import that touches @infra/prisma) ──────────
const { mockPrisma } = createMockPrismaModule();

vi.mock("@infra/prisma", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, prisma: mockPrisma.prisma };
});

// Decode-only admin auth mock: a decodable Bearer token passes requireAdminAuth
// and its `role` claim drives the REAL requirePermission check against the
// seeded RbacService, so the authz boundary is exercised end-to-end.
vi.mock("../../src/admin/auth/adminAuthMiddleware.js", async () => {
  const { createAdminAuthMock } = await import("./helpers/mockAuthMiddleware.js");
  return createAdminAuthMock();
});

// ─── Dynamic imports after mocks ─────────────────────────────────────────────
const Fastify = (await import("fastify")).default;
type FastifyInstance = import("fastify").FastifyInstance;
type RedisCacheManager = import("@adapters/cache-redis").RedisCacheManager;
const { Container } = await import("../../src/infrastructure/container/Container.js");
const { TOKENS } = await import("../../src/infrastructure/container/types.js");
const { RbacService } = await import("../../src/auth/rbacService.js");
const { PrismaAdminUserRepository } =
  await import("../../src/infrastructure/repositories/PrismaAdminUserRepository.js");
const { PrismaRoleRepository } =
  await import("../../src/infrastructure/repositories/PrismaRoleRepository.js");
const { generateAdminToken } = await import("./admin/adminTestHelper.js");

// ─── Tokens ──────────────────────────────────────────────────────────────────
// SUPER_ADMIN → all permissions. ADMIN → SYSTEM_MONITOR only (no SYSTEM_CONFIGURE
// in the seed). CLIENT → an unknown role that resolves to zero permissions,
// standing in for any authenticated customer principal.
const timestamp = Date.now();
const superAdminToken = generateAdminToken({
  id: "cache-super-admin",
  email: `cache-super-${timestamp}@example.com`,
  name: "Cache Super Admin",
  role: "SUPER_ADMIN",
});
const adminToken = generateAdminToken({
  id: "cache-admin",
  email: `cache-admin-${timestamp}@example.com`,
  name: "Cache Admin",
  role: "ADMIN",
});
const clientToken = generateAdminToken({
  id: "cache-client",
  email: `cache-client-${timestamp}@example.com`,
  name: "Cache Client",
  role: "CLIENT",
});

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

// ─── Mock cache manager ──────────────────────────────────────────────────────
type MockCacheManager = Pick<
  RedisCacheManager,
  "getStats" | "healthCheck" | "flush" | "invalidateByTag" | "invalidateByPattern" | "warmCache"
>;

function createMockCacheManager(
  config: {
    healthy?: boolean;
    statsSuccess?: boolean;
    flushSuccess?: boolean;
    invalidateSuccess?: boolean;
    warmSuccess?: boolean;
  } = {}
): MockCacheManager {
  const {
    healthy = true,
    statsSuccess = true,
    flushSuccess = true,
    invalidateSuccess = true,
    warmSuccess = true,
  } = config;

  return {
    getStats: vi.fn(async () => ({
      ok: statsSuccess,
      value: statsSuccess
        ? {
            hits: 1000,
            misses: 200,
            hitRate: 0.833,
            totalKeys: 500,
            memoryUsage: 5242880, // 5MB
            l1Hits: 800,
            l2Hits: 200,
            l1Size: 300,
            avgTtl: 3600,
            hotKeys: [
              { key: "user:123", hits: 150 },
              { key: "post:456", hits: 120 },
              { key: "project:789", hits: 100 },
              { key: "channel:abc", hits: 90 },
              { key: "analytics:xyz", hits: 80 },
            ],
          }
        : undefined,
    })),
    healthCheck: vi.fn(async () => ({
      ok: healthy,
      value: healthy
        ? {
            status: "healthy",
            latency: 15,
          }
        : undefined,
    })),
    flush: vi.fn(async () => ({
      ok: flushSuccess,
      value: flushSuccess ? undefined : undefined,
    })),
    invalidateByTag: vi.fn(async (tag: string) => ({
      ok: invalidateSuccess,
      value: invalidateSuccess ? (tag === "users" ? 10 : 5) : 0,
    })),
    invalidateByPattern: vi.fn(async (pattern: string) => ({
      ok: invalidateSuccess,
      value: invalidateSuccess ? (pattern === "user:*" ? 15 : 8) : 0,
    })),
    warmCache: vi.fn(async () => ({
      ok: warmSuccess,
      value: warmSuccess ? 25 : 0,
    })),
  };
}

// ─── App factory (registers the cache manager + a real RbacService) ──────────
async function buildApp(cacheManager: MockCacheManager): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  const container = new Container();
  container.registerInstance(TOKENS.RedisCacheManager, cacheManager as RedisCacheManager);

  const adminUserRepo = new PrismaAdminUserRepository(mockPrisma.prisma as never);
  const roleRepo = new PrismaRoleRepository(mockPrisma.prisma as never);
  container.registerInstance(
    TOKENS.RbacService,
    new RbacService(adminUserRepo, roleRepo, new InMemoryAuditLogRepository())
  );

  app.decorate("container", container);

  const { cacheStatsRoutes } = await import("../../src/monitoring/cacheStatsRoutes.js");
  await app.register(cacheStatsRoutes);
  await app.ready();
  return app;
}

describe("cacheStatsRoutes - Unit Tests", () => {
  let app: FastifyInstance;
  let mockCacheManager: MockCacheManager;

  beforeEach(async () => {
    mockCacheManager = createMockCacheManager();
    app = await buildApp(mockCacheManager);
  });

  afterEach(async () => {
    await app.close();
  });

  describe("GET /cache/stats", () => {
    it("should return comprehensive cache statistics", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/cache/stats",
        headers: authHeaders(superAdminToken),
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.stats).toBeTruthy();
      expect(body.timestamp).toBeTruthy();
    });

    it("should include hit/miss metrics", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/cache/stats",
        headers: authHeaders(superAdminToken),
      });

      const body = JSON.parse(response.body);
      expect(body.stats.hits).toBeTruthy();
      expect(body.stats.misses).toBeTruthy();
      expect(body.stats.hitRate).toBeTruthy();
      expect(body.stats.hitRatePercentage).toBeTruthy();
    });

    it("should include cache size metrics", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/cache/stats",
        headers: authHeaders(superAdminToken),
      });

      const body = JSON.parse(response.body);
      expect(body.stats.totalKeys).toBeTruthy();
      expect(body.stats.memoryUsage).toBeTruthy();
      expect(body.stats.memoryUsageMB).toBeTruthy();
    });

    it("should include L1/L2 cache breakdown", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/cache/stats",
        headers: authHeaders(superAdminToken),
      });

      const body = JSON.parse(response.body);
      expect(typeof body.stats.l1Hits === "number").toBeTruthy();
      expect(typeof body.stats.l2Hits === "number").toBeTruthy();
      expect(typeof body.stats.l1Size === "number").toBeTruthy();
    });

    it("should include hot keys (top 10)", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/cache/stats",
        headers: authHeaders(superAdminToken),
      });

      const body = JSON.parse(response.body);
      expect(Array.isArray(body.stats.hotKeys)).toBeTruthy();
      expect(body.stats.hotKeys.length <= 10).toBeTruthy();
    });

    it("should handle cache manager errors gracefully", async () => {
      const appWithFailingCache = await buildApp(createMockCacheManager({ statsSuccess: false }));

      const response = await appWithFailingCache.inject({
        method: "GET",
        url: "/cache/stats",
        headers: authHeaders(superAdminToken),
      });

      expect(response.statusCode).toBe(500);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);

      await appWithFailingCache.close();
    });
  });

  describe("GET /cache/health", () => {
    it("should return cache health status", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/cache/health",
        headers: authHeaders(superAdminToken),
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.health).toBeTruthy();
      expect(body.timestamp).toBeTruthy();
    });

    it("should include health status and latency", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/cache/health",
        headers: authHeaders(superAdminToken),
      });

      const body = JSON.parse(response.body);
      expect(body.health.status).toBeTruthy();
      expect(typeof body.health.latency === "number").toBeTruthy();
      expect(body.health.latencyMs).toBeTruthy();
    });

    it("should handle health check failures", async () => {
      const appWithUnhealthyCache = await buildApp(createMockCacheManager({ healthy: false }));

      const response = await appWithUnhealthyCache.inject({
        method: "GET",
        url: "/cache/health",
        headers: authHeaders(superAdminToken),
      });

      expect(response.statusCode).toBe(500);
      await appWithUnhealthyCache.close();
    });
  });

  describe("POST /cache/flush", () => {
    it("should flush cache successfully", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/cache/flush",
        headers: authHeaders(superAdminToken),
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.message).toBeTruthy();
      expect(body.timestamp).toBeTruthy();
    });

    it("should handle flush failures", async () => {
      const appWithFailingFlush = await buildApp(createMockCacheManager({ flushSuccess: false }));

      const response = await appWithFailingFlush.inject({
        method: "POST",
        url: "/cache/flush",
        headers: authHeaders(superAdminToken),
      });

      expect(response.statusCode).toBe(500);
      await appWithFailingFlush.close();
    });
  });

  describe("POST /cache/invalidate", () => {
    it("should invalidate cache by tags", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/cache/invalidate",
        headers: authHeaders(superAdminToken),
        payload: {
          tags: ["users", "posts"],
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(typeof body.invalidated === "number").toBeTruthy();
      expect(Array.isArray(body.tags)).toBeTruthy();
      expect(body.timestamp).toBeTruthy();
    });

    it("should invalidate cache by patterns", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/cache/invalidate",
        headers: authHeaders(superAdminToken),
        payload: {
          patterns: ["user:*", "post:*"],
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(typeof body.invalidated === "number").toBeTruthy();
      expect(Array.isArray(body.patterns)).toBeTruthy();
    });

    it("should invalidate cache by both tags and patterns", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/cache/invalidate",
        headers: authHeaders(superAdminToken),
        payload: {
          tags: ["users"],
          patterns: ["post:*"],
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.invalidated > 0).toBeTruthy();
    });

    it("should return 400 when no tags or patterns provided", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/cache/invalidate",
        headers: authHeaders(superAdminToken),
        payload: {},
      });

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);
      expect(body.error).toBeTruthy();
    });

    it("should handle empty tags array", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/cache/invalidate",
        headers: authHeaders(superAdminToken),
        payload: {
          tags: [],
          patterns: ["test:*"],
        },
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe("GET /cache/hot-keys", () => {
    it("should return top hot keys", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/cache/hot-keys",
        headers: authHeaders(superAdminToken),
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.hotKeys)).toBeTruthy();
      expect(typeof body.count === "number").toBeTruthy();
      expect(body.timestamp).toBeTruthy();
    });

    it("should limit hot keys to 50 entries", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/cache/hot-keys",
        headers: authHeaders(superAdminToken),
      });

      const body = JSON.parse(response.body);
      expect(body.hotKeys.length <= 50).toBeTruthy();
    });
  });

  describe("POST /cache/warm", () => {
    it("should warm cache successfully", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/cache/warm",
        headers: authHeaders(superAdminToken),
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(typeof body.warmedCount === "number").toBeTruthy();
      expect(body.timestamp).toBeTruthy();
    });

    it("should return warmed keys count", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/cache/warm",
        headers: authHeaders(superAdminToken),
      });

      const body = JSON.parse(response.body);
      expect(body.warmedCount >= 0).toBeTruthy();
    });

    it("should handle warming failures", async () => {
      const appWithFailingWarm = await buildApp(createMockCacheManager({ warmSuccess: false }));

      const response = await appWithFailingWarm.inject({
        method: "POST",
        url: "/cache/warm",
        headers: authHeaders(superAdminToken),
      });

      expect(response.statusCode).toBe(500);
      await appWithFailingWarm.close();
    });
  });

  // ── Authorization boundary ────────────────────────────────────────────────
  // The RedisCacheManager these routes drive is global and cross-tenant, so
  // no customer principal may reach them. Reads need SYSTEM_MONITOR; destructive
  // ops need SYSTEM_CONFIGURE.
  describe("Authorization", () => {
    const readRoutes = [
      { method: "GET" as const, url: "/cache/stats" },
      { method: "GET" as const, url: "/cache/health" },
      { method: "GET" as const, url: "/cache/hot-keys" },
    ];
    const destructiveRoutes = [
      { method: "POST" as const, url: "/cache/flush", payload: {} },
      { method: "POST" as const, url: "/cache/invalidate", payload: { tags: ["users"] } },
      { method: "POST" as const, url: "/cache/warm", payload: {} },
    ];
    const allRoutes = [...readRoutes, ...destructiveRoutes];

    it("rejects unauthenticated requests with 401 on every route", async () => {
      for (const route of allRoutes) {
        const response = await app.inject({
          method: route.method,
          url: route.url,
          ...("payload" in route ? { payload: route.payload } : {}),
        });
        expect(response.statusCode, `${route.method} ${route.url} must reject anonymous`).toBe(401);
      }
    });

    it("rejects a customer/client token with 403 on every route", async () => {
      for (const route of allRoutes) {
        const response = await app.inject({
          method: route.method,
          url: route.url,
          headers: authHeaders(clientToken),
          ...("payload" in route ? { payload: route.payload } : {}),
        });
        expect(response.statusCode, `${route.method} ${route.url} must reject client`).toBe(403);
        const body = JSON.parse(response.body);
        expect(body.error).toBeTruthy();
      }
    });

    it("allows an ADMIN token (SYSTEM_MONITOR) on read routes", async () => {
      for (const route of readRoutes) {
        const response = await app.inject({
          method: route.method,
          url: route.url,
          headers: authHeaders(adminToken),
        });
        expect(response.statusCode, `${route.method} ${route.url} should allow ADMIN read`).toBe(
          200
        );
      }
    });

    it("blocks an ADMIN token (no SYSTEM_CONFIGURE) on destructive routes with 403", async () => {
      for (const route of destructiveRoutes) {
        const response = await app.inject({
          method: route.method,
          url: route.url,
          headers: authHeaders(adminToken),
          payload: route.payload,
        });
        expect(
          response.statusCode,
          `${route.method} ${route.url} must require SYSTEM_CONFIGURE`
        ).toBe(403);
      }
    });

    it("allows a SUPER_ADMIN token on destructive routes", async () => {
      for (const route of destructiveRoutes) {
        const response = await app.inject({
          method: route.method,
          url: route.url,
          headers: authHeaders(superAdminToken),
          payload: route.payload,
        });
        expect(response.statusCode, `${route.method} ${route.url} should allow SUPER_ADMIN`).toBe(
          200
        );
      }
    });
  });

  describe("plugin fail-fast", () => {
    it("registers no routes when DI container is unavailable", async () => {
      const bareApp = Fastify({ logger: false });
      const { cacheStatsRoutes } = await import("../../src/monitoring/cacheStatsRoutes.js");
      await bareApp.register(cacheStatsRoutes);

      // Without container, the plugin returns early — none of the cache
      // ops routes are registered, so requests 404 instead of being
      // checked per-handler.
      const response = await bareApp.inject({ method: "GET", url: "/cache/stats" });
      expect(response.statusCode).toBe(404);

      await bareApp.close();
    });
  });
});
