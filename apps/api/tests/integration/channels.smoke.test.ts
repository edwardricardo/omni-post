/**
 * Tier 4 — Channels smoke tests (customer-facing)
 *
 * Channel CRUD that customers exercise from the dashboard:
 *   - POST /channels (create — credentials optional, OAuth fills later)
 *   - GET /channels/:id (fetch single)
 *   - GET /projects/:projectId/channels (list)
 *   - PATCH /channels/:id/set-primary
 *   - DELETE /channels/:id (soft-delete)
 *
 * Bluesky connect (handle + app password) and admin force-reauth flows
 * land in follow-up tiers — they share infrastructure with full OAuth
 * pipelines that need provider-specific stubs.
 *
 * @file channels.smoke.test.ts
 * @description Tier 4 channels smoke E2E
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
  apiDelete,
  expectError,
  createTestAccountWithProject,
  createTestChannel,
  cleanupTestAccount,
  API_BASE_URL,
  type TestProjectFixture,
} from "./helpers/index.js";

describe("Tier 4 — Channels smoke", () => {
  let prisma: PrismaClient;
  let owner: TestProjectFixture;
  let other: TestProjectFixture;

  before(async () => {
    const apiAvailable = await checkApiAvailable();
    assert.ok(
      apiAvailable,
      `API not reachable at ${API_BASE_URL} — start \`pnpm dev\` before running smoke tests`
    );
    prisma = createTestPrismaClient();
    owner = await createTestAccountWithProject(prisma, { tagPrefix: "ch-owner" });
    other = await createTestAccountWithProject(prisma, { tagPrefix: "ch-other" });
  });

  after(async () => {
    if (!prisma) return;
    try {
      await cleanupTestAccount(prisma, owner.accountId);
      await cleanupTestAccount(prisma, other.accountId);
    } finally {
      await prisma.$disconnect();
    }
  });

  // -----------------------------------------------------------------------
  // Create + List
  // -----------------------------------------------------------------------

  it("creates a channel in caller's project (201)", async () => {
    const result = await apiPost<{ data: { id: string; provider: string } }>(
      "/channels",
      {
        projectId: owner.projectId,
        name: "smoke-create-handle",
        platform: "X",
      },
      owner.authHeader
    );
    assert.strictEqual(result.status, 201, `body: ${JSON.stringify(result.body)}`);
    assert.ok(result.body?.data.id, "channel id returned");
  });

  it("rejects channel creation with malformed body (400)", async () => {
    const result = await apiPost(
      "/channels",
      {
        projectId: "not-a-uuid",
        name: "x",
        platform: "INVALID_PLATFORM",
      },
      owner.authHeader
    );
    expectError(result, 400);
  });

  it("rejects channel creation in cross-tenant project", async () => {
    // Owner attempts to create a channel in `other`'s project — should
    // be rejected as 404 (anti-IDOR canon: do not leak project existence).
    const result = await apiPost(
      "/channels",
      {
        projectId: other.projectId,
        name: "should-not-be-created",
        platform: "X",
      },
      owner.authHeader
    );
    assert.ok(
      [403, 404].includes(result.status),
      `expected 403/404 (cross-tenant project), got ${result.status}: ${JSON.stringify(result.body)}`
    );

    // Verify NO channel was created in other's project under that handle
    const created = await prisma.channel.findFirst({
      where: { projectId: other.projectId, handle: "should-not-be-created" },
      select: { id: true },
    });
    assert.strictEqual(created, null, "cross-tenant channel must NOT persist");
  });

  it("lists channels for caller's project", async () => {
    await createTestChannel(prisma, owner.projectId, { handle: "list-test-1" });
    await createTestChannel(prisma, owner.projectId, { handle: "list-test-2" });

    const result = await apiGet<{ data: Array<{ id: string }> }>(
      `/projects/${owner.projectId}/channels`,
      owner.authHeader
    );
    assert.strictEqual(result.status, 200);
    assert.ok(Array.isArray(result.body?.data), "data is array");
    assert.ok(
      (result.body?.data.length ?? 0) >= 2,
      `expected at least 2 channels in caller's project, got ${result.body?.data.length}`
    );
  });

  it("rejects list of cross-tenant project's channels", async () => {
    const result = await apiGet(`/projects/${other.projectId}/channels`, owner.authHeader);
    assert.ok(
      [403, 404].includes(result.status),
      `expected 403/404 listing other tenant's channels, got ${result.status}`
    );
  });

  // -----------------------------------------------------------------------
  // Get + Soft-delete
  // -----------------------------------------------------------------------

  it("fetches a channel the caller owns", async () => {
    const ch = await createTestChannel(prisma, owner.projectId, { handle: "get-target" });
    const result = await apiGet<{ data: { id: string } }>(`/channels/${ch.id}`, owner.authHeader);
    assert.strictEqual(result.status, 200, `body: ${JSON.stringify(result.body)}`);
    assert.strictEqual(result.body?.data.id, ch.id);
  });

  it("rejects fetch of cross-tenant channel", async () => {
    const otherCh = await createTestChannel(prisma, other.projectId, {
      handle: "secret-channel",
    });
    const result = await apiGet(`/channels/${otherCh.id}`, owner.authHeader);
    assert.ok(
      [403, 404].includes(result.status),
      `expected 403/404 fetching other tenant's channel, got ${result.status}`
    );
  });

  it("soft-deletes a channel the caller owns", async () => {
    const ch = await createTestChannel(prisma, owner.projectId, {
      handle: "delete-target",
    });
    const result = await apiDelete(`/channels/${ch.id}`, owner.authHeader);
    assert.strictEqual(result.status, 200, `body: ${JSON.stringify(result.body)}`);

    const dbChannel = await prisma.channel.findUnique({
      where: { id: ch.id },
      select: { deletedAt: true },
    });
    assert.ok(dbChannel?.deletedAt !== null, "channel.deletedAt set");
  });

  it("rejects delete of cross-tenant channel", async () => {
    const otherCh = await createTestChannel(prisma, other.projectId, {
      handle: "should-not-delete",
    });
    const result = await apiDelete(`/channels/${otherCh.id}`, owner.authHeader);
    assert.ok(
      [403, 404].includes(result.status),
      `expected 403/404 deleting other tenant's channel, got ${result.status}`
    );

    // Verify NOT soft-deleted
    const dbChannel = await prisma.channel.findUnique({
      where: { id: otherCh.id },
      select: { deletedAt: true },
    });
    assert.strictEqual(dbChannel?.deletedAt, null, "cross-tenant channel must NOT be soft-deleted");
  });

  // -----------------------------------------------------------------------
  // Auth gating
  // -----------------------------------------------------------------------

  it("rejects channel create without auth (401)", async () => {
    const result = await apiPost("/channels", {
      projectId: owner.projectId,
      name: "no-auth",
      platform: "X",
    });
    expectError(result, 401);
  });

  it("rejects channel list without auth (401)", async () => {
    const result = await apiGet(`/projects/${owner.projectId}/channels`);
    expectError(result, 401);
  });
});
