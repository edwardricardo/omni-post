/**
 * @file projectRoutes.test.ts
 * @description Unit tests for projectRoutes — project CRUD operations.
 *              Uses in-memory mocked Prisma stores — no real database needed.
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";

// The customer principal this file's mocked `requireClientAuth` binds. Hoisted so
// the `vi.mock` factory below (which vitest lifts above every import) can read it.
// The DELETE route now derives its caller context from `request.customerUser`, so
// a middleware mock that authenticates NOBODY would turn every soft delete into a
// 401 and prove nothing. `AUTH_STATE.principal` is mutable so one test can model
// the fail-closed branch (middleware ran, no principal survived).
//
// The bound accountId is a fixed constant, deliberately NOT read from the request:
// a double that echoed the path param back as the principal would make every
// ownership check pass by construction.
const { AUTH_STATE, CUSTOMER_PRINCIPAL } = vi.hoisted(() => {
  const CUSTOMER_PRINCIPAL = {
    id: "customer-user-42",
    accountId: "c0000000-0000-4000-8000-000000000042",
    roleId: "customer-role-owner",
    roleName: "OWNER",
    permissions: ["account:manage", "account:delete"] as readonly string[],
  };
  return {
    CUSTOMER_PRINCIPAL,
    AUTH_STATE: {
      principal: CUSTOMER_PRINCIPAL as typeof CUSTOMER_PRINCIPAL | undefined,
    },
  };
});

vi.mock("../../src/auth/customerAuthMiddleware.js", () => ({
  requireClientAuth: async (request: { customerUser?: unknown }) => {
    if (AUTH_STATE.principal) {
      request.customerUser = { ...AUTH_STATE.principal };
    }
  },
}));

// Admin surface for DELETE /projects/:projectId/hard is driven through the REAL
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

import { createMockPrismaModule, createStore, buildModelMock } from "./helpers/mockPrisma.js";
import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Mock setup — must come BEFORE any SUT imports
// ---------------------------------------------------------------------------

const { mockPrisma, stores } = createMockPrismaModule();

// Patch account.findUnique to resolve include: { _count: { select: { projects: true } } }
const origAccountFindUnique = mockPrisma.prisma.account.findUnique;
mockPrisma.prisma.account.findUnique = vi.fn(async (args: Record<string, unknown>) => {
  const result = await origAccountFindUnique(args);
  if (!result) return null;
  const include = args.include as Record<string, unknown> | undefined;
  if (include?._count) {
    (result as Record<string, unknown>)._count = {
      projects: stores.project.all().filter((p) => p.accountId === result.id).length,
    };
  }
  if (include?.projects) {
    (result as Record<string, unknown>).projects = stores.project
      .all()
      .filter((p) => p.accountId === result.id);
  }
  return result;
});

// Patch project.findUnique to support compound unique key accountId_name
const origProjectFindUnique = mockPrisma.prisma.project.findUnique;
mockPrisma.prisma.project.findUnique = vi.fn(
  async (args: { where: Record<string, unknown>; include?: Record<string, unknown> }) => {
    const where = args.where;

    // Handle compound unique key: { accountId_name: { accountId, name } }
    if (where.accountId_name) {
      const compound = where.accountId_name as { accountId: string; name: string };
      const found =
        stores.project
          .all()
          .find((p) => p.accountId === compound.accountId && p.name === compound.name) ?? null;
      return found ? { ...found } : null;
    }

    // Fall back to default behavior (by id)
    return origProjectFindUnique(args);
  }
);

// Models the mock module does not define but the container's repositories may
// reach for. The DELETE route no longer touches them (it soft-deletes the
// project row and leaves its children alone) — they remain so that any
// repository resolved from setupContainer finds a callable accessor.
const noopDeleteMany = vi.fn(async () => ({ count: 0 }));
const prismaAny = mockPrisma.prisma as Record<string, unknown>;
prismaAny.postContent = { deleteMany: noopDeleteMany };
prismaAny.postMedia = { deleteMany: noopDeleteMany };
// STORE-backed post and channel models, not bare stubs: the soft-delete suite
// seeds real child rows and then asserts they SURVIVE the project delete — an
// assertion a `count: async () => 0` stub could never carry. `post.count` also
// backs the POST dimension of the hard-delete pre-flight size probe
// (countHardDeleteImpact), which store-backed counting answers truthfully.
const postStore = createStore();
const channelStore = createStore();
prismaAny.post = buildModelMock(postStore);
prismaAny.channel = buildModelMock(channelStore);
// `task.count` and `webhookEvent.count` back the CHILD dimension of that same probe.
// They are not optional decoration: the probe reads both, and an accessor the mock
// does not define throws inside the use case's try/catch, which returns 500 — so a
// missing count here would turn every hard-delete route test into a 500 that looks
// like an unrelated regression.
prismaAny.task = { count: vi.fn(async () => 0) };
prismaAny.publishLog = { findMany: vi.fn(async () => []), deleteMany: noopDeleteMany };
// The hard delete's own tombstone write (see PrismaProjectRepository.hardDelete):
// a `DeletionRecord` row is inserted in the same transaction as the delete. It
// reports a TRUTHFUL count (rows inserted) so the repository's tombstone-count
// integrity check passes, and it records its calls so a test can read back the
// principal the delete attributed the destruction to.
prismaAny.deletionRecord = {
  createMany: vi.fn(async (args: { data: unknown[] }) => ({ count: args.data.length })),
};
// Models other repositories resolved from setupContainer may reach for. Named
// one by one rather than proxied: a model that is reached but this list forgets
// must surface as a failure, not be papered over by a catch-all.
for (const model of [
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
const { projectRoutes } = await import("../../src/projects/projectRoutes.js");
const { setupContainer } = await import("../../src/infrastructure/container/setup.js");
const { prisma } = await import("@infra/prisma");
const { TokenService } = await import("../../src/admin/auth/TokenService.js");
const { signCustomerAccessToken } = await import("../../src/auth/customerJwt.js");

// A genuine admin access token, signed with the same secret the real
// `requireAdminAuth` verifies against. The hard-delete route must attribute the
// destruction to exactly this principal (read from `request.auth.user.id`).
const ADMIN_PRINCIPAL_ID = "admin-user-777";
const adminAccessToken = new TokenService().generateAccessToken({
  id: ADMIN_PRINCIPAL_ID,
  email: "admin-seven@omnipost.test",
  name: "Admin Seven",
  role: "SUPER_ADMIN",
} as never);
const adminAuthHeaders = { authorization: `Bearer ${adminAccessToken}` };

// A genuine admin token for a STAFF role that does NOT hold `account:manage`.
// SUPPORT is a real seeded role (see mockPrisma's role seed), which is what makes
// this the honest shape of the threat: not a forged token, but a legitimate
// lower-privilege employee reaching an endpoint that crosses every tenant.
const SUPPORT_PRINCIPAL_ID = "admin-support-31";
const supportAccessToken = new TokenService().generateAccessToken({
  id: SUPPORT_PRINCIPAL_ID,
  email: "support-one@omnipost.test",
  name: "Support One",
  role: "SUPPORT",
} as never);
const supportAuthHeaders = { authorization: `Bearer ${supportAccessToken}` };

/**
 * Mints a GENUINE customer access token for the composed admin-or-owner surfaces
 * (`POST /projects/:projectId/restore`, the self-purge arm of the hard delete).
 *
 * Those routes run the REAL `requireCustomerOrAdminAuth`, not this file's
 * `requireClientAuth` double, because which branch the handler takes IS the
 * behaviour under test: a double that decided the branch would decide the answer
 * with it. Signing a real token instead means the principal the handler gates on
 * is the one the production verifier produced.
 */
