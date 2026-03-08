/**
 * Unit Tests for subscriptionRoutes — Plans and Subscription Management
 * Covers: GET /plans, GET /plans/:tier, GET/PUT /accounts/:id/subscription, GET /subscriptions
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
let testAccountId: string;

describe("subscriptionRoutes - Plans and Subscription Management", { concurrency: 1 }, () => {
  before(async () => {
    app = await createTestApp();
    const users = await createTestUsers(timestamp);
    adminToken = users.adminToken;
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

  describe("GET /admin/billing/plans", () => {
    it("should get all subscription plans", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/plans",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(Array.isArray(body.data?.plans));
      assert.ok(body.data?.plans.length >= 3);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/plans",
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe("GET /admin/billing/plans/:tier", () => {
    it("should get BASIC plan", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/plans/BASIC",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.strictEqual(body.data?.plan?.tier, "BASIC");
    });

    it("should get PRO plan", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/plans/PRO",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.data?.plan?.tier, "PRO");
    });

    it("should get ENTERPRISE plan", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/plans/ENTERPRISE",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.data?.plan?.tier, "ENTERPRISE");
    });

    it("should reject invalid tier", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/plans/INVALID",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/plans/BASIC",
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe("GET /admin/billing/accounts/:accountId/subscription", () => {
    it("should get account subscription", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/admin/billing/accounts/${testAccountId}/subscription`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(body.data?.subscription);
    });

    it("should reject non-existent account", async () => {
      const fakeId = "123e4567-e89b-12d3-a456-426614174000";
      const response = await app.inject({
        method: "GET",
        url: `/admin/billing/accounts/${fakeId}/subscription`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      assert.strictEqual(response.statusCode, 404);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/admin/billing/accounts/${testAccountId}/subscription`,
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe("PUT /admin/billing/accounts/:accountId/subscription", () => {
    it("should update account subscription", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/admin/billing/accounts/${testAccountId}/subscription`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          newTier: "PRO",
          billingCycle: "monthly",
          reason: "Upgrade to PRO tier for testing",
        },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(body.data?.subscription);
    });

    it("should reject invalid tier", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/admin/billing/accounts/${testAccountId}/subscription`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          newTier: "INVALID",
          billingCycle: "monthly",
        },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject invalid billing cycle", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/admin/billing/accounts/${testAccountId}/subscription`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          newTier: "PRO",
          billingCycle: "invalid",
        },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/admin/billing/accounts/${testAccountId}/subscription`,
        payload: {
          newTier: "PRO",
          billingCycle: "monthly",
        },
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe("GET /admin/billing/subscriptions", () => {
    it("should list all subscriptions", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/subscriptions",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(Array.isArray(body.data?.subscriptions));
      assert.ok(body.data?.pagination);
    });

    it("should filter by tier", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/subscriptions?tier=PRO",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
    });

    it("should paginate results", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/subscriptions?page=1&limit=10",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.data?.pagination?.page, 1);
      assert.strictEqual(body.data?.pagination?.limit, 10);
    });

    it("should sort by field", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/subscriptions?sortBy=createdAt&sortOrder=desc",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/billing/subscriptions",
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });
});
