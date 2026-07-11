/**
 * @file auth.test.ts
 * @description Tests for Authentication Service
 * @layer infrastructure
 */
import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { AuthService } from "../src/auth/authService.js";
import { MfaService } from "../src/admin/auth/MfaService.js";
import { PrismaAdminMfaUserRepository } from "../src/infrastructure/adapters/PrismaAdminMfaUserRepository.js";
import { PrismaCustomerMfaUserRepository } from "../src/infrastructure/adapters/PrismaCustomerMfaUserRepository.js";
import { prisma } from "@infra/prisma";
import { PrismaAdminUserRepository } from "../src/infrastructure/repositories/PrismaAdminUserRepository.js";
import { PrismaRoleRepository } from "../src/infrastructure/repositories/PrismaRoleRepository.js";
import { PrismaAdminSessionRepository } from "../src/infrastructure/repositories/PrismaAdminSessionRepository.js";
import { PrismaAuditLogRepository } from "../src/infrastructure/repositories/PrismaAuditLogRepository.js";

const adminUserRepo = new PrismaAdminUserRepository(prisma);
const roleRepo = new PrismaRoleRepository(prisma);
const sessionRepo = new PrismaAdminSessionRepository(prisma);
const mfaService = new MfaService(
  new PrismaAdminMfaUserRepository(prisma),
  new PrismaCustomerMfaUserRepository(prisma),
  new PrismaAuditLogRepository(prisma)
);
const authService = new AuthService(
  prisma,
  adminUserRepo,
  mfaService,
  roleRepo,
  sessionRepo,
  new PrismaAuditLogRepository(prisma)
);

/**
 * Authentication Service Tests
 * Tests core authentication flows including registration, login, token management, and sessions
 */

