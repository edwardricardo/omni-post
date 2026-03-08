/**
 * Unit Tests for subscriptionRoutes — Trials, Reporting, and Auto-Renewals
 * Covers: analytics/revenue, health, export, trials/start, trials/expiring,
 *         trials/stats, auto-renewals/process
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { FastifyInstance } from "fastify";
import {
  createTestApp,
  createTestUsers,
  cleanupTestUsers,
  prisma,
} from "./subscriptionRoutes.test-helpers.js";

const timestamp = Date.now();
let app: FastifyInstance;
let adminToken: string;
let superAdminToken: string;
let testAccountId: string;

describe("subscriptionRoutes - Trials, Reporting and Auto-Renewals", { concurrency: 1 }, () => {
  before(async () => {
    app = await createTestApp();
    const users = await createTestUsers(timestamp);
    adminToken = users.adminToken;
    superAdminToken = users.superAdminToken;
    testAccountId = users.testAccountId;
  });

  after(async () => {
    await cleanupTestUsers(timestamp, testAccountId);
    await app.close();
    try {
      await prisma.$disconnect();
    } catch (err) {
      console.warn("Prisma disconnect warning:", err);
    }
  });

  // Revenue analytics tests removed — endpoint deleted (was 100% fake Math.random data)

  describe("GET /admin/billing/health", () => {
    it("should get subscription health metrics", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/health",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(body.data?.health);
      assert.ok(typeof body.data?.health?.score === "number");
      assert.ok(body.data?.health?.status);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/health",
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe("GET /admin/billing/export", () => {
    it("should export subscriptions as JSON", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/export?format=json",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(Array.isArray(body.data?.data));
    });

    it("should export subscriptions as CSV", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/export?format=csv",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      assert.strictEqual(response.statusCode, 200);
      assert.ok(response.headers["content-type"]?.includes("text/csv"));
      assert.ok(response.headers["content-disposition"]?.includes("attachment"));
    });

    it("should filter export by tier", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/export?format=json&tier=PRO",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/export",
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe("POST /admin/billing/accounts/:accountId/trial/start", () => {
    it("should start trial for account", async () => {
      const trialAccount = await prisma.account.create({
        data: {
          email: `trial-${timestamp}@example.com`,
          name: "Trial Account",
          subscription: "BASIC",
          isOnTrial: false,
        },
      });

      const response = await app.inject({
        method: "POST",
        url: `/admin/billing/accounts/${trialAccount.id}/trial/start`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          tier: "PRO",
          trialDurationDays: 14,
          autoRenewal: false,
          billingCycle: "monthly",
        },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);

      await prisma.project.deleteMany({ where: { accountId: trialAccount.id } });
      await prisma.account.delete({ where: { id: trialAccount.id } });
    });

    it("should reject invalid trial duration", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/billing/accounts/${testAccountId}/trial/start`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          tier: "PRO",
          trialDurationDays: 100,
        },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/billing/accounts/${testAccountId}/trial/start`,
        payload: {
          tier: "PRO",
          trialDurationDays: 7,
        },
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe("GET /admin/billing/trials/expiring", () => {
    it("should get expiring trials", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/trials/expiring?days=7",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(Array.isArray(body.data?.trials));
    });

    it("should reject invalid days parameter", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/trials/expiring?days=100",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/trials/expiring",
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe("GET /admin/billing/trials/stats", () => {
    it("should get trial statistics", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/trials/stats",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(body.data?.stats);
      assert.ok(typeof body.data?.stats?.totalTrials === "number");
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/trials/stats",
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe("POST /admin/billing/auto-renewals/process", () => {
    it("should process auto-renewals with super admin", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/billing/auto-renewals/process",
        headers: { authorization: `Bearer ${superAdminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(typeof body.data?.processed === "number");
      assert.ok(typeof body.data?.failed === "number");
    });

    it("should reject without super admin role", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/billing/auto-renewals/process",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      assert.strictEqual(response.statusCode, 403);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/billing/auto-renewals/process",
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });
});
