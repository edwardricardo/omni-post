/**
 * @file accountReadUpdateAuthorization.test.ts
 * @description Authorization tests for the customer's "my account" surface: `GET` and
 *   `PUT /accounts/:accountId`, and the absence of the tenant listing `GET /accounts` and of
 *   customer account creation `POST /accounts`.
 *
 *   `Account` IS the tenant: it is keyed by `id`, not `accountId`, so it is absent from the
 *   Prisma tenant guard's `TENANT_SCOPED_MODELS` and every `account` query passes the guard
 *   untouched. Nothing below the route refuses a foreign account id, so the route's own gates
 *   are the only thing between one tenant's bearer token and another tenant's row.
 *
 *   The owner's rules (2026-10-18): any authenticated member reads their own account; renaming
 *   it needs `account:manage`, which the seed grants to OWNER alone; another tenant's account
 *   answers exactly as a missing one does, whatever the caller holds, so no answer tells a
 *   customer which ids name a real tenant; the project quota `maxProjects` is not a field a
 *   customer writes.
 *
 *   The suite drives the REAL `requireClientAuth` and `requireCustomerPermission` with genuinely
 *   signed customer tokens whose permission sets are the seeded roles' (`seedCustomerRoles.ts`,
 *   the verbatim mirror of `infra/prisma/seed.ts`), following `accountDeleteOwnership.test.ts`.
 * @layer infrastructure
 */

import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from "vitest";
import { createMockPrismaModule } from "../helpers/mockPrisma.js";
import { makeCustomerRoleSnapshot } from "../helpers/seedCustomerRoles.js";

// ---------------------------------------------------------------------------
// Mock setup — must come BEFORE any SUT import
// ---------------------------------------------------------------------------

const { mockPrisma, stores } = createMockPrismaModule();

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
const { createRouteTestContainer } = await import("../helpers/testContainer.js");
const { signCustomerAccessToken } = await import("../../../src/auth/customerJwt.js");

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** An account id that has never existed — the "missing" arm of the anti-enumeration pair. */
const ABSENT_ACCOUNT_ID = "a0000000-0000-4000-8000-000000000000";

/** The quota every fixture account is seeded with, so a write to it is visible. */
const SEEDED_MAX_PROJECTS = 3;

type SeededRole = "OWNER" | "MEMBER";

interface Tenant {
  accountId: string;
  name: string;
  email: string;
  token: string;
}

interface StoredAccount {
  name?: string;
  maxProjects?: number;
}

async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  typedApp.setValidatorCompiler(validatorCompiler);
  typedApp.setSerializerCompiler(serializerCompiler);
  typedApp.decorate("container", createRouteTestContainer({ prisma: mockPrisma.prisma as never }));
  await typedApp.register(accountRoutes);
  return typedApp;
}

/**
 * Seeds one live account with one project and mints a REAL customer access token for a member
 * of it holding exactly the seeded role's permissions — the token shape `requireClientAuth`
 * verifies in production.
 */
