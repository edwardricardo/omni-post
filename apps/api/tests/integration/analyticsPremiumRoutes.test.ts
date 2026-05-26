/**
 * @file analyticsPremiumRoutes.test.ts
 * @description Integration tests for the premium-analytics endpoints wired in B4
 *              against the running API: GET /analytics/roi, GET /analytics/cross-platform,
 *              POST /ai/predict-timing. Verifies auth (401), tenancy (403 for a
 *              project the account does not own — accountId comes from the token,
 *              never the client param), input validation (400), and a real 200
 *              payload from the use case.
 * @layer infrastructure
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import { checkApiAvailable, getBaseUrl } from "../testUtils.js";
import { signCustomerAccessToken } from "../../src/auth/customerJwt.js";

const API_URL = getBaseUrl();

const tokenFor = (sub: string, accountId: string): string =>
  `Bearer ${signCustomerAccessToken({
    sub,
    accountId,
    roleId: "role-test",
    roleName: "OWNER",
    permissions: [],
  })}`;

interface Envelope {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

describe("Premium analytics routes integration (B4)", () => {
  let prisma: PrismaClient;
  let accountAId: string;
  let projectAId: string;
  let accountBId: string;
  let projectBId: string;
  let authHeaderA: string;

  before(async () => {
    const apiAvailable = await checkApiAvailable();
    assert.ok(apiAvailable, `API not reachable at ${API_URL} — start the dev environment first`);

    prisma = createTestPrismaClient();
    const tag = `analytics-premium-int-${Date.now()}`;

    const accountA = await prisma.account.create({
      data: { email: `a-${tag}@test.com`, name: "Premium A" },
    });
    accountAId = accountA.id;
    projectAId = (await prisma.project.create({ data: { accountId: accountA.id, name: "PA" } })).id;
    const customerA = await prisma.customerUser.create({
      data: {
        accountId: accountA.id,
        email: `cu-a-${tag}@test.com`,
        passwordHash: "ignored",
        firstName: "P",
        lastName: "A",
      },
    });
    authHeaderA = tokenFor(customerA.id, accountA.id);

    const accountB = await prisma.account.create({
      data: { email: `b-${tag}@test.com`, name: "Premium B" },
    });
    accountBId = accountB.id;
    projectBId = (await prisma.project.create({ data: { accountId: accountB.id, name: "PB" } })).id;
  });

  after(async () => {
    if (!prisma) return;
    await prisma.project.deleteMany({ where: { id: { in: [projectAId, projectBId] } } });
    await prisma.customerUser.deleteMany({
      where: { accountId: { in: [accountAId, accountBId] } },
    });
    await prisma.account.deleteMany({ where: { id: { in: [accountAId, accountBId] } } });
    await prisma.$disconnect();
  });

  // ── GET /analytics/roi ──────────────────────────────────────────────────────
  it("roi: 401 without a token", async () => {
    const res = await fetch(`${API_URL}/analytics/roi?timeRange=30d`);
    assert.strictEqual(res.status, 401);
  });

  it("roi: 403 for a project the account does not own (tenancy)", async () => {
    const res = await fetch(`${API_URL}/analytics/roi?timeRange=30d&projectId=${projectBId}`, {
      headers: { Authorization: authHeaderA },
    });
    assert.strictEqual(res.status, 403);
  });

  it("roi: 200 with a real ROI payload for the authenticated account", async () => {
    const res = await fetch(`${API_URL}/analytics/roi?timeRange=30d`, {
      headers: { Authorization: authHeaderA },
    });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as Envelope;
    assert.equal(body.ok, true);
    assert.ok(body.data);
    assert.equal(typeof body.data!.totalInvestment, "number");
    assert.equal(typeof body.data!.roi, "number");
  });

  // ── GET /analytics/cross-platform ───────────────────────────────────────────
  it("cross-platform: 401 without a token", async () => {
    const res = await fetch(`${API_URL}/analytics/cross-platform`);
    assert.strictEqual(res.status, 401);
  });

  it("cross-platform: 200 with a summary for the authenticated account", async () => {
    const res = await fetch(`${API_URL}/analytics/cross-platform?includeCompetitive=true`, {
      headers: { Authorization: authHeaderA },
    });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as Envelope;
    assert.equal(body.ok, true);
    assert.ok(body.data && typeof body.data.summary === "object");
  });

  // ── POST /ai/predict-timing ─────────────────────────────────────────────────
  it("predict-timing: 401 without a token", async () => {
    const res = await fetch(`${API_URL}/ai/predict-timing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "X", timezone: "UTC" }),
    });
    assert.strictEqual(res.status, 401);
  });

  it("predict-timing: 400 when provider/timezone are missing", async () => {
    const res = await fetch(`${API_URL}/ai/predict-timing`, {
      method: "POST",
      headers: { Authorization: authHeaderA, "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: "text" }),
    });
    assert.strictEqual(res.status, 400);
  });

  it("predict-timing: 200 with optimal slots for a provider", async () => {
    const res = await fetch(`${API_URL}/ai/predict-timing`, {
      method: "POST",
      headers: { Authorization: authHeaderA, "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "X", contentType: "text", timezone: "UTC" }),
    });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as Envelope;
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.data!.optimalSlots));
  });
});
