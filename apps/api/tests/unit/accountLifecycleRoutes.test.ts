#!/usr/bin/env tsx
/**
 * Unit Tests for accountLifecycleRoutes
 * Testing all admin account lifecycle HTTP endpoints
 *
 * Coverage Target: 95%+
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Fastify, { FastifyInstance } from "fastify";
import { ZodTypeProvider, serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import fastifyCookie from "@fastify/cookie";
import { accountLifecycleRoutes } from "../../src/admin/accountLifecycleRoutes.js";
import { setupContainer } from "../../src/infrastructure/container/setup.js";
import { prisma } from "@infra/prisma";
import { createTestAdminUser, cleanupTestAdminUsersByEmail } from "./admin/adminTestHelper.js";

// Create test Fastify instance with admin auth
async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  typedApp.setValidatorCompiler(validatorCompiler);
  typedApp.setSerializerCompiler(serializerCompiler);

  const container = setupContainer({ prisma });
  typedApp.decorate("container", container);

  await typedApp.register(fastifyCookie);
  await typedApp.register(accountLifecycleRoutes);

  return typedApp;
}

const timestamp = Date.now();
const superAdminEmail = `superadmin-lifecycle-${timestamp}@example.com`;
const adminEmail = `admin-lifecycle-${timestamp}@example.com`;
const testPassword = "TestPassword123!";

let app: FastifyInstance;
let superAdminToken: string;
let adminToken: string;
let testAccountId: string;

describe("accountLifecycleRoutes Unit Tests", { concurrency: 1 }, () => {
  before(async () => {
    app = await createTestApp();

    // Create super admin user with valid admin JWT token
    const superAdminResult = await createTestAdminUser({
      email: superAdminEmail,
      name: "Super Admin",
      password: testPassword,
      role: "SUPER_ADMIN",
    });
    superAdminToken = superAdminResult.token;

    // Create admin user with valid admin JWT token
    const adminResult = await createTestAdminUser({
      email: adminEmail,
      name: "Admin User",
      password: testPassword,
      role: "ADMIN",
    });
    adminToken = adminResult.token;
  });

  after(async () => {
    try {
      // Cleanup test users and related data
      await cleanupTestAdminUsersByEmail(`lifecycle-${timestamp}`);
      // Also clean up accounts created during bulk/delete tests
      await cleanupTestAdminUsersByEmail(`bulk1-${timestamp}`);
      await cleanupTestAdminUsersByEmail(`bulk2-${timestamp}`);
      await cleanupTestAdminUsersByEmail(`new-account-${timestamp}`);
      await cleanupTestAdminUsersByEmail(`removal-${timestamp}`);
    } catch (err) {
      console.warn("Cleanup warning:", err);
    }

    await app.close();
    try {
      await prisma.$disconnect();
    } catch (err) {
      console.warn("Prisma disconnect warning:", err);
    }
  });

  describe("POST /admin/accounts", () => {
    it("should create account as super admin", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/accounts",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          email: `new-account-${timestamp}@example.com`,
          password: testPassword,
          name: "New Admin Account",
          role: "ADMIN",
        },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 201);
      assert.strictEqual(body.ok, true);
      assert.ok(body.data?.account?.id);
      assert.strictEqual(body.data?.account?.role, "ADMIN");

      testAccountId = body.data?.account?.id || "";
    });

    it("should reject creation without authentication", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/accounts",
        payload: {
          email: `unauth-${timestamp}@example.com`,
          password: testPassword,
          name: "Unauthorized",
        },
      });

      assert.strictEqual(response.statusCode, 401);
    });

    it("should reject creation with admin role (not super admin)", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/accounts",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          email: `admin-create-${timestamp}@example.com`,
          password: testPassword,
          name: "Admin Created",
        },
      });

      assert.strictEqual(response.statusCode, 403);
    });

    it("should reject duplicate email", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/accounts",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          email: `new-account-${timestamp}@example.com`,
          password: testPassword,
          name: "Duplicate",
        },
      });

      assert.strictEqual(response.statusCode, 409);
    });

    it("should reject weak password", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/accounts",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          email: `weak-pw-${timestamp}@example.com`,
          password: "weak",
          name: "Weak Password",
        },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject invalid email format", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/accounts",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          email: "invalid-email",
          password: testPassword,
          name: "Invalid Email",
        },
      });

      assert.strictEqual(response.statusCode, 400);
    });
  });

  describe("GET /admin/accounts/:accountId", () => {
    it("should get account as admin", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/admin/accounts/${testAccountId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.strictEqual(body.data?.account?.id, testAccountId);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/admin/accounts/${testAccountId}`,
      });

      assert.strictEqual(response.statusCode, 401);
    });

    it("should return 404 for non-existent account", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/accounts/a0000000-0000-4000-8000-000000000000",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      assert.strictEqual(response.statusCode, 404);
    });
  });

  describe("GET /admin/accounts", () => {
    it("should list accounts with pagination", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/accounts?page=1&limit=10",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(Array.isArray(body.data?.accounts));
      assert.ok(body.data?.pagination);
      assert.strictEqual(body.data?.pagination?.page, 1);
      assert.strictEqual(body.data?.pagination?.limit, 10);
    });

    it("should filter accounts by role", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/accounts?role=ADMIN",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.ok(Array.isArray(body.data?.accounts));
    });

    it("should filter accounts by active status", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/accounts?isActive=true",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const _body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/accounts",
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe("PUT /admin/accounts/:accountId", () => {
    it("should update account name as admin", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/admin/accounts/${testAccountId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: "Updated Name",
        },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.data?.account?.name, "Updated Name");
    });

    it("should update account role as super admin", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/admin/accounts/${testAccountId}`,
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          role: "SUPPORT",
        },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.data?.account?.role, "SUPPORT");
    });

    it("should reject role change by admin (not super admin)", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/admin/accounts/${testAccountId}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          role: "ADMIN",
        },
      });

      assert.strictEqual(response.statusCode, 403);
    });

    it("should return 404 for non-existent account", async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/admin/accounts/a0000000-0000-4000-8000-000000000000",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: "Updated",
        },
      });

      assert.strictEqual(response.statusCode, 404);
    });
  });

  describe("POST /admin/accounts/:accountId/suspend", () => {
    it("should suspend account as admin", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/accounts/${testAccountId}/suspend`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          reason: "Policy violation",
        },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
    });

    it("should reject suspending already suspended account", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/accounts/${testAccountId}/suspend`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          reason: "Already suspended",
        },
      });

      assert.strictEqual(response.statusCode, 409);
    });

    it("should reject without reason", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/accounts/${testAccountId}/suspend`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {},
      });

      assert.strictEqual(response.statusCode, 400);
    });
  });

  describe("POST /admin/accounts/:accountId/reactivate", () => {
    it("should reactivate account as admin", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/accounts/${testAccountId}/reactivate`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
    });

    it("should reject reactivating already active account", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/accounts/${testAccountId}/reactivate`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      assert.strictEqual(response.statusCode, 409);
    });
  });

  describe("POST /admin/accounts/:accountId/reset-password", () => {
    it("should reset password as admin", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/accounts/${testAccountId}/reset-password`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          newPassword: "NewSecurePassword123!",
          requirePasswordChange: true,
        },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
    });

    it("should reject weak new password", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/accounts/${testAccountId}/reset-password`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          newPassword: "weak",
        },
      });

      assert.strictEqual(response.statusCode, 400);
    });
  });

  describe("GET /admin/accounts/:accountId/sessions", () => {
    it("should get account sessions as admin", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/admin/accounts/${testAccountId}/sessions`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.ok(Array.isArray(body.data?.sessions));
    });

    it("should return 404 for non-existent account", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/accounts/a0000000-0000-4000-8000-000000000000/sessions",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      assert.strictEqual(response.statusCode, 404);
    });
  });

  describe("POST /admin/accounts/:accountId/revoke-sessions", () => {
    it("should revoke all sessions as admin", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/accounts/${testAccountId}/revoke-sessions`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(typeof body.data?.revokedCount, "number");
    });
  });

  describe("GET /admin/accounts/stats", () => {
    it("should get account statistics", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/accounts/stats",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.ok(body.data?.stats);
    });
  });

  describe("POST /admin/accounts/bulk/suspend", () => {
    let bulkAccountId1: string;
    let bulkAccountId2: string;

    before(async () => {
      // Create accounts for bulk operations
      const response1 = await app.inject({
        method: "POST",
        url: "/admin/accounts",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          email: `bulk1-${timestamp}@example.com`,
          password: testPassword,
          name: "Bulk 1",
        },
      });
      bulkAccountId1 = JSON.parse(response1.body).data?.account?.id || "";

      const response2 = await app.inject({
        method: "POST",
        url: "/admin/accounts",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          email: `bulk2-${timestamp}@example.com`,
          password: testPassword,
          name: "Bulk 2",
        },
      });
      bulkAccountId2 = JSON.parse(response2.body).data?.account?.id || "";
    });

    it("should bulk suspend accounts as super admin", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/accounts/bulk/suspend",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          accountIds: [bulkAccountId1, bulkAccountId2],
          reason: "Bulk suspension test",
        },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.data?.successful, 2);
    });

    it("should reject bulk suspend without super admin", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/accounts/bulk/suspend",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          accountIds: [bulkAccountId1],
          reason: "Test",
        },
      });

      assert.strictEqual(response.statusCode, 403);
    });
  });

  describe("POST /admin/accounts/bulk/reactivate", () => {
    it("should bulk reactivate accounts as super admin", async () => {
      // Get suspended accounts from previous test
      const listResponse = await app.inject({
        method: "GET",
        url: "/admin/accounts?isActive=false",
        headers: { authorization: `Bearer ${superAdminToken}` },
      });

      const listBody = JSON.parse(listResponse.body);
      const suspendedIds = listBody.data?.accounts?.map((a: any) => a.id) || [];

      const response = await app.inject({
        method: "POST",
        url: "/admin/accounts/bulk/reactivate",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          accountIds: suspendedIds.slice(0, 2),
        },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.ok(typeof body.data?.successful === "number");
    });
  });

  describe("DELETE /admin/accounts/:accountId", () => {
    let deleteAccountId: string;

    before(async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/accounts",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          email: `removal-${timestamp}@example.com`,
          password: testPassword,
          name: "To Remove",
        },
      });

      deleteAccountId = JSON.parse(response.body).data?.account?.id || "";
    });

    it("should delete account as super admin", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: `/admin/accounts/${deleteAccountId}`,
        headers: { authorization: `Bearer ${superAdminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
    });

    it("should reject deletion without super admin", async () => {
      const response = await app.inject({
        method: "DELETE",
        url: `/admin/accounts/${testAccountId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      assert.strictEqual(response.statusCode, 403);
    });
  });
});
