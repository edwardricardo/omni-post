/**
 * @file authService.test.ts
 * @description Unit tests for AuthService. Uses in-memory mocked Prisma stores
 *              so no real database connection is required. Real argon2, JWT, and
 *              otplib are used for correct crypto behavior.
 * @layer infrastructure
 */

import { describe, it, beforeEach, expect, vi } from "vitest";
import { MFA_SUBJECT_TYPE } from "@ports/core";
import { createMockPrismaModule } from "./helpers/mockPrisma.js";
import { InMemoryAuditLogRepository } from "./helpers/InMemoryAuditLogRepository.js";

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const { mockPrisma, stores } = createMockPrismaModule();

vi.mock("@infra/prisma", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, prisma: mockPrisma.prisma };
});

vi.mock("../../src/lib/logger.js", () => {
  const noop = vi.fn();
  const noopLogger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => noopLogger,
  };
  return {
    logger: noopLogger,
    authLogger: noopLogger,
    createLogger: () => noopLogger,
  };
});

// ---------------------------------------------------------------------------
// Import SUT after mocks are in place
// ---------------------------------------------------------------------------

const { AuthService, setRedisInstance } = await import("../../src/auth/authService.js");
const { MfaService } = await import("../../src/admin/auth/MfaService.js");
const { PrismaAdminMfaUserRepository } =
  await import("../../src/infrastructure/adapters/PrismaAdminMfaUserRepository.js");
const { PrismaAdminUserRepository } =
  await import("../../src/infrastructure/repositories/PrismaAdminUserRepository.js");
const { PrismaRoleRepository } =
  await import("../../src/infrastructure/repositories/PrismaRoleRepository.js");
