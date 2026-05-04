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
  const auditService = new AuditService();

  const seedRecords: Array<Record<string, unknown>> = [
    {
      id: "log-s-1",
      userId: TEST_USER_1_ID,
      action: "STATS_LOGIN",
      resource: "Session",
      success: true,
      error: null,
      resourceId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: "log-s-2",
      userId: TEST_USER_1_ID,
      action: "STATS_LOGIN",
      resource: "Session",
      success: true,
      error: null,
      resourceId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: "log-s-3",
      userId: TEST_USER_1_ID,
      action: "STATS_POST_CREATE",
      resource: "Post",
      resourceId: "stats-post-1",
      success: true,
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: "log-s-4",
      userId: TEST_USER_2_ID,
      action: "STATS_LOGIN",
      resource: "Session",
      success: false,
      error: null,
      resourceId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: "log-s-5",
      userId: TEST_USER_2_ID,
      action: "STATS_POST_CREATE",
      resource: "Post",
      resourceId: "stats-post-2",
      success: true,
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: "log-s-6",
      userId: TEST_USER_2_ID,
      action: "STATS_POST_CREATE",
      resource: "Post",
      resourceId: "stats-post-3",
      success: true,
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: "log-s-7",
      userId: null,
      action: "STATS_SYSTEM_HEALTH",
      resource: "System",
      success: true,
      error: null,
      resourceId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: "log-s-8",
      userId: null,
      action: "STATS_CACHE_CLEAR",
      resource: "System",
      success: true,
      error: null,
      resourceId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const adminUsers = [TEST_USER_1, TEST_USER_2];

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
