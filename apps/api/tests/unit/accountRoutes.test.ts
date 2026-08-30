/**
 * @file accountRoutes.test.ts
 * @description Unit tests for accountRoutes.
 *              Uses in-memory mocked Prisma stores — no real database needed.
 * @layer infrastructure
 */

import type { FastifyRequest } from "fastify";
import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";

// The tenant the mocked auth middleware signs the caller in as. DELETE
// /accounts/:accountId is tenant-gated — an Account IS the tenant root, so a
// customer may only delete its own — and the previous no-op mock produced an
// identity-less request that no longer stands in for a signed-in customer.
const authContext: { accountId: string } = { accountId: "" };

vi.mock("../../src/auth/customerAuthMiddleware.js", () => ({
  requireClientAuth: async (request: FastifyRequest) => {
    request.customerUser = {
      id: "customer-user-1",
      accountId: authContext.accountId,
      roleId: "role-1",
      roleName: "OWNER",
      permissions: [],
    };
  },
}));

// Admin surface for DELETE /accounts/:accountId/hard. Only the two
// symbols accountRoutes imports are replaced; nothing else in this route's
// module graph pulls from either middleware.
vi.mock("../../src/admin/auth/adminAuthMiddleware.js", () => ({
  requireAdminAuth: async (request: FastifyRequest) => {
    (request as FastifyRequest & { adminUser?: { id: string } }).adminUser = {
      id: "admin-user-1",
    };
  },
}));

vi.mock("../../src/auth/rbacMiddleware.js", () => ({
  requirePermission: () => async () => {},
}));

import { createMockPrismaModule } from "./helpers/mockPrisma.js";

// ---------------------------------------------------------------------------
// Mock setup — must come BEFORE any SUT imports
// ---------------------------------------------------------------------------

const { mockPrisma, stores } = createMockPrismaModule();

// accountRoutes uses include: { projects: { where: { deletedAt: null } } } and
// include: { _count: ... }. Build an include resolver for the account model.
// The nested `where` is honoured rather than ignored: the routes now list only
// live projects, and a mock that returned soft-deleted rows would hide exactly
// the behaviour under test.
function resolveAccountIncludes(
  result: Record<string, unknown>,
  include: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!include) return result;
  const ownProjects = stores.project.all().filter((p) => p.accountId === result.id);
  const liveProjects = ownProjects.filter((p) => (p.deletedAt ?? null) === null);
  if (include.projects) {
    result.projects = typeof include.projects === "object" ? liveProjects : ownProjects;
  }
  if (include._count) {
    const countSelect = (
      include._count as { select?: { projects?: boolean | Record<string, unknown> } }
    ).select;
    result._count = {
      projects:
        typeof countSelect?.projects === "object" ? liveProjects.length : ownProjects.length,
    };
  }
  return result;
}

const originalFindUnique = mockPrisma.prisma.account.findUnique;
mockPrisma.prisma.account.findUnique = vi.fn(
  async (args: { where: Record<string, unknown>; include?: Record<string, unknown> }) => {
    const result = await originalFindUnique(args);
    if (!result) return null;
    return resolveAccountIncludes(result as Record<string, unknown>, args.include);
  }
);

const originalFindFirst = mockPrisma.prisma.account.findFirst;
mockPrisma.prisma.account.findFirst = vi.fn(
  async (args: { where?: Record<string, unknown>; include?: Record<string, unknown> }) => {
    const result = await originalFindFirst(args);
    if (!result) return null;
    return resolveAccountIncludes(result as Record<string, unknown>, args.include);
  }
);

const originalFindMany = mockPrisma.prisma.account.findMany;
mockPrisma.prisma.account.findMany = vi.fn(
  async (args?: {
    where?: Record<string, unknown>;
    orderBy?: Record<string, string>;
    include?: Record<string, unknown>;
  }) => {
    const results = await originalFindMany(args);
    if (args?.include) {
      for (const result of results) {
        resolveAccountIncludes(result as Record<string, unknown>, args.include);
      }
    }
    return results;
  }
);

