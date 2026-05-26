/**
 * Integration Tests — Client Repurpose Routes
 *
 * Exercises the full HTTP cycle for `GET /repurpose/proposals` and
 * `POST /repurpose/detect` against a real API + Postgres + Redis. Both
 * endpoints are client-auth and scoped to the JWT account. Coverage:
 *   - list returns seeded proposals with numeric engagement fields
 *   - missing token -> 401 on both endpoints
 *   - cross-tenant: account B never sees account A's proposals
 *   - on-demand detect returns the {detected, alreadyProposed} shape
 *
 * The dev environment (`pnpm dev`) MUST be up — API on 3000. Tests fail
 * loud if the API is unreachable (canon: "Never skip tests because
 * services are down — start them").
 *
 * @file repurposeRoutes.test.ts
 * @description Tests for the client-facing repurpose endpoints
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import { checkApiAvailable, getBaseUrl } from "../testUtils.js";
import { signCustomerAccessToken } from "../../src/auth/customerJwt.js";

const API_URL = getBaseUrl();

interface Fixture {
  accountId: string;
  otherAccountId: string;
  projectId: string;
  otherProjectId: string;
  proposalId: string;
  authHeader: string;
  otherAuthHeader: string;
}

const tokenFor = (sub: string, accountId: string): string =>
  `Bearer ${signCustomerAccessToken({
    sub,
    accountId,
    roleId: "role-test",
    roleName: "OWNER",
    permissions: [],
  })}`;

async function getJson(path: string, authHeader?: string) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: authHeader ? { Authorization: authHeader } : {},
  });
  const body: unknown = await response.json().catch(() => null);
  return { status: response.status, body };
}

async function post(path: string, authHeader?: string) {
  // No request body — omit Content-Type so Fastify does not reject an empty
  // JSON body before the auth preHandler runs.
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: authHeader ? { Authorization: authHeader } : {},
  });
  const body: unknown = await response.json().catch(() => null);
  return { status: response.status, body };
}

describe("Client repurpose routes integration", () => {
  let prisma: PrismaClient;
  let fixture: Fixture;

  before(async () => {
    const apiAvailable = await checkApiAvailable();
    assert.ok(
      apiAvailable,
      `API not reachable at ${API_URL} — start the dev environment with 'pnpm dev' before running this suite`
    );

    prisma = createTestPrismaClient();
    const tag = `repurpose-int-${Date.now()}`;

    const account = await prisma.account.create({
      data: { email: `${tag}@test.com`, name: "Repurpose Integration Account" },
    });
    const customerUser = await prisma.customerUser.create({
      data: {
        accountId: account.id,
        email: `customer-${tag}@test.com`,
        passwordHash: "ignored-for-test",
        firstName: "Repurpose",
        lastName: "Tester",
      },
    });
    const project = await prisma.project.create({
      data: { accountId: account.id, name: `Repurpose Project ${tag}` },
    });
    const sourcePost = await prisma.post.create({
      data: { projectId: project.id, status: "PUBLISHED", publishedAt: new Date() },
    });
    const proposal = await prisma.repurposeProposal.create({
      data: {
        accountId: account.id,
        sourcePostId: sourcePost.id,
        sourcePlatform: "X",
        engagementRate: 0.42,
        engagementMultiplier: 3.1,
      },
    });

    const otherAccount = await prisma.account.create({
      data: { email: `other-${tag}@test.com`, name: "Cross-tenant Account" },
    });
    const otherCustomerUser = await prisma.customerUser.create({
      data: {
        accountId: otherAccount.id,
        email: `other-customer-${tag}@test.com`,
        passwordHash: "ignored-for-test",
        firstName: "Other",
        lastName: "Tester",
      },
    });
    const otherProject = await prisma.project.create({
      data: { accountId: otherAccount.id, name: `Other Project ${tag}` },
    });

    fixture = {
      accountId: account.id,
      otherAccountId: otherAccount.id,
      projectId: project.id,
      otherProjectId: otherProject.id,
      proposalId: proposal.id,
      authHeader: tokenFor(customerUser.id, account.id),
      otherAuthHeader: tokenFor(otherCustomerUser.id, otherAccount.id),
    };
  });

  after(async () => {
    if (!fixture) return;
    const accountIds = [fixture.accountId, fixture.otherAccountId];
    const projectIds = [fixture.projectId, fixture.otherProjectId];
    await prisma.repurposeVariant.deleteMany({
      where: { proposal: { accountId: { in: accountIds } } },
    });
    await prisma.repurposeProposal.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.post.deleteMany({ where: { projectId: { in: projectIds } } });
    await prisma.project.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.customerUser.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  it("returns the account's proposals with numeric engagement fields", async () => {
    const { status, body } = await getJson("/repurpose/proposals", fixture.authHeader);

    assert.strictEqual(status, 200);
    const data = (body as { ok: boolean; data: { proposals: unknown[]; total: number } }).data;
    assert.strictEqual(data.total >= 1, true);
    const seeded = (data.proposals as Array<{ id: string }>).find(
      (p) => p.id === fixture.proposalId
    );
    assert.ok(seeded, "seeded proposal should be listed");
    const typed = seeded as unknown as {
      engagementRate: number;
      engagementMultiplier: number;
      variantCount: number;
      sourcePlatform: string;
      status: string;
    };
    assert.strictEqual(typeof typed.engagementRate, "number");
    assert.strictEqual(typeof typed.engagementMultiplier, "number");
    assert.strictEqual(typeof typed.variantCount, "number");
    assert.strictEqual(typed.sourcePlatform, "X");
    assert.strictEqual(typed.status, "PENDING");
  });

  it("rejects an unauthenticated proposals request with 401", async () => {
    const { status } = await getJson("/repurpose/proposals");
    assert.strictEqual(status, 401);
  });

  it("does not leak proposals across tenants", async () => {
    const { status, body } = await getJson("/repurpose/proposals", fixture.otherAuthHeader);

    assert.strictEqual(status, 200);
    const data = (body as { data: { proposals: Array<{ id: string }> } }).data;
    const leaked = data.proposals.some((p) => p.id === fixture.proposalId);
    assert.strictEqual(leaked, false, "account B must not see account A's proposal");
  });

  it("runs on-demand detection for the caller's account and returns counts", async () => {
    const { status, body } = await post("/repurpose/detect", fixture.authHeader);

    assert.strictEqual(status, 200);
    const data = (body as { ok: boolean; data: { detected: number; alreadyProposed: number } })
      .data;
    assert.strictEqual(typeof data.detected, "number");
    assert.strictEqual(typeof data.alreadyProposed, "number");
  });

  it("rejects an unauthenticated detect request with 401", async () => {
    const { status } = await post("/repurpose/detect");
    assert.strictEqual(status, 401);
  });
});
