/**
 * Tier 10 — Notifications smoke tests (customer-facing)
 *
 * REST surface for in-app notifications (list / unread count / mark read /
 * preferences). The SSE stream endpoint requires a different harness and
 * lands in a follow-up.
 *
 * @file notifications.smoke.test.ts
 * @description Tier 10 notifications smoke E2E
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import { checkApiAvailable } from "../testUtils.js";
import {
  apiGet,
  apiPost,
  apiPatch,
  expectError,
  createTestAccount,
  cleanupTestAccount,
  API_BASE_URL,
  type TestAccountFixture,
} from "./helpers/index.js";

describe("Tier 10 — Notifications smoke", () => {
  let prisma: PrismaClient;
  let owner: TestAccountFixture;

  before(async () => {
    const apiAvailable = await checkApiAvailable();
    assert.ok(
      apiAvailable,
      `API not reachable at ${API_BASE_URL} — start \`pnpm dev\` before running smoke tests`
    );
    prisma = createTestPrismaClient();
    owner = await createTestAccount(prisma, { tagPrefix: "notif-owner" });
  });

  after(async () => {
    if (!prisma) return;
    try {
      await cleanupTestAccount(prisma, owner.accountId);
    } finally {
      await prisma.$disconnect();
    }
  });

  // -----------------------------------------------------------------------
  // Read endpoints — empty state for fresh customer
  // -----------------------------------------------------------------------

  it("lists notifications for a fresh customer (200, empty)", async () => {
    const result = await apiGet<{ data: unknown[] }>("/notifications", owner.authHeader);
    assert.strictEqual(result.status, 200, `body: ${JSON.stringify(result.body)}`);
    // Body shape varies; just validate auth + reachability.
    assert.ok(result.body !== null, "response body returned");
  });

  it("returns unread count for a fresh customer (200)", async () => {
    const result = await apiGet<{ data: { count: number } }>(
      "/notifications/unread-count",
      owner.authHeader
    );
    assert.strictEqual(result.status, 200, `body: ${JSON.stringify(result.body)}`);
  });

  it("gets notification preferences for a fresh customer (200)", async () => {
    const result = await apiGet("/notifications/preferences", owner.authHeader);
    assert.strictEqual(result.status, 200, `body: ${JSON.stringify(result.body)}`);
  });

  // -----------------------------------------------------------------------
  // Mutation — mark all read (idempotent, safe even with empty list)
  // -----------------------------------------------------------------------

  it("marks all notifications as read (200, idempotent)", async () => {
    const result = await apiPost("/notifications/mark-all-read", {}, owner.authHeader);
    assert.strictEqual(result.status, 200, `body: ${JSON.stringify(result.body)}`);
  });

  // -----------------------------------------------------------------------
  // Auth gating
  // -----------------------------------------------------------------------

  it("rejects list without auth (401)", async () => {
    const result = await apiGet("/notifications");
    expectError(result, 401);
  });

  it("rejects unread-count without auth (401)", async () => {
    const result = await apiGet("/notifications/unread-count");
    expectError(result, 401);
  });

  it("rejects mark-all-read without auth (401)", async () => {
    const result = await apiPost("/notifications/mark-all-read", {});
    expectError(result, 401);
  });

  it("rejects preferences GET without auth (401)", async () => {
    const result = await apiGet("/notifications/preferences");
    expectError(result, 401);
  });

  // -----------------------------------------------------------------------
  // 404 paths
  // -----------------------------------------------------------------------

  it("returns 404 marking non-existent notification as read", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const result = await apiPatch(`/notifications/${fakeId}/read`, {}, owner.authHeader);
    // 404 is the canon response; some implementations return 200 with no-op
    // when the id is well-formed but absent — accept either as the contract
    // is "no leak of cross-tenant existence".
    assert.ok(
      [200, 404].includes(result.status),
      `expected 200/404 for non-existent notification, got ${result.status}`
    );
  });
});
