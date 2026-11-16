/**
 * @file auditService.stats.test.ts
 * @description Unit tests for AuditService.getStats() — statistics aggregation.
 *              Uses mocked Prisma to avoid database dependency.
 * @layer infrastructure
 */

import { describe, it, beforeEach, expect, vi } from "vitest";
import assert from "node:assert/strict";

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
  const auditLogGroupBy = vi.fn(async (_args: GroupByArgs): Promise<Group[]> => []);
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

type SortDirection = "asc" | "desc";

/** One `orderBy` clause of `auditLog.groupBy`: a count of the group, or the grouped field. */
type GroupOrderBy = Record<string, SortDirection | Record<string, SortDirection>>;

/** The arguments of `auditLog.groupBy` the double reads. */
interface GroupByArgs {
  by: string[];
  where?: Record<string, unknown>;
  _count?: Record<string, true>;
  orderBy?: GroupOrderBy | GroupOrderBy[];
  take?: number;
}

type Group = Record<string, unknown> & { _count: Record<string, number> };

/** Compares two group keys the way Postgres does by default: nulls last ascending, first descending. */
function compareKeys(a: unknown, b: unknown, direction: SortDirection): number {
  if (a === b) return 0;
  if (a === null) return direction === "asc" ? 1 : -1;
  if (b === null) return direction === "asc" ? -1 : 1;
  const order = String(a) < String(b) ? -1 : 1;
  return direction === "asc" ? order : -order;
}

/** Compares two groups by every `orderBy` clause in turn; a clause the double does not model throws. */
function compareGroups(a: Group, b: Group, clauses: GroupOrderBy[], groupField: string): number {
  for (const clause of clauses) {
    for (const [key, spec] of Object.entries(clause)) {
      let order: number;
      if (key === "_count" && typeof spec === "object") {
        const [countOrder] = Object.entries(spec);
        if (countOrder === undefined) throw new Error("auditLogGroupBy double: empty _count order");
        const [field, direction] = countOrder;
        const countA = a._count[field];
        const countB = b._count[field];
        if (countA === undefined || countB === undefined) {
          throw new Error(`auditLogGroupBy double: no _count of ${field} to order by`);
        }
        order = direction === "asc" ? countA - countB : countB - countA;
      } else if (key === groupField && typeof spec === "string") {
        order = compareKeys(a[groupField], b[groupField], spec);
      } else {
        throw new Error(`auditLogGroupBy double: orderBy ${key} is not modelled`);
      }
      if (order !== 0) return order;
    }
  }
  return 0;
}

/**
 * Groups entries the way Prisma's `groupBy` does: the `where` is applied, a null key is a group of
 * its own, `_count.<field>` counts the group's non-null values of that field (SQL `COUNT(field)`),
 * the groups come in the `orderBy` given, and in first-seen order without one, since Postgres
 * promises no order without `ORDER BY`. A seed first seen in ascending count therefore reads an
 * `orderBy` the service drops.
 */
