#!/usr/bin/env tsx
/**
 * Unit Tests for authMiddleware
 * Testing authentication and authorization middleware functions
 *
 * Coverage Target: 95%+
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  authenticateMiddleware,
  requireRole,
  requireAdmin,
  requireSuperAdmin,
  optionalAuth,
} from "../../src/auth/authMiddleware.js";
import { AuthService } from "../../src/auth/authService.js";
import { MfaService } from "../../src/auth/mfaService.js";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { AuthenticatedUser } from "../../src/auth/authService.js";
import { prisma } from "@infra/prisma";
import { PrismaAdminUserRepository } from "../../src/infrastructure/repositories/PrismaAdminUserRepository.js";
import { TOKENS } from "../../src/infrastructure/container/types.js";

const adminUserRepo = new PrismaAdminUserRepository(prisma);
const mfaService = new MfaService(adminUserRepo);
const authService = new AuthService(adminUserRepo, mfaService);

// Minimal container mock that resolves AuthService
const mockContainer = {
  resolve: (token: symbol) => {
    if (token === TOKENS.AuthService) return authService;
    return null;
  },
};

// ============================================================================
// Test Utilities
// ============================================================================

// Mock Fastify Request — includes server.container so authMiddleware can resolve AuthService
function createMockRequest(overrides?: Partial<FastifyRequest>): FastifyRequest {
  return {
    headers: {},
    user: undefined,
    server: { container: mockContainer },
    ...overrides,
  } as unknown as FastifyRequest;
}

// Mock Fastify Reply - Pick<> documents what methods the SUT actually uses
type MockReply = Pick<FastifyReply, "code" | "send"> & {
  getStatusCode: () => number;
  getBody: () => any;
  wasSent: () => boolean;
};

function createMockReply(): MockReply & FastifyReply {
  let statusCode = 200;
  let responseBody: any = null;
  let replySent = false;

  const reply: MockReply = {
    code(code: number) {
      statusCode = code;
      return reply;
    },
    send(body: any) {
      responseBody = body;
      replySent = true;
      return reply;
    },
    getStatusCode: () => statusCode,
    getBody: () => responseBody,
    wasSent: () => replySent,
  };

  return reply as MockReply & FastifyReply;
}

// ============================================================================
// Test Setup
// ============================================================================

const timestamp = Date.now();
const superAdminEmail = `test-superadmin-${timestamp}@example.com`;
const adminEmail = `test-admin-${timestamp}@example.com`;
const supportEmail = `test-support-${timestamp}@example.com`;
const testPassword = "TestPassword123!";

let superAdminId: string;
let adminId: string;
let supportId: string;
let superAdminToken: string;
let adminToken: string;
let supportToken: string;

// ============================================================================
// Main Test Suite
// ============================================================================

describe("authMiddleware Tests", () => {
  before(async () => {
    // Register test users
    const superAdminResult = await authService.registerAdmin(
      superAdminEmail,
      testPassword,
      "Test Super Admin",
      "SUPER_ADMIN"
    );

    const adminResult = await authService.registerAdmin(
      adminEmail,
      testPassword,
      "Test Admin",
      "ADMIN"
    );

    const supportResult = await authService.registerAdmin(
      supportEmail,
      testPassword,
      "Test Support",
      "SUPPORT"
    );

    assert.strictEqual(superAdminResult.ok, true, "Created test super admin user");
    assert.strictEqual(adminResult.ok, true, "Created test admin user");
    assert.strictEqual(supportResult.ok, true, "Created test support user");

    superAdminId = superAdminResult.ok ? superAdminResult.value.id : "";
    adminId = adminResult.ok ? adminResult.value.id : "";
    supportId = supportResult.ok ? supportResult.value.id : "";

    // Login to get valid tokens
    const superAdminLogin = await authService.login(
      { email: superAdminEmail, password: testPassword },
      "192.168.1.100",
      "TestAgent-SuperAdmin"
    );

    const adminLogin = await authService.login(
      { email: adminEmail, password: testPassword },
      "192.168.1.101",
      "TestAgent-Admin"
    );

    const supportLogin = await authService.login(
      { email: supportEmail, password: testPassword },
      "192.168.1.102",
      "TestAgent-Support"
    );

    assert.strictEqual(superAdminLogin.ok, true, "Super admin login successful");
    assert.strictEqual(adminLogin.ok, true, "Admin login successful");
    assert.strictEqual(supportLogin.ok, true, "Support login successful");

    superAdminToken = superAdminLogin.ok ? superAdminLogin.value.tokens.accessToken : "";
    adminToken = adminLogin.ok ? adminLogin.value.tokens.accessToken : "";
    supportToken = supportLogin.ok ? supportLogin.value.tokens.accessToken : "";
  });

  after(async () => {
    // Cleanup test data
    const testUserIds = [superAdminId, adminId, supportId];

    for (const userId of testUserIds) {
      await prisma.auditLog.deleteMany({ where: { userId } });
      await prisma.adminSession.deleteMany({ where: { userId } });
      await prisma.adminUser.delete({ where: { id: userId } }).catch(() => {});
    }

    // Delete revoked user
    const revokedUser = await prisma.adminUser.findUnique({
      where: { email: `test-revoked-${timestamp}@example.com` },
    });

    if (revokedUser) {
      await prisma.auditLog.deleteMany({ where: { userId: revokedUser.id } });
      await prisma.adminSession.deleteMany({ where: { userId: revokedUser.id } });
      await prisma.adminUser.delete({ where: { id: revokedUser.id } });
    }

    // Delete inactive user
    const inactiveUser = await prisma.adminUser.findUnique({
      where: { email: `test-inactive-${timestamp}@example.com` },
    });

    if (inactiveUser) {
      await prisma.auditLog.deleteMany({ where: { userId: inactiveUser.id } });
      await prisma.adminSession.deleteMany({ where: { userId: inactiveUser.id } });
      await prisma.adminUser.delete({ where: { id: inactiveUser.id } });
    }
  });

  // ============================================================================
  // Test Group 1: authenticateMiddleware - Success Cases
  // ============================================================================

  describe("authenticateMiddleware - Success Cases", () => {
    it("should accept valid token with Bearer prefix", async () => {
      const request = createMockRequest({
        headers: { authorization: `Bearer ${superAdminToken}` },
      });
      const reply = createMockReply();

      await authenticateMiddleware(request, reply);

      assert.strictEqual(reply.wasSent(), false);
      assert.notStrictEqual(request.user, undefined);
      assert.strictEqual(request.user?.email, superAdminEmail);
      assert.strictEqual(request.user?.role, "SUPER_ADMIN");
    });

    it("should accept valid admin token", async () => {
      const request = createMockRequest({
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const reply = createMockReply();

      await authenticateMiddleware(request, reply);

      assert.strictEqual(reply.wasSent(), false);
      assert.strictEqual(request.user?.role, "ADMIN");
    });

    it("should accept valid support token", async () => {
      const request = createMockRequest({
        headers: { authorization: `Bearer ${supportToken}` },
      });
      const reply = createMockReply();

      await authenticateMiddleware(request, reply);

      assert.strictEqual(reply.wasSent(), false);
      assert.strictEqual(request.user?.role, "SUPPORT");
    });
  });

  // ============================================================================
  // Test Group 2: authenticateMiddleware - Failure Cases
  // ============================================================================

  describe("authenticateMiddleware - Failure Cases", () => {
    it("should reject when no Authorization header", async () => {
      const request = createMockRequest({ headers: {} });
      const reply = createMockReply();

      await authenticateMiddleware(request, reply);

      assert.strictEqual(reply.wasSent(), true);
      assert.strictEqual(reply.getStatusCode(), 401);
      assert.strictEqual(reply.getBody()?.error, "Authorization token required");
    });

    it("should reject token without Bearer prefix", async () => {
      const request = createMockRequest({
        headers: { authorization: superAdminToken },
      });
      const reply = createMockReply();

      await authenticateMiddleware(request, reply);

      assert.strictEqual(reply.wasSent(), true);
      assert.strictEqual(reply.getStatusCode(), 401);
    });

    it("should reject empty Bearer token", async () => {
      const request = createMockRequest({
        headers: { authorization: "Bearer " },
      });
      const reply = createMockReply();

      await authenticateMiddleware(request, reply);

      assert.strictEqual(reply.wasSent(), true);
      assert.strictEqual(reply.getStatusCode(), 401);
    });

    it("should reject invalid token format", async () => {
      const request = createMockRequest({
        headers: { authorization: "Bearer invalid-token-format" },
      });
      const reply = createMockReply();

      await authenticateMiddleware(request, reply);

      assert.strictEqual(reply.wasSent(), true);
      assert.strictEqual(reply.getStatusCode(), 401);
      assert.strictEqual(reply.getBody()?.error, "Invalid token");
    });

    it("should reject token from revoked session", async () => {
      // Create a new user and session, then revoke it
      const revokedUserEmail = `test-revoked-${timestamp}@example.com`;
      const revokedUserResult = await authService.registerAdmin(
        revokedUserEmail,
        testPassword,
        "Test Revoked User",
        "ADMIN"
      );

      assert.strictEqual(revokedUserResult.ok, true);

      const revokedUserId = revokedUserResult.ok ? revokedUserResult.value.id : "";

      const revokedLogin = await authService.login(
        { email: revokedUserEmail, password: testPassword },
        "192.168.1.200",
        "TestAgent-Revoked"
      );

      assert.strictEqual(revokedLogin.ok, true);

      const revokedToken = revokedLogin.ok ? revokedLogin.value.tokens.accessToken : "";

      // Revoke all sessions
      await authService.revokeAllSessions(revokedUserId);

      const request = createMockRequest({
        headers: { authorization: `Bearer ${revokedToken}` },
      });
      const reply = createMockReply();

      await authenticateMiddleware(request, reply);

      assert.strictEqual(reply.wasSent(), true);
      assert.strictEqual(reply.getStatusCode(), 401);
    });

    it("should reject token from inactive user", async () => {
      // Create a user and mark as inactive
      const inactiveUserEmail = `test-inactive-${timestamp}@example.com`;
      const inactiveUserResult = await authService.registerAdmin(
        inactiveUserEmail,
        testPassword,
        "Test Inactive User",
        "ADMIN"
      );

      assert.strictEqual(inactiveUserResult.ok, true);

      const inactiveUserId = inactiveUserResult.ok ? inactiveUserResult.value.id : "";

      const inactiveLogin = await authService.login(
        { email: inactiveUserEmail, password: testPassword },
        "192.168.1.201",
        "TestAgent-Inactive"
      );

      assert.strictEqual(inactiveLogin.ok, true);

      const inactiveToken = inactiveLogin.ok ? inactiveLogin.value.tokens.accessToken : "";

      // Mark user as inactive
      await prisma.adminUser.update({
        where: { id: inactiveUserId },
        data: { isActive: false },
      });

      const request = createMockRequest({
        headers: { authorization: `Bearer ${inactiveToken}` },
      });
      const reply = createMockReply();

      await authenticateMiddleware(request, reply);

      assert.strictEqual(reply.wasSent(), true);
      assert.strictEqual(reply.getStatusCode(), 403);
      assert.strictEqual(reply.getBody()?.error, "Account is inactive");
    });
  });

  // ============================================================================
  // Test Group 3: requireRole - Success Cases
  // ============================================================================

  describe("requireRole - Success Cases", () => {
    it("should allow SUPER_ADMIN for SUPER_ADMIN role", async () => {
      const request = createMockRequest({
        user: {
          id: superAdminId,
          email: superAdminEmail,
          name: "Test Super Admin",
          role: "SUPER_ADMIN",
          isActive: true,
          emailVerified: true,
          mfaEnabled: false,
          lastLoginAt: null,
        } as AuthenticatedUser,
      });
      const reply = createMockReply();

      const middleware = requireRole("SUPER_ADMIN");
      await middleware(request, reply);

      assert.strictEqual(reply.wasSent(), false);
    });

    it("should allow ADMIN for ADMIN role", async () => {
      const request = createMockRequest({
        user: {
          id: adminId,
          email: adminEmail,
          name: "Test Admin",
          role: "ADMIN",
          isActive: true,
          emailVerified: true,
          mfaEnabled: false,
          lastLoginAt: null,
        } as AuthenticatedUser,
      });
      const reply = createMockReply();

      const middleware = requireRole("ADMIN");
      await middleware(request, reply);

      assert.strictEqual(reply.wasSent(), false);
    });

    it("should allow SUPPORT for SUPPORT role", async () => {
      const request = createMockRequest({
        user: {
          id: supportId,
          email: supportEmail,
          name: "Test Support",
          role: "SUPPORT",
          isActive: true,
          emailVerified: true,
          mfaEnabled: false,
          lastLoginAt: null,
        } as AuthenticatedUser,
      });
      const reply = createMockReply();

      const middleware = requireRole("SUPPORT");
      await middleware(request, reply);

      assert.strictEqual(reply.wasSent(), false);
    });

    it("should allow SUPER_ADMIN when multiple roles specified", async () => {
      const request = createMockRequest({
        user: {
          id: superAdminId,
          email: superAdminEmail,
          name: "Test Super Admin",
          role: "SUPER_ADMIN",
          isActive: true,
          emailVerified: true,
          mfaEnabled: false,
          lastLoginAt: null,
        } as AuthenticatedUser,
      });
      const reply = createMockReply();

      const middleware = requireRole("SUPER_ADMIN", "ADMIN");
      await middleware(request, reply);

      assert.strictEqual(reply.wasSent(), false);
    });

    it("should allow ADMIN when multiple roles specified", async () => {
      const request = createMockRequest({
        user: {
          id: adminId,
          email: adminEmail,
          name: "Test Admin",
          role: "ADMIN",
          isActive: true,
          emailVerified: true,
          mfaEnabled: false,
          lastLoginAt: null,
        } as AuthenticatedUser,
      });
      const reply = createMockReply();

      const middleware = requireRole("SUPER_ADMIN", "ADMIN", "SUPPORT");
      await middleware(request, reply);

      assert.strictEqual(reply.wasSent(), false);
    });
  });

  // ============================================================================
  // Test Group 4: requireRole - Failure Cases
  // ============================================================================

  describe("requireRole - Failure Cases", () => {
    it("should reject when no user attached to request", async () => {
      const request = createMockRequest({ user: undefined });
      const reply = createMockReply();

      const middleware = requireRole("ADMIN");
      await middleware(request, reply);

      assert.strictEqual(reply.wasSent(), true);
      assert.strictEqual(reply.getStatusCode(), 401);
      assert.strictEqual(reply.getBody()?.error, "Authentication required");
    });

    it("should reject user role not in allowed roles", async () => {
      const request = createMockRequest({
        user: {
          id: supportId,
          email: supportEmail,
          name: "Test Support",
          role: "SUPPORT",
          isActive: true,
          emailVerified: true,
          mfaEnabled: false,
          lastLoginAt: null,
        } as AuthenticatedUser,
      });
      const reply = createMockReply();

      const middleware = requireRole("SUPER_ADMIN", "ADMIN");
      await middleware(request, reply);

      assert.strictEqual(reply.wasSent(), true);
      assert.strictEqual(reply.getStatusCode(), 403);
      assert.strictEqual(reply.getBody()?.error, "Insufficient permissions");
      assert.deepStrictEqual(reply.getBody()?.required, ["SUPER_ADMIN", "ADMIN"]);
      assert.strictEqual(reply.getBody()?.current, "SUPPORT");
    });

    it("should reject ADMIN for SUPER_ADMIN-only role", async () => {
      const request = createMockRequest({
        user: {
          id: adminId,
          email: adminEmail,
          name: "Test Admin",
          role: "ADMIN",
          isActive: true,
          emailVerified: true,
          mfaEnabled: false,
          lastLoginAt: null,
        } as AuthenticatedUser,
      });
      const reply = createMockReply();

      const middleware = requireRole("SUPER_ADMIN");
      await middleware(request, reply);

      assert.strictEqual(reply.wasSent(), true);
      assert.strictEqual(reply.getStatusCode(), 403);
    });
  });

  // ============================================================================
  // Test Group 5: requireAdmin - Success Cases
  // ============================================================================

  describe("requireAdmin - Success Cases", () => {
    it("should allow ADMIN role", async () => {
      const request = createMockRequest({
        user: {
          id: adminId,
          email: adminEmail,
          name: "Test Admin",
          role: "ADMIN",
          isActive: true,
          emailVerified: true,
          mfaEnabled: false,
          lastLoginAt: null,
        } as AuthenticatedUser,
      });
      const reply = createMockReply();

      await requireAdmin(request, reply);

      assert.strictEqual(reply.wasSent(), false);
    });

    it("should allow SUPER_ADMIN role", async () => {
      const request = createMockRequest({
        user: {
          id: superAdminId,
          email: superAdminEmail,
          name: "Test Super Admin",
          role: "SUPER_ADMIN",
          isActive: true,
          emailVerified: true,
          mfaEnabled: false,
          lastLoginAt: null,
        } as AuthenticatedUser,
      });
      const reply = createMockReply();

      await requireAdmin(request, reply);

      assert.strictEqual(reply.wasSent(), false);
    });
  });

  // ============================================================================
  // Test Group 6: requireAdmin - Failure Cases
  // ============================================================================

  describe("requireAdmin - Failure Cases", () => {
    it("should reject when no user attached", async () => {
      const request = createMockRequest({ user: undefined });
      const reply = createMockReply();

      await requireAdmin(request, reply);

      assert.strictEqual(reply.wasSent(), true);
      assert.strictEqual(reply.getStatusCode(), 401);
      assert.strictEqual(reply.getBody()?.error, "Authentication required");
    });

    it("should reject SUPPORT user", async () => {
      const request = createMockRequest({
        user: {
          id: supportId,
          email: supportEmail,
          name: "Test Support",
          role: "SUPPORT",
          isActive: true,
          emailVerified: true,
          mfaEnabled: false,
          lastLoginAt: null,
        } as AuthenticatedUser,
      });
      const reply = createMockReply();

      await requireAdmin(request, reply);

      assert.strictEqual(reply.wasSent(), true);
      assert.strictEqual(reply.getStatusCode(), 403);
      assert.strictEqual(reply.getBody()?.error, "Admin access required");
      assert.strictEqual(reply.getBody()?.current, "SUPPORT");
    });
  });

  // ============================================================================
  // Test Group 7: requireSuperAdmin - Success Cases
  // ============================================================================

  describe("requireSuperAdmin - Success Cases", () => {
    it("should allow SUPER_ADMIN role", async () => {
      const request = createMockRequest({
        user: {
          id: superAdminId,
          email: superAdminEmail,
          name: "Test Super Admin",
          role: "SUPER_ADMIN",
          isActive: true,
          emailVerified: true,
          mfaEnabled: false,
          lastLoginAt: null,
        } as AuthenticatedUser,
      });
      const reply = createMockReply();

      await requireSuperAdmin(request, reply);

      assert.strictEqual(reply.wasSent(), false);
    });
  });

  // ============================================================================
  // Test Group 8: requireSuperAdmin - Failure Cases
  // ============================================================================

  describe("requireSuperAdmin - Failure Cases", () => {
    it("should reject when no user attached", async () => {
      const request = createMockRequest({ user: undefined });
      const reply = createMockReply();

      await requireSuperAdmin(request, reply);

      assert.strictEqual(reply.wasSent(), true);
      assert.strictEqual(reply.getStatusCode(), 401);
      assert.strictEqual(reply.getBody()?.error, "Authentication required");
    });

    it("should reject ADMIN role", async () => {
      const request = createMockRequest({
        user: {
          id: adminId,
          email: adminEmail,
          name: "Test Admin",
          role: "ADMIN",
          isActive: true,
          emailVerified: true,
          mfaEnabled: false,
          lastLoginAt: null,
        } as AuthenticatedUser,
      });
      const reply = createMockReply();

      await requireSuperAdmin(request, reply);

      assert.strictEqual(reply.wasSent(), true);
      assert.strictEqual(reply.getStatusCode(), 403);
      assert.strictEqual(reply.getBody()?.error, "Super admin access required");
      assert.strictEqual(reply.getBody()?.current, "ADMIN");
    });

    it("should reject SUPPORT role", async () => {
      const request = createMockRequest({
        user: {
          id: supportId,
          email: supportEmail,
          name: "Test Support",
          role: "SUPPORT",
          isActive: true,
          emailVerified: true,
          mfaEnabled: false,
          lastLoginAt: null,
        } as AuthenticatedUser,
      });
      const reply = createMockReply();

      await requireSuperAdmin(request, reply);

      assert.strictEqual(reply.wasSent(), true);
      assert.strictEqual(reply.getStatusCode(), 403);
    });
  });

  // ============================================================================
  // Test Group 9: optionalAuth - Success Cases
  // ============================================================================

  describe("optionalAuth - Success Cases", () => {
    it("should attach user with valid token", async () => {
      const request = createMockRequest({
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const reply = createMockReply();

      await optionalAuth(request, reply);

      assert.strictEqual(reply.wasSent(), false);
      assert.notStrictEqual(request.user, undefined);
      assert.strictEqual(request.user?.email, adminEmail);
    });

    it("should continue without error when no token", async () => {
      const request = createMockRequest({ headers: {} });
      const reply = createMockReply();

      await optionalAuth(request, reply);

      assert.strictEqual(reply.wasSent(), false);
      assert.strictEqual(request.user, undefined);
    });

    it("should continue without error with invalid token", async () => {
      const request = createMockRequest({
        headers: { authorization: "Bearer invalid-token" },
      });
      const reply = createMockReply();

      await optionalAuth(request, reply);

      assert.strictEqual(reply.wasSent(), false);
      assert.strictEqual(request.user, undefined);
    });

    it("should continue without error without Bearer prefix", async () => {
      const request = createMockRequest({
        headers: { authorization: adminToken },
      });
      const reply = createMockReply();

      await optionalAuth(request, reply);

      assert.strictEqual(reply.wasSent(), false);
      assert.strictEqual(request.user, undefined);
    });

    it("should continue without error with empty Bearer token", async () => {
      const request = createMockRequest({
        headers: { authorization: "Bearer " },
      });
      const reply = createMockReply();

      await optionalAuth(request, reply);

      assert.strictEqual(reply.wasSent(), false);
      assert.strictEqual(request.user, undefined);
    });
  });
});
