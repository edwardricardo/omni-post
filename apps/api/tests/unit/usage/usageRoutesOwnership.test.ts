/**
 * @file usageRoutesOwnership.test.ts
 * @description Authorization tests for `GET /accounts/:accountId/usage`, the customer usage page's
 *   read of an account's plan, limits, trial and billing dates.
 *
 *   `Account` IS the tenant: it is keyed by `id`, not `accountId`, so it is absent from the Prisma
 *   tenant guard's `TENANT_SCOPED_MODELS`, and the use case's account-context read passes the guard
 *   untouched. Nothing below the route refuses a foreign account id, so the route's own gate is the
 *   only thing between one tenant's bearer token and another tenant's billing context.
 *
 *   The owner's rule (2026-10-18): any authenticated member of an account reads its usage; another
 *   tenant's account answers exactly as a missing one does, whatever the caller holds, so no answer
 *   tells a customer which ids name a real tenant.
 *
 *   The suite drives the REAL `requireClientAuth` with genuinely signed customer tokens whose
 *   permission sets are the seeded roles' (`seedCustomerRoles.ts`), and the REAL `GetUsageUseCase`
 *   from the composition root over a recording repository double, so "refused before the use case"
 *   is observed as an account-context read that never happened.
 * @layer infrastructure
 */

import { randomUUID } from "node:crypto";
import { describe, it, beforeAll, beforeEach, afterAll, expect, vi } from "vitest";
import type {
  AccountUsageContext,
  UsageMetricData,
  UsageMetricRepository,
} from "@core/domain/repositories/UsageMetricRepository.js";
import { createMockPrismaModule } from "../helpers/mockPrisma.js";
import { makeCustomerRoleSnapshot } from "../helpers/seedCustomerRoles.js";

// ---------------------------------------------------------------------------
// Mock setup — must come BEFORE any SUT import
// ---------------------------------------------------------------------------

const { mockPrisma } = createMockPrismaModule();

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
const { usageRoutes } = await import("../../../src/usage/usageRoutes.js");
const { createRouteTestContainer } = await import("../helpers/testContainer.js");
const { TOKENS } = await import("../../../src/infrastructure/container/types.js");
const { signCustomerAccessToken } = await import("../../../src/auth/customerJwt.js");

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** An account id that has never existed — the "missing" arm of the anti-enumeration pair. */
const ABSENT_ACCOUNT_ID = "a0000000-0000-4000-8000-000000000000";

/** The body every account the caller does not own answers with, missing or another tenant's. */
const NOT_FOUND_BODY = { ok: false, error: "Account not found" };

/** The period every request asks for, so the counters row the double returns is the one read. */
const PERIOD = { year: 2026, month: 10 };

type SeededRole = "OWNER" | "MEMBER";

interface Tenant {
  accountId: string;
  context: AccountUsageContext;
}

interface UsageBody {
  ok: boolean;
  error?: string;
  data?: {
    accountId?: string;
    periodYear?: number;
    periodMonth?: number;
    postsPublished?: number;
    plan?: string;
    postsLimit?: number | null;
    nextBillingDate?: string | null;
  };
}

/** Plan and billing context per live account; an id absent from it is a missing account. */
const contexts = new Map<string, AccountUsageContext>();

const findAccountContext = vi.fn(
  async (accountId: string): Promise<AccountUsageContext | null> => contexts.get(accountId) ?? null
);

const findByPeriod = vi.fn(
  async (accountId: string, year: number, month: number): Promise<UsageMetricData | null> => ({
    id: `metric-${accountId}`,
    accountId,
    periodYear: year,
    periodMonth: month,
    postsPublished: 7,
    aiCallsMade: 2,
    storageGb: 1,
    teamMemberCount: 3,
    updatedAt: new Date("2026-10-01T00:00:00Z"),
  })
);

/** The repository the composition root's `GetUsageUseCase` reads through in this suite. */
const usageRepository: UsageMetricRepository = {
  increment: vi.fn(async () => undefined),
  set: vi.fn(async () => undefined),
  findByPeriod,
  findAccountContext,
};

async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  typedApp.setValidatorCompiler(validatorCompiler);
  typedApp.setSerializerCompiler(serializerCompiler);
  const container = createRouteTestContainer({ prisma: mockPrisma.prisma as never });
  container.registerInstance<UsageMetricRepository>(TOKENS.UsageMetricRepository, usageRepository);
  typedApp.decorate("container", container);
  await typedApp.register(usageRoutes);
  return typedApp;
}

/** Seeds one live account with a distinctive plan and billing context. */
function makeTenant(label: string): Tenant {
  const accountId = randomUUID();
  const context: AccountUsageContext = {
    plan: `Plan of ${label}`,
    channelsCount: 4,
    postsLimit: 120,
    channelsLimit: 10,
    teamMembersLimit: 5,
    storageLimitGb: 50,
    isOnTrial: true,
    trialEndDate: new Date("2026-11-01T00:00:00Z"),
    nextBillingDate: new Date("2026-11-15T00:00:00Z"),
  };
  contexts.set(accountId, context);
  return { accountId, context };
}

/**
 * Mints a REAL customer access token for a member of `accountId` holding exactly the seeded role's
 * permissions — the token shape `requireClientAuth` verifies in production.
 */
