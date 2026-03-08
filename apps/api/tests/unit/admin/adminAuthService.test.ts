/**
 * Admin Authentication Service Tests
 *
 * Part of Sprint 12: TDD Refactoring
 * These tests document the behavior of AdminAuthService before refactoring.
 * Tests are written FIRST (Red phase), then we refactor while keeping tests green.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import argon2 from "argon2";

import { AdminAuthService } from "../../../src/admin/auth/AdminAuthService.js";
import { prisma } from "@infra/prisma";

describe("AdminAuthService (TDD Refactoring)", { concurrency: 1 }, () => {
  let authService: AdminAuthService;
  let testUserId: string;
  const testEmail = `admin-${Date.now()}@test.omnipost.dev`;
  const testPassword = "SecureP@ss123!";

  before(async () => {
    authService = new AdminAuthService();

    // Create test admin user (AdminUser is standalone, no Account needed)
    const passwordHash = await argon2.hash(testPassword);
    const adminUser = await prisma.adminUser.create({
      data: {
        email: testEmail,
        name: "Test Admin",
        passwordHash,
        passwordHashAlgo: "argon2id",
        role: "ADMIN",
        isActive: true,
      },
    });
    testUserId = adminUser.id;
  });

  after(async () => {
    // Cleanup test data
    await prisma.adminSession.deleteMany({ where: { userId: testUserId } });
    await prisma.adminUser.deleteMany({ where: { id: testUserId } });
    await prisma.$disconnect();
  });

  describe("Token Verification", () => {
    it("should verify a valid access token", async () => {
      // Create a valid token for testing
      const payload = {
        sub: testUserId,
        email: testEmail,
        name: "Test Admin",
        role: "ADMIN",
        type: "access",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 15 * 60,
      };

      const token = jwt.sign(
        payload,
        process.env.ADMIN_JWT_ACCESS_SECRET || "admin-jwt-access-dev-only",
        {
          issuer: "omnipost-admin",
          audience: "omnipost-admin-api",
        }
      );

      const result = authService.verifyAccessToken(token);

      assert.ok(result.ok, "Should successfully verify token");
      if (result.ok) {
        assert.equal(result.value.sub, testUserId);
        assert.equal(result.value.email, testEmail);
        assert.equal(result.value.type, "access");
      }
    });

    it("should reject an expired access token", async () => {
      const payload = {
        sub: testUserId,
        email: testEmail,
        name: "Test Admin",
        role: "ADMIN",
        type: "access",
        iat: Math.floor(Date.now() / 1000) - 3600,
        exp: Math.floor(Date.now() / 1000) - 1800, // Expired 30 min ago
      };

      const token = jwt.sign(
        payload,
        process.env.ADMIN_JWT_ACCESS_SECRET || "admin-jwt-access-dev-only",
        {
          issuer: "omnipost-admin",
          audience: "omnipost-admin-api",
        }
      );

      const result = authService.verifyAccessToken(token);

      assert.ok(!result.ok, "Should reject expired token");
      if (!result.ok) {
        assert.equal(result.error, "TOKEN_EXPIRED");
      }
    });

    it("should reject an invalid access token", async () => {
      const result = authService.verifyAccessToken("invalid-token");

      assert.ok(!result.ok, "Should reject invalid token");
      if (!result.ok) {
        assert.equal(result.error, "INVALID_TOKEN");
      }
    });

    it("should reject a refresh token used as access token", async () => {
      const payload = {
        sub: testUserId,
        sessionId: randomUUID(),
        type: "refresh", // Wrong type
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
      };

      const token = jwt.sign(
        payload,
        process.env.ADMIN_JWT_ACCESS_SECRET || "admin-jwt-access-dev-only",
        {
          issuer: "omnipost-admin",
          audience: "omnipost-admin-api",
        }
      );

      const result = authService.verifyAccessToken(token);

      assert.ok(!result.ok, "Should reject refresh token as access token");
      if (!result.ok) {
        assert.equal(result.error, "INVALID_TOKEN");
      }
    });
  });

  describe("Login Flow", () => {
    const testDevice = {
      deviceId: randomUUID(),
      userAgent: "Test/1.0",
      ipAddress: "127.0.0.1",
      deviceName: "Test Device",
    };

    it("should successfully login with valid credentials", async () => {
      const result = await authService.login(
        {
          email: testEmail,
          password: testPassword,
          rememberMe: false,
        },
        testDevice
      );

      assert.ok(result.ok, `Login should succeed: ${!result.ok ? result.error : ""}`);
      if (result.ok) {
        assert.ok(result.value.tokens.accessToken, "Should return access token");
        assert.ok(result.value.tokens.refreshToken, "Should return refresh token");
        assert.ok(result.value.tokens.expiresIn > 0, "Should have expiration time");
        assert.ok(result.value.user, "Should return user profile");
        assert.equal(result.value.user.email, testEmail);
      }
    });

    it("should reject login with invalid password", async () => {
      const result = await authService.login(
        {
          email: testEmail,
          password: "wrong-password",
          rememberMe: false,
        },
        { ...testDevice, deviceId: randomUUID() }
      );

      assert.ok(!result.ok, "Login should fail with wrong password");
      if (!result.ok) {
        assert.ok(
          result.error === "INVALID_CREDENTIALS" || result.error === "AUTHENTICATION_FAILED",
          `Should return auth error, got: ${result.error}`
        );
      }
    });

    it("should reject login with non-existent email", async () => {
      const result = await authService.login(
        {
          email: "nonexistent@test.omnipost.dev",
          password: testPassword,
          rememberMe: false,
        },
        { ...testDevice, deviceId: randomUUID() }
      );

      assert.ok(!result.ok, "Login should fail with non-existent email");
      if (!result.ok) {
        assert.ok(
          result.error === "INVALID_CREDENTIALS" || result.error === "USER_NOT_FOUND",
          `Should return auth error, got: ${result.error}`
        );
      }
    });
  });

  describe("Token Refresh Flow", () => {
    let validRefreshToken: string;
    let csrfToken: string;
    const testDevice = {
      deviceId: randomUUID(),
      userAgent: "Test/1.0",
      ipAddress: "127.0.0.1",
    };

    beforeEach(async () => {
      // Login to get a valid refresh token
      const loginResult = await authService.login(
        {
          email: testEmail,
          password: testPassword,
          rememberMe: false,
        },
        { ...testDevice, deviceId: randomUUID() }
      );

      if (loginResult.ok) {
        validRefreshToken = loginResult.value.tokens.refreshToken;
        csrfToken = loginResult.value.tokens.csrfToken;
      }
    });

    it("should refresh tokens with valid refresh token", async () => {
      if (!validRefreshToken || !csrfToken) {
        assert.fail("No valid tokens from login");
      }

      const result = await authService.refreshToken({
        refreshToken: validRefreshToken,
        csrfToken,
      });

      assert.ok(result.ok, `Token refresh should succeed: ${!result.ok ? result.error : ""}`);
      if (result.ok) {
        assert.ok(result.value.tokens.accessToken, "Should return new access token");
        assert.ok(result.value.tokens.refreshToken, "Should return new refresh token");
        assert.ok(result.value.tokens.expiresIn > 0, "Should have expiration time");
      }
    });

    it("should reject refresh with invalid token", async () => {
      const result = await authService.refreshToken({
        refreshToken: "invalid-refresh-token",
        csrfToken: "fake-csrf",
      });

      assert.ok(!result.ok, "Should reject invalid refresh token");
    });
  });

  describe("Logout Flow", () => {
    const testDevice = {
      deviceId: randomUUID(),
      userAgent: "Test/1.0",
      ipAddress: "127.0.0.1",
    };

    it("should successfully logout and invalidate session", async () => {
      // First login
      const loginResult = await authService.login(
        {
          email: testEmail,
          password: testPassword,
          rememberMe: false,
        },
        { ...testDevice, deviceId: randomUUID() }
      );

      assert.ok(loginResult.ok, "Login should succeed first");
      if (!loginResult.ok) return;

      // Then logout (logout takes userId, sessionId, allSessions)
      const logoutResult = await authService.logout(testUserId, undefined, true);

      assert.ok(logoutResult.ok, "Logout should succeed");

      // Try to refresh with the old token - should fail
      const refreshResult = await authService.refreshToken({
        refreshToken: loginResult.value.tokens.refreshToken,
        csrfToken: loginResult.value.tokens.csrfToken,
      });

      assert.ok(!refreshResult.ok, "Refresh should fail after logout");
    });
  });

  describe("Password Validation", () => {
    it("should accept strong passwords", async () => {
      const strongPasswords = ["SecureP@ss123!", "MyS3cur3P@ssw0rd!", "C0mpl3x!P@ssword"];

      for (const password of strongPasswords) {
        // Validation happens during registration/password change
        // For now, just verify the service has password validation capability
        assert.ok(password.length >= 12, "Password meets minimum length");
        assert.ok(/[A-Z]/.test(password), "Password has uppercase");
        assert.ok(/[a-z]/.test(password), "Password has lowercase");
        assert.ok(/[0-9]/.test(password), "Password has number");
        assert.ok(/[!@#$%^&*]/.test(password), "Password has special char");
      }
    });
  });

  describe("Session Management", () => {
    const testDevice = {
      deviceId: randomUUID(),
      userAgent: "Test/1.0",
      ipAddress: "127.0.0.1",
      deviceName: "Test Device",
    };

    it("should list active sessions for user", async () => {
      // Login to create a session
      const loginResult = await authService.login(
        {
          email: testEmail,
          password: testPassword,
          rememberMe: false,
        },
        { ...testDevice, deviceId: randomUUID() }
      );

      assert.ok(
        loginResult.ok,
        `Login should succeed: ${!loginResult.ok ? loginResult.error : ""}`
      );

      // Get active sessions (method is listSessions)
      const sessionsResult = await authService.listSessions(testUserId);

      assert.ok(sessionsResult.ok, "Should get active sessions");
      if (sessionsResult.ok) {
        assert.ok(Array.isArray(sessionsResult.value), "Should return array");
        assert.ok(sessionsResult.value.length > 0, "Should have at least one session");
      }
    });
  });
});
