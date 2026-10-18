/**
 * @file projectAccountScope.integration.test.ts
 * @description Two-tenant real-database proof that the account-scoped project routes,
 *   `POST` and `GET /accounts/:accountId/projects`, admit only the caller's own account
 *   (CWE-639). Runs the real application (`createApp`), so the real customer authentication,
 *   the real route preHandlers and the real Prisma tenant guard all sit in front of the
 *   handlers.
 *
 *   The guard alone was the wall: `Account` is the tenant itself and is not guard-enrolled, so
 *   a foreign account id passed the handler's account read and only the later `project` query
 *   was refused, as a `TenantContextMismatchError` the handler answered with 500. A missing
 *   account answered 404, so the status told an authenticated customer which ids name a real
 *   tenant. These cases pin that a foreign account and a missing one get the same 404, byte for
 *   byte, and that the foreign tenant gains no project and leaks none.
 *
 *   Each test seeds the tenants it reads and `afterEach` deletes them, so the suite passes in
 *   any order and on an empty database.
 * @layer infrastructure
 */

import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@infra/prisma";
import { createSeedPrismaClient } from "./helpers/seedPrismaClient.js";
import { createApp } from "../../src/index.js";
import { signCustomerAccessToken } from "../../src/auth/customerJwt.js";

/** The body the handler answers for an account that does not exist. */
const ACCOUNT_NOT_FOUND = { ok: false, error: "Account not found" };

interface SeededTenant {
  accountId: string;
  projectId: string;
  bearer: string;
}

/**
 * @param accountId - The account the token's principal belongs to.
 * @returns A customer Bearer token whose verified principal is a customer of `accountId`.
 */
const bearerFor = (accountId: string): string =>
  `Bearer ${signCustomerAccessToken({
    sub: `project-scope-user-${accountId}`,
    accountId,
    roleId: "role-test",
    roleName: "OWNER",
    permissions: [],
  })}`;

describe("account scope of /accounts/:accountId/projects (CWE-639)", () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;
  const seededAccountIds: string[] = [];

  /**
   * Seeds one tenant on the owner channel: an account with room for more projects, one live
   * project, and a token for a customer of that account.
   * @param label - Names the tenant in its rows, readable in a failure message.
   * @returns The tenant's account and project ids and its customer's Bearer token.
   */
  async function seedTenant(label: string): Promise<SeededTenant> {
    const account = await prisma.account.create({
      data: {
        email: `project-scope-${label}-${randomUUID()}@test.com`,
        name: `Project Scope ${label}`,
        maxProjects: 5,
      },
    });
    seededAccountIds.push(account.id);
    const project = await prisma.project.create({
      data: { accountId: account.id, name: `Project Scope ${label} ${randomUUID()}` },
    });
    return { accountId: account.id, projectId: project.id, bearer: bearerFor(account.id) };
  }

  /**
   * @param accountId - The account whose projects are read.
   * @returns The ids of every project the account holds, read on the owner channel.
   */
  async function projectIdsOf(accountId: string): Promise<string[]> {
    const rows = await prisma.project.findMany({ where: { accountId }, select: { id: true } });
    return rows.map((row) => row.id).sort();
  }

  before(async () => {
    prisma = createSeedPrismaClient();
    app = await createApp();
    await app.ready();
  });

  afterEach(async () => {
    const accountIds = seededAccountIds.splice(0);
    await prisma.project.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
  });

  after(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it("answers POST on another tenant's account with the 404 a missing account gets, and writes nothing", async () => {
    const victim = await seedTenant("victim");
    const caller = await seedTenant("caller");

    const foreign = await app.inject({
      method: "POST",
      url: `/accounts/${victim.accountId}/projects`,
      headers: { authorization: caller.bearer },
      payload: { name: `Cross Tenant ${randomUUID()}`, locale: "en" },
    });
    const missing = await app.inject({
      method: "POST",
      url: `/accounts/${randomUUID()}/projects`,
      headers: { authorization: caller.bearer },
      payload: { name: `Missing Tenant ${randomUUID()}`, locale: "en" },
    });

    assert.equal(foreign.statusCode, 404, "a foreign account must answer 404, never 500 or 200");
    assert.equal(missing.statusCode, 404);
    assert.deepEqual(missing.json(), ACCOUNT_NOT_FOUND);
    assert.equal(
      foreign.body,
      missing.body,
      "a foreign account must look exactly like a missing one"
    );
    assert.deepEqual(await projectIdsOf(victim.accountId), [victim.projectId]);
  });

  it("answers GET on another tenant's account with the 404 a missing account gets, and lists nothing", async () => {
    const victim = await seedTenant("victim");
    const caller = await seedTenant("caller");

    const foreign = await app.inject({
      method: "GET",
      url: `/accounts/${victim.accountId}/projects`,
      headers: { authorization: caller.bearer },
    });
    const missing = await app.inject({
      method: "GET",
      url: `/accounts/${randomUUID()}/projects`,
      headers: { authorization: caller.bearer },
    });

    assert.equal(foreign.statusCode, 404, "a foreign account must answer 404, never 500 or 200");
    assert.equal(missing.statusCode, 404);
    assert.deepEqual(missing.json(), ACCOUNT_NOT_FOUND);
    assert.equal(
      foreign.body,
      missing.body,
      "a foreign account must look exactly like a missing one"
    );
    assert.ok(!foreign.body.includes(victim.projectId), "no project of the victim may leak");
  });

  it("lets the owner create a project in its own account and list it", async () => {
    const owner = await seedTenant("owner");

    const created = await app.inject({
      method: "POST",
      url: `/accounts/${owner.accountId}/projects`,
      headers: { authorization: owner.bearer },
      payload: { name: `Own Project ${randomUUID()}`, locale: "en" },
    });
    assert.equal(created.statusCode, 200);
    const createdId: string = created.json().data.id;
    assert.equal(created.json().data.accountId, owner.accountId);

    const listed = await app.inject({
      method: "GET",
      url: `/accounts/${owner.accountId}/projects`,
      headers: { authorization: owner.bearer },
    });
    assert.equal(listed.statusCode, 200);
    const listedIds = (listed.json().data as { id: string }[]).map((project) => project.id).sort();
    assert.deepEqual(listedIds, [owner.projectId, createdId].sort());
  });
});