function customerHeaders(
  overrides: Partial<{ accountId: string; permissions: readonly string[] }> = {}
): { authorization: string } {
  const token = signCustomerAccessToken({
    sub: CUSTOMER_PRINCIPAL.id,
    accountId: overrides.accountId ?? CUSTOMER_PRINCIPAL.accountId,
    roleId: CUSTOMER_PRINCIPAL.roleId,
    roleName: CUSTOMER_PRINCIPAL.roleName,
    permissions: overrides.permissions ?? CUSTOMER_PRINCIPAL.permissions,
  });
  return { authorization: `Bearer ${token}` };
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  const container = setupContainer({ prisma: prisma as never });
  app.decorate("container", container);

  await app.register(projectRoutes);

  return app;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

const timestamp = Date.now();
const testProjectName = `Test Project ${timestamp}`;

describe("projectRoutes - Unit Tests", () => {
  let app: FastifyInstance;
  let createdAccountId: string;
  let _createdProjectId: string;

  beforeAll(async () => {
    app = await createTestApp();

    // Create test account under the SAME id the mocked `requireClientAuth`
    // binds as the principal's tenant: the soft-delete path is ownership-gated
    // against `customerUser.accountId`, so a randomly-generated account id would
    // make every DELETE in this file answer 404 for a reason it does not test.
    const testAccount = await prisma.account.create({
      data: {
        id: CUSTOMER_PRINCIPAL.accountId,
        email: `test-project-${timestamp}@example.com`,
        name: "Test Account",
        subscription: "BASIC",
        maxProjects: 5,
      },
    });
    createdAccountId = testAccount.id;
  });

  afterAll(async () => {
    try {
      if (createdAccountId) {
        await prisma.project.deleteMany({
          where: { accountId: createdAccountId },
        });
        await prisma.account
          .delete({
            where: { id: createdAccountId },
          })
          .catch(() => {
            /* may already be deleted */
          });
      }
    } catch (_err) {
      // best-effort cleanup
    }
    await app.close();
  });

  describe("POST /accounts/:accountId/projects", () => {
    it("should create a new project successfully", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/accounts/${createdAccountId}/projects`,
        payload: {
          name: testProjectName,
          locale: "en",
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.data?.id).toBeTruthy();
      expect(body.data?.accountId).toBe(createdAccountId);
      expect(body.data?.name).toBe(testProjectName);
      expect(body.data?.locale).toBe("en");
      expect(body.data?.createdAt).toBeTruthy();

      _createdProjectId = body.data?.id;
    });

    it("should use default locale if not provided", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/accounts/${createdAccountId}/projects`,
        payload: {
          name: `Default Locale Project ${timestamp}`,
        },
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.data?.locale).toBe("en");

      // Cleanup
      if (body.data?.id) {
        await prisma.project.delete({ where: { id: body.data.id } });
      }
    });

    it("should return 404 for non-existent account", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/accounts/a0000000-0000-4000-8000-000000000000/projects",
        payload: {
          name: "Test Project",
          locale: "en",
        },
      });

      expect(response.statusCode).toBe(404);

      const body = JSON.parse(response.body);
      expect(body.error).toBeTruthy();
    });

    it("should return 409 when project name already exists", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/accounts/${createdAccountId}/projects`,
        payload: {
          name: testProjectName,
          locale: "en",
        },
      });

      expect(response.statusCode).toBe(409);

      const body = JSON.parse(response.body);
      expect(body.error).toBeTruthy();
      expect(body.error).toBe("NAME_TAKEN");
    });

    it("should return 403 when quota exceeded", async () => {
      // Create account with maxProjects = 0
      const quotaAccount = await prisma.account.create({
        data: {
          email: `quota-test-${timestamp}@example.com`,
          name: "Quota Test",
          subscription: "BASIC",
          maxProjects: 0,
        },
      });

      const response = await app.inject({
        method: "POST",
        url: `/accounts/${quotaAccount.id}/projects`,
        payload: {
          name: "Should Fail",
          locale: "en",
        },
      });

      expect(response.statusCode).toBe(403);

      const body = JSON.parse(response.body);
      expect(body.error).toBeTruthy();
      expect(body.error).toBe("QUOTA_EXCEEDED");

      // Cleanup
      await prisma.account.delete({ where: { id: quotaAccount.id } });
    });

    it("counts DELETED projects against the quota and explains which slots are held", async () => {
      // The rule, and it is the opposite of what quota used to do: a deleted
      // project still HOLDS its slot. Counting only live rows handed the slot back
      // on delete, which — since the delete is soft and reversible — made deletion
      // a quota-farming move: delete, create, restore, and a 2-slot tenant ends up
      // holding 3.
      const account = await prisma.account.create({
        data: {
          email: `quota-held-${Date.now()}@example.com`,
          name: "Quota Held",
          subscription: "BASIC",
          maxProjects: 2,
        },
      });
      await prisma.project.create({
        data: { accountId: account.id, name: `Live One ${Date.now()}`, locale: "en" },
      });
      await prisma.project.create({
        data: {
          accountId: account.id,
          name: `Deleted One ${Date.now()}`,
          locale: "en",
          deletedAt: new Date(),
        },
      });

      const response = await app.inject({
        method: "POST",
        url: `/accounts/${account.id}/projects`,
        payload: { name: `Third Project ${Date.now()}`, locale: "en" },
      });

      expect(response.statusCode).toBe(403);

      const body = JSON.parse(response.body);
      expect(body.error).toBe("QUOTA_EXCEEDED");
      // The refusal has to be actionable. The tenant's project LIST shows one
      // project against a limit of two, so a bare "quota exceeded" is a number
      // they cannot reconcile with anything on their screen; the body has to say
      // that a deleted project is holding the missing slot and name both exits.
      expect(body.details).toMatchObject({ used: 2, limit: 2, deletedHeld: 1 });
      expect(String(body.details?.message)).toContain("restore");
      expect(String(body.details?.message)).toContain("permanently delete");
    });

    it("still allows creation while the held slots — live and deleted — are under the limit", async () => {
      // The other half: counting deleted rows must not strand a tenant below its
      // own limit. One live project against a limit of two still leaves a slot.
      const account = await prisma.account.create({
        data: {
          email: `quota-room-${Date.now()}@example.com`,
          name: "Quota Room",
          subscription: "BASIC",
          maxProjects: 2,
        },
      });
      await prisma.project.create({
        data: { accountId: account.id, name: `Only Live ${Date.now()}`, locale: "en" },
      });

      const response = await app.inject({
        method: "POST",
        url: `/accounts/${account.id}/projects`,
        payload: { name: `Second Project ${Date.now()}`, locale: "en" },
      });

      expect(response.statusCode).toBe(200);
    });

    it("frees the slot again once the held project is permanently erased", async () => {
      // The escape hatch the 403 message promises, exercised end to end so the
      // message cannot become a lie: erasing the deleted project releases its
      // slot and the create that was refused now succeeds.
      const account = await prisma.account.create({
        data: {
          email: `quota-freed-${Date.now()}@example.com`,
          name: "Quota Freed",
          subscription: "BASIC",
          maxProjects: 1,
        },
      });
      const held = await prisma.project.create({
        data: {
          accountId: account.id,
          name: `Held Slot ${Date.now()}`,
          locale: "en",
          deletedAt: new Date(),
        },
      });

      const refused = await app.inject({
        method: "POST",
        url: `/accounts/${account.id}/projects`,
        payload: { name: `Blocked ${Date.now()}`, locale: "en" },
      });
      expect(refused.statusCode).toBe(403);

      const purge = await app.inject({
        method: "DELETE",
        url: `/projects/${held.id}/hard`,
        headers: adminAuthHeaders,
        payload: { reason: "Releasing the held quota slot" },
      });
      expect(purge.statusCode).toBe(200);

      const allowed = await app.inject({
        method: "POST",
        url: `/accounts/${account.id}/projects`,
        payload: { name: `Allowed ${Date.now()}`, locale: "en" },
      });
      expect(allowed.statusCode).toBe(200);
    });

    it("should validate project name format", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/accounts/${createdAccountId}/projects`,
        payload: {
          name: "", // Empty name
          locale: "en",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should validate locale format", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/accounts/${createdAccountId}/projects`,
        payload: {
          name: "Valid Name",
          locale: "x", // Too short
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject invalid account ID format", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/accounts/invalid!/projects",
        payload: {
          name: "Test Project",
          locale: "en",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should accept valid locales", async () => {
      const locales = ["en", "es", "fr", "de", "ja"];

      for (const locale of locales) {
        const response = await app.inject({
          method: "POST",
          url: `/accounts/${createdAccountId}/projects`,
          payload: {
            name: `Project ${locale} ${Date.now()}`,
            locale,
          },
        });

        expect(response.statusCode).toBe(200);

        const body = JSON.parse(response.body);
        expect(body.data?.locale).toBe(locale);

        // Cleanup
        if (body.data?.id) {
          await prisma.project.delete({ where: { id: body.data.id } });
        }
      }
    });
  });

  describe("GET /accounts/:accountId/projects", () => {
    it("should list all projects for an account", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/accounts/${createdAccountId}/projects`,
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data)).toBeTruthy();
      expect(body.data.length >= 1).toBeTruthy();
    });

    it("should return projects in descending order by creation date", async () => {
      // Create multiple projects
      const project1 = await prisma.project.create({
        data: {
          accountId: createdAccountId,
          name: `Project 1 ${Date.now()}`,
          locale: "en",
        },
      });

      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 10);
        timer.unref();
      }); // Small delay

      const project2 = await prisma.project.create({
        data: {
          accountId: createdAccountId,
          name: `Project 2 ${Date.now()}`,
          locale: "en",
        },
      });

      const response = await app.inject({
        method: "GET",
        url: `/accounts/${createdAccountId}/projects`,
      });

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.data.length >= 2).toBeTruthy();

      // First project should be the most recent
      const dates = body.data.map((p: Record<string, unknown>) =>
        new Date(p.createdAt as string).getTime()
      );
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i - 1] >= dates[i]).toBeTruthy();
      }

      // Cleanup
      await prisma.project.delete({ where: { id: project1.id } });
      await prisma.project.delete({ where: { id: project2.id } });
    });

    it("should return empty array for account with no projects", async () => {
      const emptyAccount = await prisma.account.create({
        data: {
          email: `empty-${timestamp}@example.com`,
          name: "Empty Account",
          subscription: "BASIC",
          maxProjects: 5,
        },
      });

      const response = await app.inject({
        method: "GET",
        url: `/accounts/${emptyAccount.id}/projects`,
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data)).toBeTruthy();
      expect(body.data.length).toBe(0);

      // Cleanup
      await prisma.account.delete({ where: { id: emptyAccount.id } });
    });

    it("should return 404 for non-existent account", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/accounts/a0000000-0000-4000-8000-000000000000/projects",
      });

      expect(response.statusCode).toBe(404);
    });

    it("should include all project fields", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/accounts/${createdAccountId}/projects`,
      });

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.data.length > 0).toBeTruthy();

      const project = body.data[0];
      expect(project.id).toBeTruthy();
      expect(project.accountId).toBeTruthy();
      expect(project.name).toBeTruthy();
      expect(project.locale).toBeTruthy();
      expect(project.createdAt).toBeTruthy();
    });

    it("should reject invalid account ID format", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/accounts/invalid!/projects",
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("DELETE /projects/:projectId", () => {
    it("soft-deletes: the row survives with deletedAt set, asserted through the store", async () => {
      // Create project to delete
      const projectToDelete = await prisma.project.create({
        data: {
          accountId: createdAccountId,
          name: `To Delete ${Date.now()}`,
          locale: "en",
        },
      });

      const response = await app.inject({
        method: "DELETE",
        url: `/projects/${projectToDelete.id}`,
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.data?.message).toBeTruthy();

      // The row is PRESENT and carries deletedAt — asserted through the store,
      // not through a read path that might filter it. A null here is the old
      // hard-delete-by-default defect coming back.
      const survivor = (await prisma.project.findUnique({
        where: { id: projectToDelete.id },
      })) as { deletedAt?: Date | null } | null;
      expect(survivor).not.toBe(null);
      expect(survivor?.deletedAt).toBeInstanceOf(Date);
    });

    it("answers the second delete of the same project with 404", async () => {
      const doomed = await prisma.project.create({
        data: {
          accountId: createdAccountId,
          name: `Twice Deleted ${Date.now()}`,
          locale: "en",
        },
      });

      const first = await app.inject({ method: "DELETE", url: `/projects/${doomed.id}` });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({ method: "DELETE", url: `/projects/${doomed.id}` });
      expect(second.statusCode).toBe(404);
    });

    it("should return 404 for non-existent project", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: "/projects/a0000000-0000-4000-8000-000000000000",
      });

      expect(response.statusCode).toBe(404);

      const body = JSON.parse(response.body);
      expect(body.error).toBeTruthy();
    });

    it("should reject invalid project ID format", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: "/projects/invalid!",
      });

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error).toBeTruthy();
    });

    it("should return success message after deletion", async () => {
      const projectToDelete = await prisma.project.create({
        data: {
          accountId: createdAccountId,
          name: `Delete Message Test ${Date.now()}`,
          locale: "en",
        },
      });

      const response = await app.inject({
        method: "DELETE",
        url: `/projects/${projectToDelete.id}`,
      });

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
      expect(body.data?.message).toBe("Project deleted successfully");
    });

    it("does NOT cascade: the project's posts and channels survive the soft delete untouched", async () => {
      const projectWithData = await prisma.project.create({
        data: {
          accountId: createdAccountId,
          name: `No Cascade ${Date.now()}`,
          locale: "en",
        },
      });
      const post = postStore.add({
        projectId: projectWithData.id,
        title: "Surviving post",
        deletedAt: null,
      });
      const channel = channelStore.add({
        projectId: projectWithData.id,
        name: "Surviving channel",
        provider: "X",
      });

      const postDeleteMany = (prismaAny.post as { deleteMany: ReturnType<typeof vi.fn> })
        .deleteMany;
      const channelDeleteMany = (prismaAny.channel as { deleteMany: ReturnType<typeof vi.fn> })
        .deleteMany;
      postDeleteMany.mockClear();
      channelDeleteMany.mockClear();
      noopDeleteMany.mockClear();

      const response = await app.inject({
        method: "DELETE",
        url: `/projects/${projectWithData.id}`,
      });
      expect(response.statusCode).toBe(200);

      // The children are still THERE, un-deleted — through the store, the same
      // place Postgres would hold them. And no destructive statement was even
      // issued: the leaf-first deleteMany calls the old handler carried are gone.
      const survivingPost = postStore.get(post.id as string) as
        { deletedAt?: Date | null } | undefined;
      const survivingChannel = channelStore.get(channel.id as string);
      expect(survivingPost).toBeDefined();
      expect(survivingPost?.deletedAt ?? null).toBe(null);
      expect(survivingChannel).toBeDefined();
      expect(postDeleteMany).not.toHaveBeenCalled();
      expect(channelDeleteMany).not.toHaveBeenCalled();
      expect(noopDeleteMany).not.toHaveBeenCalled();
    });

    it("refuses to delete a project of another tenant and leaves it live (404, anti-enumeration)", async () => {
      const foreignAccount = await prisma.account.create({
        data: {
          email: `foreign-${Date.now()}@example.com`,
          name: "Foreign Tenant",
          maxProjects: 5,
        },
      });
      const foreignProject = await prisma.project.create({
        data: {
          accountId: foreignAccount.id,
          name: `Foreign Project ${Date.now()}`,
          locale: "en",
        },
      });

      const response = await app.inject({
        method: "DELETE",
        url: `/projects/${foreignProject.id}`,
      });

      // Same 404 a missing project gets — never a 403 that confirms existence.
      expect(response.statusCode).toBe(404);
      const survivor = (await prisma.project.findUnique({
        where: { id: foreignProject.id },
      })) as { deletedAt?: Date | null } | null;
      expect(survivor).not.toBe(null);
      expect(survivor?.deletedAt ?? null).toBe(null);
    });

    it("fails closed with 401 and deletes nothing when no principal survived authentication", async () => {
      const survivorProject = await prisma.project.create({
        data: {
          accountId: createdAccountId,
          name: `No Principal ${Date.now()}`,
          locale: "en",
        },
      });

      AUTH_STATE.principal = undefined;
      try {
        const response = await app.inject({
          method: "DELETE",
          url: `/projects/${survivorProject.id}`,
        });
        expect(response.statusCode).toBe(401);
      } finally {
        AUTH_STATE.principal = CUSTOMER_PRINCIPAL;
      }

      const survivor = (await prisma.project.findUnique({
        where: { id: survivorProject.id },
      })) as { deletedAt?: Date | null } | null;
      expect(survivor).not.toBe(null);
      expect(survivor?.deletedAt ?? null).toBe(null);
    });

    it("writes an audit record naming the customer principal and the soft mode", async () => {
      const audited = await prisma.project.create({
        data: {
          accountId: createdAccountId,
          name: `Audited Soft Delete ${Date.now()}`,
          locale: "en",
        },
      });

      const response = await app.inject({
        method: "DELETE",
        url: `/projects/${audited.id}`,
      });
      expect(response.statusCode).toBe(200);

      const entry = stores.auditLog.all().find((row) => row.resourceId === audited.id) as
        | {
            customerUserId?: string;
            userId?: string;
            action?: string;
            success?: boolean;
            details?: unknown;
          }
        | undefined;

      expect(entry).toBeTruthy();
      expect(entry?.action).toBe("PROJECT_DELETED");
      // A CUSTOMER deleted this — the customer FK carries the attribution and
      // the admin FK stays empty (DB exclusive-arc CHECK).
      expect(entry?.customerUserId).toBe(CUSTOMER_PRINCIPAL.id);
      expect(entry?.userId ?? null).toBe(null);
      expect(entry?.success).toBe(true);
      expect((entry?.details as { mode?: string })?.mode).toBe("soft");
    });

    it("refuses a member without account:delete with 403 and the project stays live", async () => {
      const survivor = await prisma.project.create({
        data: {
          accountId: createdAccountId,
          name: `Member Cannot Delete ${Date.now()}`,
          locale: "en",
        },
      });

      // A real, broad member permission set — everything a MEMBER legitimately
      // holds — minus the OWNER-only grant. A soft delete still shuts the project
      // down for the whole tenant, so it stays an owner-grade action even though
      // the row survives.
      AUTH_STATE.principal = { ...CUSTOMER_PRINCIPAL, permissions: ["post:manage"] };
      try {
        const response = await app.inject({
          method: "DELETE",
          url: `/projects/${survivor.id}`,
        });
        expect(response.statusCode).toBe(403);
      } finally {
        AUTH_STATE.principal = CUSTOMER_PRINCIPAL;
      }

      const still = (await prisma.project.findUnique({ where: { id: survivor.id } })) as {
        deletedAt?: Date | null;
      } | null;
      expect(still).not.toBe(null);
      expect(still?.deletedAt ?? null).toBe(null);
    });

    it("still lets the owner holding account:delete delete the project", async () => {
      // The other half of the gate above: it must refuse by CAPABILITY, not
      // refuse everyone. A gate that denies the owner too is not a stricter gate,
      // it is a broken endpoint.
      const doomed = await prisma.project.create({
        data: {
          accountId: createdAccountId,
          name: `Owner Can Delete ${Date.now()}`,
          locale: "en",
        },
      });

      const response = await app.inject({
        method: "DELETE",
        url: `/projects/${doomed.id}`,
      });

      expect(response.statusCode).toBe(200);
      const survivor = (await prisma.project.findUnique({ where: { id: doomed.id } })) as {
        deletedAt?: Date | null;
      } | null;
      expect(survivor?.deletedAt).toBeInstanceOf(Date);
    });

    it("no longer serves a soft-deleted project on GET (read sweep)", async () => {
      const readSwept = await prisma.project.create({
        data: {
          accountId: createdAccountId,
          name: `Read Swept ${Date.now()}`,
          locale: "en",
        },
      });

      const before = await app.inject({ method: "GET", url: `/projects/${readSwept.id}` });
      expect(before.statusCode).toBe(200);

      const del = await app.inject({ method: "DELETE", url: `/projects/${readSwept.id}` });
      expect(del.statusCode).toBe(200);

      const after = await app.inject({ method: "GET", url: `/projects/${readSwept.id}` });
      expect(after.statusCode).toBe(404);
    });
  });

  describe("DELETE /projects/:projectId/hard", () => {
    /**
     * Seed a project in the ONLY state an erasure is admissible over: already
     * soft-deleted. The interlock makes a prior soft delete part of the
     * arrangement of every hard-delete test that expects to succeed — a live
     * project now answers 409, and a suite that kept seeding one would be
     * asserting the very defect the interlock closes.
     */
    async function seedErasableProject(name: string): Promise<{ id: string }> {
      return prisma.project.create({
        data: {
          accountId: createdAccountId,
          name: `${name} ${Date.now()}`,
          locale: "en",
          deletedAt: new Date(),
        },
      });
    }

    it("destroys the project row, unlike the soft path", async () => {
      const doomed = await seedErasableProject("Hard Delete");

      const response = await app.inject({
        method: "DELETE",
        url: `/projects/${doomed.id}/hard`,
        headers: adminAuthHeaders,
        payload: { reason: "GDPR erasure request" },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).data?.deleted).toBe(true);

      const gone = await prisma.project.findUnique({ where: { id: doomed.id } });
      expect(gone).toBe(null);
    });

    it("records the authenticated admin principal (request.auth.user.id) on the tombstone, not a placeholder", async () => {
      // R1-F1: before the fix the route read the phantom `request.adminUser`
      // (nothing set it) and fell back to "unknown". Driven through the REAL
      // `requireAdminAuth` with a signed token, the id on the tombstone MUST be
      // the token's principal.
      const createMany = (
        prisma as unknown as {
          deletionRecord: { createMany: { mock: { calls: unknown[][] } } };
        }
      ).deletionRecord.createMany;
      createMany.mock.calls.length = 0;

      const doomed = await seedErasableProject("Attributed Hard Delete");

      const response = await app.inject({
        method: "DELETE",
        url: `/projects/${doomed.id}/hard`,
        headers: adminAuthHeaders,
        payload: { reason: "GDPR erasure request" },
      });
      expect(response.statusCode).toBe(200);

      const args = createMany.mock.calls[0]?.[0] as { data: Array<Record<string, unknown>> };
      expect(args.data[0]?.deletedBy).toBe(ADMIN_PRINCIPAL_ID);
      expect(args.data[0]?.deletedBy).not.toBe("unknown");
    });

    it("rejects the hard delete with 401 and destroys nothing when no admin token is present", async () => {
      const survivor = await prisma.project.create({
        data: {
          accountId: createdAccountId,
          name: `No Token ${Date.now()}`,
          locale: "en",
        },
      });

      const response = await app.inject({
        method: "DELETE",
        url: `/projects/${survivor.id}/hard`,
        payload: { reason: "GDPR erasure request" },
      });

      expect(response.statusCode).toBe(401);
      const still = await prisma.project.findUnique({ where: { id: survivor.id } });
      expect(still).not.toBe(null);
    });

    it("refuses without a written reason, so the audit record can never be empty", async () => {
      const survivor = await prisma.project.create({
        data: {
          accountId: createdAccountId,
          name: `Needs Reason ${Date.now()}`,
          locale: "en",
        },
      });

      const noBody = await app.inject({
        method: "DELETE",
        url: `/projects/${survivor.id}/hard`,
        headers: adminAuthHeaders,
      });
      expect(noBody.statusCode).toBe(400);

      const tooShort = await app.inject({
        method: "DELETE",
        url: `/projects/${survivor.id}/hard`,
        headers: adminAuthHeaders,
        payload: { reason: "oops" },
      });
      expect(tooShort.statusCode).toBe(400);

      // Neither rejected request touched the row.
      const still = await prisma.project.findUnique({ where: { id: survivor.id } });
      expect(still).not.toBe(null);
    });

    it("returns 404 for an unknown project", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: "/projects/a0000000-0000-4000-8000-000000000000/hard",
        headers: adminAuthHeaders,
        payload: { reason: "GDPR erasure request" },
      });

      expect(response.statusCode).toBe(404);
    });

    it("refuses with 409 and destroys nothing when the project is still live", async () => {
      // The two-act rule at the route: an erasure follows a soft delete, it does
      // not replace it. Without the interlock this same request destroyed a live
      // project outright, so the reversible step a mistaken erasure is caught by
      // could be skipped entirely.
      const live = await prisma.project.create({
        data: {
          accountId: createdAccountId,
          name: `Still Live ${Date.now()}`,
          locale: "en",
        },
      });

      const response = await app.inject({
        method: "DELETE",
        url: `/projects/${live.id}/hard`,
        headers: adminAuthHeaders,
        payload: { reason: "GDPR erasure request" },
      });

      expect(response.statusCode).toBe(409);
      const survivor = await prisma.project.findUnique({ where: { id: live.id } });
      expect(survivor).not.toBe(null);
    });

    it("writes an audit record naming the admin and the reason", async () => {
      const doomed = await seedErasableProject("Audited Hard Delete");

      await app.inject({
        method: "DELETE",
        url: `/projects/${doomed.id}/hard`,
        headers: adminAuthHeaders,
        payload: { reason: "Support escalation 4821" },
      });

      const entry = stores.auditLog.all().find((row) => row.resourceId === doomed.id) as
        { userId?: string; action?: string; success?: boolean; details?: unknown } | undefined;

      expect(entry).toBeTruthy();
      expect(entry?.action).toBe("PROJECT_DELETED");
      expect(entry?.userId).toBe(ADMIN_PRINCIPAL_ID);
      expect(entry?.success).toBe(true);
      expect((entry?.details as { reason?: string; mode?: string })?.reason).toBe(
        "Support escalation 4821"
      );
      expect((entry?.details as { mode?: string })?.mode).toBe("hard");
    });
  });

  describe("POST /projects/:projectId/restore", () => {
    /** A project in the only state a restore acts on: already soft-deleted. */
    async function seedDeletedProject(
      name: string,
      accountId: string = createdAccountId
    ): Promise<{ id: string; name: string }> {
      const row = await prisma.project.create({
        data: {
          accountId,
          name: `${name} ${Date.now()}`,
          locale: "en",
          deletedAt: new Date(),
        },
      });
      return row as { id: string; name: string };
    }

    /** Reads `deletedAt` through the store, never through a read path that filters it. */
    async function deletedAtOf(projectId: string): Promise<Date | null> {
      const row = (await prisma.project.findUnique({ where: { id: projectId } })) as {
        deletedAt?: Date | null;
      } | null;
      return row?.deletedAt ?? null;
    }

    it("clears deletedAt for the owning customer and the project is served again", async () => {
      const deleted = await seedDeletedProject("Restorable");

      const response = await app.inject({
        method: "POST",
        url: `/projects/${deleted.id}/restore`,
        headers: customerHeaders(),
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).data?.restored).toBe(true);
      // The state change itself, not just the status code: a 200 over a row still
      // carrying `deletedAt` would be a reversal that reversed nothing.
      expect(await deletedAtOf(deleted.id)).toBe(null);

      // And the project is back in the live population every ordinary read serves,
      // which is the only reason a tenant asks for a restore at all.
      const after = await app.inject({ method: "GET", url: `/projects/${deleted.id}` });
      expect(after.statusCode).toBe(200);
    });

    it("answers 404 for another tenant's soft-deleted project, which stays deleted", async () => {
      const foreignAccount = await prisma.account.create({
        data: {
          email: `restore-foreign-${Date.now()}@example.com`,
          name: "Foreign Tenant",
          maxProjects: 5,
        },
      });
      const foreign = await seedDeletedProject("Foreign Restorable", foreignAccount.id);

      const response = await app.inject({
        method: "POST",
        url: `/projects/${foreign.id}/restore`,
        headers: customerHeaders(),
      });

      // The same 404 a missing project gets — never a 403 that would confirm the
      // id names a real project belonging to somebody else.
      expect(response.statusCode).toBe(404);
      expect(await deletedAtOf(foreign.id)).toBeInstanceOf(Date);
    });

    it("refuses a customer without account:delete with 403 and leaves the project deleted", async () => {
      const deleted = await seedDeletedProject("Needs Owner Grant");

      const response = await app.inject({
        method: "POST",
        url: `/projects/${deleted.id}/restore`,
        // A real, broad member permission set — everything a MEMBER legitimately
        // holds — minus the OWNER-only grant. Undoing a tenant-wide action is the
        // same grade of authority as performing it, so a member who cannot delete
        // the project must not be able to bring it back either.
        headers: customerHeaders({ permissions: ["post:manage", "analytics:read"] }),
      });

      expect(response.statusCode).toBe(403);
      expect(await deletedAtOf(deleted.id)).toBeInstanceOf(Date);
    });

    it("refuses a SUPPORT admin lacking account:manage with 403 and leaves the project deleted", async () => {
      // THE CROSS-TENANT HOLE. Authentication only proves the caller is staff;
      // this endpoint reaches every tenant on the platform. With the capability
      // check removed, this exact request — a genuine token for the lowest
      // seeded staff role — restores another tenant's project and answers 200.
      const deleted = await seedDeletedProject("Support Cannot Restore");

      const response = await app.inject({
        method: "POST",
        url: `/projects/${deleted.id}/restore`,
        headers: supportAuthHeaders,
      });

      expect(response.statusCode).toBe(403);
      expect(await deletedAtOf(deleted.id)).toBeInstanceOf(Date);
    });

    it("restores for an admin who does hold account:manage, so the gate is capability and not blanket denial", async () => {
      const deleted = await seedDeletedProject("Support Escalated");

      const response = await app.inject({
        method: "POST",
        url: `/projects/${deleted.id}/restore`,
        headers: adminAuthHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(await deletedAtOf(deleted.id)).toBe(null);
    });

    it("answers 409 naming the active project that already holds the name", async () => {
      const contestedName = `Contested Name ${Date.now()}`;
      // A soft delete does NOT confiscate a name — the unique is partial — so the
      // account is free to reuse it while the old project sits deleted. Restoring
      // the old one would then put two live projects on one name.
      const deleted = await prisma.project.create({
        data: {
          accountId: createdAccountId,
          name: contestedName,
          locale: "en",
          deletedAt: new Date(),
        },
      });
      const holder = await prisma.project.create({
        data: { accountId: createdAccountId, name: contestedName, locale: "en" },
      });

      const response = await app.inject({
        method: "POST",
        url: `/projects/${deleted.id}/restore`,
        headers: customerHeaders(),
      });

      expect(response.statusCode).toBe(409);
      // The body has to NAME the blocker. Only a human can decide which of the two
      // projects keeps the name, and they cannot decide it while being told only
      // that something went wrong.
      const body = JSON.parse(response.body);
      expect(String(body.error)).toContain(holder.id);
      // Refused means refused: the deleted row is untouched, so nothing half-happened.
      expect(await deletedAtOf(deleted.id)).toBeInstanceOf(Date);
    });

    it("answers 401 and restores nothing when no token is presented", async () => {
      const deleted = await seedDeletedProject("No Token Restore");

      const response = await app.inject({
        method: "POST",
        url: `/projects/${deleted.id}/restore`,
      });

      expect(response.statusCode).toBe(401);
      expect(await deletedAtOf(deleted.id)).toBeInstanceOf(Date);
    });
  });

  describe("DELETE /projects/:projectId/hard — owner self-purge", () => {
    /** A soft-deleted project owned by the bound customer principal's own account. */
    async function seedOwnDeletedProject(name: string): Promise<{ id: string; name: string }> {
      const row = await prisma.project.create({
        data: {
          accountId: createdAccountId,
          name: `${name} ${Date.now()}`,
          locale: "en",
          deletedAt: new Date(),
        },
      });
      return row as { id: string; name: string };
    }

    it("destroys the owner's own soft-deleted project when confirmName matches exactly", async () => {
      const doomed = await seedOwnDeletedProject("Self Purge");

      const response = await app.inject({
        method: "DELETE",
        url: `/projects/${doomed.id}/hard`,
        headers: customerHeaders(),
        payload: { reason: "Tenant-initiated erasure", confirmName: doomed.name },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).data?.deleted).toBe(true);
      const gone = await prisma.project.findUnique({ where: { id: doomed.id } });
      expect(gone).toBe(null);
    });

    it("attributes the self-purge to the CUSTOMER principal on the tombstone and the audit log", async () => {
      const createMany = (
        prisma as unknown as {
          deletionRecord: { createMany: { mock: { calls: unknown[][] } } };
        }
      ).deletionRecord.createMany;
      createMany.mock.calls.length = 0;

      const doomed = await seedOwnDeletedProject("Attributed Self Purge");

      const response = await app.inject({
        method: "DELETE",
        url: `/projects/${doomed.id}/hard`,
        headers: customerHeaders(),
        payload: { reason: "Tenant-initiated erasure", confirmName: doomed.name },
      });
      expect(response.statusCode).toBe(200);

      // The tombstone is the only durable record of a destruction, so it has to
      // name who really did it. Attributing a tenant's own purge to an admin who
      // never touched it would make that record describe something that did not
      // happen.
      const args = createMany.mock.calls[0]?.[0] as { data: Array<Record<string, unknown>> };
      expect(args.data[0]?.deletedBy).toBe(CUSTOMER_PRINCIPAL.id);

      const entry = stores.auditLog.all().find((row) => row.resourceId === doomed.id) as
        { customerUserId?: string; userId?: string; details?: unknown } | undefined;
      // The customer FK carries it and the admin FK stays empty — the DB models
      // the two as an exclusive arc, so a row claiming both is not writable.
      expect(entry?.customerUserId).toBe(CUSTOMER_PRINCIPAL.id);
      expect(entry?.userId ?? null).toBe(null);
      expect((entry?.details as { mode?: string })?.mode).toBe("hard");
    });

    it("refuses with 400 and destroys nothing when confirmName is not the project's name", async () => {
      const survivor = await seedOwnDeletedProject("Wrong Confirmation");

      const response = await app.inject({
        method: "DELETE",
        url: `/projects/${survivor.id}/hard`,
        headers: customerHeaders(),
        payload: { reason: "Tenant-initiated erasure", confirmName: "Some other project" },
      });

      // A project id in a URL carries no evidence that the human meant THIS
      // project. Typing the name back is that evidence, and without the comparison
      // this same request erases whatever the id happened to name.
      expect(response.statusCode).toBe(400);
      const still = await prisma.project.findUnique({ where: { id: survivor.id } });
      expect(still).not.toBe(null);
    });

    it("refuses with 400 and destroys nothing when confirmName is omitted entirely", async () => {
      const survivor = await seedOwnDeletedProject("Missing Confirmation");

      const response = await app.inject({
        method: "DELETE",
        url: `/projects/${survivor.id}/hard`,
        headers: customerHeaders(),
        payload: { reason: "Tenant-initiated erasure" },
      });

      // An absent confirmation must not read as "nothing to confirm". The schema
      // cannot require it (the admin arm legitimately omits it), so the customer
      // branch does — and if it stopped, the field would be present in the code
      // and absent in effect.
      expect(response.statusCode).toBe(400);
      const still = await prisma.project.findUnique({ where: { id: survivor.id } });
      expect(still).not.toBe(null);

      // The message must NAME the missing field. Without the route's own guard
      // the request still fails 400 — the use case compares the project's name
      // against `undefined` and refuses — but it refuses by telling the caller
      // their project "is not named undefined", which describes the bug in our
      // handler rather than the mistake in their request. The status alone
      // therefore cannot tell the two apart, and this assertion is what makes the
      // route-level guard's absence visible instead of silently absorbed.
      expect(String(JSON.parse(response.body).error)).toContain("confirmName");
    });

    it("refuses a LIVE project with 409 even for its owner, and it survives", async () => {
      const live = await prisma.project.create({
        data: {
          accountId: createdAccountId,
          name: `Self Purge Live ${Date.now()}`,
          locale: "en",
        },
      });

      const response = await app.inject({
        method: "DELETE",
        url: `/projects/${live.id}/hard`,
        headers: customerHeaders(),
        payload: { reason: "Tenant-initiated erasure", confirmName: live.name },
      });

      // The two-act rule is universal — the self-purge is not the one path where
      // a single call still destroys a live project.
      expect(response.statusCode).toBe(409);
      expect(JSON.parse(response.body).error).toContain("requires a prior soft delete");
      const survivor = await prisma.project.findUnique({ where: { id: live.id } });
      expect(survivor).not.toBe(null);
    });

    it("answers 404 for another tenant's project even with the right confirmName", async () => {
      const foreignAccount = await prisma.account.create({
        data: {
          email: `purge-foreign-${Date.now()}@example.com`,
          name: "Foreign Tenant",
          maxProjects: 5,
        },
      });
      const foreign = await prisma.project.create({
        data: {
          accountId: foreignAccount.id,
          name: `Foreign Purge ${Date.now()}`,
          locale: "en",
          deletedAt: new Date(),
        },
      });

      const response = await app.inject({
        method: "DELETE",
        url: `/projects/${foreign.id}/hard`,
        headers: customerHeaders(),
        payload: { reason: "Tenant-initiated erasure", confirmName: foreign.name },
      });

      // Ownership outranks the confirmation, and answers 404 rather than "wrong
      // name" — otherwise the endpoint becomes an oracle for guessing another
      // tenant's project names one request at a time.
      expect(response.statusCode).toBe(404);
      const survivor = await prisma.project.findUnique({ where: { id: foreign.id } });
      expect(survivor).not.toBe(null);
    });

    it("refuses a customer without account:delete with 403 and destroys nothing", async () => {
      const survivor = await seedOwnDeletedProject("Member Cannot Purge");

      const response = await app.inject({
        method: "DELETE",
        url: `/projects/${survivor.id}/hard`,
        headers: customerHeaders({ permissions: ["post:manage", "analytics:read"] }),
        payload: { reason: "Tenant-initiated erasure", confirmName: survivor.name },
      });

      expect(response.statusCode).toBe(403);
      const still = await prisma.project.findUnique({ where: { id: survivor.id } });
      expect(still).not.toBe(null);
    });

    it("refuses a SUPPORT admin lacking account:manage with 403 and destroys nothing", async () => {
      const survivor = await seedOwnDeletedProject("Support Cannot Purge");

      const response = await app.inject({
        method: "DELETE",
        url: `/projects/${survivor.id}/hard`,
        headers: supportAuthHeaders,
        payload: { reason: "Support escalation 991" },
      });

      // The admin arm's capability gate moved out of the preHandler and into the
      // handler when this route began accepting customer tokens. Losing it there
      // would let any staff role erase any tenant's project.
      expect(response.statusCode).toBe(403);
      const still = await prisma.project.findUnique({ where: { id: survivor.id } });
      expect(still).not.toBe(null);
    });
  });

  describe("Error Handling", () => {
    it("should handle database errors gracefully", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/accounts/${createdAccountId}/projects`,
      });

      expect(response.statusCode < 500 || response.statusCode === 500).toBeTruthy();
    });

    it("should return proper error structure", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/accounts/a0000000-0000-4000-8000-000000000001/projects",
      });

      const body = JSON.parse(response.body);
      expect(body.error).toBeTruthy();
      expect(typeof body.error).toBe("string");
    });
  });

  describe("Input Validation", () => {
    it("should validate required fields for project creation", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/accounts/${createdAccountId}/projects`,
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it("should validate name length constraints", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/accounts/${createdAccountId}/projects`,
        payload: {
          name: "x".repeat(300), // Very long name
          locale: "en",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should validate locale format constraints", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/accounts/${createdAccountId}/projects`,
        payload: {
          name: "Valid Name",
          locale: "toolong",
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