function groupEntries(entries: Array<Record<string, unknown>>, args: GroupByArgs): Group[] {
  const filtered = args.where ? filterEntries(entries, args.where) : [...entries];
  const groupField = args.by[0] ?? "";
  const countField = args._count ? (Object.keys(args._count)[0] ?? groupField) : groupField;
  const groups = new Map<unknown, Array<Record<string, unknown>>>();

  for (const entry of filtered) {
    const key = entry[groupField] ?? null;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }

  const result: Group[] = Array.from(groups.entries()).map(([key, members]) => ({
    [groupField]: key,
    _count: {
      [countField]: members.filter((member) => (member[countField] ?? null) !== null).length,
    },
  }));

  if (args.orderBy) {
    const clauses = Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy];
    result.sort((a, b) => compareGroups(a, b, clauses, groupField));
  }

  return args.take === undefined ? result : result.slice(0, args.take);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuditService - getStats()", () => {
  const auditService = new AuditService(mocks.prismaClient);

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

    // Mock groupBy — aggregates from seed data with the where, null groups and orderBy it receives
    mocks.auditLogGroupBy.mockImplementation(async (args: GroupByArgs) =>
      groupEntries(seedRecords, args)
    );

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
    it("names each top resource after the resource its logs record", async () => {
      const result = await auditService.getStats({ action: "STATS_" });

      assert.ok(result.ok);
      expect(result.value.topResources).toHaveLength(3);
      expect(result.value.topResources).toEqual(
        expect.arrayContaining([
          { resource: "Session", count: 3 },
          { resource: "Post", count: 3 },
          { resource: "System", count: 2 },
        ])
      );
    });

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

  describe("getStats() - Ranking Order and Null Groups", () => {
    // Every user and resource is first seen in ascending count, and in ascending id, so a ranking
    // that loses its count order, or orders by the grouped field, reads back in the wrong order.
    const RANK_USER_A = { id: "audit-rank-user-a", email: "rank-a@example.com", name: "Rank A" };
    const RANK_USER_B = { id: "audit-rank-user-b", email: "rank-b@example.com", name: "Rank B" };
    const RANK_USER_C = { id: "audit-rank-user-c", email: "rank-c@example.com", name: "Rank C" };

    const makeLog = (
      id: string,
      userId: string | null,
      resource: string | null
    ): Record<string, unknown> => ({
      id,
      userId,
      action: "RANK_EVENT",
      resource,
      resourceId: null,
      success: true,
      error: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });

    const rankingRecords = [
      makeLog("log-r-1", RANK_USER_A.id, "Campaign"),
      makeLog("log-r-2", RANK_USER_B.id, "Channel"),
      makeLog("log-r-3", RANK_USER_B.id, "Channel"),
      makeLog("log-r-4", RANK_USER_C.id, "Post"),
      makeLog("log-r-5", RANK_USER_C.id, "Post"),
      makeLog("log-r-6", RANK_USER_C.id, "Post"),
      makeLog("log-r-7", null, null),
      makeLog("log-r-8", null, null),
    ];

    const rankingUsers = [RANK_USER_A, RANK_USER_B, RANK_USER_C];

    beforeEach(() => {
      mocks.auditLogCount.mockImplementation(
        async ({ where }: { where: Record<string, unknown> }) =>
          filterEntries(rankingRecords, where).length
      );
      mocks.auditLogGroupBy.mockImplementation(async (args: GroupByArgs) =>
        groupEntries(rankingRecords, args)
      );
      mocks.adminUserFindMany.mockImplementation(
        async ({ where }: { where: { id: { in: Array<string | null> } } }) =>
          rankingUsers.filter((user) => where.id.in.includes(user.id))
      );
    });

    it("returns the top users in descending order of their log count", async () => {
      const result = await auditService.getStats({});

      assert.ok(result.ok);
      expect(result.value.topUsers).toEqual([
        { user: "Rank C", email: "rank-c@example.com", count: 3 },
        { user: "Rank B", email: "rank-b@example.com", count: 2 },
        { user: "Rank A", email: "rank-a@example.com", count: 1 },
      ]);
    });

    it("returns the top resources in descending order of their log count", async () => {
      const result = await auditService.getStats({});

      assert.ok(result.ok);
      expect(result.value.topResources).toEqual([
        { resource: "Post", count: 3 },
        { resource: "Channel", count: 2 },
        { resource: "Campaign", count: 1 },
      ]);
    });

    it("leaves the logs with no user out of the top users", async () => {
      const result = await auditService.getStats({});

      assert.ok(result.ok);
      expect(result.value.topUsers.map((entry) => entry.email).sort()).toEqual([
        "rank-a@example.com",
        "rank-b@example.com",
        "rank-c@example.com",
      ]);
    });

    it("leaves the logs with no resource out of the top resources", async () => {
      const result = await auditService.getStats({});

      assert.ok(result.ok);
      expect(result.value.topResources.map((entry) => entry.resource).sort()).toEqual([
        "Campaign",
        "Channel",
        "Post",
      ]);
    });
  });
});
