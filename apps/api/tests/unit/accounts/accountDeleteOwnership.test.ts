/**
 * @file accountDeleteOwnership.test.ts
 * @description Ownership tests for `DELETE /accounts/:accountId`, the customer
 *   soft-delete surface. The route carries `requireClientAuth` and nothing else,
 *   and `Account` is structurally outside the Prisma tenant guard — it IS the
 *   tenant, so it has no `accountId` column and cannot be enrolled in
 *   `TENANT_SCOPED_MODELS` (verified against the guard's own pure function in
 *   `tests/unit/security/tenantGuard.test.ts`: `Account` bypasses). No isolation
 *   layer below the handler can therefore refuse a foreign account id, which
 *   makes the comparison in the handler the ONLY thing standing between one
 *   tenant's bearer token and another tenant's destruction.
 *
 *   These tests drive the REAL `requireClientAuth` with genuinely signed
 *   customer tokens rather than mocking it. `tests/unit/accountRoutes.test.ts`
 *   mocks that middleware to a no-op, which is why it can assert the delete
 *   works but can never assert WHOSE account it worked on — and a mock that
 *   fabricates a principal proves an authorization the running system does not
 *   perform (the phantom `request.adminUser` precedent recorded in that file).
 * @layer infrastructure
 */

import { describe, it, beforeEach, afterAll, expect, vi } from "vitest";
import { createMockPrismaModule } from "../helpers/mockPrisma.js";

// ---------------------------------------------------------------------------
// Mock setup — must come BEFORE any SUT import
// ---------------------------------------------------------------------------

const { mockPrisma, stores } = createMockPrismaModule();

// `include: { projects: { select: { id: true } } }` on the handler's existence
// probe. The double answers with the victim's real project rows so that, if the
// handler proceeds, it proceeds with genuine ids to destroy — an empty include
// would make the destruction look harmless for the wrong reason.
const originalAccountFindUnique = mockPrisma.prisma.account.findUnique;
mockPrisma.prisma.account.findUnique = vi.fn(
  async (args: { where: Record<string, unknown>; include?: Record<string, unknown> }) => {
    const result = (await originalAccountFindUnique(args)) as Record<string, unknown> | null;
    if (!result) return null;
    if (args.include?.projects) {
      result.projects = stores.project.all().filter((p) => p.accountId === result.id);
    }
    return result;
  }
);

// The four leaf-first `deleteMany` calls the handler issues before it deletes the
// account row. They are spies, not no-ops with a shrug: `post`, `postContent` and
// `postMedia` are ALSO absent from `TENANT_SCOPED_MODELS`, so in production these
// three statements destroy the victim's rows outright, ahead of the cascade. A
// test that only checked the account row would call the breach "contained" while
// the posts were already gone.
const postContentDeleteMany = vi.fn(async () => ({ count: 0 }));
const postMediaDeleteMany = vi.fn(async () => ({ count: 0 }));
const postDeleteMany = vi.fn(async () => ({ count: 0 }));
const channelDeleteMany = vi.fn(async () => ({ count: 0 }));

const prismaAny = mockPrisma.prisma as Record<string, unknown>;
prismaAny.postContent = { deleteMany: postContentDeleteMany };
prismaAny.postMedia = { deleteMany: postMediaDeleteMany };
prismaAny.post = {
  deleteMany: postDeleteMany,
  findMany: vi.fn(async () => []),
  count: vi.fn(async () => 0),
};
prismaAny.channel = { deleteMany: channelDeleteMany };
prismaAny.task = { count: vi.fn(async () => 0) };
prismaAny.deletionRecord = {
  createMany: vi.fn(async (args: { data: unknown[] }) => ({ count: args.data.length })),
};

vi.mock("@infra/prisma", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, prisma: mockPrisma.prisma };
});

