/**
 * @file accountDeletePermission.test.ts
 * @description Permission tests for `DELETE /accounts/:accountId`. Ownership is
 *   NOT authorization: `accountDeleteOwnership.test.ts` pins that a FOREIGN
 *   tenant is refused, but every member of the account itself passes that
 *   comparison — VIEWER included. This suite pins the second gate, that the
 *   caller additionally holds the destructive grant.
 *
 *   Why it is load-bearing on this branch specifically: the ON DELETE
 *   convention flipped `Invoice.accountId` and `Referral.referralCodeId` from
 *   RESTRICT to CASCADE/SET NULL. Before it, the database itself refused to
 *   delete any account that had ever been billed or referred, so a
 *   low-privilege caller got a 500 and destroyed nothing. After it, the same
 *   call completes and cascades through the account's children. The
 *   authorization did not change; the blast radius did.
 *
 *   `account:delete` is the real grant, not an invented one: seeded to OWNER
 *   only (`infra/prisma/seed.ts:534`), mirrored in the OWNER test helper
 *   (`tests/unit/helpers/seedCustomerRoles.ts:58`), and MANAGER is defined as
 *   "everything except billing, account deletion, and role assignment".
 *
 *   These tests drive the REAL `requireClientAuth` with genuinely signed
 *   tokens, following `accountDeleteOwnership.test.ts`. The file-level auth
 *   mock in `accountRoutes.test.ts` authenticates a fixed principal and so
 *   cannot vary permissions — the exact axis under test here.
 * @layer infrastructure
 */

import { describe, it, beforeEach, afterAll, expect, vi } from "vitest";
import { createMockPrismaModule } from "../helpers/mockPrisma.js";

// ---------------------------------------------------------------------------
// Mock setup — must come BEFORE any SUT import
// ---------------------------------------------------------------------------

const { mockPrisma, stores } = createMockPrismaModule();

// Mirrors the handler's existence probe (`include: { projects: ... }`) so that a
// caller who gets past the gates proceeds with REAL project ids to destroy. An
// empty include would make a failure to refuse look harmless for the wrong reason.
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

// The four leaf-first `deleteMany` calls the handler issues before the account
// row itself. `post`, `postContent` and `postMedia` are absent from
// `TENANT_SCOPED_MODELS`, so in production reaching these lines already destroys
// rows — ahead of any cascade. Asserting only on the account row would call a
// breach "contained" while the posts were gone.
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

/** The destructive grant, seeded to OWNER only. */
const ACCOUNT_DELETE = "account:delete";

/**
 * The MEMBER-shaped set: real, broad, operationally useful permissions that
 * nonetheless stop short of account destruction. Deliberately NOT an empty
 * array — an empty set would pass a check that merely tests for "some
 * permissions" rather than for the specific grant.
 */
const MEMBER_PERMISSIONS: readonly string[] = [
  "post:read",
  "post:create",
  "post:edit",
  "post:publish",
  "post:delete",
  "channel:read",
  "channel:manage",
  "analytics:read",
  "member:read",
  "account:read",
  "account:manage",
];

/** The OWNER-shaped set: MEMBER plus the destructive grant. */
const OWNER_PERMISSIONS: readonly string[] = [...MEMBER_PERMISSIONS, ACCOUNT_DELETE];

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
 * carrying exactly `permissions` — the same token shape `requireClientAuth`
 * verifies in production.
 */
async function makeTenant(label: string, permissions: readonly string[]): Promise<Tenant> {
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

  const token = signCustomerAccessToken({
    sub: `user-${label}`,
    accountId: account.id,
    roleId: permissions.includes(ACCOUNT_DELETE) ? "role-owner" : "role-member",
    roleName: permissions.includes(ACCOUNT_DELETE) ? "OWNER" : "MEMBER",
    permissions,
  });

  return { accountId: account.id, projectId: project.id as string, token };
}

/**
 * Mints a token whose payload carries NO `permissions` claim at all.
 * `verifyCustomerToken` casts the decoded payload with `as CustomerJwtPayload`
 * and validates nothing at runtime, so this token reaches the handler with
 * `principal.permissions === undefined` — a real runtime path, not a
 * hypothetical one.
 */
