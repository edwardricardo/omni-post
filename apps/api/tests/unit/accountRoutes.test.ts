/**
 * @file accountRoutes.test.ts
 * @description Unit tests for accountRoutes.
 *              Uses in-memory mocked Prisma stores — no real database needed.
 * @layer test
 */

import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";
import { createMockPrismaModule } from "./helpers/mockPrisma.js";

// ---------------------------------------------------------------------------
// Mock setup — must come BEFORE any SUT imports
// ---------------------------------------------------------------------------

const { mockPrisma, stores } = createMockPrismaModule();

// accountRoutes uses include: { projects: true } and include: { _count: ... }
// Build an include resolver for the account model
const originalFindUnique = mockPrisma.prisma.account.findUnique;
mockPrisma.prisma.account.findUnique = vi.fn(
  async (args: { where: Record<string, unknown>; include?: Record<string, unknown> }) => {
    const result = await originalFindUnique(args);
    if (!result) return null;

    if (args.include?.projects) {
      const projects = stores.project.all().filter((p) => p.accountId === result.id);
      (result as Record<string, unknown>).projects = projects;
    }
    if (args.include?._count) {
      const projectCount = stores.project.all().filter((p) => p.accountId === result.id).length;
      (result as Record<string, unknown>)._count = { projects: projectCount };
    }
    return result;
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
    if (args?.include?.projects) {
      for (const result of results) {
        const projects = stores.project.all().filter((p) => p.accountId === result.id);
        (result as Record<string, unknown>).projects = projects;
      }
    }
    return results;
  }
);

// Add models used by delete handler
const noopDeleteMany = vi.fn(async () => ({ count: 0 }));
const prismaAny = mockPrisma.prisma as Record<string, unknown>;
prismaAny.postContent = { deleteMany: noopDeleteMany };
prismaAny.postMedia = { deleteMany: noopDeleteMany };
prismaAny.post = { deleteMany: noopDeleteMany };
prismaAny.channel = { deleteMany: noopDeleteMany };

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
      expect(body.data?.subscription).toBe("BASIC");
      expect(body.data?.maxProjects).toBe(1); // BASIC tier default
      expect(body.data?.isOnTrial).toBe(true);

      testAccountId = body.data?.id || "";
    });

    it("should create PRO account with correct maxProjects", async () => {
      const proEmail = `pro-${testEmail}`;
      const response = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          email: proEmail,
          name: testName,
          subscription: "PRO",
        },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.data?.subscription).toBe("PRO");
      expect(body.data?.maxProjects).toBe(3); // PRO tier default
    });

    it("should create ENTERPRISE account with correct maxProjects", async () => {
      const enterpriseEmail = `enterprise-${testEmail}`;
      const response = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          email: enterpriseEmail,
          name: testName,
          subscription: "ENTERPRISE",
        },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.data?.subscription).toBe("ENTERPRISE");
      expect(body.data?.maxProjects).toBe(10); // ENTERPRISE tier default
    });

    it("should create account with custom maxProjects", async () => {
      const customEmail = `custom-${testEmail}`;
      const response = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          email: customEmail,
          name: testName,
          subscription: "PRO",
          maxProjects: 5,
        },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.data?.maxProjects).toBe(5); // Custom value
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

    it("should reject invalid subscription tier", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/accounts",
        payload: {
          email: `invalid-sub-${testEmail}`,
          name: testName,
          subscription: "INVALID_TIER",
        },
      });

      expect(response.statusCode).toBe(400);
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

    it("should update account subscription tier", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/accounts/${testAccountId}`,
        payload: {
          subscription: "PRO",
        },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.data?.subscription).toBe("PRO");
      expect(body.data?.maxProjects).toBe(3); // Auto-updated to PRO default
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

    it("should update subscription without overriding explicit maxProjects", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/accounts/${testAccountId}`,
        payload: {
          subscription: "ENTERPRISE",
          maxProjects: 15,
        },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.data?.subscription).toBe("ENTERPRISE");
      expect(body.data?.maxProjects).toBe(15); // Explicit value preserved
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

    it("should reject invalid subscription tier", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/accounts/${testAccountId}`,
        payload: {
          subscription: "INVALID_TIER",
        },
      });

      expect(response.statusCode).toBe(400);
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
});
