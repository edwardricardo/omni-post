#!/usr/bin/env tsx
/**
 * Unit Tests for auditRoutes
 * Testing all audit HTTP endpoints
 *
 * Coverage Target: 95%+
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Fastify, { FastifyInstance } from "fastify";
import { ZodTypeProvider, serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { auditRoutes } from "../../src/audit/auditRoutes.js";
import type { AuthService } from "../../src/auth/authService.js";
import { auditService } from "../../src/audit/auditService.js";
import { prisma } from "@infra/prisma";
import { setupContainer } from "../../src/infrastructure/container/setup.js";
import { TOKENS } from "../../src/infrastructure/container/types.js";

// Populated by createTestApp() — must match the instance used by the middleware.
let containerAuthService: AuthService;

// Create test Fastify instance
async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  typedApp.setValidatorCompiler(validatorCompiler);
  typedApp.setSerializerCompiler(serializerCompiler);

  const container = setupContainer({ prisma });
  // Capture the container's AuthService so token generation uses the same JWT secret.
  containerAuthService = container.resolve<AuthService>(TOKENS.AuthService);

  typedApp.decorate("container", container);

  await typedApp.register(auditRoutes);

  return typedApp;
}

const timestamp = Date.now();
const adminEmail = `admin-audit-${timestamp}@example.com`;
const superAdminEmail = `superadmin-audit-${timestamp}@example.com`;
const testPassword = "TestPassword123!";

let app: FastifyInstance;
let adminToken: string;
let superAdminToken: string;
let adminUserId: string;
let _testLogId: string;

describe("auditRoutes Unit Tests", { concurrency: 1 }, () => {
  before(async () => {
    app = await createTestApp();

    // Create admin user
    const adminResult = await containerAuthService.registerAdmin(
      adminEmail,
      testPassword,
      "Admin User",
      "ADMIN"
    );
    if (adminResult.ok) {
      adminUserId = adminResult.value.id;
    }

    // Create super admin user
    const _superAdminResult = await containerAuthService.registerAdmin(
      superAdminEmail,
      testPassword,
      "Super Admin User",
      "SUPER_ADMIN"
    );

    // Login to get tokens
    const adminLogin = await containerAuthService.login(
      { email: adminEmail, password: testPassword },
      "127.0.0.1",
      "test-agent"
    );
    if (adminLogin.ok && "tokens" in adminLogin.value) {
      adminToken = adminLogin.value.tokens.accessToken;
    }

    const superAdminLogin = await containerAuthService.login(
      { email: superAdminEmail, password: testPassword },
      "127.0.0.1",
      "test-agent"
    );
    if (superAdminLogin.ok && "tokens" in superAdminLogin.value) {
      superAdminToken = superAdminLogin.value.tokens.accessToken;
    }

    // Create test audit logs
    await auditService.log({
      userId: adminUserId,
      action: "TEST_ACTION",
      resource: "TestResource",
      resourceId: "test-123",
      ipAddress: "127.0.0.1",
      userAgent: "test-agent",
      success: true,
    });
  });

  after(async () => {
    try {
      // Cleanup audit logs created during tests
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { userId: adminUserId },
            { action: "TEST_ACTION" },
            { action: "MANUAL_LOG" },
            { action: "FAILED_ACTION" },
          ],
        },
      });

      // Find all test users by both admin and superadmin email prefixes
      const testUsers = await prisma.adminUser.findMany({
        where: {
          OR: [
            { email: { startsWith: `admin-audit-${timestamp}` } },
            { email: { startsWith: `superadmin-audit-${timestamp}` } },
          ],
        },
      });

      for (const user of testUsers) {
        await prisma.adminSession.deleteMany({ where: { userId: user.id } });
        await prisma.adminUser.delete({ where: { id: user.id } });
      }
    } catch (err) {
      console.warn("Cleanup warning:", err);
    }

    await app.close();
  });

  describe("GET /admin/audit/logs", () => {
    it("should get audit logs with admin token", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/logs",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(Array.isArray(body.data?.logs));
    });

    it("should filter by userId", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/admin/audit/logs?userId=${adminUserId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(body.data?.filters?.userId);
    });

    it("should filter by action", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/logs?action=TEST_ACTION",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
    });

    it("should filter by date range", async () => {
      const startDate = new Date(Date.now() - 86400000).toISOString();
      const endDate = new Date().toISOString();

      const response = await app.inject({
        method: "GET",
        url: `/admin/audit/logs?startDate=${startDate}&endDate=${endDate}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
    });

    it("should paginate results", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/logs?limit=10&offset=0",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/logs",
      });

      assert.strictEqual(response.statusCode, 401);
    });

    it("should reject invalid limit", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/logs?limit=2000",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      assert.strictEqual(response.statusCode, 400);
    });
  });

  describe("GET /admin/audit/stats", () => {
    it("should get audit statistics", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/stats",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(body.data?.stats);
    });

    it("should filter stats by userId", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/admin/audit/stats?userId=${adminUserId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
    });

    it("should filter stats by date range", async () => {
      const startDate = new Date(Date.now() - 86400000).toISOString();
      const endDate = new Date().toISOString();

      const response = await app.inject({
        method: "GET",
        url: `/admin/audit/stats?startDate=${startDate}&endDate=${endDate}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/stats",
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe("GET /admin/audit/users/:userId/logs", () => {
    it("should get user audit logs", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/admin/audit/users/${adminUserId}/logs`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(Array.isArray(body.data?.logs));
    });

    it("should paginate user logs", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/admin/audit/users/${adminUserId}/logs?limit=5&offset=0`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/admin/audit/users/${adminUserId}/logs`,
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe("GET /admin/audit/resources/:resource/logs", () => {
    it("should get resource audit logs", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/resources/TestResource/logs",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(Array.isArray(body.data?.logs));
    });

    it("should filter by resourceId", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/resources/TestResource/logs?resourceId=test-123",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/resources/TestResource/logs",
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe("POST /admin/audit/logs", () => {
    it("should create manual audit log with super admin", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/audit/logs",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          action: "MANUAL_LOG",
          resource: "ManualResource",
          resourceId: "manual-123",
          success: true,
        },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 201);
      assert.strictEqual(body.ok, true);
      assert.ok(body.data?.log);

      _testLogId = body.data?.log?.id;
    });

    it("should reject without super admin role", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/audit/logs",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          action: "MANUAL_LOG",
          success: true,
        },
      });

      assert.strictEqual(response.statusCode, 403);
    });

    it("should create log with error details", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/audit/logs",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          action: "FAILED_ACTION",
          success: false,
          error: "Test error message",
        },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 201);
      assert.strictEqual(body.ok, true);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/audit/logs",
        payload: {
          action: "TEST",
        },
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe("POST /admin/audit/cleanup", () => {
    it("should cleanup old audit logs with super admin", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/audit/cleanup",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          retentionDays: 90,
        },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(typeof body.data?.deletedCount === "number");
    });

    it("should reject without super admin role", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/audit/cleanup",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          retentionDays: 90,
        },
      });

      assert.strictEqual(response.statusCode, 403);
    });

    it("should reject invalid retention days", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/audit/cleanup",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          retentionDays: 5000,
        },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/audit/cleanup",
        payload: {
          retentionDays: 90,
        },
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe("GET /admin/audit/my-logs", () => {
    it("should get current user logs", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/my-logs",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(Array.isArray(body.data?.logs));
    });

    it("should paginate my logs", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/my-logs?limit=10&offset=0",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/my-logs",
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe("GET /admin/audit/export", () => {
    it("should export audit logs as JSON with super admin", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/export?format=json",
        headers: { authorization: `Bearer ${superAdminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.ok(body.export_date);
      assert.ok(Array.isArray(body.logs));
    });

    it("should export audit logs as CSV with super admin", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/export?format=csv",
        headers: { authorization: `Bearer ${superAdminToken}` },
      });

      assert.strictEqual(response.statusCode, 200);
      assert.ok(response.headers["content-type"]?.includes("text/csv"));
      assert.ok(response.headers["content-disposition"]?.includes("attachment"));
      assert.ok(response.body.includes("Timestamp"));
    });

    it("should filter export by date range", async () => {
      const startDate = new Date(Date.now() - 86400000).toISOString();
      const endDate = new Date().toISOString();

      const response = await app.inject({
        method: "GET",
        url: `/admin/audit/export?format=json&startDate=${startDate}&endDate=${endDate}`,
        headers: { authorization: `Bearer ${superAdminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.ok(body.filters);
    });

    it("should reject without super admin role", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/export",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      assert.strictEqual(response.statusCode, 403);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/audit/export",
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });
});
