#!/usr/bin/env tsx
/**
 * Comprehensive Unit Tests for AuthService
 * Target Coverage: 95%+
 *
 * Testing:
 * - Registration (success, validation, duplicates)
 * - Login (success, failures, MFA, session management)
 * - Token operations (verify, refresh, blacklist)
 * - Session management (revoke, concurrent limits)
 * - Enhanced security features (fingerprinting, Redis)
 *
 * Converted to node:test standard
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { AuthService, setRedisInstance } from "../../src/auth/authService.js";
import { MfaService } from "../../src/auth/mfaService.js";
import { prisma } from "@infra/prisma";
import { PrismaAdminUserRepository } from "../../src/infrastructure/repositories/PrismaAdminUserRepository.js";
import Redis from "ioredis";

// Instantiate services with injected Prisma repository (proper DI pattern)
const adminUserRepo = new PrismaAdminUserRepository(prisma);
const mfaService = new MfaService(adminUserRepo);
const authService = new AuthService(adminUserRepo, mfaService);

const timestamp = Date.now();
const testEmail = `test-auth-${timestamp}@example.com`;
const testPassword = "SecurePassword123!";
const testName = "Test Auth User";

let testRedis: Redis | null = null;
let testUserId = "";
let accessToken = "";
let refreshToken = "";

describe("AuthService", { concurrency: 1 }, () => {
  before(async () => {
    // Initialize Redis for enhanced security testing
    try {
      testRedis = new Redis({
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379"),
        password: process.env.REDIS_PASSWORD,
        maxRetriesPerRequest: 1,
      });

      await testRedis.ping();
      setRedisInstance(testRedis);
      console.log("✅ Redis connected for enhanced security testing\n");
    } catch {
      console.log("⚠️  Redis not available - enhanced security features will be disabled\n");
      testRedis = null;
    }
  });

  after(async () => {
    // Cleanup
    if (testUserId) {
      await prisma.adminSession.deleteMany({ where: { userId: testUserId } });
      await prisma.auditLog.deleteMany({ where: { userId: testUserId } });
      await prisma.adminUser.delete({ where: { id: testUserId } }).catch(() => {});
    }

    // Close Redis connection
    if (testRedis) {
      await testRedis.quit();
    }
  });

  describe("Registration", () => {
    it("should register new admin successfully", async () => {
      const result = await authService.registerAdmin(testEmail, testPassword, testName, "ADMIN");

      assert.strictEqual(result.ok, true, "Registration should succeed");
      if (result.ok) {
        assert.strictEqual(result.value.email, testEmail.toLowerCase());
        assert.strictEqual(result.value.role, "ADMIN");
        assert.strictEqual(result.value.isActive, true);
        assert.strictEqual(result.value.mfaEnabled, false);
        testUserId = result.value.id;
      }
    });

    it("should reject duplicate email", async () => {
      const result = await authService.registerAdmin(testEmail, testPassword, testName, "ADMIN");

      assert.strictEqual(result.ok, false, "Should reject duplicate email");
      if (!result.ok) {
        assert.strictEqual(result.error, "EMAIL_EXISTS");
      }
    });

    it("should reject weak password", async () => {
      const result = await authService.registerAdmin(
        `weak-${timestamp}@example.com`,
        "weak",
        testName,
        "ADMIN"
      );

      assert.strictEqual(result.ok, false, "Should reject weak password");
      if (!result.ok) {
        assert.strictEqual(result.error, "VALIDATION_ERROR");
      }
    });

    it("should reject empty email", async () => {
      const result = await authService.registerAdmin("", testPassword, testName, "ADMIN");

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error, "VALIDATION_ERROR");
      }
    });

    it("should reject empty name", async () => {
      const result = await authService.registerAdmin(
        `empty-${timestamp}@example.com`,
        testPassword,
        "",
        "ADMIN"
      );

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error, "VALIDATION_ERROR");
      }
    });
  });

  describe("Login", () => {
    it("should login with valid credentials", async () => {
      const result = await authService.login(
        { email: testEmail, password: testPassword },
        "192.168.1.100",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      );

      assert.strictEqual(result.ok, true, "Login should succeed");
      if (result.ok) {
        assert.strictEqual(result.value.user.email, testEmail.toLowerCase());
        assert.ok(result.value.tokens.accessToken.length > 0);
        assert.ok(result.value.tokens.refreshToken.length > 0);
        assert.ok(result.value.tokens.sessionId);
        accessToken = result.value.tokens.accessToken;
        refreshToken = result.value.tokens.refreshToken;
      }
    });

    it("should reject invalid password", async () => {
      const result = await authService.login(
        { email: testEmail, password: "WrongPassword123!" },
        "192.168.1.100",
        "Mozilla/5.0 Test"
      );

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error, "INVALID_CREDENTIALS");
      }
    });

    it("should reject non-existent user", async () => {
      const result = await authService.login(
        { email: `nonexistent-${timestamp}@example.com`, password: testPassword },
        "192.168.1.100",
        "Mozilla/5.0 Test"
      );

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error, "INVALID_CREDENTIALS");
      }
    });

    it("should reject inactive user", async () => {
      await prisma.adminUser.update({
        where: { id: testUserId },
        data: { isActive: false },
      });

      const result = await authService.login(
        { email: testEmail, password: testPassword },
        "192.168.1.100",
        "Mozilla/5.0 Test"
      );

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error, "USER_INACTIVE");
      }

      // Reactivate user
      await prisma.adminUser.update({
        where: { id: testUserId },
        data: { isActive: true },
      });
    });
  });

  describe("Token Verification", () => {
    it("should verify valid access token", async () => {
      const result = await authService.verifyAccessToken(accessToken);

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual(result.value.id, testUserId);
      }
    });

    it("should reject invalid token", async () => {
      const result = await authService.verifyAccessToken("invalid.token.here");

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error, "INVALID_TOKEN");
      }
    });

    it("should reject token from revoked session", async () => {
      const sessions = await prisma.adminSession.findMany({
        where: { userId: testUserId, isActive: true },
      });

      if (sessions.length > 0) {
        await prisma.adminSession.update({
          where: { id: sessions[0]!.id },
          data: { isActive: false },
        });

        const result = await authService.verifyAccessToken(accessToken);

        assert.strictEqual(result.ok, false);
        if (!result.ok) {
          assert.strictEqual(result.error, "SESSION_EXPIRED");
        }

        // Reactivate session
        await prisma.adminSession.update({
          where: { id: sessions[0]!.id },
          data: { isActive: true },
        });
      }
    });
  });

  describe("Token Refresh", () => {
    it("should refresh tokens successfully", async () => {
      const result = await authService.refreshTokens(refreshToken, "192.168.1.100");

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.ok(result.value.accessToken.length > 0);
        assert.ok(result.value.refreshToken.length > 0);
        assert.notStrictEqual(result.value.refreshToken, refreshToken);

        // Update tokens
        const oldRefreshToken = refreshToken;
        accessToken = result.value.accessToken;
        refreshToken = result.value.refreshToken;

        // Test token blacklisting if Redis is available
        if (testRedis) {
          await new Promise((resolve) => setTimeout(resolve, 100));

          const oldTokenResult = await authService.refreshTokens(oldRefreshToken, "192.168.1.100");

          assert.strictEqual(oldTokenResult.ok, false);
          if (!oldTokenResult.ok) {
            assert.strictEqual(oldTokenResult.error, "TOKEN_BLACKLISTED");
          }
        }
      }
    });

    it("should reject invalid refresh token", async () => {
      const result = await authService.refreshTokens("invalid.refresh.token", "192.168.1.100");

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error, "INVALID_TOKEN");
      }
    });
  });

  describe("Session Management", () => {
    it("should get user sessions", async () => {
      const result = await authService.getUserSessions(testUserId);

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.ok(Array.isArray(result.value));
        assert.ok(result.value.length > 0);
      }
    });

    it("should logout successfully", async () => {
      const result = await authService.logout(refreshToken);

      assert.strictEqual(result.ok, true);

      const sessions = await authService.getUserSessions(testUserId);
      assert.strictEqual(sessions.ok, true);
      if (sessions.ok) {
        assert.strictEqual(sessions.value.length, 0);
      }
    });

    it("should return error for non-existent session on logout", async () => {
      const result = await authService.logout("non.existent.token");

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error, "SESSION_NOT_FOUND");
      }
    });

    it("should revoke all sessions", async () => {
      // Create multiple sessions
      await authService.login(
        { email: testEmail, password: testPassword },
        "192.168.1.101",
        "Chrome"
      );
      await authService.login(
        { email: testEmail, password: testPassword },
        "192.168.1.102",
        "Firefox"
      );
      await authService.login(
        { email: testEmail, password: testPassword },
        "192.168.1.103",
        "Safari"
      );

      const result = await authService.revokeAllSessions(testUserId);

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.ok(result.value >= 3);
      }

      const sessions = await authService.getUserSessions(testUserId);
      assert.strictEqual(sessions.ok, true);
      if (sessions.ok) {
        assert.strictEqual(sessions.value.length, 0);
      }
    });
  });

  describe("MFA Integration", () => {
    let mfaSecret = "";

    it("should setup MFA", async () => {
      const result = await mfaService.setupMfa(testUserId, testEmail);

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        mfaSecret = result.value.secret;
      }
    });

    it("should verify and enable MFA", async () => {
      const { authenticator } = await import("otplib");
      const validToken = authenticator.generate(mfaSecret);

      const result = await mfaService.verifyMfaSetup(testUserId, validToken);
      assert.strictEqual(result.ok, true);
    });

    it("should require MFA token on login", async () => {
      const result = await authService.login(
        { email: testEmail, password: testPassword },
        "192.168.1.104",
        "Mozilla/5.0 Test"
      );

      assert.strictEqual(result.ok, true);
      if (result.ok && "mfaRequired" in result.value) {
        assert.strictEqual(result.value.mfaRequired, true);
      }
    });

    it("should reject invalid MFA token", async () => {
      const result = await authService.login(
        { email: testEmail, password: testPassword, mfaToken: "000000" },
        "192.168.1.104",
        "Mozilla/5.0 Test"
      );

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.error, "INVALID_MFA_TOKEN");
      }
    });

    it("should login successfully with valid MFA token", async () => {
      const { authenticator } = await import("otplib");
      const validToken = authenticator.generate(mfaSecret);

      const result = await authService.login(
        { email: testEmail, password: testPassword, mfaToken: validToken },
        "192.168.1.104",
        "Mozilla/5.0 Test"
      );

      assert.strictEqual(result.ok, true);
      if (result.ok && "user" in result.value) {
        assert.ok(result.value.tokens);
      }
    });

    it("should disable MFA", async () => {
      const { authenticator } = await import("otplib");
      const validToken = authenticator.generate(mfaSecret);

      const result = await mfaService.disableMfa(testUserId, validToken);
      assert.strictEqual(result.ok, true);
    });
  });

  if (testRedis) {
    describe("Redis Security Features", () => {
      it("should enforce concurrent session limit", async () => {
        // Clean up existing sessions
        await authService.revokeAllSessions(testUserId);
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Create 5 sessions (maximum)
        const logins = [];
        for (let i = 0; i < 5; i++) {
          logins.push(
            authService.login(
              { email: testEmail, password: testPassword },
              `192.168.1.${200 + i}`,
              `UserAgent-${i}`
            )
          );
        }

        const results = await Promise.all(logins);
        assert.ok(
          results.every((r) => r.ok),
          "Should allow 5 sessions"
        );

        // Try 6th session
        const sixthLogin = await authService.login(
          { email: testEmail, password: testPassword },
          "192.168.1.250",
          "UserAgent-6"
        );

        assert.strictEqual(sixthLogin.ok, false);
        if (!sixthLogin.ok) {
          assert.strictEqual(sixthLogin.error, "TOO_MANY_SESSIONS");
        }

        // Cleanup
        await authService.revokeAllSessions(testUserId);
      });

      it("should validate device fingerprint", async () => {
        const login = await authService.login(
          { email: testEmail, password: testPassword },
          "192.168.1.100",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0"
        );

        assert.strictEqual(login.ok, true);
        if (login.ok) {
          const token = login.value.tokens.refreshToken;

          // Try refresh with different fingerprint
          const refresh = await authService.refreshTokens(token, "192.168.1.100", {
            userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1",
            ipAddress: "192.168.1.100",
          });

          assert.strictEqual(refresh.ok, false);
          if (!refresh.ok) {
            assert.strictEqual(refresh.error, "SESSION_EXPIRED");
          }
        }
      });
    });
  }
});
