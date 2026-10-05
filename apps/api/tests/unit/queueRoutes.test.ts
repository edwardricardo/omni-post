/**
 * @file queueRoutes.test.ts
 * @description Unit tests for queueRoutes (admin/queueRoutes). The plugin receives the
 *              publish queue from the composition root through its options, so the suite
 *              passes an in-memory double there and every answer is deterministic. Mocked
 *              Prisma backs the RBAC guard, the one consumer of the container below.
 *
 * Tests the 5 BullMQ queue management endpoints:
 *   GET  /admin/queue/stats
 *   GET  /admin/queue/jobs
 *   GET  /admin/queue/jobs/:id
 *   POST /admin/queue/jobs/:id/retry
 *   POST /admin/queue/jobs/:id/remove
 *
 * Routes are protected with requireAdminAuth + requirePermission(SYSTEM_MONITOR).
 * @layer infrastructure
 */

import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from "vitest";
import type { Job, Queue } from "bullmq";
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
// Publish queue double
// ---------------------------------------------------------------------------

// The one job the double holds, with spies on the two operations the routes run on a job.
const retry = vi.fn(async () => undefined);
const remove = vi.fn(async () => undefined);
const storedJob = {
  id: "job-1",
  name: "publish-post",
  data: { postId: "post-1" },
  progress: 0,
  attemptsMade: 3,
  opts: { attempts: 3 },
  timestamp: 1_700_000_000_000,
  processedOn: 1_700_000_001_000,
  finishedOn: 1_700_000_002_000,
  failedReason: "provider timeout",
  stacktrace: [],
  delay: 0,
  getState: async () => "failed",
  retry,
  remove,
} as unknown as Job;

// The publish queue the composition root builds, narrowed to the operations the routes call.
const publishQueue: Pick<Queue, "name" | "getJobCounts" | "getJobs" | "getJob" | "getJobLogs"> = {
  name: "publish",
  getJobCounts: vi.fn(async () => ({
    waiting: 2,
    active: 1,
    completed: 6,
    failed: 2,
    delayed: 1,
    paused: 0,
  })),
  getJobs: vi.fn(async () => [storedJob]),
  getJob: vi.fn(async (id: string) => (id === storedJob.id ? storedJob : undefined)),
  getJobLogs: vi.fn(async () => ({ logs: ["attempt 3 failed: provider timeout"], count: 1 })),
};

const DEFAULT_STATES = ["waiting", "active", "failed", "delayed", "completed"];

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
  await app.register(queueRoutes, { queue: publishQueue });
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

  beforeEach(() => {
    vi.clearAllMocks();
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

    it("returns the publish queue's counts with the success rate over finished jobs", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/queue/stats",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).data).toEqual({
        total: 12,
        queued: 3,
        processing: 1,
        published: 6,
        failed: 2,
        paused: 0,
        successRate: 75,
      });
    });
  });

  // ── GET /admin/queue/jobs ──────────────────────────────────────────────

  describe("GET /admin/queue/jobs", () => {
    it("lists the first page of jobs in the default states", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/queue/jobs",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.total).toBe(1);
      expect(body.data.items[0]).toMatchObject({
        id: "job-1",
        maxAttempts: 3,
        failedReason: "provider timeout",
      });
      expect(publishQueue.getJobs).toHaveBeenCalledWith(DEFAULT_STATES, 0, 49);
    });

    it("asks the queue for the valid requested states only", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/queue/jobs?types=failed,unknown,waiting",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(publishQueue.getJobs).toHaveBeenCalledWith(["failed", "waiting"], 0, 49);
    });

    it("asks the queue for the requested page bounds", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/queue/jobs?start=0&end=9",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(publishQueue.getJobs).toHaveBeenCalledWith(DEFAULT_STATES, 0, 9);
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
    it("returns 404 for a job the queue does not hold", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/queue/jobs/nonexistent-job-id-999",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).ok).toBe(false);
    });

    it("returns the job with its state and its logs", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/queue/jobs/job-1",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).data).toMatchObject({
        id: "job-1",
        state: "failed",
        logs: { logs: ["attempt 3 failed: provider timeout"], count: 1 },
      });
      expect(publishQueue.getJobLogs).toHaveBeenCalledWith("job-1", 0, 50);
    });
  });

  // ── POST /admin/queue/jobs/:id/retry ──────────────────────────────────

  describe("POST /admin/queue/jobs/:id/retry", () => {
    it("returns 404 and retries nothing for a job the queue does not hold", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/queue/jobs/nonexistent-retry-job/retry",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).ok).toBe(false);
      expect(retry).not.toHaveBeenCalled();
    });

    it("retries the job the queue holds", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/queue/jobs/job-1/retry",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).data).toEqual({ retried: true, jobId: "job-1" });
      expect(retry).toHaveBeenCalledTimes(1);
    });
  });

  // ── POST /admin/queue/jobs/:id/remove ─────────────────────────────────

  describe("POST /admin/queue/jobs/:id/remove", () => {
    it("returns 404 and removes nothing for a job the queue does not hold", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/queue/jobs/nonexistent-remove-job/remove",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).ok).toBe(false);
      expect(remove).not.toHaveBeenCalled();
    });

    it("removes the job the queue holds", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/queue/jobs/job-1/remove",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).data).toEqual({ removed: true, jobId: "job-1" });
      expect(remove).toHaveBeenCalledTimes(1);
    });
  });
});