// Models the mock module does not define but the container's repositories may
// reach for. The DELETE route no longer touches them (it soft-deletes the
// account row and leaves its children alone) — they remain so that any
// repository resolved from setupContainer finds a callable accessor.
const noopDeleteMany = vi.fn(async () => ({ count: 0 }));
const prismaAny = mockPrisma.prisma as Record<string, unknown>;
prismaAny.postContent = { deleteMany: noopDeleteMany };
prismaAny.postMedia = { deleteMany: noopDeleteMany };
prismaAny.post = { deleteMany: noopDeleteMany, findMany: vi.fn(async () => []) };
prismaAny.channel = { deleteMany: noopDeleteMany };
// The hard delete's own tombstone write (see PrismaAccountRepository.hardDelete):
// one `DeletionRecord` row for the account plus one per project it drags along,
// inserted in the same transaction as the delete, so the double has to offer it
// or the route fails with an INTERNAL_ERROR.
prismaAny.deletionRecord = { createMany: vi.fn(async () => ({ count: 1 })) };
// Models other repositories resolved from setupContainer may reach for. Named
// one by one rather than proxied: a model that is reached but this list forgets
// must surface as a failure, not be papered over by a catch-all.
for (const model of [
  "publishLog",
  "analytics",
  "contentVersion",
  "tweet",
  "thread",
  "contentTemplate",
  "instagramStoryProject",
  "videoProcessingJob",
  "instagramAnalytics",
  "schedulingRule",
  "template",
]) {
  prismaAny[model] = { deleteMany: vi.fn(async () => ({ count: 0 })) };
}

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

const Fastify = (await import("fastify")).default;
const { serializerCompiler, validatorCompiler } = await import("fastify-type-provider-zod");
const { accountRoutes } = await import("../../src/accounts/accountRoutes.js");
const { setupContainer } = await import("../../src/infrastructure/container/setup.js");

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  typedApp.setValidatorCompiler(validatorCompiler);
  typedApp.setSerializerCompiler(serializerCompiler);

  const container = setupContainer({ prisma: mockPrisma.prisma as never });
  typedApp.decorate("container", container);

  await typedApp.register(accountRoutes);

  return typedApp;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

const timestamp = Date.now();
const testEmail = `test-account-${timestamp}@example.com`;
const testName = "Test Account User";

let app: FastifyInstance;
let testAccountId: string;