function tokenFor(accountId: string, role: SeededRole, label: string): string {
  const snapshot = makeCustomerRoleSnapshot(role);
  return signCustomerAccessToken({
    sub: `user-${label}`,
    accountId,
    roleId: snapshot.roleId,
    roleName: snapshot.roleName,
    permissions: [...snapshot.permissions],
  });
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function usageUrl(accountId: string): string {
  return `/accounts/${accountId}/usage?year=${PERIOD.year}&month=${PERIOD.month}`;
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

describe("GET /accounts/:accountId/usage — own account only", () => {
  it.each<SeededRole>(["OWNER", "MEMBER"])(
    "returns 404 with the shared not-found body and reads no account context when a %s asks for another tenant's account",
    async (role) => {
      const attacker = makeTenant(`attacker-${role}`);
      const victim = makeTenant(`victim-${role}`);

      const response = await app.inject({
        method: "GET",
        url: usageUrl(victim.accountId),
        headers: bearer(tokenFor(attacker.accountId, role, `attacker-${role}`)),
      });

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body)).toEqual(NOT_FOUND_BODY);
      expect(response.body).not.toContain(victim.context.plan);
      // Refused before the use case: no read probed the account or its billing context.
      expect(findAccountContext).not.toHaveBeenCalled();
      expect(findByPeriod).not.toHaveBeenCalled();
    }
  );

  it("answers another tenant's account exactly as an account that does not exist", async () => {
    const attacker = makeTenant("pair-attacker");
    const victim = makeTenant("pair-victim");
    const token = tokenFor(attacker.accountId, "OWNER", "pair-attacker");

    const foreign = await app.inject({
      method: "GET",
      url: usageUrl(victim.accountId),
      headers: bearer(token),
    });
    const missing = await app.inject({
      method: "GET",
      url: usageUrl(ABSENT_ACCOUNT_ID),
      headers: bearer(token),
    });

    // Anti-enumeration: a distinguishable answer confirms the id names a real tenant.
    expect(foreign.statusCode).toBe(missing.statusCode);
    expect(foreign.body).toBe(missing.body);
    expect(findAccountContext).not.toHaveBeenCalled();
  });

  it("returns the 404 body the route gives the caller's own soft-deleted account when the account is another tenant's", async () => {
    // The gate answers before the use case; the caller's own soft-deleted account passes the gate
    // and gets the route's own not-found answer. The two must be the same bytes, or the body would
    // tell a foreign id from a missing one.
    const attacker = makeTenant("gone-attacker");
    const victim = makeTenant("gone-victim");
    const gone = makeTenant("gone-own");
    // The repository reads live accounts only (`deletedAt: null`), so a soft-deleted account has
    // no context.
    contexts.delete(gone.accountId);

    const foreign = await app.inject({
      method: "GET",
      url: usageUrl(victim.accountId),
      headers: bearer(tokenFor(attacker.accountId, "OWNER", "gone-attacker")),
    });
    const ownGone = await app.inject({
      method: "GET",
      url: usageUrl(gone.accountId),
      headers: bearer(tokenFor(gone.accountId, "OWNER", "gone-own")),
    });

    expect(ownGone.statusCode).toBe(404);
    // The own account reached the use case, whose read found no live account.
    expect(findAccountContext).toHaveBeenCalledWith(gone.accountId);
    expect(findAccountContext).not.toHaveBeenCalledWith(victim.accountId);
    expect(foreign.statusCode).toBe(404);
    expect(foreign.body).toBe(ownGone.body);
    expect(ownGone.body).not.toContain(gone.accountId);
  });

  it("returns 200 with the usage payload when the OWNER reads their own account", async () => {
    const tenant = makeTenant("own-owner");

    const response = await app.inject({
      method: "GET",
      url: usageUrl(tenant.accountId),
      headers: bearer(tokenFor(tenant.accountId, "OWNER", "own-owner")),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as UsageBody;
    expect(body.ok).toBe(true);
    expect(body.data).toMatchObject({
      accountId: tenant.accountId,
      periodYear: PERIOD.year,
      periodMonth: PERIOD.month,
      postsPublished: 7,
      plan: tenant.context.plan,
      postsLimit: 120,
      nextBillingDate: "2026-11-15T00:00:00.000Z",
    });
    expect(findAccountContext).toHaveBeenCalledWith(tenant.accountId);
  });

  it("returns 200 with the usage payload when a MEMBER of the account reads it", async () => {
    const tenant = makeTenant("own-member");

    const response = await app.inject({
      method: "GET",
      url: usageUrl(tenant.accountId),
      headers: bearer(tokenFor(tenant.accountId, "MEMBER", "own-member")),
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as UsageBody;
    expect(body.ok).toBe(true);
    expect(body.data?.accountId).toBe(tenant.accountId);
    expect(body.data?.plan).toBe(tenant.context.plan);
  });

  it("returns 401 and reads no account context when no customer token is presented", async () => {
    const victim = makeTenant("no-token");

    const response = await app.inject({ method: "GET", url: usageUrl(victim.accountId) });

    expect(response.statusCode).toBe(401);
    expect(findAccountContext).not.toHaveBeenCalled();
  });
});
