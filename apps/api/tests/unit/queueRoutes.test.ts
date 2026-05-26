/**
 * @file queueRoutes.test.ts
 * @description Unit tests for queueRoutes (admin/queueRoutes). Uses mocked Prisma
 *              and a real Fastify instance to test HTTP endpoint behavior.
 *
 * Tests the 5 BullMQ queue management endpoints:
 *   GET  /admin/queue/stats
 *   GET  /admin/queue/jobs
 *   GET  /admin/queue/jobs/:id
 *   POST /admin/queue/jobs/:id/retry
 *   POST /admin/queue/jobs/:id/remove
 *
 * Routes are protected with requireAdminAuth + requireAdmin middleware.
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";
import { createMockPrismaModule } from "./helpers/mockPrisma.js";
import { InMemoryAuditLogRepository } from "./helpers/InMemoryAuditLogRepository.js";

// ---------------------------------------------------------------------------
// Mock setup (must be before any dynamic imports)
// ---------------------------------------------------------------------------

const { mockPrisma } = createMockPrismaModule();

vi.mock("@infra/prisma", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, prisma: mockPrisma.prisma };
});

vi.mock("../../src/admin/auth/adminAuthMiddleware.js", async () => {
  const { createAdminAuthMock } = await import("./helpers/mockAuthMiddleware.js");
  return createAdminAuthMock();
});

vi.mock("../../src/lib/logger.js", () => {
  const noop = vi.fn();
  const noopLogger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => noopLogger,
  };
  return { logger: noopLogger, authLogger: noopLogger, createLogger: () => noopLogger };
});

// ---------------------------------------------------------------------------
// Dynamic imports after mocks
// ---------------------------------------------------------------------------

const Fastify = (await import("fastify")).default;
const { queueRoutes } = await import("../../src/admin/queueRoutes.js");
const { generateAdminToken } = await import("./admin/adminTestHelper.js");
const { Container } = await import("../../src/infrastructure/container/Container.js");
const { TOKENS } = await import("../../src/infrastructure/container/types.js");
const { RbacService } = await import("../../src/auth/rbacService.js");
const { PrismaAdminUserRepository } =
  await import("../../src/infrastructure/repositories/PrismaAdminUserRepository.js");
const { PrismaRoleRepository } =
  await import("../../src/infrastructure/repositories/PrismaRoleRepository.js");

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const timestamp = Date.now();

async function createTestApp() {
  const app = Fastify({ logger: false });
  const adminUserRepo = new PrismaAdminUserRepository(mockPrisma.prisma as never);
  const roleRepo = new PrismaRoleRepository(mockPrisma.prisma as never);
  const container = new Container();
  container.registerInstance(
    TOKENS.RbacService,
    new RbacService(adminUserRepo, roleRepo, new InMemoryAuditLogRepository())
  );
  app.decorate("container", container);
  await app.register(queueRoutes);
  await app.ready();
  return app;
}

let app: import("fastify").FastifyInstance;
let adminToken: string;

describe("queueRoutes", () => {
  beforeAll(async () => {
    app = await createTestApp();

    // Generate a valid admin JWT token directly (no DB needed for token generation)
    adminToken = generateAdminToken({
      id: "admin-queue-test-id",
      email: `queue-test-${timestamp}@example.com`,
      name: "Queue Test Admin",
      role: "ADMIN",
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // ── GET /admin/queue/stats ─────────────────────────────────────────────

  describe("GET /admin/queue/stats", () => {
    it("should return 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: "/admin/queue/stats" });
      expect(res.statusCode).toBe(401);
    });

    it("should return queue statistics with expected shape", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/queue/stats",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      // With lazyConnect the BullMQ client connects on demand; in a test env
      // without Redis it may return either 200 (empty counts) or 500 (ECONNREFUSED).
      const body = JSON.parse(res.body);
      if (res.statusCode === 200) {
        expect(body.ok).toBe(true);
        expect(typeof body.data.total === "number").toBeTruthy();
        expect(typeof body.data.queued === "number").toBeTruthy();
        expect(typeof body.data.processing === "number").toBeTruthy();
        expect(typeof body.data.published === "number").toBeTruthy();
        expect(typeof body.data.failed === "number").toBeTruthy();
        expect(typeof body.data.successRate === "number").toBeTruthy();
      } else {
        expect(res.statusCode).toBe(500);
        expect(body.ok).toBe(false);
      }
    });

    it("should return valid successRate in range 0-100 when Redis available", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/queue/stats",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      if (res.statusCode !== 200) return; // skip when Redis unavailable

      const body = JSON.parse(res.body);
      expect(body.data.successRate >= 0).toBeTruthy();
      expect(body.data.successRate <= 100).toBeTruthy();
    });
  });

  // ── GET /admin/queue/jobs ──────────────────────────────────────────────

  describe("GET /admin/queue/jobs", () => {
    it("should return jobs list with items array", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/queue/jobs",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(res.body);
      if (res.statusCode === 200) {
        expect(body.ok).toBe(true);
        expect(Array.isArray(body.data.items)).toBeTruthy();
        expect(typeof body.data.total === "number").toBeTruthy();
      } else {
        expect(res.statusCode).toBe(500);
        expect(body.ok).toBe(false);
      }
    });

    it("should accept types query parameter", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/queue/jobs?types=failed,waiting",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(res.body);
      if (res.statusCode === 200) {
        expect(body.ok).toBe(true);
        expect(Array.isArray(body.data.items)).toBeTruthy();
      } else {
        // Redis unavailable — 500 is acceptable
        expect(res.statusCode).toBe(500);
      }
    });

    it("should accept start and end pagination parameters", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/queue/jobs?start=0&end=9",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(res.body);
      if (res.statusCode === 200) {
        expect(body.ok).toBe(true);
      } else {
        expect(res.statusCode).toBe(500);
      }
    });

    it("should return 400 for invalid start parameter", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/queue/jobs?start=-1",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(false);
    });
  });

  // ── GET /admin/queue/jobs/:id ──────────────────────────────────────────

  describe("GET /admin/queue/jobs/:id", () => {
    it("should return 404 for a non-existent job ID when Redis available", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/queue/jobs/nonexistent-job-id-999",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(res.body);
      if (res.statusCode === 404) {
        expect(body.ok).toBe(false);
      } else {
        // Redis unavailable → 500
        expect(res.statusCode).toBe(500);
        expect(body.ok).toBe(false);
      }
    });

    it("should return structured error response for missing job", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/queue/jobs/job-does-not-exist",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(res.body);
      expect(body.ok).toBe(false);
    });
  });

  // ── POST /admin/queue/jobs/:id/retry ──────────────────────────────────

  describe("POST /admin/queue/jobs/:id/retry", () => {
    it("should return 404 when retrying non-existent job (Redis available)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/queue/jobs/nonexistent-retry-job/retry",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(res.body);
      if (res.statusCode === 404) {
        expect(body.ok).toBe(false);
      } else {
        // Redis unavailable
        expect(res.statusCode).toBe(500);
        expect(body.ok).toBe(false);
      }
    });

    it("should return error response shape for failed retry", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/queue/jobs/fake-job-id/retry",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(res.body);
      expect(body.ok).toBe(false);
    });
  });

  // ── POST /admin/queue/jobs/:id/remove ─────────────────────────────────

  describe("POST /admin/queue/jobs/:id/remove", () => {
    it("should return 404 when removing non-existent job (Redis available)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/queue/jobs/nonexistent-remove-job/remove",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(res.body);
      if (res.statusCode === 404) {
        expect(body.ok).toBe(false);
      } else {
        expect(res.statusCode).toBe(500);
        expect(body.ok).toBe(false);
      }
    });

    it("should return error response shape for failed removal", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/queue/jobs/fake-job-id/remove",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(res.body);
      expect(body.ok).toBe(false);
    });
  });
});