async function makeTenant(label: string, role: SeededRole): Promise<Tenant> {
  const name = `Tenant ${label}`;
  const email = `${label}-${Date.now()}-${Math.random()}@example.com`;
  const account = (await mockPrisma.prisma.account.create({
    data: { email, name, maxProjects: SEEDED_MAX_PROJECTS },
  })) as { id: string };

  stores.project.add({ accountId: account.id, name: `${label} project`, deletedAt: null });

  const snapshot = makeCustomerRoleSnapshot(role);
  const token = signCustomerAccessToken({
    sub: `user-${label}`,
    accountId: account.id,
    roleId: snapshot.roleId,
    roleName: snapshot.roleName,
    permissions: [...snapshot.permissions],
  });

  return { accountId: account.id, name, email, token };
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** Reads the row straight from the store, never through a route. */
function storedAccount(accountId: string): StoredAccount | undefined {
  return stores.account.get(accountId) as StoredAccount | undefined;
}

/**
 * Every `account` query the double received whose `where.id` named `accountId`. A refusal that
 * happens before the database leaves this empty; one that reads first and refuses after does
 * not, and that read is the existence probe the gate exists to deny.
 */
function accountQueriesNaming(accountId: string): unknown[] {
  const model = mockPrisma.prisma.account as unknown as Record<
    string,
    { mock?: { calls: unknown[][] } }
  >;
  return ["findFirst", "findUnique", "update", "updateMany"].flatMap((method) =>
    (model[method]?.mock?.calls ?? []).filter((call) => {
      const where = (call[0] as { where?: { id?: unknown } } | undefined)?.where;
      return where?.id === accountId;
    })
  );
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await createTestApp();
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterAll(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /accounts/:accountId — own account only", () => {
  it("returns 404 with the body of a missing account when the account is another tenant's", async () => {
    const attacker = await makeTenant("read-attacker", "OWNER");
    const victim = await makeTenant("read-victim", "OWNER");

    const foreign = await app.inject({
      method: "GET",
      url: `/accounts/${victim.accountId}`,
      headers: bearer(attacker.token),
    });
    const missing = await app.inject({
      method: "GET",
      url: `/accounts/${ABSENT_ACCOUNT_ID}`,
      headers: bearer(attacker.token),
    });

    expect(foreign.statusCode).toBe(404);
    // Anti-enumeration: a distinguishable answer confirms the id names a real tenant.
    expect(foreign.statusCode).toBe(missing.statusCode);
    expect(foreign.body).toBe(missing.body);
    expect(foreign.body).not.toContain(victim.email);
    // Refused before the database: no read probed whether the id exists.
    expect(accountQueriesNaming(victim.accountId)).toHaveLength(0);
  });

  it("returns the 404 body the handler gives the caller's own deleted account when the account is another tenant's", async () => {
    // The gate answers before the handler; the caller's own soft-deleted account passes the gate
    // and gets the handler's own not-found answer. The two must be the same bytes, or the body
    // would tell a foreign id from a missing one.
    const attacker = await makeTenant("read-gone-attacker", "OWNER");
    const victim = await makeTenant("read-gone-victim", "OWNER");
    const gone = await makeTenant("read-gone-own", "OWNER");
    stores.account.update(gone.accountId, { deletedAt: new Date() });

    const foreign = await app.inject({
      method: "GET",
      url: `/accounts/${victim.accountId}`,
      headers: bearer(attacker.token),
    });
    const ownGone = await app.inject({
      method: "GET",
      url: `/accounts/${gone.accountId}`,
      headers: bearer(gone.token),
    });

    expect(ownGone.statusCode).toBe(404);
    // The own account reached the handler, whose read found it deleted.
    expect(accountQueriesNaming(gone.accountId)).not.toHaveLength(0);
    expect(foreign.statusCode).toBe(404);
    expect(foreign.body).toBe(ownGone.body);
  });

  it("returns 200 with the account when a MEMBER without account:manage reads their own", async () => {
    const member = await makeTenant("read-member", "MEMBER");

    const response = await app.inject({
      method: "GET",
      url: `/accounts/${member.accountId}`,
      headers: bearer(member.token),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data?: { id?: string } };
    expect(body.ok).toBe(true);
    expect(body.data?.id).toBe(member.accountId);
  });

  it("returns 401 and reads nothing when no customer token is presented", async () => {
    const victim = await makeTenant("read-no-token", "OWNER");

    const response = await app.inject({ method: "GET", url: `/accounts/${victim.accountId}` });

    expect(response.statusCode).toBe(401);
    expect(accountQueriesNaming(victim.accountId)).toHaveLength(0);
  });
});

describe("PUT /accounts/:accountId — own account, account:manage, name only", () => {
  it("returns 404 and leaves the row unchanged when an OWNER renames another tenant's account", async () => {
    const attacker = await makeTenant("write-attacker", "OWNER");
    const victim = await makeTenant("write-victim", "OWNER");

    const foreign = await app.inject({
      method: "PUT",
      url: `/accounts/${victim.accountId}`,
      headers: bearer(attacker.token),
      payload: { name: "Renamed by attacker" },
    });
    const missing = await app.inject({
      method: "PUT",
      url: `/accounts/${ABSENT_ACCOUNT_ID}`,
      headers: bearer(attacker.token),
      payload: { name: "Renamed by attacker" },
    });

    expect(foreign.statusCode).toBe(404);
    expect(foreign.body).toBe(missing.body);
    expect(storedAccount(victim.accountId)?.name).toBe(victim.name);
    expect(storedAccount(victim.accountId)?.maxProjects).toBe(SEEDED_MAX_PROJECTS);
    expect(accountQueriesNaming(victim.accountId)).toHaveLength(0);
  });

  it("returns 404, not 403, when a MEMBER without account:manage writes another tenant's account", async () => {
    // The account comparison runs before the grant, so a foreign id answers 404 whatever the
    // caller holds: the status of a request that names another tenant never depends on who asks.
    const attacker = await makeTenant("write-member-attacker", "MEMBER");
    const victim = await makeTenant("write-member-victim", "OWNER");

    const response = await app.inject({
      method: "PUT",
      url: `/accounts/${victim.accountId}`,
      headers: bearer(attacker.token),
      payload: { name: "Renamed by member" },
    });

    expect(response.statusCode).toBe(404);
    expect(storedAccount(victim.accountId)?.name).toBe(victim.name);
    expect(accountQueriesNaming(victim.accountId)).toHaveLength(0);
  });

  it("returns 403 and keeps the name when a MEMBER without account:manage renames their own account", async () => {
    const member = await makeTenant("write-member-own", "MEMBER");

    const response = await app.inject({
      method: "PUT",
      url: `/accounts/${member.accountId}`,
      headers: bearer(member.token),
      payload: { name: "Renamed by member" },
    });

    expect(response.statusCode).toBe(403);
    expect(storedAccount(member.accountId)?.name).toBe(member.name);
    expect(accountQueriesNaming(member.accountId)).toHaveLength(0);
  });

  it("returns 200 and stores the new name when the OWNER renames their own account", async () => {
    const owner = await makeTenant("write-owner", "OWNER");

    const response = await app.inject({
      method: "PUT",
      url: `/accounts/${owner.accountId}`,
      headers: bearer(owner.token),
      payload: { name: "Renamed by owner" },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { ok: boolean; data?: { name?: string } };
    expect(body.data?.name).toBe("Renamed by owner");
    expect(storedAccount(owner.accountId)?.name).toBe("Renamed by owner");
  });

  it("returns 400 and leaves the stored quota intact when the OWNER's body carries maxProjects", async () => {
    // The quota is a billing field: an owner raising their own `maxProjects` would bypass the
    // plan's limit. The body is `{ name }` and nothing else, so the request is refused whole.
    const owner = await makeTenant("write-quota", "OWNER");

    const response = await app.inject({
      method: "PUT",
      url: `/accounts/${owner.accountId}`,
      headers: bearer(owner.token),
      payload: { name: "Quota bump", maxProjects: 500 },
    });

    expect(response.statusCode).toBe(400);
    expect(storedAccount(owner.accountId)?.maxProjects).toBe(SEEDED_MAX_PROJECTS);
    expect(storedAccount(owner.accountId)?.name).toBe(owner.name);
  });

  it.each([{ timezone: "UTC" }, { locale: "en" }, { slug: "my-account" }, { phone: "5551234" }])(
    "returns 400 when the OWNER's body carries a field the route never writes (%o)",
    async (extra) => {
      const owner = await makeTenant("write-extra", "OWNER");

      const response = await app.inject({
        method: "PUT",
        url: `/accounts/${owner.accountId}`,
        headers: bearer(owner.token),
        payload: { name: "Extra field", ...extra },
      });

      expect(response.statusCode).toBe(400);
      expect(storedAccount(owner.accountId)?.name).toBe(owner.name);
    }
  );
});

describe("GET /accounts — no tenant listing", () => {
  it("returns 404 and lists no tenant to an authenticated customer", async () => {
    const caller = await makeTenant("list-caller", "OWNER");
    const other = await makeTenant("list-other", "OWNER");

    const response = await app.inject({
      method: "GET",
      url: "/accounts",
      headers: bearer(caller.token),
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain(other.email);
    expect(response.body).not.toContain(caller.email);
  });
});

describe("POST /accounts — no customer account creation", () => {
  it("returns 404 and creates no account when an authenticated customer posts one", async () => {
    // The route minted a userless tenant with a quota the caller chose, and its address then
    // refused the real owner's self-registration. Customer registration is the one way an
    // account comes into being for a customer.
    const caller = await makeTenant("create-caller", "OWNER");
    const email = `minted-${Date.now()}-${Math.random()}@example.com`;
    const accountsBefore = stores.account.all().length;

    const response = await app.inject({
      method: "POST",
      url: "/accounts",
      headers: bearer(caller.token),
      payload: { email, name: "Minted Tenant", maxProjects: 50 },
    });

    // Fastify answers 404, not 405, to a method and path no route registers.
    expect(response.statusCode).toBe(404);
    expect(stores.account.all()).toHaveLength(accountsBefore);
    expect(stores.account.all().some((account) => account.email === email)).toBe(false);
  });
});