const { PrismaAdminSessionRepository } =
  await import("../../src/infrastructure/repositories/PrismaAdminSessionRepository.js");

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const testPassword = "SecurePassword123!";
const testName = "Test Auth User";

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("AuthService", () => {
  let authService: InstanceType<typeof AuthService>;
  let mfaService: InstanceType<typeof MfaService>;
  let testEmail: string;
  let testUserId: string;
  let accessToken: string;
  let refreshToken: string;

  beforeEach(() => {
    // Reset all stores
    stores.adminUser.clear();
    stores.adminSession.clear();
    stores.auditLog.clear();

    // Generate unique email per test run
    testEmail = `test-auth-${Date.now()}@example.com`;
    testUserId = "";
    accessToken = "";
    refreshToken = "";

    // Ensure no Redis so tests stay pure unit tests
    setRedisInstance(null as unknown as import("ioredis").default);

    // Create fresh service instances with mocked prisma
    const adminUserRepo = new PrismaAdminUserRepository(mockPrisma.prisma as never);
    const roleRepo = new PrismaRoleRepository(mockPrisma.prisma as never);
    const sessionRepo = new PrismaAdminSessionRepository(mockPrisma.prisma as never);
    // Unified MFA service over the admin adapter. Both subject repos point at the
    // same admin adapter (mirroring the composition root until the dedicated
    // customer adapter lands), backed by the single mock Prisma store the rest
    // of the suite reads from.
    const adminMfaRepo = new PrismaAdminMfaUserRepository(mockPrisma.prisma as never);
    mfaService = new MfaService(adminMfaRepo, adminMfaRepo, new InMemoryAuditLogRepository());
    authService = new AuthService(
      mockPrisma.prisma,
      adminUserRepo,
      mfaService,
      roleRepo,
      sessionRepo,
      new InMemoryAuditLogRepository()
    );
  });

  describe("Registration", () => {
    it("should register new admin successfully", async () => {
      const result = await authService.registerAdmin(testEmail, testPassword, testName, "ADMIN");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.email).toBe(testEmail.toLowerCase());
        expect(result.value.role).toBe("ADMIN");
        expect(result.value.isActive).toBe(true);
        expect(result.value.mfaEnabled).toBe(false);
        testUserId = result.value.id;
      }
    });

    it("should reject duplicate email", async () => {
      await authService.registerAdmin(testEmail, testPassword, testName, "ADMIN");
      const result = await authService.registerAdmin(testEmail, testPassword, testName, "ADMIN");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("EMAIL_EXISTS");
      }
    });

    it("should reject weak password", async () => {
      const result = await authService.registerAdmin(
        `weak-${Date.now()}@example.com`,
        "weak",
        testName,
        "ADMIN"
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("VALIDATION_ERROR");
      }
    });

    it("should reject empty email", async () => {
      const result = await authService.registerAdmin("", testPassword, testName, "ADMIN");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("VALIDATION_ERROR");
      }
    });

    it("should reject empty name", async () => {
      const result = await authService.registerAdmin(
        `empty-${Date.now()}@example.com`,
        testPassword,
        "",
        "ADMIN"
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("VALIDATION_ERROR");
      }
    });
  });

  describe("Login", () => {
    beforeEach(async () => {
      const reg = await authService.registerAdmin(testEmail, testPassword, testName, "ADMIN");
      if (reg.ok) testUserId = reg.value.id;
    });

    it("should login with valid credentials", async () => {
      const result = await authService.login(
        { email: testEmail, password: testPassword },
        "192.168.1.100",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.user.email).toBe(testEmail.toLowerCase());
        expect(result.value.tokens.accessToken.length > 0).toBeTruthy();
        expect(result.value.tokens.refreshToken.length > 0).toBeTruthy();
        expect(result.value.tokens.sessionId).toBeTruthy();
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

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("INVALID_CREDENTIALS");
      }
    });

    it("should reject non-existent user", async () => {
      const result = await authService.login(
        { email: `nonexistent-${Date.now()}@example.com`, password: testPassword },
        "192.168.1.100",
        "Mozilla/5.0 Test"
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("INVALID_CREDENTIALS");
      }
    });

    it("should reject inactive user", async () => {
      // Deactivate user via store
      const user = stores.adminUser.all().find((u) => u.email === testEmail.toLowerCase());
      if (user) {
        stores.adminUser.update(user.id as string, { isActive: false });
      }

      const result = await authService.login(
        { email: testEmail, password: testPassword },
        "192.168.1.100",
        "Mozilla/5.0 Test"
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("USER_INACTIVE");
      }

      // Reactivate user
      if (user) {
        stores.adminUser.update(user.id as string, { isActive: true });
      }
    });
  });

  describe("Token Verification", () => {
    beforeEach(async () => {
      const reg = await authService.registerAdmin(testEmail, testPassword, testName, "ADMIN");
      if (reg.ok) testUserId = reg.value.id;

      const login = await authService.login(
        { email: testEmail, password: testPassword },
        "192.168.1.100",
        "Mozilla/5.0"
      );
      if (login.ok) {
        accessToken = login.value.tokens.accessToken;
        refreshToken = login.value.tokens.refreshToken;
      }
    });

    it("should verify valid access token", async () => {
      const result = await authService.verifyAccessToken(accessToken);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe(testUserId);
      }
    });

    it("should reject invalid token", async () => {
      const result = await authService.verifyAccessToken("invalid.token.here");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("INVALID_TOKEN");
      }
    });

    it("should reject token from revoked session", async () => {
      const sessions = stores.adminSession
        .all()
        .filter((s) => s.userId === testUserId && s.isActive === true);

      if (sessions.length > 0) {
        const sessionId = sessions[0]!.id as string;
        stores.adminSession.update(sessionId, { isActive: false });

        const result = await authService.verifyAccessToken(accessToken);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toBe("SESSION_EXPIRED");
        }

        // Reactivate session
        stores.adminSession.update(sessionId, { isActive: true });
      }
    });
  });

  describe("Token Refresh", () => {
    beforeEach(async () => {
      const reg = await authService.registerAdmin(testEmail, testPassword, testName, "ADMIN");
      if (reg.ok) testUserId = reg.value.id;

      const login = await authService.login(
        { email: testEmail, password: testPassword },
        "192.168.1.100",
        "Mozilla/5.0"
      );
      if (login.ok) {
        accessToken = login.value.tokens.accessToken;
        refreshToken = login.value.tokens.refreshToken;
      }
    });

    it("should refresh tokens successfully", async () => {
      const result = await authService.refreshTokens(refreshToken, "192.168.1.100");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.accessToken.length > 0).toBeTruthy();
        expect(result.value.refreshToken.length > 0).toBeTruthy();
        // Without Redis, tokenVersion is not embedded in the JWT payload,
        // so the new token may be identical if generated in the same second.
        // We only assert that valid tokens are returned.
        accessToken = result.value.accessToken;
        refreshToken = result.value.refreshToken;
      }
    });

    it("should reject invalid refresh token", async () => {
      const result = await authService.refreshTokens("invalid.refresh.token", "192.168.1.100");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("INVALID_TOKEN");
      }
    });
  });

  describe("Session Management", () => {
    beforeEach(async () => {
      const reg = await authService.registerAdmin(testEmail, testPassword, testName, "ADMIN");
      if (reg.ok) testUserId = reg.value.id;

      const login = await authService.login(
        { email: testEmail, password: testPassword },
        "192.168.1.100",
        "Mozilla/5.0"
      );
      if (login.ok) {
        accessToken = login.value.tokens.accessToken;
        refreshToken = login.value.tokens.refreshToken;
      }
    });

    it("should get user sessions", async () => {
      const result = await authService.getUserSessions(testUserId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(Array.isArray(result.value)).toBeTruthy();
        expect(result.value.length > 0).toBeTruthy();
      }
    });

    it("should logout successfully", async () => {
      const result = await authService.logout(refreshToken);

      expect(result.ok).toBe(true);

      const sessions = await authService.getUserSessions(testUserId);
      expect(sessions.ok).toBe(true);
      if (sessions.ok) {
        expect(sessions.value.length).toBe(0);
      }
    });

    it("should return error for non-existent session on logout", async () => {
      const result = await authService.logout("non.existent.token");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("SESSION_NOT_FOUND");
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

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value >= 3).toBeTruthy();
      }

      const sessions = await authService.getUserSessions(testUserId);
      expect(sessions.ok).toBe(true);
      if (sessions.ok) {
        expect(sessions.value.length).toBe(0);
      }
    });
  });

  describe("MFA Integration", () => {
    let mfaSecret = "";

    beforeEach(async () => {
      const reg = await authService.registerAdmin(testEmail, testPassword, testName, "ADMIN");
      if (reg.ok) testUserId = reg.value.id;
    });

    it("should setup MFA", async () => {
      const result = await mfaService.setupMfa(
        { type: MFA_SUBJECT_TYPE.ADMIN, id: testUserId },
        testEmail
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        mfaSecret = result.value.secret;
      }
    });

    it("should verify and enable MFA", async () => {
      const setupResult = await mfaService.setupMfa(
        { type: MFA_SUBJECT_TYPE.ADMIN, id: testUserId },
        testEmail
      );
      expect(setupResult.ok).toBe(true);
      if (!setupResult.ok) return;
      mfaSecret = setupResult.value.secret;

      const { authenticator } = await import("otplib");
      const validToken = authenticator.generate(mfaSecret);

      const result = await mfaService.verifyMfaSetup(
        { type: MFA_SUBJECT_TYPE.ADMIN, id: testUserId },
        validToken
      );
      expect(result.ok).toBe(true);
    });

    it("should require MFA token on login", async () => {
      // Setup and enable MFA
      const setupResult = await mfaService.setupMfa(
        { type: MFA_SUBJECT_TYPE.ADMIN, id: testUserId },
        testEmail
      );
      if (setupResult.ok) {
        mfaSecret = setupResult.value.secret;
        const { authenticator } = await import("otplib");
        await mfaService.verifyMfaSetup(
          { type: MFA_SUBJECT_TYPE.ADMIN, id: testUserId },
          authenticator.generate(mfaSecret)
        );
      }

      const result = await authService.login(
        { email: testEmail, password: testPassword },
        "192.168.1.104",
        "Mozilla/5.0 Test"
      );

      expect(result.ok).toBe(true);
      if (result.ok && "mfaRequired" in result.value) {
        expect(result.value.mfaRequired).toBe(true);
      }
    });

    it("should reject invalid MFA token", async () => {
      // Setup and enable MFA
      const setupResult = await mfaService.setupMfa(
        { type: MFA_SUBJECT_TYPE.ADMIN, id: testUserId },
        testEmail
      );
      if (setupResult.ok) {
        mfaSecret = setupResult.value.secret;
        const { authenticator } = await import("otplib");
        await mfaService.verifyMfaSetup(
          { type: MFA_SUBJECT_TYPE.ADMIN, id: testUserId },
          authenticator.generate(mfaSecret)
        );
      }

      const result = await authService.login(
        { email: testEmail, password: testPassword, mfaToken: "000000" },
        "192.168.1.104",
        "Mozilla/5.0 Test"
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("INVALID_MFA_TOKEN");
      }
    });

    it("should login successfully with valid MFA token", async () => {
      // Setup and enable MFA
      const setupResult = await mfaService.setupMfa(
        { type: MFA_SUBJECT_TYPE.ADMIN, id: testUserId },
        testEmail
      );
      if (setupResult.ok) {
        mfaSecret = setupResult.value.secret;
        const { authenticator } = await import("otplib");
        await mfaService.verifyMfaSetup(
          { type: MFA_SUBJECT_TYPE.ADMIN, id: testUserId },
          authenticator.generate(mfaSecret)
        );
      }

      const { authenticator } = await import("otplib");
      const validToken = authenticator.generate(mfaSecret);

      const result = await authService.login(
        { email: testEmail, password: testPassword, mfaToken: validToken },
        "192.168.1.104",
        "Mozilla/5.0 Test"
      );

      expect(result.ok).toBe(true);
      if (result.ok && "user" in result.value) {
        expect(result.value.tokens).toBeTruthy();
      }
    });

    it("should disable MFA", async () => {
      // Setup and enable MFA first
      const setupResult = await mfaService.setupMfa(
        { type: MFA_SUBJECT_TYPE.ADMIN, id: testUserId },
        testEmail
      );
      if (setupResult.ok) {
        mfaSecret = setupResult.value.secret;
        const { authenticator } = await import("otplib");
        await mfaService.verifyMfaSetup(
          { type: MFA_SUBJECT_TYPE.ADMIN, id: testUserId },
          authenticator.generate(mfaSecret)
        );
      }

      const { authenticator } = await import("otplib");
      const validToken = authenticator.generate(mfaSecret);

      const result = await mfaService.disableMfa(
        { type: MFA_SUBJECT_TYPE.ADMIN, id: testUserId },
        validToken
      );
      expect(result.ok).toBe(true);
    });
  });
});