describe("accountRoutes Unit Tests", () => {
  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("POST /accounts", () => {
    it("should create account successfully with defaults", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          email: testEmail,
          name: testName,
        },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.id).toBeTruthy();
      expect(body.data?.email).toBe(testEmail);
      expect(body.data?.name).toBe(testName);
      expect(body.data?.maxProjects).toBe(1);
      expect(body.data?.isOnTrial).toBe(true);

      testAccountId = body.data?.id || "";
    });

    it("should create account with custom maxProjects", async () => {
      const customEmail = `custom-${testEmail}`;
      const response = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          email: customEmail,
          name: testName,
          maxProjects: 5,
        },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.data?.maxProjects).toBe(5);
    });

    it("should reject duplicate email", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          email: testEmail,
          name: testName,
        },
      });

      expect(response.statusCode).toBe(409);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);
      expect(body.error).toBe("EMAIL_TAKEN");
    });

    it("should reject invalid email format", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          email: "invalid-email",
          name: testName,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject missing email", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          name: testName,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject missing name", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          email: `missing-name-${testEmail}`,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should ignore unknown fields in payload", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          email: `unknown-field-${testEmail}`,
          name: testName,
          unknownField: "someValue",
        },
      });

      // Zod strips unknown fields; request should succeed
      expect([200, 400].includes(response.statusCode)).toBeTruthy();
    });

    it("should reject negative maxProjects", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          email: `negative-max-${testEmail}`,
          name: testName,
          maxProjects: -1,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject zero maxProjects", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          email: `zero-max-${testEmail}`,
          name: testName,
          maxProjects: 0,
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("GET /accounts/:accountId", () => {
    it("should get account by ID successfully", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/accounts/${testAccountId}`,
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.id).toBe(testAccountId);
      expect(body.data?.email).toBe(testEmail);
      expect(body.data?.name).toBe(testName);
      expect(Array.isArray(body.data?.projects)).toBeTruthy();
    });

    it("should return 404 for non-existent account", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/accounts/a0000000-0000-4000-8000-000000000000",
      });

      expect(response.statusCode).toBe(404);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);
    });

    it("should reject invalid account ID format", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/accounts/not-a-uuid",
      });

      expect(response.statusCode).toBe(400); // Invalid UUID format
    });
  });

  describe("GET /accounts", () => {
    it("should list all accounts successfully", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/accounts",
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data)).toBeTruthy();
      expect(body.data.length > 0).toBeTruthy();

      const account = body.data.find((a: Record<string, unknown>) => a.id === testAccountId);
      expect(account).toBeTruthy();
      expect(account.email).toBe(testEmail);
      expect(typeof account.projectCount).toBe("number");
    });

    it("should return accounts ordered by createdAt desc", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/accounts",
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.data.length >= 2).toBeTruthy();

      // Verify descending order
      for (let i = 0; i < body.data.length - 1; i++) {
        const current = new Date(body.data[i].createdAt);
        const next = new Date(body.data[i + 1].createdAt);
        expect(current >= next).toBeTruthy();
      }
    });
  });

  describe("PUT /accounts/:accountId", () => {
    it("should update account name successfully", async () => {
      const newName = "Updated Account Name";
      const response = await app.inject({
        method: "PUT",
        url: `/accounts/${testAccountId}`,
        payload: {
          name: newName,
        },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.name).toBe(newName);
      expect(body.data?.id).toBe(testAccountId);
    });

    it("should update maxProjects explicitly", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/accounts/${testAccountId}`,
        payload: {
          maxProjects: 7,
        },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.data?.maxProjects).toBe(7);
    });

    it("should return 404 for non-existent account", async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/accounts/a0000000-0000-4000-8000-000000000000",
        payload: {
          name: "New Name",
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it("should reject negative maxProjects", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/accounts/${testAccountId}`,
        payload: {
          maxProjects: -1,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should handle empty update payload", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/accounts/${testAccountId}`,
        payload: {},
      });

      // Should succeed with no changes
      expect(response.statusCode).toBe(200);
    });
  });

  describe("DELETE /accounts/:accountId", () => {
    let deleteAccountId: string;

    beforeAll(async () => {
      // Create account to delete
      const createResponse = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          email: `removal-${testEmail}`,
          name: "To Be Removed",
        },
      });

      const body = JSON.parse(createResponse.body);
      deleteAccountId = body.data?.id || "";
      // An Account IS the tenant root: the only account a customer may delete
      // is its own, so sign the caller in as the account under test.
      authContext.accountId = deleteAccountId;
    });

    it("returns 404 without deleting when the caller belongs to a different tenant", async () => {
      const victim = await mockPrisma.prisma.account.create({
        data: {
          email: `victim-account-${timestamp}@example.com`,
          name: "Victim Account",
          maxProjects: 1,
        },
      });

      // The caller is signed in as `deleteAccountId`, not as the victim.
      const response = await app.inject({
        method: "DELETE",
        url: `/accounts/${victim.id}`,
      });

      expect(response.statusCode).toBe(404);

      const survivor = await mockPrisma.prisma.account.findUnique({ where: { id: victim.id } });
      expect(survivor).not.toBe(null);
      expect(survivor?.deletedAt ?? null).toBe(null);
    });

    it("should delete account successfully", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: `/accounts/${deleteAccountId}`,
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.message).toBeTruthy();
    });

    it("soft-deletes: the account row survives with deletedAt set", async () => {
      // H12 Soft Delete Universal. The row is NOT destroyed — it stays in the
      // table stamped with deletedAt, so invoices, audit rows and the tenant's
      // content remain attributable. Before this change the handler physically
      // removed the account together with every post and channel under it.
      const row = await mockPrisma.prisma.account.findUnique({
        where: { id: deleteAccountId },
      });

      expect(row).not.toBe(null);
      expect(row?.deletedAt).toBeInstanceOf(Date);
    });

    it("should verify account is deleted", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/accounts/${deleteAccountId}`,
      });

      expect(response.statusCode).toBe(404);
    });

    it("hides the deleted account from the list endpoint", async () => {
      const response = await app.inject({ method: "GET", url: "/accounts" });

      expect(response.statusCode).toBe(200);
      const listed = JSON.parse(response.body).data as { id: string }[];
      expect(listed.some((a) => a.id === deleteAccountId)).toBe(false);
    });

    it("should return 404 when deleting non-existent account", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: "/accounts/a0000000-0000-4000-8000-000000000000",
      });

      expect(response.statusCode).toBe(404);
    });

    it("should return 404 when deleting already deleted account", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: `/accounts/${deleteAccountId}`,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("DELETE /accounts/:accountId/hard", () => {
    it("destroys the account row, unlike the soft path", async () => {
      const doomed = await mockPrisma.prisma.account.create({
        data: {
          email: `hard-${Date.now()}@example.com`,
          name: "Hard Delete",
          maxProjects: 1,
        },
      });

      const response = await app.inject({
        method: "DELETE",
        url: `/accounts/${doomed.id}/hard`,
        payload: { reason: "GDPR erasure request" },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).data?.deleted).toBe(true);

      const gone = await mockPrisma.prisma.account.findUnique({ where: { id: doomed.id } });
      expect(gone).toBe(null);
    });

    it("refuses without a written reason, so the audit record can never be empty", async () => {
      const survivor = await mockPrisma.prisma.account.create({
        data: {
          email: `needs-reason-${Date.now()}@example.com`,
          name: "Needs Reason",
          maxProjects: 1,
        },
      });

      const noBody = await app.inject({
        method: "DELETE",
        url: `/accounts/${survivor.id}/hard`,
      });
      expect(noBody.statusCode).toBe(400);

      const tooShort = await app.inject({
        method: "DELETE",
        url: `/accounts/${survivor.id}/hard`,
        payload: { reason: "oops" },
      });
      expect(tooShort.statusCode).toBe(400);

      // Neither rejected request touched the row.
      const still = await mockPrisma.prisma.account.findUnique({
        where: { id: survivor.id },
      });
      expect(still).not.toBe(null);
    });

    it("returns 404 for an unknown account", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: "/accounts/a0000000-0000-4000-8000-000000000000/hard",
        payload: { reason: "GDPR erasure request" },
      });

      expect(response.statusCode).toBe(404);
    });

    it("writes an audit record naming the admin and the reason", async () => {
      const doomed = await mockPrisma.prisma.account.create({
        data: {
          email: `audited-${Date.now()}@example.com`,
          name: "Audited Hard Delete",
          maxProjects: 1,
        },
      });

      await app.inject({
        method: "DELETE",
        url: `/accounts/${doomed.id}/hard`,
        payload: { reason: "Support escalation 4821" },
      });

      const entry = stores.auditLog.all().find((row) => row.resourceId === doomed.id) as
        { userId?: string; action?: string; success?: boolean; details?: unknown } | undefined;

      expect(entry).toBeTruthy();
      expect(entry?.action).toBe("ACCOUNT_DELETED");
      expect(entry?.userId).toBe("admin-user-1");
      expect(entry?.success).toBe(true);
      expect((entry?.details as { reason?: string })?.reason).toBe("Support escalation 4821");
      expect((entry?.details as { mode?: string })?.mode).toBe("hard");
    });
  });
});
