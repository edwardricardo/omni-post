/**
 * @file softDeletedIdentifierReuse.test.ts
 * @description Pins the anti-confiscation contract at the ONLY layer a user can
 *   observe it: the create routes. Two uniques are partial in the database
 *   (`Project_accountId_name_key` and `Account_email_key`, both
 *   `WHERE "deletedAt" IS NULL`) so that soft-deleting a project named
 *   "Marketing" — or an account addressed `x@y.z` — does not confiscate that
 *   identifier for the rest of the tenant's life. The database permits the
 *   reuse. If the route's own duplicate check still sees the soft-deleted row it
 *   answers 409 anyway and the user-visible behaviour is unchanged: the partial
 *   index is then a constraint nobody can reach.
 *
 *   Both halves are asserted, because a check that stops refusing everything is
 *   a worse defect than the one it replaces: the reuse must SUCCEED, and a
 *   genuinely live duplicate must still be REFUSED.
 *
 *   The customer surface is driven through the REAL `requireClientAuth` with
 *   genuinely signed tokens (precedent: `accounts/accountDeleteOwnership.test.ts`).
 *   Mocking it to a no-op would leave the tenant context unbound, and the
 *   duplicate check under test runs against a tenant-guard-enrolled model.
 * @layer infrastructure
 */

import { describe, it, beforeEach, afterAll, expect, vi } from "vitest";
import { createMockPrismaModule } from "./helpers/mockPrisma.js";

// ---------------------------------------------------------------------------
// Mock setup — must come BEFORE any SUT import
// ---------------------------------------------------------------------------

const { mockPrisma, stores } = createMockPrismaModule();

/**
 * Compound-selector fidelity for `project.findUnique`.
 *
 * The shared mock's `matchesWhere` cannot read a compound selector at all: it
 * compares `record["accountId_name"]` (always `undefined`) against the selector
 * object, so it answers `null` for EVERY input. Left alone it would report "no
 * duplicate" unconditionally and this suite would go green over the very defect
 * it exists to catch — a double strictly more permissive than the database.
 *
 * This replacement reproduces what Prisma actually emits for a compound
 * selector: equality on the two columns and NOTHING else. The index behind the
 * selector is partial, but Prisma builds SQL from the `where`, not from the
 * index, so soft-deleted rows stay in scope. That is exactly why the check is
 * wrong, and the double must not soften it.
 */
const originalProjectFindUnique = mockPrisma.prisma.project.findUnique;
mockPrisma.prisma.project.findUnique = vi.fn(
  async (args: { where: Record<string, unknown>; include?: Record<string, unknown> }) => {
    const selector = args.where.accountId_name as { accountId: string; name: string } | undefined;
    if (selector) {
      const found =
        stores.project
          .all()
          .find((p) => p.accountId === selector.accountId && p.name === selector.name) ?? null;
      return found ? { ...found } : null;
    }
    return originalProjectFindUnique(args);
  }
);

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

// ---------------------------------------------------------------------------
// SUT imports (after mocks)
// ---------------------------------------------------------------------------

const Fastify = (await import("fastify")).default;
const { accountRoutes } = await import("../../src/accounts/accountRoutes.js");
const { projectRoutes } = await import("../../src/projects/projectRoutes.js");
const { setupContainer } = await import("../../src/infrastructure/container/setup.js");
const { signCustomerAccessToken } = await import("../../src/auth/customerJwt.js");

import type { FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let seq = 0;
const unique = (label: string): string => `${label}-${Date.now()}-${(seq += 1)}`;

async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate("container", setupContainer({ prisma: mockPrisma.prisma as never }));
  await app.register(accountRoutes);
  await app.register(projectRoutes);
  return app;
}

/**
 * Seeds one account and mints a REAL customer access token scoped to it. The
 * quota headroom is deliberate: `createProject` checks `maxProjects` against a
 * project count BEFORE it reaches the duplicate check, and that count does not
 * filter `deletedAt`. A tight quota would make these tests answer 403 for a
 * reason that has nothing to do with the name.
 */
