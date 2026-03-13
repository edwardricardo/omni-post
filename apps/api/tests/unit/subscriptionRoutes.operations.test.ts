/**
 * @file subscriptionRoutes.operations.test.ts
 * @description Unit tests for subscriptionRoutes — Account Operations and Billing Analytics.
 *              Uses in-memory mocked Prisma stores — no real database needed.
 * @layer test
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

vi.mock("@infra/prisma", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, prisma: mockPrisma.prisma };
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

const { createTestApp, createTestUsers, cleanupTestUsers, prisma } = await import(
  "./subscriptionRoutes.test-helpers.js"
);

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

const timestamp = Date.now();
let app: FastifyInstance;
let adminToken: string;
let superAdminToken: string;
let testAccountId: string;

describe("subscriptionRoutes - Account Operations and Billing Analytics", () => {
  beforeAll(async () => {
    app = await createTestApp();
    const users = await createTestUsers(timestamp);
    adminToken = users.adminToken;
    superAdminToken = users.superAdminToken;
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

  describe("GET /admin/billing/stats", () => {
    it("should get subscription statistics", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/stats",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.stats).toBeTruthy();
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/stats",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("POST /admin/billing/accounts/:accountId/validate-limits", () => {
    it("should validate CREATE_PROJECT limit", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/billing/accounts/${testAccountId}/validate-limits`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          operation: "CREATE_PROJECT",
          amount: 1,
        },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.validation).toBeTruthy();
    });

    it("should validate ADD_TEAM_MEMBER limit", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/billing/accounts/${testAccountId}/validate-limits`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          operation: "ADD_TEAM_MEMBER",
          amount: 2,
        },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("should reject invalid operation", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/billing/accounts/${testAccountId}/validate-limits`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          operation: "INVALID_OP",
          amount: 1,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/billing/accounts/${testAccountId}/validate-limits`,
        payload: {
          operation: "CREATE_PROJECT",
          amount: 1,
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("POST /admin/billing/accounts/:accountId/suspend", () => {
    it("should suspend account subscription", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/billing/accounts/${testAccountId}/suspend`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          reason: "Payment failure - account suspended pending resolution",
        },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("should reject empty reason", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/billing/accounts/${testAccountId}/suspend`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          reason: "",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/billing/accounts/${testAccountId}/suspend`,
        payload: {
          reason: "Valid reason for suspension",
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("POST /admin/billing/bulk/upgrade", () => {
    it("should bulk upgrade accounts with super admin", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/billing/bulk/upgrade",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          accountIds: [testAccountId],
          newTier: "ENTERPRISE",
          billingCycle: "yearly",
          reason: "Bulk upgrade for testing",
        },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(typeof body.data?.successful === "number").toBeTruthy();
      expect(typeof body.data?.failed === "number").toBeTruthy();
    });

    it("should reject without super admin role", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/billing/bulk/upgrade",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          accountIds: [testAccountId],
          newTier: "PRO",
          billingCycle: "monthly",
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it("should reject too many accounts", async () => {
      const manyIds = Array(51)
        .fill(testAccountId)
        .map((id, i) => `${id}-${i}`);

      const response = await app.inject({
        method: "POST",
        url: "/admin/billing/bulk/upgrade",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          accountIds: manyIds,
          newTier: "PRO",
          billingCycle: "monthly",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/billing/bulk/upgrade",
        payload: {
          accountIds: [testAccountId],
          newTier: "PRO",
          billingCycle: "monthly",
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // Revenue analytics tests removed — endpoint deleted (was 100% fake Math.random data)
});
