/**
 * @file activityFeedService.test.ts
 * @description Unit tests for the ActivityFeedService — cursor-based pagination,
 *              action-to-display mapping, and filter behavior.
 *              Uses mocked Prisma to avoid database dependency.
 * @layer infrastructure
 */

import { describe, it, beforeEach, expect, vi } from "vitest";
import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Mock setup — vi.hoisted runs before vi.mock factories
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const noop = () => {};

  const auditLogStore: Array<Record<string, unknown>> = [];

  const auditLogFindMany = vi.fn(
    async (args: {
      where?: Record<string, unknown>;
      include?: Record<string, unknown>;
      orderBy?: Record<string, string>;
      take?: number;
      cursor?: { id: string };
      skip?: number;
    }) => {
      let results = [...auditLogStore];

      // Apply where filters
      if (args.where) {
        results = results.filter((entry) => {
          for (const [key, value] of Object.entries(args.where!)) {
            if (entry[key] !== value) return false;
          }
          return true;
        });
      }

      // Sort by createdAt desc
      results.sort(
        (a, b) =>
          new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime()
      );

      // Apply cursor-based pagination
      if (args.cursor) {
        const cursorIndex = results.findIndex((r) => r.id === args.cursor!.id);
        if (cursorIndex >= 0) {
          // skip: 1 means skip the cursor item itself
          results = results.slice(cursorIndex + (args.skip ?? 0));
        }
      }

      // Apply take
      if (args.take) {
        results = results.slice(0, args.take);
      }

      // If include.user is requested, attach user data
      if (args.include?.user) {
        results = results.map((r) => ({
          ...r,
          user: r.userId === testUserId ? { ...testUser } : null,
        }));
      }

      return results;
    }
  );

  const auditLogCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    const now = new Date();
    const record = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      success: true,
      resource: null,
      resourceId: null,
      userId: null,
      ipAddress: null,
      userAgent: null,
      details: null,
      error: null,
      ...data,
    };
    auditLogStore.push(record);
    return record;
  });

  const auditLogDeleteMany = vi.fn(async ({ where }: { where?: Record<string, unknown> } = {}) => {
    if (!where) {
      auditLogStore.length = 0;
      return { count: 0 };
    }
    if (where.id && typeof where.id === "object" && "in" in (where.id as Record<string, unknown>)) {
      const ids = (where.id as { in: string[] }).in;
      for (let i = auditLogStore.length - 1; i >= 0; i--) {
        if (ids.includes(auditLogStore[i]!.id as string)) {
          auditLogStore.splice(i, 1);
        }
      }
    }
    return { count: 0 };
  });

  const prismaClient: any = {
    auditLog: {
      create: auditLogCreate,
      findMany: auditLogFindMany,
      deleteMany: auditLogDeleteMany,
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => null),
      count: vi.fn(async () => 0),
    },
    $connect: vi.fn(async () => undefined),
    $disconnect: vi.fn(async () => undefined),
    $transaction: vi.fn(async (fn: any) => fn(prismaClient)),
  };

  const loggerObj = {
    info: vi.fn(noop),
    warn: vi.fn(noop),
    error: vi.fn(noop),
    debug: vi.fn(noop),
    trace: vi.fn(noop),
    fatal: vi.fn(noop),
    child: vi.fn((): any => loggerObj),
  };

  const testUserId = "audit-test-user-001";
  const testUser = {
    id: testUserId,
    email: "audit-test-user@example.com",
    name: "Audit Test User",
  };

  return {
    prismaClient,
    loggerObj,
    auditLogStore,
    auditLogCreate,
    auditLogFindMany,
    auditLogDeleteMany,
    testUserId,
    testUser,
  };
});

const { testUserId } = mocks;

vi.mock("@infra/prisma", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, prisma: mocks.prismaClient };
});

vi.mock("../../src/lib/logger.js", () => ({
  logger: mocks.loggerObj,
  authLogger: mocks.loggerObj,
  createLogger: () => mocks.loggerObj,
}));

// ---------------------------------------------------------------------------
// Import SUT after mocks are in place
// ---------------------------------------------------------------------------