describe("Authentication Service", () => {
  const testUsers: string[] = [];

  // Clean up all test users
  after(async () => {
    if (testUsers.length > 0) {
      await prisma.adminUser.deleteMany({
        where: {
          id: { in: testUsers },
        },
      });
    }
  });

  describe("Admin User Registration", () => {
    let userId: string;

    afterEach(async () => {
      if (userId) {
        await prisma.adminUser.delete({ where: { id: userId } }).catch(() => {});
        userId = "";
      }
    });

    it("should register a new admin user successfully", async () => {
      const email = `admin-${Date.now()}@test.com`;
      const result = await authService.registerAdmin(email, "password123", "Test Admin", "ADMIN");

      assert.ok(result.ok, `Registration failed: ${result.ok ? "" : result.error}`);
      assert.equal(result.value.email, email);
      assert.equal(result.value.role, "ADMIN");
      assert.ok(result.value.id);

      userId = result.value.id;
      testUsers.push(userId);
    });

    it("should register a super admin user successfully", async () => {
      const email = `superadmin-${Date.now()}@test.com`;
      const result = await authService.registerAdmin(
        email,
        "password123",
        "Super Admin",
        "SUPER_ADMIN"
      );

      assert.ok(result.ok, "Super admin registration should succeed");
      assert.equal(result.value.role, "SUPER_ADMIN");

      userId = result.value.id;
      testUsers.push(userId);
    });

    it("should reject duplicate email registration", async () => {
      const email = `duplicate-${Date.now()}@test.com`;

      // First registration
      const result1 = await authService.registerAdmin(email, "password123", "First User", "ADMIN");
      assert.ok(result1.ok, "First registration should succeed");
      userId = result1.value.id;
      testUsers.push(userId);

      // Duplicate registration
      const result2 = await authService.registerAdmin(email, "password123", "Second User", "ADMIN");
      assert.ok(!result2.ok, "Duplicate email should be rejected");
    });
  });

  describe("User Login", () => {
    let testEmail: string;
    let testUserId: string;

    beforeEach(async () => {
      testEmail = `login-${Date.now()}@test.com`;
      const registerResult = await authService.registerAdmin(
        testEmail,
        "password123",
        "Login Test User",
        "ADMIN"
      );
      assert.ok(registerResult.ok);
      testUserId = registerResult.value.id;
      testUsers.push(testUserId);
    });

    afterEach(async () => {
      if (testUserId) {
        await prisma.adminUser.delete({ where: { id: testUserId } }).catch(() => {});
      }
    });

    it("should login with valid credentials", async () => {
      const result = await authService.login(
        { email: testEmail, password: "password123" },
        "127.0.0.1",
        "Test-User-Agent"
      );

      assert.ok(result.ok, `Login failed: ${result.ok ? "" : result.error}`);
      assert.ok("user" in result.value, "Should have user in response");
      assert.ok(result.value.tokens.accessToken);
      assert.ok(result.value.tokens.refreshToken);
      assert.ok(result.value.tokens.expiresAt);
    });

    it("should reject invalid password", async () => {
      const result = await authService.login(
        { email: testEmail, password: "wrongpassword" },
        "127.0.0.1",
        "Test-User-Agent"
      );

      assert.ok(!result.ok, "Login with wrong password should fail");
      assert.ok(result.error);
    });

    it("should reject non-existent user", async () => {
      const result = await authService.login(
        { email: `nonexistent-${Date.now()}@test.com`, password: "password123" },
        "127.0.0.1",
        "Test-User-Agent"
      );

      assert.ok(!result.ok, "Login with non-existent email should fail");
    });
  });

  describe("Token Verification", () => {
    let accessToken: string;
    let testUserId: string;

    before(async () => {
      const email = `token-${Date.now()}@test.com`;
      const registerResult = await authService.registerAdmin(
        email,
        "password123",
        "Token Test User",
        "ADMIN"
      );
      assert.ok(registerResult.ok);
      testUserId = registerResult.value.id;
      testUsers.push(testUserId);

      const loginResult = await authService.login(
        { email, password: "password123" },
        "127.0.0.1",
        "Test-User-Agent"
      );
      assert.ok(loginResult.ok);
      assert.ok("user" in loginResult.value);
      accessToken = loginResult.value.tokens.accessToken;
    });

    after(async () => {
      if (testUserId) {
        await prisma.adminUser.delete({ where: { id: testUserId } }).catch(() => {});
      }
    });

    it("should verify valid access token", async () => {
      const result = await authService.verifyAccessToken(accessToken);

      assert.ok(result.ok, "Valid token should verify successfully");
      assert.equal(result.value.id, testUserId);
      assert.ok(result.value.email);
      assert.ok(result.value.role);
    });

    it("should reject invalid access token", async () => {
      const result = await authService.verifyAccessToken("invalid.token.here");

      assert.ok(!result.ok, "Invalid token should be rejected");
    });

    it("should reject expired token after logout", async () => {
      // Get fresh tokens for logout test
      const email = `logout-${Date.now()}@test.com`;
      const registerResult = await authService.registerAdmin(
        email,
        "password123",
        "Logout Test User",
        "ADMIN"
      );
      assert.ok(registerResult.ok);
      const logoutTestUserId = registerResult.value.id;
      testUsers.push(logoutTestUserId);

      const loginResult = await authService.login(
        { email, password: "password123" },
        "127.0.0.1",
        "Test-User-Agent"
      );
      assert.ok(loginResult.ok && "user" in loginResult.value);
      const { refreshToken, accessToken: testAccessToken } = loginResult.value.tokens;

      // Logout
      const logoutResult = await authService.logout(refreshToken);
      assert.ok(logoutResult.ok, "Logout should succeed");

      // Try to verify token after logout
      const verifyResult = await authService.verifyAccessToken(testAccessToken);
      assert.ok(!verifyResult.ok, "Token should be invalid after logout");

      // Cleanup
      await prisma.adminUser.delete({ where: { id: logoutTestUserId } }).catch(() => {});
    });
  });

  describe("Token Refresh", () => {
    let refreshToken: string;
    let testUserId: string;

    before(async () => {
      const email = `refresh-${Date.now()}@test.com`;
      const registerResult = await authService.registerAdmin(
        email,
        "password123",
        "Refresh Test User",
        "ADMIN"
      );
      assert.ok(registerResult.ok);
      testUserId = registerResult.value.id;
      testUsers.push(testUserId);

      const loginResult = await authService.login(
        { email, password: "password123" },
        "127.0.0.1",
        "Test-User-Agent"
      );
      assert.ok(loginResult.ok && "user" in loginResult.value);
      refreshToken = loginResult.value.tokens.refreshToken;
    });

    after(async () => {
      if (testUserId) {
        await prisma.adminUser.delete({ where: { id: testUserId } }).catch(() => {});
      }
    });

    it("should refresh tokens with valid refresh token", async () => {
      // Wait 1 second to ensure new JWT has different iat timestamp
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const result = await authService.refreshTokens(refreshToken, "127.0.0.1");

      assert.ok(result.ok, `Token refresh failed: ${result.ok ? "" : result.error}`);
      assert.ok(result.value.accessToken);
      assert.ok(result.value.refreshToken);
      assert.notEqual(result.value.refreshToken, refreshToken, "Should return new refresh token");
    });

    it("should reject invalid refresh token", async () => {
      const result = await authService.refreshTokens("invalid.refresh.token", "127.0.0.1");

      assert.ok(!result.ok, "Invalid refresh token should be rejected");
    });

    it("should reject refresh token after logout", async () => {
      const email = `refresh-logout-${Date.now()}@test.com`;
      const registerResult = await authService.registerAdmin(
        email,
        "password123",
        "Refresh Logout Test",
        "ADMIN"
      );
      assert.ok(registerResult.ok);
      const userId = registerResult.value.id;
      testUsers.push(userId);

      const loginResult = await authService.login(
        { email, password: "password123" },
        "127.0.0.1",
        "Test-User-Agent"
      );
      assert.ok(loginResult.ok && "user" in loginResult.value);
      const testRefreshToken = loginResult.value.tokens.refreshToken;

      // Logout
      await authService.logout(testRefreshToken);

      // Try to refresh after logout
      const refreshResult = await authService.refreshTokens(testRefreshToken, "127.0.0.1");
      assert.ok(!refreshResult.ok, "Refresh token should be invalid after logout");

      await prisma.adminUser.delete({ where: { id: userId } }).catch(() => {});
    });
  });

  describe("User Sessions", () => {
    let testUserId: string;
    let testEmail: string;

    before(async () => {
      testEmail = `sessions-${Date.now()}@test.com`;
      const registerResult = await authService.registerAdmin(
        testEmail,
        "password123",
        "Sessions Test User",
        "ADMIN"
      );
      assert.ok(registerResult.ok);
      testUserId = registerResult.value.id;
      testUsers.push(testUserId);
    });

    after(async () => {
      if (testUserId) {
        await prisma.adminUser.delete({ where: { id: testUserId } }).catch(() => {});
      }
    });

    it("should retrieve user sessions", async () => {
      // Create a session by logging in
      const loginResult = await authService.login(
        { email: testEmail, password: "password123" },
        "127.0.0.1",
        "Test-User-Agent"
      );
      assert.ok(loginResult.ok && "user" in loginResult.value);

      // Get sessions
      const sessionsResult = await authService.getUserSessions(testUserId);

      assert.ok(sessionsResult.ok, "Get sessions should succeed");
      assert.ok(sessionsResult.value.length > 0, "Should have at least one active session");
    });

    it("should return empty array when no sessions exist", async () => {
      const email = `no-sessions-${Date.now()}@test.com`;
      const registerResult = await authService.registerAdmin(
        email,
        "password123",
        "No Sessions Test",
        "ADMIN"
      );
      assert.ok(registerResult.ok);
      const userId = registerResult.value.id;
      testUsers.push(userId);

      const sessionsResult = await authService.getUserSessions(userId);

      assert.ok(sessionsResult.ok, "Get sessions should succeed");
      assert.equal(sessionsResult.value.length, 0, "Should have no sessions");

      await prisma.adminUser.delete({ where: { id: userId } }).catch(() => {});
    });
  });

  describe("Role-Based User Creation", () => {
    const createdUserIds: string[] = [];

    afterEach(async () => {
      for (const id of createdUserIds) {
        await prisma.adminUser.delete({ where: { id } }).catch(() => {});
      }
      createdUserIds.length = 0;
    });

    it("should create users with different roles", async () => {
      const roles: Array<"SUPER_ADMIN" | "ADMIN" | "SUPPORT"> = ["SUPER_ADMIN", "ADMIN", "SUPPORT"];

      for (const role of roles) {
        const email = `${role.toLowerCase()}-${Date.now()}@test.com`;
        const result = await authService.registerAdmin(email, "password123", `${role} User`, role);

        assert.ok(result.ok, `Should create ${role} user`);
        assert.equal(result.value.role, role);

        createdUserIds.push(result.value.id);
        testUsers.push(result.value.id);
      }

      assert.equal(createdUserIds.length, 3, "Should have created 3 users");
    });
  });
});