async function makeTenantWithoutPermissionsClaim(label: string): Promise<Tenant> {
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

  // canon-exception: test-fixture — the signer's type demands `permissions`;
  // constructing a token that OMITS it is precisely the invalid state under test.
  const token = signCustomerAccessToken({
    sub: `user-${label}`,
    accountId: account.id,
    roleId: "role-legacy",
    roleName: "OWNER",
    permissions: undefined as unknown as readonly string[],
  });

  return { accountId: account.id, projectId: project.id as string, token };
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function expectNoChildDestruction(): void {
  expect(postContentDeleteMany).not.toHaveBeenCalled();
  expect(postMediaDeleteMany).not.toHaveBeenCalled();
  expect(postDeleteMany).not.toHaveBeenCalled();
  expect(channelDeleteMany).not.toHaveBeenCalled();
}

let app: FastifyInstance;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DELETE /accounts/:accountId — destructive permission", () => {
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

  it("refuses a member of the account who lacks account:delete, and the account survives", async () => {
    const member = await makeTenant("member", MEMBER_PERMISSIONS);

    const response = await app.inject({
      method: "DELETE",
      url: `/accounts/${member.accountId}`,
      headers: bearer(member.token),
    });

    // 403, not 404: this caller owns the account and already knows it exists,
    // so refusing by capability leaks nothing the caller did not supply.
    expect(response.statusCode).toBe(403);

    const survivor = await mockPrisma.prisma.account.findUnique({
      where: { id: member.accountId },
    });
    expect(survivor).not.toBe(null);
  });

  it("destroys none of the account's children when the caller lacks account:delete", async () => {
    const member = await makeTenant("member-children", MEMBER_PERMISSIONS);

    await app.inject({
      method: "DELETE",
      url: `/accounts/${member.accountId}`,
      headers: bearer(member.token),
    });

    expectNoChildDestruction();
  });

  it("refuses a token carrying no permissions claim at all, and the account survives", async () => {
    const legacy = await makeTenantWithoutPermissionsClaim("legacy");

    const response = await app.inject({
      method: "DELETE",
      url: `/accounts/${legacy.accountId}`,
      headers: bearer(legacy.token),
    });

    expect(response.statusCode).toBe(403);
    expectNoChildDestruction();

    const survivor = await mockPrisma.prisma.account.findUnique({
      where: { id: legacy.accountId },
    });
    expect(survivor).not.toBe(null);
  });

  it("refuses a token carrying an empty permissions array, and the account survives", async () => {
    const stripped = await makeTenant("stripped", []);

    const response = await app.inject({
      method: "DELETE",
      url: `/accounts/${stripped.accountId}`,
      headers: bearer(stripped.token),
    });

    // The empty set must refuse. A `?? []` style default that treats "no
    // permissions" as "nothing to check" would let this through.
    expect(response.statusCode).toBe(403);
    expectNoChildDestruction();

    const survivor = await mockPrisma.prisma.account.findUnique({
      where: { id: stripped.accountId },
    });
    expect(survivor).not.toBe(null);
  });

  it("still lets an owner holding account:delete delete their own account — softly", async () => {
    const owner = await makeTenant("owner", OWNER_PERMISSIONS);

    const response = await app.inject({
      method: "DELETE",
      url: `/accounts/${owner.accountId}`,
      headers: bearer(owner.token),
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).ok).toBe(true);

    // Soft delete: the row is PRESENT and carries deletedAt. The previous
    // version of this test pinned the hard-delete-by-default defect as the
    // contract (`expect(gone).toBe(null)`).
    const survivor = (await mockPrisma.prisma.account.findUnique({
      where: { id: owner.accountId },
    })) as { deletedAt?: Date | null } | null;
    expect(survivor).not.toBe(null);
    expect(survivor?.deletedAt).toBeInstanceOf(Date);
  });

  it("keeps answering a foreign account id with 404 even for an owner who holds account:delete", async () => {
    const attacker = await makeTenant("attacker-perm", OWNER_PERMISSIONS);
    const victim = await makeTenant("victim-perm", OWNER_PERMISSIONS);

    const response = await app.inject({
      method: "DELETE",
      url: `/accounts/${victim.accountId}`,
      headers: bearer(attacker.token),
    });

    // Ownership stays the dominant gate and keeps its anti-enumeration 404.
    // Holding the grant for YOUR account must never become a 403 hint that
    // SOMEONE ELSE'S account exists.
    expect(response.statusCode).toBe(404);
    expectNoChildDestruction();

    const survivor = await mockPrisma.prisma.account.findUnique({
      where: { id: victim.accountId },
    });
    expect(survivor).not.toBe(null);
  });
});
