/**
 * @file accountRoutesTenantIsolation.test.ts
 * @description Cross-tenant (CWE-639 / IDOR-ACCOUNTS) regression tests for the
 *              account routes. Account IS the tenant root, so the gate is a
 *              direct token-vs-URL identity check: a customer authenticated for
 *              account A must not be able to GET / PUT / DELETE account B, and
 *              `GET /accounts` must return only the caller's own account. A
 *              mismatched `:accountId` resolves to NOT_FOUND (anti-enumeration —
 *              same shape as a missing account, so existence does not leak).
 *
 *              The auth middleware is mocked to set `request.customerUser` from
 *              an `x-test-account` header so each request can simulate a
 *              specific caller tenant.
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";

vi.mock("../../src/auth/customerAuthMiddleware.js", () => ({
  // Simulate an authenticated customer whose accountId is supplied via header.
  requireClientAuth: async (request: {
    headers: Record<string, unknown>;
    customerUser?: unknown;
  }) => {
    const accountId = request.headers["x-test-account"];
    if (typeof accountId === "string" && accountId.length > 0) {
      (request as Record<string, unknown>).customerUser = {
        id: "caller-user",
        accountId,
        roleId: "role-owner",
        roleName: "OWNER",
        permissions: [],
      };
    }
  },
}));

import { createMockPrismaModule } from "./helpers/mockPrisma.js";

const { mockPrisma, stores } = createMockPrismaModule();

const originalFindUnique = mockPrisma.prisma.account.findUnique;
mockPrisma.prisma.account.findUnique = vi.fn(
  async (args: { where: Record<string, unknown>; include?: Record<string, unknown> }) => {
    const result = await originalFindUnique(args);
    if (!result) return null;
    if (args.include?.projects) {
      const projects = stores.project.all().filter((p) => p.accountId === result.id);
      (result as Record<string, unknown>).projects = projects;
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
  return { logger: noopLogger, authLogger: noopLogger, createLogger: () => noopLogger };
});

const Fastify = (await import("fastify")).default;
const { serializerCompiler, validatorCompiler } = await import("fastify-type-provider-zod");
const { accountRoutes } = await import("../../src/accounts/accountRoutes.js");
const { setupContainer } = await import("../../src/infrastructure/container/setup.js");

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

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

const timestamp = Date.now();

let app: FastifyInstance;
let accountA: string;
let accountB: string;

describe("accountRoutes — tenant isolation (IDOR-ACCOUNTS, CWE-639)", () => {
  beforeAll(async () => {
    app = await createTestApp();

    const a = await (mockPrisma.prisma.account as { create: Function }).create({
      data: { email: `tenant-a-${timestamp}@example.com`, name: "Tenant A", maxProjects: 1 },
    });
    accountA = a.id;
    const b = await (mockPrisma.prisma.account as { create: Function }).create({
      data: { email: `tenant-b-${timestamp}@example.com`, name: "Tenant B", maxProjects: 1 },
    });
    accountB = b.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /accounts/:accountId", () => {
    it("returns not-found when tenant A reads tenant B's account", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/accounts/${accountB}`,
        headers: { "x-test-account": accountA },
      });
      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);
    });

    it("returns the account when the owning tenant reads its own account", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/accounts/${accountA}`,
        headers: { "x-test-account": accountA },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data?.id).toBe(accountA);
    });
  });

  describe("PUT /accounts/:accountId", () => {
    it("returns not-found and does not mutate when tenant A updates tenant B's account", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/accounts/${accountB}`,
        headers: { "x-test-account": accountA },
        payload: { name: "Hijacked" },
      });
      expect(response.statusCode).toBe(404);

      // Confirm B's name is untouched.
      const stored = await (mockPrisma.prisma.account as { findUnique: Function }).findUnique({
        where: { id: accountB },
      });
      expect(stored?.name).toBe("Tenant B");
    });
  });

  describe("DELETE /accounts/:accountId", () => {
    it("returns not-found and does not delete when tenant A deletes tenant B's account", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: `/accounts/${accountB}`,
        headers: { "x-test-account": accountA },
      });
      expect(response.statusCode).toBe(404);

      const stored = await (mockPrisma.prisma.account as { findUnique: Function }).findUnique({
        where: { id: accountB },
      });
      expect(stored).toBeTruthy();
    });
  });

  describe("GET /accounts", () => {
    it("returns only the caller's own account, never every tenant's", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/accounts",
        headers: { "x-test-account": accountA },
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      const ids = (body.data as Array<{ id: string }>).map((a) => a.id);
      expect(ids).toContain(accountA);
      expect(ids).not.toContain(accountB);
    });
  });
});
