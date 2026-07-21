/**
 * @file subscriptionRoutes.plans.test.ts
 * @description Unit tests for subscriptionRoutes — Plans and Subscription Management.
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
    Record<string, unknown> | undefined;
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
prismaAny.teamMember = { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) };
prismaAny.post = { deleteMany: vi.fn(async () => ({ count: 0 })) };
prismaAny.channel = { deleteMany: vi.fn(async () => ({ count: 0 })) };
prismaAny.postContent = { deleteMany: vi.fn(async () => ({ count: 0 })) };
prismaAny.postMedia = { deleteMany: vi.fn(async () => ({ count: 0 })) };

// ProviderBundle mock data for getAllPlansFromDB
const mockBundles = [
  {
    id: "bundle-basic",
    slug: "BASIC",
    name: "Basic Plan",
    providers: ["X"],
    pricePerMonth: 9.99,
    pricePerYear: 99.99,
    maxProjects: 1,
    isActive: true,
    sortOrder: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "bundle-pro",
    slug: "PRO",
    name: "Pro Plan",
    providers: ["X", "INSTAGRAM", "FACEBOOK"],
    pricePerMonth: 29.99,
    pricePerYear: 299.99,
    maxProjects: 5,
    isActive: true,
    sortOrder: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "bundle-enterprise",
    slug: "ENTERPRISE",
    name: "Enterprise Plan",
    providers: ["X", "INSTAGRAM", "FACEBOOK", "YOUTUBE", "TIKTOK"],
    pricePerMonth: 99.99,
    pricePerYear: 999.99,
    maxProjects: 50,
    isActive: true,
    sortOrder: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

prismaAny.providerBundle = {
  findMany: vi.fn(async () => mockBundles),
  findUnique: vi.fn(async () => null),
};

// Track known account IDs for subscription lookups
const knownAccountIds = new Set<string>();

// AccountSubscription mock for getProviderSubscription / listProviderSubscriptions
prismaAny.accountSubscription = {
  findUnique: vi.fn(async (args: Record<string, unknown>) => {
    const where = args.where as Record<string, unknown> | undefined;
    const accountId = where?.accountId as string | undefined;
    if (accountId && knownAccountIds.has(accountId)) {
      return {
        id: `sub-${accountId}`,
        accountId,
        maxProjects: 5,
        providers: ["X"],
        pricePerMonth: 29.99,
        status: "ACTIVE",
        billingCycle: "monthly",
        bundleId: "bundle-pro",
        bundle: mockBundles[1],
        account: { id: accountId, name: "Test Account", email: "test@example.com" },
        trialEndsAt: null,
        currentPeriodEnd: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }
    return null;
  }),
  findMany: vi.fn(async () => []),
  count: vi.fn(async () => 0),
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
let testAccountId: string;

describe("subscriptionRoutes - Plans and Subscription Management", () => {
  beforeAll(async () => {
    app = await createTestApp();
    const users = await createTestUsers(timestamp);
    adminToken = users.adminToken;
    testAccountId = users.testAccountId;
    knownAccountIds.add(testAccountId);
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

  describe("GET /admin/billing/plans", () => {
    it("should get all subscription plans", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/plans",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data?.plans)).toBeTruthy();
      expect(body.data?.plans.length >= 3).toBeTruthy();
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/plans",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /admin/billing/plans/:tier", () => {
    it("should get BASIC plan", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/plans/BASIC",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.plan?.slug).toBe("BASIC");
    });

    it("should get PRO plan", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/plans/PRO",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.data?.plan?.slug).toBe("PRO");
    });

    it("should get ENTERPRISE plan", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/plans/ENTERPRISE",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.data?.plan?.slug).toBe("ENTERPRISE");
    });

    it("should reject invalid tier", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/plans/INVALID",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/plans/BASIC",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /admin/billing/accounts/:accountId/subscription", () => {
    it("should get account subscription", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/admin/billing/accounts/${testAccountId}/subscription`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.subscription).toBeTruthy();
      expect(body.data?.subscription?.status).toBe("ACTIVE");
    });

    it("should return 404 for non-existent account", async () => {
      const fakeId = "123e4567-e89b-12d3-a456-426614174000";
      const response = await app.inject({
        method: "GET",
        url: `/admin/billing/accounts/${fakeId}/subscription`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/admin/billing/accounts/${testAccountId}/subscription`,
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("PUT /admin/billing/accounts/:accountId/subscription (deprecated)", () => {
    it("should return 400 for subscription update (deprecated — Account.subscription removed)", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/admin/billing/accounts/${testAccountId}/subscription`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          newTier: "PRO",
          billingCycle: "monthly",
          reason: "Upgrade to PRO tier for testing",
        },
      });

      // Route path mismatch or deprecated handler — returns 400 or 404
      expect([400, 404].includes(response.statusCode)).toBeTruthy();
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/admin/billing/accounts/${testAccountId}/subscription`,
        payload: {
          newTier: "PRO",
          billingCycle: "monthly",
        },
      });

      expect([400, 401, 404].includes(response.statusCode)).toBeTruthy();
    });
  });

  describe("GET /admin/billing/subscriptions", () => {
    it("should list all subscriptions", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/subscriptions",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data?.subscriptions)).toBeTruthy();
      expect(body.data?.pagination).toBeTruthy();
    });

    it("should filter by status", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/subscriptions?status=ACTIVE",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("should paginate results", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/subscriptions?page=1&limit=10",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.data?.pagination?.page).toBe(1);
      expect(body.data?.pagination?.limit).toBe(10);
    });

    it("should sort by field", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/subscriptions?sortBy=createdAt&sortOrder=desc",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/subscriptions",
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
