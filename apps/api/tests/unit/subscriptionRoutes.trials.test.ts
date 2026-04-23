/**
 * @file subscriptionRoutes.trials.test.ts
 * @description Unit tests for subscriptionRoutes — Trials, Reporting, and Auto-Renewals.
 *              Uses in-memory mocked Prisma stores — no real database needed.
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";
import { createMockPrismaModule } from "./helpers/mockPrisma.js";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Mock setup — must come BEFORE any SUT imports
// ---------------------------------------------------------------------------

const { mockPrisma, stores } = createMockPrismaModule();

// Patch account.findUnique to resolve include: { projects: true }
const origAccountFindUnique = mockPrisma.prisma.account.findUnique;
mockPrisma.prisma.account.findUnique = vi.fn(async (args: Record<string, unknown>) => {
  const result = await origAccountFindUnique(args);
  if (!result) return null;
  const include = args.include as Record<string, unknown> | undefined;
  if (include?.projects) {
    (result as Record<string, unknown>).projects = stores.project
      .all()
      .filter((p) => p.accountId === result.id);
  }
  if (include?._count) {
    (result as Record<string, unknown>)._count = {
      projects: stores.project.all().filter((p) => p.accountId === result.id).length,
    };
  }
  return result;
});

const origAccountFindMany = mockPrisma.prisma.account.findMany;
mockPrisma.prisma.account.findMany = vi.fn(async (args?: Record<string, unknown>) => {
  const results = await origAccountFindMany(args);
  const include = (args as Record<string, unknown> | undefined)?.include as
    | Record<string, unknown>
    | undefined;
  if (include?.projects) {
    for (const r of results) {
      (r as Record<string, unknown>).projects = stores.project
        .all()
        .filter((p) => p.accountId === r.id);
    }
  }
  return results;
});

// Add models not in the default store
const prismaAny = mockPrisma.prisma as Record<string, unknown>;
prismaAny.adminUserPermission = { deleteMany: vi.fn(async () => ({ count: 0 })) };
const noopModel = {
  findMany: vi.fn(async () => []),
  findUnique: vi.fn(async () => null),
  findFirst: vi.fn(async () => null),
  create: vi.fn(async () => ({})),
  update: vi.fn(async () => ({})),
  delete: vi.fn(async () => ({})),
  deleteMany: vi.fn(async () => ({ count: 0 })),
  updateMany: vi.fn(async () => ({ count: 0 })),
  count: vi.fn(async () => 0),
  groupBy: vi.fn(async () => []),
};
prismaAny.teamMember = { ...noopModel };
prismaAny.post = { ...noopModel };
prismaAny.channel = { ...noopModel };
prismaAny.postContent = { ...noopModel };
prismaAny.postMedia = { ...noopModel };
prismaAny.accountSubscription = {
  ...noopModel,
  groupBy: vi.fn(async () => []),
  updateMany: vi.fn(async () => ({ count: 0 })),
};

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
  return {
    logger: noopLogger,
    authLogger: noopLogger,
    createLogger: () => noopLogger,
  };
});

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

const { createTestApp, createTestUsers, cleanupTestUsers, prisma } =
  await import("./subscriptionRoutes.test-helpers.js");

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

const timestamp = Date.now();
let app: FastifyInstance;
let adminToken: string;
let superAdminToken: string;
let supportToken: string;
let testAccountId: string;

describe("subscriptionRoutes - Trials, Reporting and Auto-Renewals", () => {
  beforeAll(async () => {
    app = await createTestApp();
    const users = await createTestUsers(timestamp);
    adminToken = users.adminToken;
    superAdminToken = users.superAdminToken;
    supportToken = users.supportToken;
    testAccountId = users.testAccountId;
  });

  afterAll(async () => {
    await cleanupTestUsers(timestamp, testAccountId);
    await app.close();
    try {
      await prisma.$disconnect();
    } catch (_err) {
      // best-effort
    }
  });

  // Revenue analytics tests removed — endpoint deleted (was 100% fake Math.random data)

  describe("GET /admin/billing/health", () => {
    it("should get subscription health metrics", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/health",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.health).toBeTruthy();
      expect(typeof body.data?.health?.score === "number").toBeTruthy();
      expect(body.data?.health?.status).toBeTruthy();
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/health",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /admin/billing/export", () => {
    it("should export subscriptions as JSON", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/export?format=json",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data?.data)).toBeTruthy();
    });

    it("should export subscriptions as CSV", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/export?format=csv",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]?.includes("text/csv")).toBeTruthy();
      expect(response.headers["content-disposition"]?.includes("attachment")).toBeTruthy();
    });

    it("should filter export by status", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/export?format=json&status=ACTIVE",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/export",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("POST /admin/billing/accounts/:accountId/trial/start", () => {
    it("should start trial for account", async () => {
      const trialAccount = await prisma.account.create({
        data: {
          email: `trial-${timestamp}@example.com`,
          name: "Trial Account",
          subscription: "BASIC",
          isOnTrial: false,
        },
      });

      const response = await app.inject({
        method: "POST",
        url: `/admin/billing/accounts/${trialAccount.id}/trial/start`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          trialDays: 14,
        },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);

      await prisma.project.deleteMany({ where: { accountId: trialAccount.id } });
      await prisma.account.delete({ where: { id: trialAccount.id } });
    });

    it("should reject invalid trial duration", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/billing/accounts/${testAccountId}/trial/start`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          trialDays: 100,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/billing/accounts/${testAccountId}/trial/start`,
        payload: {
          trialDays: 7,
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /admin/billing/trials/expiring", () => {
    it("should get expiring trials", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/trials/expiring?days=7",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data?.trials)).toBeTruthy();
    });

    it("should reject invalid days parameter", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/trials/expiring?days=100",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/trials/expiring",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /admin/billing/trials/stats", () => {
    it("should get trial statistics", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/trials/stats",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.stats).toBeTruthy();
      expect(typeof body.data?.stats?.totalTrials === "number").toBeTruthy();
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/trials/stats",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("POST /admin/billing/auto-renewals/process", () => {
    it("should process auto-renewals with super admin", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/billing/auto-renewals/process",
        headers: { authorization: `Bearer ${superAdminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(typeof body.data?.processed === "number").toBeTruthy();
      expect(typeof body.data?.failed === "number").toBeTruthy();
    });

    it("should reject without billing:manage permission", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/billing/auto-renewals/process",
        headers: { authorization: `Bearer ${supportToken}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/billing/auto-renewals/process",
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
