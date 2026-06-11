/**
 * Integration Tests - Crisis Mode Routes
 *
 * Tests the full HTTP request/response cycle for crisis mode endpoints.
 *
 * NOTE: These tests require the API server to be running.
 * Run `pnpm dev:api` before running these tests.
 *
 * @file crisisRoutes.test.ts
 * @description Tests for Crisis Mode Routes Integration
 * @layer infrastructure
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import { checkApiAvailable, getBaseUrl } from "../testUtils.js";
import { signCustomerAccessToken } from "../../src/auth/customerJwt.js";

const API_URL = getBaseUrl();

/**
 * Mints a customer Bearer token bound to the seeded account. The
 * `/projects/:projectId/crisis` endpoints sit behind `requireClientAuth`, and
 * the project lookup is tenant-scoped by the token's accountId, so the token
 * MUST carry the same accountId as the seeded project for the route to resolve
 * it (otherwise the project is invisible and the route returns 404).
 */
const bearerFor = (accountId: string): string =>
  `Bearer ${signCustomerAccessToken({
    sub: `crisis-routes-user-${accountId}`,
    accountId,
    roleId: "role-test",
    roleName: "OWNER",
    permissions: [],
  })}`;

describe("Crisis Mode Routes Integration", () => {
  let apiAvailable = false;
  let prisma: PrismaClient;
  let testAccountId: string;
  let testProjectId: string;
  let authHeader: string;

  before(async () => {
    apiAvailable = await checkApiAvailable();
    if (!apiAvailable) {
      console.log("⚠️  API server not running - crisis mode integration tests will be skipped");
      return;
    }

    prisma = createTestPrismaClient();

    // Create test account and project
    const account = await prisma.account.create({
      data: {
        email: `crisis-routes-test-${Date.now()}@test.com`,
        name: "Crisis Routes Test Account",
      },
    });
    testAccountId = account.id;
    authHeader = bearerFor(account.id);

    const project = await prisma.project.create({
      data: {
        accountId: account.id,
        name: `Crisis Routes Test Project ${Date.now()}`,
      },
    });
    testProjectId = project.id;
  });

  after(async () => {
    if (!apiAvailable) return;

    // Cleanup
    await prisma.project.deleteMany({ where: { id: testProjectId } });
    await prisma.account.deleteMany({ where: { id: testAccountId } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    if (!apiAvailable) return;

    // Reset crisis mode before each test
    await prisma.project.update({
      where: { id: testProjectId },
      data: {
        isInCrisisMode: false,
        crisisStartedAt: null,
        crisisReason: null,
        crisisModeHistory: [],
      },
    });
  });

  describe("POST /projects/:projectId/crisis", () => {
    it("should enter crisis mode", async (t) => {
      if (!apiAvailable) {
        t.skip("API not available");
        return;
      }

      const response = await fetch(`${API_URL}/projects/${testProjectId}/crisis`, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: "PR crisis - negative viral content",
        }),
      });

      assert.equal(response.status, 200);
      const body = await response.json();
      assert.ok(body.ok);
      assert.equal(body.data.isInCrisisMode, true);
      assert.equal(body.data.reason, "PR crisis - negative viral content");
      assert.ok(body.data.startedAt);
    });

    it("should fail if already in crisis mode", async (t) => {
      if (!apiAvailable) {
        t.skip("API not available");
        return;
      }

      // Enter crisis mode first
      await fetch(`${API_URL}/projects/${testProjectId}/crisis`, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "First crisis" }),
      });

      // Try to enter again
      const response = await fetch(`${API_URL}/projects/${testProjectId}/crisis`, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Second crisis" }),
      });

      assert.equal(response.status, 409);
    });

    it("should return 404 for non-existent project", async (t) => {
      if (!apiAvailable) {
        t.skip("API not available");
        return;
      }

      const response = await fetch(
        `${API_URL}/projects/a0000000-0000-4000-8000-000000000000/crisis`,
        {
          method: "POST",
          headers: { Authorization: authHeader, "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "Test" }),
        }
      );

      assert.equal(response.status, 404);
    });

    it("should reject empty reason", async (t) => {
      if (!apiAvailable) {
        t.skip("API not available");
        return;
      }

      const response = await fetch(`${API_URL}/projects/${testProjectId}/crisis`, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "" }),
      });

      assert.equal(response.status, 400);
    });
  });

  describe("DELETE /projects/:projectId/crisis", () => {
    it("should exit crisis mode", async (t) => {
      if (!apiAvailable) {
        t.skip("API not available");
        return;
      }

      // Enter crisis mode first
      await fetch(`${API_URL}/projects/${testProjectId}/crisis`, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Test crisis" }),
      });

      // Exit crisis mode
      const response = await fetch(`${API_URL}/projects/${testProjectId}/crisis`, {
        method: "DELETE",
        headers: { Authorization: authHeader },
      });

      assert.equal(response.status, 200);
      const body = await response.json();
      assert.ok(body.ok);
      assert.equal(body.data.isInCrisisMode, false);
      assert.ok(body.data.duration >= 0);
    });

    it("should fail if not in crisis mode", async (t) => {
      if (!apiAvailable) {
        t.skip("API not available");
        return;
      }

      const response = await fetch(`${API_URL}/projects/${testProjectId}/crisis`, {
        method: "DELETE",
        headers: { Authorization: authHeader },
      });

      assert.equal(response.status, 409);
    });
  });

  describe("GET /projects/:projectId/crisis", () => {
    it("should return crisis status when in crisis mode", async (t) => {
      if (!apiAvailable) {
        t.skip("API not available");
        return;
      }

      // Enter crisis mode
      await fetch(`${API_URL}/projects/${testProjectId}/crisis`, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Active crisis" }),
      });

      // Get status
      const response = await fetch(`${API_URL}/projects/${testProjectId}/crisis`, {
        headers: { Authorization: authHeader },
      });

      assert.equal(response.status, 200);
      const body = await response.json();
      assert.ok(body.ok);
      assert.equal(body.data.isInCrisisMode, true);
      assert.equal(body.data.reason, "Active crisis");
      assert.ok(body.data.startedAt);
    });

    it("should return not in crisis when project is normal", async (t) => {
      if (!apiAvailable) {
        t.skip("API not available");
        return;
      }

      const response = await fetch(`${API_URL}/projects/${testProjectId}/crisis`, {
        headers: { Authorization: authHeader },
      });

      assert.equal(response.status, 200);
      const body = await response.json();
      assert.ok(body.ok);
      assert.equal(body.data.isInCrisisMode, false);
    });

    it("should include crisis history", async (t) => {
      if (!apiAvailable) {
        t.skip("API not available");
        return;
      }

      // Enter and exit crisis mode twice
      await fetch(`${API_URL}/projects/${testProjectId}/crisis`, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "First crisis" }),
      });
      await fetch(`${API_URL}/projects/${testProjectId}/crisis`, {
        method: "DELETE",
        headers: { Authorization: authHeader },
      });

      await fetch(`${API_URL}/projects/${testProjectId}/crisis`, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Second crisis" }),
      });

      // Get status
      const response = await fetch(`${API_URL}/projects/${testProjectId}/crisis`, {
        headers: { Authorization: authHeader },
      });

      const body = await response.json();
      assert.ok(body.ok);
      assert.equal(body.data.isInCrisisMode, true);
      assert.equal(body.data.history.length, 2);
    });

    it("should return 404 for non-existent project", async (t) => {
      if (!apiAvailable) {
        t.skip("API not available");
        return;
      }

      const response = await fetch(
        `${API_URL}/projects/a0000000-0000-4000-8000-000000000000/crisis`,
        { headers: { Authorization: authHeader } }
      );

      assert.equal(response.status, 404);
    });
  });
});