vi.mock("../../../src/lib/logger.js", () => {
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

// ---------------------------------------------------------------------------
// SUT imports (after mocks)
// ---------------------------------------------------------------------------

const Fastify = (await import("fastify")).default;
const { serializerCompiler, validatorCompiler } = await import("fastify-type-provider-zod");
const { accountRoutes } = await import("../../../src/accounts/accountRoutes.js");
const { setupContainer } = await import("../../../src/infrastructure/container/setup.js");
const { signCustomerAccessToken } = await import("../../../src/auth/customerJwt.js");

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** An account id that has never existed — the "missing" arm of the anti-enumeration pair. */
const ABSENT_ACCOUNT_ID = "a0000000-0000-4000-8000-000000000000";

interface Tenant {
  accountId: string;
  projectId: string;
  token: string;
}

async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  typedApp.setValidatorCompiler(validatorCompiler);
  typedApp.setSerializerCompiler(serializerCompiler);
  typedApp.decorate("container", setupContainer({ prisma: mockPrisma.prisma as never }));
  await typedApp.register(accountRoutes);
  return typedApp;
}

/**
 * Seeds one account with one project and mints a REAL customer access token
 * scoped to it — the same token shape `requireClientAuth` verifies in production.
 */
async function makeTenant(label: string): Promise<Tenant> {
  const account = (await mockPrisma.prisma.account.create({
    data: {
      email: `${label}-${Date.now()}-${Math.random()}@example.com`,
      name: `Tenant ${label}`,
      maxProjects: 1,
    },
  })) as { id: string };

  const project = stores.project.add({
    accountId: account.id,
    name: `${label} project`,
    deletedAt: null,
  });

  // A REAL OWNER token: the seeded OWNER role carries `account:delete`
  // (`infra/prisma/seed.ts`), and the handler now asserts that grant. Minting
  // an "OWNER" without it would contradict the seed and would make these tests
  // pass for the wrong reason — refused for lacking a permission rather than
  // for reaching across tenants, which is the only thing this suite is about.
  // The permission gate itself is pinned in `accountDeletePermission.test.ts`.
  const token = signCustomerAccessToken({
    sub: `user-${label}`,
    accountId: account.id,
    roleId: "role-owner",
    roleName: "OWNER",
    permissions: ["account:manage", "account:delete"],
  });

  return { accountId: account.id, projectId: project.id as string, token };
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

let app: FastifyInstance;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DELETE /accounts/:accountId — tenant ownership", () => {
  beforeEach(async () => {
    app ??= await createTestApp();
    postContentDeleteMany.mockClear();
    postMediaDeleteMany.mockClear();
    postDeleteMany.mockClear();
    channelDeleteMany.mockClear();
  });

  afterAll(async () => {
    await app.close();
  });

  it("refuses to delete another tenant's account and leaves that account intact", async () => {
    const attacker = await makeTenant("attacker");
    const victim = await makeTenant("victim");

    const response = await app.inject({
      method: "DELETE",
      url: `/accounts/${victim.accountId}`,
      headers: bearer(attacker.token),
    });

    expect(response.statusCode).toBe(404);

    const survivor = await mockPrisma.prisma.account.findUnique({
      where: { id: victim.accountId },
    });
    expect(survivor).not.toBe(null);
  });

  it("destroys none of the victim's children when a foreign tenant asks", async () => {
    const attacker = await makeTenant("attacker-children");
    const victim = await makeTenant("victim-children");

    await app.inject({
      method: "DELETE",
      url: `/accounts/${victim.accountId}`,
      headers: bearer(attacker.token),
    });

    // The three unguarded leaf deletes must never have been issued. In
    // production `post`, `postContent` and `postMedia` have no tenant guard at
    // all, so reaching these lines with the victim's project ids IS the breach,
    // independently of whether the final `account.delete` succeeds.
    expect(postContentDeleteMany).not.toHaveBeenCalled();
    expect(postMediaDeleteMany).not.toHaveBeenCalled();
    expect(postDeleteMany).not.toHaveBeenCalled();
    expect(channelDeleteMany).not.toHaveBeenCalled();
  });

  it("answers a foreign account id exactly as it answers a missing one", async () => {
    const attacker = await makeTenant("attacker-enum");
    const victim = await makeTenant("victim-enum");

    const foreign = await app.inject({
      method: "DELETE",
      url: `/accounts/${victim.accountId}`,
      headers: bearer(attacker.token),
    });
    const missing = await app.inject({
      method: "DELETE",
      url: `/accounts/${ABSENT_ACCOUNT_ID}`,
      headers: bearer(attacker.token),
    });

    // Anti-enumeration: a distinguishable answer (403 vs 404, or a different
    // body) confirms to an attacker that the id names a real tenant.
    expect(foreign.statusCode).toBe(missing.statusCode);
    expect(foreign.body).toBe(missing.body);
  });

  it("still lets a customer delete their own account", async () => {
    const owner = await makeTenant("self");

    const response = await app.inject({
      method: "DELETE",
      url: `/accounts/${owner.accountId}`,
      headers: bearer(owner.token),
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).ok).toBe(true);

    const gone = await mockPrisma.prisma.account.findUnique({ where: { id: owner.accountId } });
    expect(gone).toBe(null);
  });

  it("refuses with 401 and destroys nothing when no customer token is present", async () => {
    const victim = await makeTenant("no-token");

    const response = await app.inject({
      method: "DELETE",
      url: `/accounts/${victim.accountId}`,
    });

    expect(response.statusCode).toBe(401);
    const survivor = await mockPrisma.prisma.account.findUnique({
      where: { id: victim.accountId },
    });
    expect(survivor).not.toBe(null);
  });
});
