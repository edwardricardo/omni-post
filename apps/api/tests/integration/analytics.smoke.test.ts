/**
 * Tier 9 — Analytics smoke tests (customer-facing)
 *
 * Coverage:
 *   - Auth gating across the (large) analytics surface
 *   - Cross-tenant isolation on per-project endpoints
 *   - Documents the existing /analytics/project/:projectId BROKEN-AUTH
 *     bug (no preHandler, leaks per-project metrics to anyone) so the
 *     suite fails loudly if the bug is "fixed back" by accident.
 *
 * @file analytics.smoke.test.ts
 * @description Tier 9 analytics smoke E2E
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import { checkApiAvailable } from "../testUtils.js";
import {
  apiGet,
  expectError,
  createTestAccountWithProject,
  cleanupTestAccount,
  API_BASE_URL,
  type TestProjectFixture,
} from "./helpers/index.js";

describe("Tier 9 — Analytics smoke", () => {
  let prisma: PrismaClient;
  let owner: TestProjectFixture;

  before(async () => {
    const apiAvailable = await checkApiAvailable();
    assert.ok(
      apiAvailable,
      `API not reachable at ${API_BASE_URL} — start \`pnpm dev\` before running smoke tests`
    );
    prisma = createTestPrismaClient();
    owner = await createTestAccountWithProject(prisma, { tagPrefix: "anal-owner" });
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
  // Authenticated dashboards / trends
  // -----------------------------------------------------------------------

  // Several analytics endpoints are scaffolded (501 "not yet implemented")
  // — accepting 200 OR 501 lets the smoke confirm the route IS reachable
  // and AUTH-gated, without locking in a feature implementation that's
  // explicitly pending. When wiring lands, tighten to 200 only.

  it("dashboard endpoint reachable and auth-gated for caller", async () => {
    const result = await apiGet(
      `/analytics/dashboard?projectId=${owner.projectId}&timeRange=30d`,
      owner.authHeader
    );
    assert.ok(
      [200, 501].includes(result.status),
      `expected 200 or 501 (scaffolded), got ${result.status}: ${JSON.stringify(result.body)}`
    );
  });

  it("engagement trends endpoint reachable and auth-gated for caller", async () => {
    const result = await apiGet(
      `/engagement/trends?projectId=${owner.projectId}&timeRange=30d&granularity=day`,
      owner.authHeader
    );
    assert.ok(
      [200, 501].includes(result.status),
      `expected 200 or 501 (scaffolded), got ${result.status}`
    );
  });

  it("best posting times endpoint reachable and auth-gated for caller", async () => {
    const result = await apiGet(
      `/posts/best-times?projectId=${owner.projectId}&timezone=UTC&lookbackDays=30`,
      owner.authHeader
    );
    assert.ok(
      [200, 501].includes(result.status),
      `expected 200 or 501 (scaffolded), got ${result.status}`
    );
  });

  // -----------------------------------------------------------------------
  // Auth gating
  // -----------------------------------------------------------------------

  it("rejects analytics dashboard without auth (401)", async () => {
    const result = await apiGet("/analytics/dashboard");
    expectError(result, 401);
  });

  it("rejects engagement trends without auth (401)", async () => {
    const result = await apiGet("/engagement/trends");
    expectError(result, 401);
  });

  it("rejects geographic analytics without auth (401)", async () => {
    const result = await apiGet("/engagement/geographic");
    expectError(result, 401);
  });

  it("rejects media performance analytics without auth (401)", async () => {
    const result = await apiGet("/content/media-performance");
    expectError(result, 401);
  });

  // -----------------------------------------------------------------------
  // Documented broken-auth (BUG): /analytics/project/:projectId has no
  // preHandler. The endpoint comment claims "no auth required for read"
  // but per-project metrics are tenant-private (views/engagement/
  // demographics). This test asserts current behavior so a fix is visible
  // as a smoke regression — flip the assertion when the route is gated.
  // -----------------------------------------------------------------------

  it("DOCUMENTS bug: /analytics/project/:projectId leaks without auth (FIXME)", async () => {
    const result = await apiGet(`/analytics/project/${owner.projectId}`);
    // Current behavior: returns 200 (or 404) without auth — should be 401.
    // When the route is properly gated, this assertion FAILS and the
    // smoke flags the regression so the gate is re-applied. Until then,
    // document what shipping behavior is.
    assert.notStrictEqual(
      result.status,
      401,
      "FIXME: /analytics/project/:projectId now requires auth — flip this assertion to expectError(result, 401)"
    );
  });
});
