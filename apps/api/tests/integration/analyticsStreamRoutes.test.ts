/**
 * @file analyticsStreamRoutes.test.ts
 * @description Integration tests for GET /analytics/stream (SSE) against the running
 *              API. Verifies auth (401 without a token), tenancy (403 for a project
 *              the account does not own — the fix for the old WS wrong-domain bug),
 *              and a real SSE handshake (200 text/event-stream with a first data
 *              frame). The stream is aborted after the first chunk so the suite does
 *              not hang on the open connection.
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

describe("Analytics realtime stream (SSE) integration", () => {
  let prisma: PrismaClient;
  let accountAId: string;
  let projectAId: string;
  let accountBId: string;
  let projectBId: string;
  let authHeaderA: string;

  before(async () => {
    const apiAvailable = await checkApiAvailable();
    assert.ok(
      apiAvailable,
      `API not reachable at ${API_URL} — start the dev environment with 'pnpm dev' before running this suite`
    );

    prisma = createTestPrismaClient();
    const tag = `analytics-stream-int-${Date.now()}`;

    const accountA = await prisma.account.create({
      data: { email: `a-${tag}@test.com`, name: "Stream Account A" },
    });
    accountAId = accountA.id;
    const projectA = await prisma.project.create({
      data: { accountId: accountA.id, name: "Project A" },
    });
    projectAId = projectA.id;
    const customerA = await prisma.customerUser.create({
      data: {
        accountId: accountA.id,
        email: `cu-a-${tag}@test.com`,
        passwordHash: "ignored-for-test",
        firstName: "Stream",
        lastName: "Owner",
      },
    });
    authHeaderA = tokenFor(customerA.id, accountA.id);

    const accountB = await prisma.account.create({
      data: { email: `b-${tag}@test.com`, name: "Stream Account B" },
    });
    accountBId = accountB.id;
    const projectB = await prisma.project.create({
      data: { accountId: accountB.id, name: "Project B" },
    });
    projectBId = projectB.id;
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

  it("returns 401 without an auth token", async () => {
    const res = await fetch(`${API_URL}/analytics/stream?projectId=${projectAId}`);
    assert.strictEqual(res.status, 401);
    await res.body?.cancel();
  });

  it("returns 403 for a project the account does not own (tenancy)", async () => {
    const res = await fetch(`${API_URL}/analytics/stream?projectId=${projectBId}`, {
      headers: { Authorization: authHeaderA },
    });
    assert.strictEqual(res.status, 403);
    await res.body?.cancel();
  });

  it("opens an SSE stream (200 text/event-stream) for an owned project", async () => {
    const controller = new AbortController();
    const res = await fetch(`${API_URL}/analytics/stream?projectId=${projectAId}`, {
      headers: { Authorization: authHeaderA, Accept: "text/event-stream" },
      signal: controller.signal,
    });

    assert.strictEqual(res.status, 200);
    assert.ok(
      (res.headers.get("content-type") ?? "").includes("text/event-stream"),
      "expected text/event-stream content type"
    );

    // Read the first frame (the connected handshake), then abort so the open
    // stream does not hang the suite.
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    assert.ok(
      text.includes("connected") || text.includes("data:"),
      `expected an SSE data frame, got: ${text.slice(0, 80)}`
    );

    await reader.cancel();
    controller.abort();
  });
});