async function makeTenant(label: string): Promise<{ accountId: string; token: string }> {
  const account = (await mockPrisma.prisma.account.create({
    data: {
      email: `${unique(label)}@example.com`,
      name: `Tenant ${label}`,
      maxProjects: 50,
    },
  })) as { id: string };

  const token = signCustomerAccessToken({
    sub: `user-${label}`,
    accountId: account.id,
    roleId: "role-owner",
    roleName: "OWNER",
    permissions: ["account:manage", "account:delete"],
  });

  return { accountId: account.id, token };
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** The row shape a real soft delete leaves behind: present, with `deletedAt` set. */
function seedSoftDeletedProject(accountId: string, name: string): void {
  stores.project.add({ accountId, name, locale: "en", deletedAt: new Date() });
}

function seedLiveProject(accountId: string, name: string): void {
  stores.project.add({ accountId, name, locale: "en", deletedAt: null });
}

let app: FastifyInstance;

async function postProject(
  tenant: { accountId: string; token: string },
  name: string
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const response = await app.inject({
    method: "POST",
    url: `/accounts/${tenant.accountId}/projects`,
    headers: bearer(tenant.token),
    payload: { name, locale: "en" },
  });
  return { statusCode: response.statusCode, body: JSON.parse(response.body) };
}

async function postAccount(
  tenant: { token: string },
  email: string
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const response = await app.inject({
    method: "POST",
    url: "/accounts",
    headers: bearer(tenant.token),
    payload: { email, name: "Reused Address" },
  });
  return { statusCode: response.statusCode, body: JSON.parse(response.body) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("soft-deleted identifiers are reusable, live ones are not", () => {
  beforeEach(async () => {
    app ??= await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("POST /accounts/:accountId/projects — project name", () => {
    it("accepts a name whose only holder was soft-deleted", async () => {
      const tenant = await makeTenant("project-reuse");
      const name = unique("Marketing");
      seedSoftDeletedProject(tenant.accountId, name);

      const result = await postProject(tenant, name);

      expect(result.statusCode).toBe(200);
      expect(result.body.data).toMatchObject({ name });
    });

    it("still refuses a name held by a LIVE project", async () => {
      const tenant = await makeTenant("project-conflict");
      const name = unique("Marketing");
      seedLiveProject(tenant.accountId, name);

      const result = await postProject(tenant, name);

      expect(result.statusCode).toBe(409);
      expect(result.body.error).toBe("NAME_TAKEN");
    });

    it("accepts a name two soft-deleted rows already share", async () => {
      // The migration's own header states two soft-deleted projects may share a
      // name by design. Once they do, the compound selector is no longer unique
      // and `findUnique` is querying for at-most-one row across two — a latent
      // defect independent of the 409. A duplicate check filtered to live rows
      // never sees either of them.
      const tenant = await makeTenant("project-double");
      const name = unique("Marketing");
      seedSoftDeletedProject(tenant.accountId, name);
      seedSoftDeletedProject(tenant.accountId, name);

      const result = await postProject(tenant, name);

      expect(result.statusCode).toBe(200);
      expect(result.body.data).toMatchObject({ name });
    });

    it("keeps the name available to the owning account only", async () => {
      // The check must stay scoped to the account in the path. A name held live
      // by ANOTHER tenant is not a conflict here.
      const owner = await makeTenant("project-scope-owner");
      const other = await makeTenant("project-scope-other");
      const name = unique("Marketing");
      seedLiveProject(other.accountId, name);

      const result = await postProject(owner, name);

      expect(result.statusCode).toBe(200);
      expect(result.body.data).toMatchObject({ name });
    });
  });

  describe("POST /accounts — account email", () => {
    it("accepts an address whose only holder was soft-deleted", async () => {
      const caller = await makeTenant("email-reuse");
      const email = `${unique("reused")}@example.com`;
      await mockPrisma.prisma.account.create({
        data: { email, name: "Gone", maxProjects: 1, deletedAt: new Date() },
      });

      const result = await postAccount(caller, email);

      expect(result.statusCode).toBe(200);
      expect(result.body.data).toMatchObject({ email });
    });

    it("still refuses an address held by a LIVE account", async () => {
      const caller = await makeTenant("email-conflict");
      const email = `${unique("held")}@example.com`;
      await mockPrisma.prisma.account.create({
        data: { email, name: "Still Here", maxProjects: 1, deletedAt: null },
      });

      const result = await postAccount(caller, email);

      expect(result.statusCode).toBe(409);
      expect(result.body.error).toBe("EMAIL_TAKEN");
    });

    it("matches the address verbatim, exactly as the create stores it", async () => {
      // `SecureSchemas.userEmail` neither lowercases nor trims, and the create
      // writes the address as given, so the lookup, the stored row and the
      // Postgres index all compare the same bytes. Normalising the lookup alone
      // would stop it detecting a duplicate the database would then accept.
      const caller = await makeTenant("email-verbatim");
      const stored = `${unique("Mixed")}@Example.com`;
      await mockPrisma.prisma.account.create({
        data: { email: stored, name: "Still Here", maxProjects: 1, deletedAt: null },
      });

      const result = await postAccount(caller, stored);

      expect(result.statusCode).toBe(409);
      expect(result.body.error).toBe("EMAIL_TAKEN");
    });
  });

  describe("test-double fidelity", () => {
    it("resolves the compound project selector against soft-deleted rows", async () => {
      // Guards the suite itself. If the double answered `null` for a compound
      // selector — which the SHARED mock does — every assertion above would pass
      // whether or not the route was ever fixed.
      const tenant = await makeTenant("fidelity");
      const name = unique("Fidelity");
      seedSoftDeletedProject(tenant.accountId, name);

      const row = await mockPrisma.prisma.project.findUnique({
        where: { accountId_name: { accountId: tenant.accountId, name } },
      });

      expect(row).not.toBe(null);
      expect((row as { deletedAt: Date | null }).deletedAt).not.toBe(null);
    });
  });
});