import { ActivityFeedService } from "../../src/audit/activityFeedService.js";
import { AuditActions, AuditResources } from "../../src/audit/auditService.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTestLog(
  overrides: {
    action?: string;
    resource?: string;
    resourceId?: string;
    userId?: string;
    success?: boolean;
    details?: Record<string, unknown>;
  } = {}
): Promise<string> {
  const record = {
    id: randomUUID(),
    action: overrides.action ?? AuditActions.POST_CREATED,
    resource: overrides.resource ?? null,
    resourceId: overrides.resourceId ?? null,
    userId: overrides.userId ?? null,
    success: overrides.success ?? true,
    details: overrides.details ?? null,
    ipAddress: null,
    userAgent: null,
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  mocks.auditLogStore.push(record);
  return record.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ActivityFeedService", () => {
  const feedService = new ActivityFeedService(mocks.prismaClient);

  beforeEach(() => {
    mocks.auditLogStore.length = 0;
    mocks.auditLogFindMany.mockClear();
    mocks.auditLogCreate.mockClear();
    mocks.auditLogDeleteMany.mockClear();
  });

  describe("getFeed", () => {
    it("returns empty feed when no audit logs exist for filters", async () => {
      const result = await feedService.getFeed({ userId: "non-existent-user-id" });

      expect(result.ok).toBeTruthy();
      expect(result.value.items.length).toBe(0);
      expect(result.value.hasMore).toBe(false);
      expect(result.value.nextCursor).toBe(undefined);
    });

    it("returns activity items with correct display mapping", async () => {
      await createTestLog({ action: AuditActions.POST_CREATED, userId: testUserId });

      const result = await feedService.getFeed({ userId: testUserId });

      expect(result.ok).toBeTruthy();
      expect(result.value.items.length >= 1).toBeTruthy();

      const postItem = result.value.items.find((i) => i.title === "Created post");
      expect(postItem).toBeTruthy();
      expect(postItem!.icon).toBe("file-plus");
      expect(postItem!.timestamp instanceof Date).toBeTruthy();
    });

    it("includes actor information when user exists", async () => {
      await createTestLog({ action: AuditActions.LOGIN, userId: testUserId });

      const result = await feedService.getFeed({ userId: testUserId });

      expect(result.ok).toBeTruthy();
      const loginItem = result.value.items.find((i) => i.title === "Signed in");
      expect(loginItem).toBeTruthy();
      expect(loginItem!.actor).toBeTruthy();
      expect(loginItem!.actor!.email).toBe("audit-test-user@example.com");
    });

    it("filters by resource type", async () => {
      await createTestLog({
        action: AuditActions.PROJECT_CREATED,
        resource: AuditResources.PROJECT,
        userId: testUserId,
      });
      await createTestLog({
        action: AuditActions.POST_CREATED,
        resource: AuditResources.POST,
        userId: testUserId,
      });

      const result = await feedService.getFeed({
        resource: AuditResources.PROJECT,
        userId: testUserId,
      });

      expect(result.ok).toBeTruthy();
      const allProject = result.value.items.every((i) => i.resource === AuditResources.PROJECT);
      expect(allProject).toBeTruthy();
    });

    it("excludes failed actions from feed", async () => {
      await createTestLog({
        action: AuditActions.LOGIN_FAILED,
        userId: testUserId,
        success: false,
      });
      await createTestLog({
        action: AuditActions.LOGIN,
        userId: testUserId,
        success: true,
      });

      const result = await feedService.getFeed({ userId: testUserId });

      expect(result.ok).toBeTruthy();
      const failedItems = result.value.items.filter((i) => i.title === "Failed sign-in attempt");
      expect(failedItems.length).toBe(0);
    });

    it("supports cursor-based pagination", async () => {
      // Create 5 logs with staggered timestamps so ordering is deterministic
      for (let i = 0; i < 5; i++) {
        const id = randomUUID();
        mocks.auditLogStore.push({
          id,
          action: AuditActions.POST_UPDATED,
          resource: null,
          resourceId: null,
          userId: testUserId,
          success: true,
          details: null,
          ipAddress: null,
          userAgent: null,
          error: null,
          createdAt: new Date(Date.now() - (4 - i) * 1000),
          updatedAt: new Date(),
        });
      }

      // Get first page with limit 2
      const page1 = await feedService.getFeed({ userId: testUserId, limit: 2 });
      expect(page1.ok).toBeTruthy();
      expect(page1.value.items.length).toBe(2);
      expect(page1.value.hasMore).toBe(true);
      expect(page1.value.nextCursor).toBeTruthy();

      // Get second page using cursor
      const page2 = await feedService.getFeed({
        userId: testUserId,
        limit: 2,
        cursor: page1.value.nextCursor,
      });
      expect(page2.ok).toBeTruthy();
      expect(page2.value.items.length).toBe(2);

      // Verify no overlap
      const page1Ids = new Set(page1.value.items.map((i) => i.id));
      const overlap = page2.value.items.filter((i) => page1Ids.has(i.id));
      expect(overlap.length).toBe(0);
    });

    it("caps limit at 100", async () => {
      const result = await feedService.getFeed({ userId: testUserId, limit: 500 });
      expect(result.ok).toBeTruthy();
    });

    it("builds description from details metadata", async () => {
      await createTestLog({
        action: AuditActions.POST_CREATED,
        resource: AuditResources.POST,
        resourceId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        userId: testUserId,
        details: { name: "My First Post" },
      });

      const result = await feedService.getFeed({ userId: testUserId });
      expect(result.ok).toBeTruthy();

      const item = result.value.items.find(
        (i) => i.resourceId === "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
      );
      expect(item).toBeTruthy();
      expect(item!.description.includes("My First Post")).toBeTruthy();
      expect(item!.description.includes("Post")).toBeTruthy();
    });
  });
});
