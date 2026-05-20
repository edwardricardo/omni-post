/**
 * Integration Tests — Client Trend Radar Route
 *
 * Exercises `GET /trends/radar` against a real API + Postgres. The
 * endpoint is client-auth and scoped to the JWT account. Coverage:
 *   - happy path: returns seeded scored trends with provenance fields
 *     (source, sourceUrl) and Decimal→Number conversion of relevanceScore
 *   - missing token -> 401
 *   - cross-tenant query param (accountId ≠ JWT.accountId) -> 403
 *   - cross-tenant (account B authenticated, account A's rows not leaked)
 *   - expired rows (expiresAt past) are filtered out
 *
 * The dev environment (`pnpm dev`) MUST be up — API on 3000. Tests fail
 * loud if the API is unreachable (canon: "Never skip tests because
 * services are down — start them").
 *
 * @file trendRadarRoutes.test.ts
 * @description Tests for the client-facing trend radar endpoint
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
  activeRowId: string;
  expiredRowId: string;
  otherRowId: string;
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

describe("Client trend radar route integration", () => {
  let prisma: PrismaClient;
  let fixture: Fixture;

  before(async () => {
    const apiAvailable = await checkApiAvailable();
    assert.ok(
      apiAvailable,
      `API not reachable at ${API_URL} — start the dev environment with 'pnpm dev' before running this suite`
    );

    prisma = createTestPrismaClient();
    const tag = `trend-radar-int-${Date.now()}`;
    const now = new Date();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;

    const account = await prisma.account.create({
      data: { email: `${tag}@test.com`, name: "Trend Radar Integration Account" },
    });
    const customerUser = await prisma.customerUser.create({
      data: {
        accountId: account.id,
        email: `customer-${tag}@test.com`,
        passwordHash: "ignored-for-test",
        firstName: "TrendRadar",
        lastName: "Tester",
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

    const activeRow = await prisma.trendRadarResult.create({
      data: {
        accountId: account.id,
        topic: "#AIArt",
        platform: "TIKTOK",
        source: "PERPLEXITY_WEB",
        sourceUrl: "https://example.test/ai-art",
        relevanceScore: 9,
        postIdea: "Ride the AI art wave",
        bestPlatform: "TIKTOK",
        urgency: "TODAY",
        volume: 1500,
        fetchedAt: now,
        expiresAt: new Date(now.getTime() + thirtyDays),
      },
    });

    const expiredRow = await prisma.trendRadarResult.create({
      data: {
        accountId: account.id,
        topic: "#StaleTopic",
        platform: "X",
        source: "INBOX_MENTIONS",
        sourceUrl: null,
        relevanceScore: 7,
        postIdea: null,
        bestPlatform: null,
        urgency: "THIS_WEEK",
        volume: null,
        fetchedAt: new Date(now.getTime() - thirtyDays - 1000),
        expiresAt: new Date(now.getTime() - 1000),
      },
    });

    const otherRow = await prisma.trendRadarResult.create({
      data: {
        accountId: otherAccount.id,
        topic: "#OtherTenantTopic",
        platform: "INSTAGRAM",
        source: "ACCOUNT_ANALYTICS",
        sourceUrl: null,
        relevanceScore: 8,
        postIdea: null,
        bestPlatform: null,
        urgency: "TODAY",
        volume: null,
        fetchedAt: now,
        expiresAt: new Date(now.getTime() + thirtyDays),
      },
    });

    fixture = {
      accountId: account.id,
      otherAccountId: otherAccount.id,
      activeRowId: activeRow.id,
      expiredRowId: expiredRow.id,
      otherRowId: otherRow.id,
      authHeader: tokenFor(customerUser.id, account.id),
      otherAuthHeader: tokenFor(otherCustomerUser.id, otherAccount.id),
    };
  });

  after(async () => {
    if (!fixture) return;
    const accountIds = [fixture.accountId, fixture.otherAccountId];
    await prisma.trendRadarResult.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.customerUser.deleteMany({ where: { accountId: { in: accountIds } } });
    await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
    await prisma.$disconnect();
  });

  it("returns the account's active scored trends with provenance and numeric relevanceScore", async () => {
    const { status, body } = await getJson("/trends/radar", fixture.authHeader);

    assert.strictEqual(status, 200);
    const data = (
      body as { ok: boolean; data: { scored: Array<Record<string, unknown>>; total: number } }
    ).data;
    assert.strictEqual(typeof data.total, "number");
    const seeded = data.scored.find((r) => r["topic"] === "#AIArt");
    assert.ok(seeded, "seeded active row should appear in the response");
    assert.strictEqual(seeded["source"], "PERPLEXITY_WEB");
    assert.strictEqual(seeded["sourceUrl"], "https://example.test/ai-art");
    assert.strictEqual(seeded["platform"], "TIKTOK");
    assert.strictEqual(seeded["urgency"], "TODAY");
    assert.strictEqual(typeof seeded["relevanceScore"], "number");
    assert.strictEqual(typeof seeded["fetchedAt"], "string");
  });

  it("filters out rows past their expiresAt retention", async () => {
    const { body } = await getJson("/trends/radar", fixture.authHeader);
    const scored = (body as { data: { scored: Array<Record<string, unknown>> } }).data.scored;
    const leakedExpired = scored.some((r) => r["topic"] === "#StaleTopic");
    assert.strictEqual(leakedExpired, false, "expired rows must not appear");
  });

  it("rejects an unauthenticated request with 401", async () => {
    const { status } = await getJson("/trends/radar");
    assert.strictEqual(status, 401);
  });

  it("rejects a cross-tenant accountId query param with 403", async () => {
    const { status } = await getJson(
      `/trends/radar?accountId=${fixture.otherAccountId}`,
      fixture.authHeader
    );
    assert.strictEqual(status, 403);
  });

  it("does not leak rows across tenants", async () => {
    const { status, body } = await getJson("/trends/radar", fixture.otherAuthHeader);

    assert.strictEqual(status, 200);
    const scored = (body as { data: { scored: Array<Record<string, unknown>> } }).data.scored;
    const leaked = scored.some((r) => r["topic"] === "#AIArt");
    assert.strictEqual(leaked, false, "account B must not see account A's trend radar rows");
    const ownRow = scored.find((r) => r["topic"] === "#OtherTenantTopic");
    assert.ok(ownRow, "account B should see its own row");
  });
});
