/**
 * Unit Tests for subscriptionRoutes — Account Operations and Billing Analytics
 * Covers: GET /stats, validate-limits, suspend, bulk/upgrade, analytics/revenue
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

describe(
  "subscriptionRoutes - Account Operations and Billing Analytics",
  { concurrency: 1 },
  () => {
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

    describe("GET /admin/billing/stats", () => {
      it("should get subscription statistics", async () => {
        const response = await app.inject({
          method: "GET",
          url: "/admin/billing/stats",
          headers: { authorization: `Bearer ${adminToken}` },
        });

        const body = JSON.parse(response.body);

        assert.strictEqual(response.statusCode, 200);
        assert.strictEqual(body.ok, true);
        assert.ok(body.data?.stats);
      });

      it("should reject without authentication", async () => {
        const response = await app.inject({
          method: "GET",
          url: "/admin/billing/stats",
        });

        assert.strictEqual(response.statusCode, 401);
      });
    });

    describe("POST /admin/billing/accounts/:accountId/validate-limits", () => {
      it("should validate CREATE_PROJECT limit", async () => {
        const response = await app.inject({
          method: "POST",
          url: `/admin/billing/accounts/${testAccountId}/validate-limits`,
          headers: { authorization: `Bearer ${adminToken}` },
          payload: {
            operation: "CREATE_PROJECT",
            amount: 1,
          },
        });

        const body = JSON.parse(response.body);

        assert.strictEqual(response.statusCode, 200);
        assert.strictEqual(body.ok, true);
        assert.ok(body.data?.validation);
      });

      it("should validate ADD_TEAM_MEMBER limit", async () => {
        const response = await app.inject({
          method: "POST",
          url: `/admin/billing/accounts/${testAccountId}/validate-limits`,
          headers: { authorization: `Bearer ${adminToken}` },
          payload: {
            operation: "ADD_TEAM_MEMBER",
            amount: 2,
          },
        });

        const body = JSON.parse(response.body);

        assert.strictEqual(response.statusCode, 200);
        assert.strictEqual(body.ok, true);
      });

      it("should reject invalid operation", async () => {
        const response = await app.inject({
          method: "POST",
          url: `/admin/billing/accounts/${testAccountId}/validate-limits`,
          headers: { authorization: `Bearer ${adminToken}` },
          payload: {
            operation: "INVALID_OP",
            amount: 1,
          },
        });

        assert.strictEqual(response.statusCode, 400);
      });

      it("should reject without authentication", async () => {
        const response = await app.inject({
          method: "POST",
          url: `/admin/billing/accounts/${testAccountId}/validate-limits`,
          payload: {
            operation: "CREATE_PROJECT",
            amount: 1,
          },
        });

        assert.strictEqual(response.statusCode, 401);
      });
    });

    describe("POST /admin/billing/accounts/:accountId/suspend", () => {
      it("should suspend account subscription", async () => {
        const response = await app.inject({
          method: "POST",
          url: `/admin/billing/accounts/${testAccountId}/suspend`,
          headers: { authorization: `Bearer ${adminToken}` },
          payload: {
            reason: "Payment failure - account suspended pending resolution",
          },
        });

        const body = JSON.parse(response.body);

        assert.strictEqual(response.statusCode, 200);
        assert.strictEqual(body.ok, true);
      });

      it("should reject empty reason", async () => {
        const response = await app.inject({
          method: "POST",
          url: `/admin/billing/accounts/${testAccountId}/suspend`,
          headers: { authorization: `Bearer ${adminToken}` },
          payload: {
            reason: "",
          },
        });

        assert.strictEqual(response.statusCode, 400);
      });

      it("should reject without authentication", async () => {
        const response = await app.inject({
          method: "POST",
          url: `/admin/billing/accounts/${testAccountId}/suspend`,
          payload: {
            reason: "Valid reason for suspension",
          },
        });

        assert.strictEqual(response.statusCode, 401);
      });
    });

    describe("POST /admin/billing/bulk/upgrade", () => {
      it("should bulk upgrade accounts with super admin", async () => {
        const response = await app.inject({
          method: "POST",
          url: "/admin/billing/bulk/upgrade",
          headers: { authorization: `Bearer ${superAdminToken}` },
          payload: {
            accountIds: [testAccountId],
            newTier: "ENTERPRISE",
            billingCycle: "yearly",
            reason: "Bulk upgrade for testing",
          },
        });

        const body = JSON.parse(response.body);

        assert.strictEqual(response.statusCode, 200);
        assert.strictEqual(body.ok, true);
        assert.ok(typeof body.data?.successful === "number");
        assert.ok(typeof body.data?.failed === "number");
      });

      it("should reject without super admin role", async () => {
        const response = await app.inject({
          method: "POST",
          url: "/admin/billing/bulk/upgrade",
          headers: { authorization: `Bearer ${adminToken}` },
          payload: {
            accountIds: [testAccountId],
            newTier: "PRO",
            billingCycle: "monthly",
          },
        });

        assert.strictEqual(response.statusCode, 403);
      });

      it("should reject too many accounts", async () => {
        const manyIds = Array(51)
          .fill(testAccountId)
          .map((id, i) => `${id}-${i}`);

        const response = await app.inject({
          method: "POST",
          url: "/admin/billing/bulk/upgrade",
          headers: { authorization: `Bearer ${superAdminToken}` },
          payload: {
            accountIds: manyIds,
            newTier: "PRO",
            billingCycle: "monthly",
          },
        });

        assert.strictEqual(response.statusCode, 400);
      });

      it("should reject without authentication", async () => {
        const response = await app.inject({
          method: "POST",
          url: "/admin/billing/bulk/upgrade",
          payload: {
            accountIds: [testAccountId],
            newTier: "PRO",
            billingCycle: "monthly",
          },
        });

        assert.strictEqual(response.statusCode, 401);
      });
    });

    // Revenue analytics tests removed — endpoint deleted (was 100% fake Math.random data)
  }
);
