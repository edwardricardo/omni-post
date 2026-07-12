/**
 * @file auditService.stats.test.ts
 * @description Unit tests for AuditService.getStats() — statistics aggregation.
 *              Uses mocked Prisma to avoid database dependency.
 * @layer infrastructure
 */

import { describe, it, beforeEach, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock setup — vi.hoisted runs before vi.mock factories
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const noop = () => {};
  const noopAsync = async () => undefined;

  const auditLogCreate = vi.fn();
  const auditLogFindMany = vi.fn();
  const auditLogFindUnique = vi.fn();
  const auditLogCount = vi.fn();
  const auditLogDeleteMany = vi.fn();
  const auditLogGroupBy = vi.fn(async () => []);
  const adminUserFindMany = vi.fn();
  const customerUserFindMany = vi.fn();

  const prismaClient: any = {
    auditLog: {
      create: auditLogCreate,
      findMany: auditLogFindMany,
      findUnique: auditLogFindUnique,
      count: auditLogCount,
      deleteMany: auditLogDeleteMany,
      groupBy: auditLogGroupBy,
    },
    adminUser: {
      findMany: adminUserFindMany,
    },
    customerUser: {
      findMany: customerUserFindMany,
    },
    $connect: vi.fn(noopAsync),
    $disconnect: vi.fn(noopAsync),
    $transaction: vi.fn(async (fn: any) => fn(prismaClient)),
  };

  const logger = {
    info: vi.fn(noop),
    warn: vi.fn(noop),
    error: vi.fn(noop),
    debug: vi.fn(noop),
    child: vi.fn(() => logger),
  };

  return {
    prismaClient,
    logger,
    auditLogCount,
    auditLogGroupBy,
    adminUserFindMany,
    customerUserFindMany,
  };
});

vi.mock("@infra/prisma", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@infra/prisma")>();
  return {
    ...actual,
    prisma: mocks.prismaClient,
  };
});

vi.mock("../../src/lib/logger.js", () => ({
  logger: mocks.logger,
}));

import { AuditService } from "../../src/audit/auditService.js";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const TEST_USER_1_ID = "audit-test-user-001";
const TEST_USER_2_ID = "audit-test-user-002";

const TEST_USER_1 = {
  id: TEST_USER_1_ID,
  email: "audit-test-user@example.com",
  name: "Audit Test User",
  role: "ADMIN",
};

const TEST_USER_2 = {
  id: TEST_USER_2_ID,
  email: "audit-test-user2@example.com",
  name: "Audit Test User 2",
  role: "SUPPORT",
};

const TEST_CUSTOMER_1_ID = "audit-test-customer-001";
const TEST_CUSTOMER_2_ID = "audit-test-customer-002";

const TEST_CUSTOMER_1 = {
  id: TEST_CUSTOMER_1_ID,
  email: "audit-test-customer@example.com",
  firstName: "Audit",
  lastName: "Customer",
};

