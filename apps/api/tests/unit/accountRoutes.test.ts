/**
 * @file accountRoutes.test.ts
 * @description Unit tests for accountRoutes.
 *              Uses in-memory mocked Prisma stores — no real database needed.
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";

// The customer principal this file's mocked `requireClientAuth` binds. Hoisted
// so the `vi.mock` factory below (which vitest lifts above every import) can read
// it, and so the DELETE suite can mint its account under exactly this id.
const { CUSTOMER_PRINCIPAL } = vi.hoisted(() => ({
  CUSTOMER_PRINCIPAL: {
    id: "customer-user-1",
    accountId: "c0000000-0000-4000-8000-000000000001",
    roleId: "customer-role-1",
    roleName: "OWNER",
    // The seeded OWNER role carries `account:delete`, and DELETE
    // /accounts/:accountId asserts that grant. A principal labelled OWNER
    // without it contradicts the seed and would make this file's DELETE suite
    // fail for a reason it does not test. The grant itself — that a member
    // WITHOUT it is refused and destroys nothing — is pinned under the real
    // middleware in `tests/unit/accounts/accountDeletePermission.test.ts`.
    permissions: ["account:manage", "account:delete"] as readonly string[],
  },
}));

// The customer middleware stays mocked here so the POST/GET/PUT/LIST suites can
// run without minting a token per request — but it now binds a principal instead
// of authenticating NOBODY. An empty `async () => {}` left `request.customerUser`
// undefined, which is a shape production never produces after this preHandler
// succeeds, and it is why these tests could assert that DELETE works while being
// blind to WHOSE account it worked on.
//
// The bound accountId is a fixed constant, deliberately NOT read from the request:
// a double that echoed the path param back as the principal would make every
// ownership check pass by construction. Ownership under the REAL `requireClientAuth`
// with genuinely signed tokens is proven in
// `tests/unit/accounts/accountDeleteOwnership.test.ts`.
vi.mock("../../src/auth/customerAuthMiddleware.js", () => ({
  requireClientAuth: async (request: { customerUser?: unknown }) => {
    request.customerUser = { ...CUSTOMER_PRINCIPAL };
  },
}));

// Admin surface for DELETE /accounts/:accountId/hard is driven through the REAL
// `requireAdminAuth` (NOT mocked): a mock that set a phantom `request.adminUser`
// nothing in production ever sets would "prove" an attribution the running system
// does not provide. The real middleware binds the principal on `request.auth`, and
// these tests pass a genuine, TokenService-signed admin access token — so the id
// that lands on the tombstone and the audit record is the one the real
// authentication path put there. Only `requirePermission` stays mocked: RBAC
// enforcement is a separate concern from attribution.
vi.mock("../../src/auth/rbacMiddleware.js", () => ({
  requirePermission: () => async () => {},
}));

import { createMockPrismaModule } from "./helpers/mockPrisma.js";

// ---------------------------------------------------------------------------
// Mock setup — must come BEFORE any SUT imports
// ---------------------------------------------------------------------------

const { mockPrisma, stores } = createMockPrismaModule();

// accountRoutes uses include: { projects: ... } and include: { _count: ... }.
// One include resolver for the account model, shared by findUnique and findMany.
// A nested `where` is honoured rather than ignored, so the double answers the
// same shape the real client would for either form of the include.
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

// Models the mock module does not define but the DELETE handler and the
// container's repositories reach for.
const noopDeleteMany = vi.fn(async () => ({ count: 0 }));
const prismaAny = mockPrisma.prisma as Record<string, unknown>;
prismaAny.postContent = { deleteMany: noopDeleteMany };
prismaAny.postMedia = { deleteMany: noopDeleteMany };
// `post.count` backs the POST dimension of the hard-delete pre-flight size probe
// (countHardDeleteImpact); 0 keeps every fixture well under the ceiling so the
// guard never trips here.
prismaAny.post = {
  deleteMany: noopDeleteMany,
  findMany: vi.fn(async () => []),
  count: vi.fn(async () => 0),
};
// `task.count` and `webhookEvent.count` back the CHILD dimension of that same probe.
// They are not optional decoration: the probe reads both, and an accessor the mock
// does not define throws inside the use case's try/catch, which returns 500 — so a
// missing count here would turn every hard-delete route test into a 500 that looks
// like an unrelated regression.
prismaAny.task = { count: vi.fn(async () => 0) };
prismaAny.channel = { deleteMany: noopDeleteMany };
// The hard delete's own tombstone write (see PrismaAccountRepository.hardDelete):
// one `DeletionRecord` row for the account plus one per project it drags along,
// inserted in the same transaction as the delete, so the double has to offer it
// or the route fails. It reports a TRUTHFUL count (rows inserted) so the
// repository's tombstone-count integrity check passes, and it records its calls
// so a test can read back the principal the delete attributed the destruction to.
prismaAny.deletionRecord = {
  createMany: vi.fn(async (args: { data: unknown[] }) => ({ count: args.data.length })),
};
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
const { TokenService } = await import("../../src/admin/auth/TokenService.js");

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

// A genuine admin access token, signed with the same secret the real
// `requireAdminAuth` verifies against. `ADMIN_PRINCIPAL_ID` is the id the token
// carries in `sub`; the hard-delete route must attribute the destruction to
// exactly this principal (read from `request.auth.user.id`), never a placeholder.
const ADMIN_PRINCIPAL_ID = "admin-user-777";
const adminAccessToken = new TokenService().generateAccessToken({
  id: ADMIN_PRINCIPAL_ID,
  email: "admin-seven@omnipost.test",
  name: "Admin Seven",
  role: "SUPER_ADMIN",
} as never);
const adminAuthHeaders = { authorization: `Bearer ${adminAccessToken}` };

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

  // `Foo@Example.com` and `foo@example.com` are ONE address for registration
  // purposes. The three assertions below are one fix seen from three sides, and
  // they only hold together: the route must STORE the normalized form, the
  // lookup must FIND it whatever the caller typed, and the duplicate check must
  // REFUSE the case-twin. Normalizing only the lookup is worse than doing
  // nothing — it searches `foo@` against a row stored `Foo@`, misses, and
  // reports "available" for an address that is already taken.
  describe("POST /accounts — email is normalized identity", () => {
    const mixedCase = `Norm-${timestamp}@Example.COM`;
    const normalized = mixedCase.toLowerCase();

    it("stores the address lowercased when registration supplies mixed case", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: { email: mixedCase, name: testName },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      // The response echoes the persisted row, so this asserts what was STORED,
      // not merely what the handler echoed back.
      expect(body.data?.email).toBe(normalized);

      const stored = stores.account.all().find((a) => a.id === body.data?.id);
      expect(stored?.email).toBe(normalized);
    });

    it("refuses the case-twin of an existing address as a duplicate", async () => {
      // The address differs from the row above ONLY in casing. Before the fix
      // the duplicate check compared raw bytes, so this call created a SECOND
      // account holding the same identity — the exact duplicate the check
      // exists to prevent.
      const response = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: { email: normalized.toUpperCase(), name: testName },
      });

      expect(response.statusCode).toBe(409);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);
      expect(body.error).toBe("EMAIL_TAKEN");

      // The refusal must leave exactly one holder of the address.
      const holders = stores.account.all().filter((a) => a.email === normalized);
      expect(holders).toHaveLength(1);
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
    // The account under test IS the bound principal's own account: a customer may
    // only delete their own, so the id is pinned rather than whatever POST /accounts
    // happened to generate.
    const deleteAccountId = CUSTOMER_PRINCIPAL.accountId;

    beforeAll(async () => {
      await mockPrisma.prisma.account.create({
        data: {
          id: deleteAccountId,
          email: `removal-${testEmail}`,
          name: "To Be Removed",
          maxProjects: 1,
        },
      });
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

    it("should verify account is deleted", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/accounts/${deleteAccountId}`,
      });

      expect(response.statusCode).toBe(404);
    });

    it("should return 404 for an account id that is not the caller's own", async () => {
      // Any id other than the principal's is refused with the SAME 404 a missing
      // account gets — the anti-enumeration answer. Previously this asserted the
      // not-found branch; with the ownership check in front, an id the caller does
      // not own never reaches a lookup at all.
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
        headers: adminAuthHeaders,
        payload: { reason: "GDPR erasure request" },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).data?.deleted).toBe(true);

      const gone = await mockPrisma.prisma.account.findUnique({ where: { id: doomed.id } });
      expect(gone).toBe(null);
    });

    it("records the authenticated admin principal (request.auth.user.id) on the tombstone, not a placeholder", async () => {
      // R1-F1: before the fix the route read the phantom `request.adminUser`
      // (nothing set it) and fell back to "unknown"; every hard delete was
      // attributed to nobody while a mock made it look attributed. Driven through
      // the REAL `requireAdminAuth` with a signed token, the id on the tombstone
      // MUST be the token's principal.
      const createMany = (
        mockPrisma.prisma as unknown as {
          deletionRecord: { createMany: { mock: { calls: unknown[][] } } };
        }
      ).deletionRecord.createMany;
      createMany.mock.calls.length = 0;

      const doomed = await mockPrisma.prisma.account.create({
        data: {
          email: `attributed-${Date.now()}@example.com`,
          name: "Attributed Hard Delete",
          maxProjects: 1,
        },
      });

      const response = await app.inject({
        method: "DELETE",
        url: `/accounts/${doomed.id}/hard`,
        headers: adminAuthHeaders,
        payload: { reason: "GDPR erasure request" },
      });
      expect(response.statusCode).toBe(200);

      const args = createMany.mock.calls[0]?.[0] as { data: Array<Record<string, unknown>> };
      const accountTombstone = args.data.find((r) => r.entityType === "ACCOUNT");
      expect(accountTombstone?.deletedBy).toBe(ADMIN_PRINCIPAL_ID);
      // And nothing falls back to the old placeholder.
      expect(accountTombstone?.deletedBy).not.toBe("unknown");
    });

    it("rejects the hard delete with 401 and destroys nothing when no admin token is present", async () => {
      // Fail closed: with no principal we cannot know who is erasing a tenant's
      // data, so the real middleware refuses before the handler runs.
      const survivor = await mockPrisma.prisma.account.create({
        data: {
          email: `no-token-${Date.now()}@example.com`,
          name: "No Token",
          maxProjects: 1,
        },
      });

      const response = await app.inject({
        method: "DELETE",
        url: `/accounts/${survivor.id}/hard`,
        payload: { reason: "GDPR erasure request" },
      });

      expect(response.statusCode).toBe(401);
      const still = await mockPrisma.prisma.account.findUnique({ where: { id: survivor.id } });
      expect(still).not.toBe(null);
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
        headers: adminAuthHeaders,
      });
      expect(noBody.statusCode).toBe(400);

      const tooShort = await app.inject({
        method: "DELETE",
        url: `/accounts/${survivor.id}/hard`,
        headers: adminAuthHeaders,
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
        headers: adminAuthHeaders,
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
        headers: adminAuthHeaders,
        payload: { reason: "Support escalation 4821" },
      });

      const entry = stores.auditLog.all().find((row) => row.resourceId === doomed.id) as
        { userId?: string; action?: string; success?: boolean; details?: unknown } | undefined;

      expect(entry).toBeTruthy();
      expect(entry?.action).toBe("ACCOUNT_DELETED");
      expect(entry?.userId).toBe(ADMIN_PRINCIPAL_ID);
      expect(entry?.success).toBe(true);
      expect((entry?.details as { reason?: string })?.reason).toBe("Support escalation 4821");
      expect((entry?.details as { mode?: string })?.mode).toBe("hard");
    });
  });
});
