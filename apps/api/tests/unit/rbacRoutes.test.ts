#!/usr/bin/env tsx
/**
 * Unit Tests for rbacRoutes
 * Testing all RBAC HTTP endpoints
 *
 * Coverage Target: 95%+
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Fastify, { FastifyInstance } from "fastify";
import { ZodTypeProvider, serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { rbacRoutes } from "../../src/auth/rbacRoutes.js";
import { AuthService } from "../../src/auth/authService.js";
import { MfaService } from "../../src/auth/mfaService.js";
import { RbacService } from "../../src/auth/rbacService.js";
import { prisma } from "@infra/prisma";
import { PrismaAdminUserRepository } from "../../src/infrastructure/repositories/PrismaAdminUserRepository.js";
import { Container } from "../../src/infrastructure/container/Container.js";
import { TOKENS } from "../../src/infrastructure/container/types.js";

// Shared service instances — the same AuthService is used both to create tokens
// (in before()) and to verify them inside the route handler, so JWT secrets match.
const adminUserRepo = new PrismaAdminUserRepository(prisma);
const mfaService = new MfaService(adminUserRepo);
const authService = new AuthService(adminUserRepo, mfaService);
const rbacService = new RbacService(adminUserRepo);

// Create test Fastify instance
async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  typedApp.setValidatorCompiler(validatorCompiler);
  typedApp.setSerializerCompiler(serializerCompiler);

  // Register the same service instances used in before() so JWT secrets match.
  const container = new Container();
  container.registerInstance(TOKENS.AuthService, authService);
  container.registerInstance(TOKENS.RbacService, rbacService);
  typedApp.decorate("container", container);

  await typedApp.register(rbacRoutes);

  return typedApp;
}

const timestamp = Date.now();
const adminEmail = `admin-rbac-${timestamp}@example.com`;
const superAdminEmail = `superadmin-rbac-${timestamp}@example.com`;
const supportEmail = `support-rbac-${timestamp}@example.com`;
const testPassword = "TestPassword123!";

let app: FastifyInstance;
let adminToken: string;
let superAdminToken: string;
let supportToken: string;
let _adminUserId: string;
let superAdminUserId: string;
let supportUserId: string;

describe("rbacRoutes Unit Tests", { concurrency: 1 }, () => {
  before(async () => {
    app = await createTestApp();

    // Create admin user
    const adminResult = await authService.registerAdmin(
      adminEmail,
      testPassword,
      "Admin User",
      "ADMIN"
    );
    if (adminResult.ok) {
      _adminUserId = adminResult.value.id;
    }

    // Create super admin user
    const superAdminResult = await authService.registerAdmin(
      superAdminEmail,
      testPassword,
      "Super Admin User",
      "SUPER_ADMIN"
    );
    if (superAdminResult.ok) {
      superAdminUserId = superAdminResult.value.id;
    }

    // Create support user
    const supportResult = await authService.registerAdmin(
      supportEmail,
      testPassword,
      "Support User",
      "SUPPORT"
    );
    if (supportResult.ok) {
      supportUserId = supportResult.value.id;
    }

    // Login to get tokens
    const adminLogin = await authService.login(
      { email: adminEmail, password: testPassword },
      "127.0.0.1",
      "test-agent"
    );
    if (adminLogin.ok && "tokens" in adminLogin.value) {
      adminToken = adminLogin.value.tokens.accessToken;
    }

    const superAdminLogin = await authService.login(
      { email: superAdminEmail, password: testPassword },
      "127.0.0.1",
      "test-agent"
    );
    if (superAdminLogin.ok && "tokens" in superAdminLogin.value) {
      superAdminToken = superAdminLogin.value.tokens.accessToken;
    }

    const supportLogin = await authService.login(
      { email: supportEmail, password: testPassword },
      "127.0.0.1",
      "test-agent"
    );
    if (supportLogin.ok && "tokens" in supportLogin.value) {
      supportToken = supportLogin.value.tokens.accessToken;
    }
  });

  after(async () => {
    // Cleanup
    const testUsers = await prisma.adminUser.findMany({
      where: { email: { contains: `-rbac-${timestamp}` } },
    });

    for (const user of testUsers) {
      await prisma.auditLog.deleteMany({ where: { userId: user.id } });
      await prisma.adminSession.deleteMany({ where: { userId: user.id } });
      await prisma.adminUser.delete({ where: { id: user.id } });
    }

    await app.close();
  });

  describe("GET /auth/permissions", () => {
    it("should get permissions for authenticated admin", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/auth/permissions",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(body.data?.user);
      assert.strictEqual(body.data?.user?.role, "ADMIN");
      assert.ok(Array.isArray(body.data?.permissions));
    });

    it("should get permissions for super admin", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/auth/permissions",
        headers: { authorization: `Bearer ${superAdminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.data?.user?.role, "SUPER_ADMIN");
      assert.ok(Array.isArray(body.data?.permissions));
    });

    it("should get permissions for support user", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/auth/permissions",
        headers: { authorization: `Bearer ${supportToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.data?.user?.role, "SUPPORT");
      assert.ok(Array.isArray(body.data?.permissions));
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/auth/permissions",
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe("GET /admin/rbac/roles", () => {
    it("should get all roles as admin", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/roles",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(Array.isArray(body.data?.roles));
      assert.ok(body.data?.permissionCategories);
      assert.ok(Array.isArray(body.data?.allPermissions));
    });

    it("should reject without admin role", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/roles",
        headers: { authorization: `Bearer ${supportToken}` },
      });

      assert.strictEqual(response.statusCode, 403);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/roles",
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe("GET /admin/rbac/roles/:role", () => {
    it("should get specific role info", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/roles/ADMIN",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(body.data?.role);
    });

    it("should get SUPER_ADMIN role info", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/roles/SUPER_ADMIN",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
    });

    it("should get SUPPORT role info", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/roles/SUPPORT",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
    });

    it("should reject invalid role", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/roles/INVALID_ROLE",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/roles/ADMIN",
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe("GET /admin/rbac/roles/:role/users", () => {
    it("should get users by ADMIN role", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/roles/ADMIN/users",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(Array.isArray(body.data?.users));
      assert.ok(body.data?.count >= 0);
    });

    it("should get users by SUPER_ADMIN role", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/roles/SUPER_ADMIN/users",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(Array.isArray(body.data?.users));
    });

    it("should get users by SUPPORT role", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/roles/SUPPORT/users",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
    });

    it("should reject invalid role", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/roles/INVALID/users",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/roles/ADMIN/users",
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe("PUT /admin/rbac/users/:userId/role", () => {
    it("should update user role as super admin", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/admin/rbac/users/${supportUserId}/role`,
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          role: "ADMIN",
          reason: "Promotion to admin role for increased responsibilities",
        },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.strictEqual(body.data?.newRole, "ADMIN");
    });

    it("should reject without super admin role", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/admin/rbac/users/${supportUserId}/role`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          role: "SUPER_ADMIN",
          reason: "Should not be allowed without super admin",
        },
      });

      assert.strictEqual(response.statusCode, 403);
    });

    it("should reject invalid role", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/admin/rbac/users/${supportUserId}/role`,
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          role: "INVALID_ROLE",
          reason: "Testing invalid role",
        },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject short reason", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/admin/rbac/users/${supportUserId}/role`,
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          role: "SUPPORT",
          reason: "short",
        },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject modifying own role", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/admin/rbac/users/${superAdminUserId}/role`,
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          role: "ADMIN",
          reason: "Attempting to modify own role which should fail",
        },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "PUT",
        url: `/admin/rbac/users/${supportUserId}/role`,
        payload: {
          role: "ADMIN",
          reason: "Valid reason for role change",
        },
      });

      assert.strictEqual(response.statusCode, 401);
    });

    it("should restore support user back to SUPPORT role", async () => {
      // The first test promoted support to ADMIN; restore to SUPPORT so later
      // tests that depend on the SUPPORT role behave correctly.
      const response = await app.inject({
        method: "PUT",
        url: `/admin/rbac/users/${supportUserId}/role`,
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          role: "SUPPORT",
          reason: "Restoring original SUPPORT role for subsequent tests",
        },
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.data?.newRole, "SUPPORT");
    });
  });

  describe("POST /auth/permissions/check", () => {
    it("should check single permission", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/permissions/check",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          permissions: ["user:read"],
          requireAll: false,
        },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(typeof body.data?.hasAccess === "boolean");
      assert.ok(body.data?.permissions);
    });

    it("should check multiple permissions with requireAll", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/permissions/check",
        headers: { authorization: `Bearer ${superAdminToken}` },
        payload: {
          permissions: ["user:read", "user:create"],
          requireAll: true,
        },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
    });

    it("should check permissions with requireAll false", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/permissions/check",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          permissions: ["user:read", "system:configure"],
          requireAll: false,
        },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
    });

    it("should reject invalid permissions", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/permissions/check",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          permissions: ["INVALID_PERMISSION"],
          requireAll: false,
        },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject empty permissions array", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/permissions/check",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          permissions: [],
          requireAll: false,
        },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/permissions/check",
        payload: {
          permissions: ["USER_READ"],
        },
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe("GET /admin/rbac/hierarchy", () => {
    it("should get role hierarchy as admin", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/hierarchy",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(body.data?.hierarchy);
      assert.ok(body.data?.permissionMatrix);
      assert.ok(Array.isArray(body.data?.roles));
    });

    it("should show canModifyRoles for super admin", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/hierarchy",
        headers: { authorization: `Bearer ${superAdminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.data?.currentUser?.canModifyRoles, true);
    });

    it("should reject without admin role", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/hierarchy",
        headers: { authorization: `Bearer ${supportToken}` },
      });

      assert.strictEqual(response.statusCode, 403);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/hierarchy",
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe("GET /admin/rbac/status", () => {
    it("should get RBAC system status", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/status",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.strictEqual(body.data?.status, "active");
      assert.ok(body.data?.statistics);
      assert.ok(typeof body.data?.statistics?.totalUsers === "number");
      assert.ok(typeof body.data?.statistics?.totalRoles === "number");
    });

    it("should include role distribution", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/status",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.ok(Array.isArray(body.data?.statistics?.roleDistribution));
    });

    it("should reject without admin role", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/status",
        headers: { authorization: `Bearer ${supportToken}` },
      });

      assert.strictEqual(response.statusCode, 403);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/rbac/status",
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });
});