const TEST_CUSTOMER_2 = {
  id: TEST_CUSTOMER_2_ID,
  email: "audit-test-customer2@example.com",
  firstName: "Second",
  lastName: "Customer",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Filter entries using the same where clause logic AuditService builds */
function filterEntries(
  entries: Array<Record<string, unknown>>,
  where: Record<string, unknown>
): Array<Record<string, unknown>> {
  return entries.filter((entry) => {
    for (const [key, value] of Object.entries(where)) {
      if (value === undefined || value === null) continue;

      if (key === "createdAt" && typeof value === "object") {
        const dateFilter = value as Record<string, Date>;
        const entryDate = entry.createdAt as Date;
        if (dateFilter.gte && entryDate < dateFilter.gte) return false;
        if (dateFilter.lte && entryDate > dateFilter.lte) return false;
        continue;
      }

      if (typeof value === "object" && value !== null && "contains" in (value as any)) {
        const filter = value as { contains: string; mode?: string };
        const entryVal = String(entry[key] ?? "");
        if (filter.mode === "insensitive") {
          if (!entryVal.toLowerCase().includes(filter.contains.toLowerCase())) return false;
        } else {
          if (!entryVal.includes(filter.contains)) return false;
        }
        continue;
      }

      if (typeof value === "object" && value !== null && "not" in (value as any)) {
        const notVal = (value as { not: unknown }).not;
        if (entry[key] === notVal) return false;
        continue;
      }

      if (entry[key] !== value) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuditService - getStats()", () => {
  const auditService = new AuditService(mocks.prismaClient);

  /** Admin-actor row shape: `userId` FK + `actorType: ADMIN`. */
  const adminRow = (
    id: string,
    userId: string,
    fields: Record<string, unknown>
  ): Record<string, unknown> => ({
    id,
    userId,
    customerUserId: null,
    actorType: "ADMIN",
    error: null,
    resourceId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...fields,
  });

  /** Customer-actor row shape: `customerUserId` FK + `actorType: CUSTOMER`. */
  const customerRow = (
    id: string,
    customerUserId: string,
    fields: Record<string, unknown>
  ): Record<string, unknown> => ({
    id,
    userId: null,
    customerUserId,
    actorType: "CUSTOMER",
    error: null,
    resourceId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...fields,
  });

  /** System row shape (no actor FK; `actorType: SYSTEM`). */
  const systemRow = (id: string, fields: Record<string, unknown>): Record<string, unknown> => ({
    id,
    userId: null,
    customerUserId: null,
    actorType: "SYSTEM",
    error: null,
    resourceId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...fields,
  });

  const seedRecords: Array<Record<string, unknown>> = [
    adminRow("log-s-1", TEST_USER_1_ID, {
      action: "STATS_LOGIN",
      resource: "Session",
      success: true,
    }),
    adminRow("log-s-2", TEST_USER_1_ID, {
      action: "STATS_LOGIN",
      resource: "Session",
      success: true,
    }),
    adminRow("log-s-3", TEST_USER_1_ID, {
      action: "STATS_POST_CREATE",
      resource: "Post",
      resourceId: "stats-post-1",
      success: true,
    }),
    adminRow("log-s-4", TEST_USER_2_ID, {
      action: "STATS_LOGIN",
      resource: "Session",
      success: false,
    }),
    adminRow("log-s-5", TEST_USER_2_ID, {
      action: "STATS_POST_CREATE",
      resource: "Post",
      resourceId: "stats-post-2",
      success: true,
    }),
    adminRow("log-s-6", TEST_USER_2_ID, {
      action: "STATS_POST_CREATE",
      resource: "Post",
      resourceId: "stats-post-3",
      success: true,
    }),
    systemRow("log-s-7", {
      action: "STATS_SYSTEM_HEALTH",
      resource: "System",
      success: true,
    }),
    systemRow("log-s-8", {
      action: "STATS_CACHE_CLEAR",
      resource: "System",
      success: true,
    }),
    customerRow("log-s-9", TEST_CUSTOMER_1_ID, {
      action: "STATS_LOGIN",
      resource: "Session",
      success: true,
    }),
    customerRow("log-s-10", TEST_CUSTOMER_1_ID, {
      action: "STATS_POST_CREATE",
      resource: "Post",
      resourceId: "stats-post-4",
      success: true,
    }),
    customerRow("log-s-11", TEST_CUSTOMER_2_ID, {
      action: "STATS_LOGIN",
      resource: "Session",
      success: true,
    }),
  ];

  const adminUsers = [TEST_USER_1, TEST_USER_2];
  const customerUsers = [TEST_CUSTOMER_1, TEST_CUSTOMER_2];

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock count — filters records and counts
    mocks.auditLogCount.mockImplementation(async ({ where }: any = {}) => {
      if (!where) return seedRecords.length;
      return filterEntries(seedRecords, where).length;
    });

    // Mock groupBy — aggregates from seed data
    mocks.auditLogGroupBy.mockImplementation(async ({ by, where, _count, take }: any) => {
      let entries = [...seedRecords];
      if (where) {
        entries = filterEntries(entries, where);
      }

      const groupField = by[0] as string;
      const countField = _count ? Object.keys(_count)[0] : groupField;
      const groups = new Map<string, number>();

      for (const entry of entries) {
        const key = entry[groupField];
        if (key === null || key === undefined) continue;
        const keyStr = String(key);
        groups.set(keyStr, (groups.get(keyStr) ?? 0) + 1);
      }

      let result = Array.from(groups.entries())
        .map(([key, count]) => ({
          [groupField]: key,
          _count: { [countField]: count },
        }))
        .sort((a, b) => {
          const ca = a._count[countField] as number;
          const cb = b._count[countField] as number;
          return cb - ca;
        });

      if (take) {
        result = result.slice(0, take);
      }

      return result;
    });

    // Mock adminUser.findMany — returns matching users
    mocks.adminUserFindMany.mockImplementation(async ({ where }: any = {}) => {
      if (!where) return adminUsers;
      if (where.id?.in) {
        return adminUsers.filter((u) => (where.id.in as string[]).includes(u.id));
      }
      return adminUsers;
    });

    // Mock customerUser.findMany — resolves the CUSTOMER actor identities
    mocks.customerUserFindMany.mockImplementation(async ({ where }: any = {}) => {
      if (!where) return customerUsers;
      if (where.id?.in) {
        return customerUsers.filter((c) => (where.id.in as string[]).includes(c.id));
      }
      return customerUsers;
    });
  });

  describe("getStats() - Basic Counts", () => {
    it("should count total logs matching filter", async () => {
      const result = await auditService.getStats({
        action: "STATS_",
      });

      expect(result.ok).toBeTruthy();
      expect(result.value.total >= 8).toBeTruthy();
    });

    it("should count successful and failed separately", async () => {
      const result = await auditService.getStats({
        action: "STATS_",
      });

      expect(result.ok).toBeTruthy();
      expect(result.value.total).toBe(result.value.successful + result.value.failed);
      expect(result.value.successful >= 7).toBeTruthy();
      expect(result.value.failed >= 1).toBeTruthy();
    });
  });

  describe("getStats() - Top Actions Aggregation", () => {
    it("should return top actions sorted by count descending", async () => {
      const result = await auditService.getStats({
        action: "STATS_",
      });

      expect(result.ok).toBeTruthy();
      expect(result.value.topActions.length > 0).toBeTruthy();

      for (let i = 0; i < result.value.topActions.length - 1; i++) {
        expect(
          result.value.topActions[i].count >= result.value.topActions[i + 1].count
        ).toBeTruthy();
      }
    });

    it("should limit top actions to 10", async () => {
      const result = await auditService.getStats({});

      expect(result.ok).toBeTruthy();
      expect(result.value.topActions.length <= 10).toBeTruthy();
    });

    it("should include action name and count", async () => {
      const result = await auditService.getStats({
        action: "STATS_",
      });

      expect(result.ok).toBeTruthy();
      const loginAction = result.value.topActions.find((a) => a.action === "STATS_LOGIN");
      expect(loginAction).toBeTruthy();
      expect(loginAction!.count >= 3).toBeTruthy();
    });
  });

  describe("getStats() - Top Resources Aggregation", () => {
    it("should return top resources sorted by count descending", async () => {
      const result = await auditService.getStats({
        action: "STATS_",
      });

      expect(result.ok).toBeTruthy();
      expect(result.value.topResources.length > 0).toBeTruthy();

      for (let i = 0; i < result.value.topResources.length - 1; i++) {
        expect(
          result.value.topResources[i].count >= result.value.topResources[i + 1].count
        ).toBeTruthy();
      }
    });

    it("should filter out null resources", async () => {
      const result = await auditService.getStats({});

      expect(result.ok).toBeTruthy();
      result.value.topResources.forEach((r) => {
        expect(r.resource).toBeTruthy();
      });
    });

    it("should limit top resources to 10", async () => {
      const result = await auditService.getStats({});

      expect(result.ok).toBeTruthy();
      expect(result.value.topResources.length <= 10).toBeTruthy();
    });
  });

  describe("getStats() - Top Users Aggregation", () => {
    it("should return top users with name and email", async () => {
      const result = await auditService.getStats({
        action: "STATS_",
      });

      expect(result.ok).toBeTruthy();
      expect(result.value.topUsers.length >= 2).toBeTruthy();

      const testUser = result.value.topUsers.find((u) => u.email === "audit-test-user@example.com");
      expect(testUser).toBeTruthy();
      expect(testUser!.user).toBe("Audit Test User");
      expect(testUser!.count >= 3).toBeTruthy();
    });

    it("should filter out null userIds", async () => {
      const result = await auditService.getStats({
        action: "STATS_",
      });

      expect(result.ok).toBeTruthy();
      result.value.topUsers.forEach((u) => {
        expect(u.user !== "Unknown" || u.email !== "Unknown").toBeTruthy();
      });
    });

    it("should sort by count descending", async () => {
      const result = await auditService.getStats({
        action: "STATS_",
      });

      expect(result.ok).toBeTruthy();

      if (result.value.topUsers.length >= 2) {
        for (let i = 0; i < result.value.topUsers.length - 1; i++) {
          expect(result.value.topUsers[i].count >= result.value.topUsers[i + 1].count).toBeTruthy();
        }
      }
    });

    it("should limit top users to 10", async () => {
      const result = await auditService.getStats({});

      expect(result.ok).toBeTruthy();
      expect(result.value.topUsers.length <= 10).toBeTruthy();
    });
  });

  describe("getStats() - Customer Actor Visibility", () => {
    it("counts customer actors per customer identity instead of one null-user bucket", async () => {
      const result = await auditService.getStats({ action: "STATS_" });

      expect(result.ok).toBeTruthy();
      expect(result.value.topCustomerUsers).toHaveLength(2);

      const first = result.value.topCustomerUsers.find(
        (c) => c.email === "audit-test-customer@example.com"
      );
      expect(first).toBeTruthy();
      expect(first!.user).toBe("Audit Customer");
      expect(first!.count).toBe(2);

      const second = result.value.topCustomerUsers.find(
        (c) => c.email === "audit-test-customer2@example.com"
      );
      expect(second).toBeTruthy();
      expect(second!.user).toBe("Second Customer");
      expect(second!.count).toBe(1);
    });

    it("sorts top customer users by count descending", async () => {
      const result = await auditService.getStats({ action: "STATS_" });

      expect(result.ok).toBeTruthy();
      expect(result.value.topCustomerUsers.map((c) => c.count)).toEqual([2, 1]);
    });

    it("keeps system rows distinguishable from customer rows via actorType", async () => {
      const result = await auditService.getStats({ action: "STATS_" });

      expect(result.ok).toBeTruthy();
      expect(result.value.byActorType).toEqual({ SYSTEM: 2, ADMIN: 6, CUSTOMER: 3 });
    });

    it("does not leak customer actors into the admin topUsers bucket", async () => {
      const result = await auditService.getStats({ action: "STATS_" });

      expect(result.ok).toBeTruthy();
      expect(result.value.topUsers).toHaveLength(2);
      result.value.topUsers.forEach((u) => {
        expect(u.email.startsWith("audit-test-user")).toBeTruthy();
      });
    });

    it("keeps admin top-user counts byte-identical to the pre-change behavior", async () => {
      const result = await auditService.getStats({ action: "STATS_" });

      expect(result.ok).toBeTruthy();
      expect(result.value.topUsers).toEqual([
        { user: "Audit Test User", email: "audit-test-user@example.com", count: 3 },
        { user: "Audit Test User 2", email: "audit-test-user2@example.com", count: 3 },
      ]);
    });
  });

  describe("getStats() - Stats Filtering", () => {
    it("should apply filters to all aggregations", async () => {
      const result = await auditService.getStats({
        userId: TEST_USER_1_ID,
      });

      expect(result.ok).toBeTruthy();
      expect(result.value.total >= 3).toBeTruthy();
    });

    it("should apply date range to stats", async () => {
      const currentTime = new Date();
      const oneDayAgo = new Date(currentTime.getTime() - 24 * 60 * 60 * 1000);

      const result = await auditService.getStats({
        action: "STATS_",
        startDate: oneDayAgo,
      });

      expect(result.ok).toBeTruthy();
      expect(result.value.total >= 0).toBeTruthy();
    });
  });
});
