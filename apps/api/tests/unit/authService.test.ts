/**
 * @file authService.test.ts
 * @description Unit tests for AuthService. Uses in-memory mocked Prisma stores
 *              so no real database connection is required. Real argon2, JWT, and
 *              otplib are used for correct crypto behavior.
 * @layer infrastructure
 */

import { describe, it, beforeEach, expect, vi } from "vitest";
import jwt from "jsonwebtoken";
import { MFA_SUBJECT_TYPE } from "@ports/core";
import type { AuthTokens } from "../../src/auth/authTypes.js";
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
const { AuthServiceCore } = await import("../../src/auth/authServiceCore.js");
const { hashRefreshToken } = await import("../../src/auth/refreshTokenHash.js");
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
  // Captured rather than constructed inline: the rotation cases below read the rows back
  // to prove a refused rotation is AUDITED, not silently dropped.
  let auditLog: InMemoryAuditLogRepository;
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
    auditLog = new InMemoryAuditLogRepository();
    authService = new AuthService(
      mockPrisma.prisma,
      adminUserRepo,
      mfaService,
      roleRepo,
      sessionRepo,
      auditLog
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
        // Redis is absent here, so the per-mint id is the only thing separating this token
        // from the one it replaces — and the login above happened in the same second.
        expect(result.value.refreshToken).not.toBe(refreshToken);
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

  describe("Refresh Token Rotation", () => {
    // The stored refresh-token hash is a single-use credential, so rotating it is a
    // compare-and-swap on the hash being replaced: a token another caller has already
    // rotated must mint no second pair. Redis stays absent unless a case installs a
    // double, which is the deployment shape where the row is the only thing able to
    // refuse a replay.

    /** Mirrors the production key prefix, which is module-private to the Redis helpers. */
    const TOKEN_BLACKLIST_PREFIX = "auth:blacklist:";

    let sessionId: string;

    const loginFresh = async (): Promise<void> => {
      const reg = await authService.registerAdmin(testEmail, testPassword, testName, "ADMIN");
      expect(reg.ok).toBe(true);
      if (reg.ok) testUserId = reg.value.id;

      const login = await authService.login(
        { email: testEmail, password: testPassword },
        "192.168.1.100",
        "Mozilla/5.0"
      );
      expect(login.ok).toBe(true);
      if (login.ok && "user" in login.value) {
        refreshToken = login.value.tokens.refreshToken;
        sessionId = login.value.tokens.sessionId;
      }
    };

    const sessionRow = (): Record<string, unknown> => {
      const row = stores.adminSession.all().find((s) => s.id === sessionId);
      expect(row).toBeTruthy();
      return row as Record<string, unknown>;
    };

    /**
     * A concurrent writer landing BETWEEN the deciding read and the claim: the read
     * resolves against the row as it stood, and only then is the stored row moved. It is
     * the interleaving an attacker gets for free, expressed without timing.
     */
    const concurrentWriteAfterRead = (mutation: Record<string, unknown>): void => {
      const findUnique = mockPrisma.prisma.adminSession.findUnique as unknown as {
        getMockImplementation: () => ((args: unknown) => Promise<unknown>) | undefined;
        mockImplementationOnce: (fn: (args: unknown) => Promise<unknown>) => unknown;
      };
      const read = findUnique.getMockImplementation();
      findUnique.mockImplementationOnce(async (args: unknown) => {
        const row = await read?.(args);
        stores.adminSession.update(sessionId, mutation);
        return row;
      });
    };

    /** Records only what the ordering cases need: which keys were written, in order. */
    const makeRecordingRedis = (
      events: string[]
    ): Record<string, (...args: never[]) => Promise<unknown>> => ({
      get: vi.fn(async () => null),
      setex: vi.fn(async (key: string) => {
        if (key.startsWith(TOKEN_BLACKLIST_PREFIX)) events.push("blacklist");
        return "OK";
      }),
      del: vi.fn(async () => 1),
      sadd: vi.fn(async () => 1),
      expire: vi.fn(async () => 1),
      scard: vi.fn(async () => 0),
      lpush: vi.fn(async () => 1),
      ltrim: vi.fn(async () => "OK"),
    });

    it("stores the hash of the newly issued refresh token", async () => {
      await loginFresh();
      const presentedHash = hashRefreshToken(refreshToken);
      expect(sessionRow().refreshTokenHash).toBe(presentedHash);

      const result = await authService.refreshTokens(refreshToken, "192.168.1.100");

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(sessionRow().refreshTokenHash).toBe(hashRefreshToken(result.value.refreshToken));
      expect(sessionRow().refreshTokenHash).not.toBe(presentedHash);
    });

    it("refuses a token already rotated by a concurrent caller, and leaves that hash alone", async () => {
      await loginFresh();
      const rotatedByRacer = "rotated-by-a-concurrent-caller";
      concurrentWriteAfterRead({ refreshTokenHash: rotatedByRacer });

      const result = await authService.refreshTokens(refreshToken, "192.168.1.100");

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe("TOKEN_BLACKLISTED");
      expect(sessionRow().refreshTokenHash).toBe(rotatedByRacer);
      const replayed = auditLog.rows.filter(
        (row) => (row.details as Record<string, unknown>).reason === "ROTATED_TOKEN_REPLAYED"
      );
      expect(replayed).toHaveLength(1);
      expect((replayed[0]?.details as Record<string, unknown>).severity).toBe("HIGH");
    });

    it("refuses a token whose session was deactivated between the read and the claim", async () => {
      await loginFresh();
      concurrentWriteAfterRead({ isActive: false });

      const result = await authService.refreshTokens(refreshToken, "192.168.1.100");

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe("TOKEN_BLACKLISTED");
      expect(sessionRow().refreshTokenHash).toBe(hashRefreshToken(refreshToken));
      expect(sessionRow().isActive).toBe(false);
    });

    it("refuses the same token on a second presentation", async () => {
      await loginFresh();
      const rotated = await authService.refreshTokens(refreshToken, "192.168.1.100");
      expect(rotated.ok).toBe(true);
      if (!rotated.ok) return;

      const replay = await authService.refreshTokens(refreshToken, "192.168.1.100");

      expect(replay.ok).toBe(false);
      expect(sessionRow().refreshTokenHash).toBe(hashRefreshToken(rotated.value.refreshToken));
    });

    it("blacklists nothing when the claim refuses", async () => {
      const events: string[] = [];
      setRedisInstance(makeRecordingRedis(events) as unknown as import("ioredis").default);
      await loginFresh();
      concurrentWriteAfterRead({ refreshTokenHash: "rotated-by-a-concurrent-caller" });

      const result = await authService.refreshTokens(refreshToken, "192.168.1.100");

      expect(result.ok).toBe(false);
      // A refused attempt that blacklisted the token would kill the credential the WINNER
      // is still holding — the reason the blacklist write belongs after the claim.
      expect(events).toEqual([]);
    });

    it("blacklists the presented token exactly once, and only after the claim commits", async () => {
      const events: string[] = [];
      setRedisInstance(makeRecordingRedis(events) as unknown as import("ioredis").default);
      await loginFresh();
      const model = mockPrisma.prisma.adminSession as unknown as {
        updateMany: (args: unknown) => Promise<{ count: number }>;
      };
      const claim = model.updateMany;
      model.updateMany = async (args: unknown) => {
        events.push("claim");
        return claim(args);
      };

      try {
        const result = await authService.refreshTokens(refreshToken, "192.168.1.100");

        expect(result.ok).toBe(true);
        expect(events).toEqual(["claim", "blacklist"]);
      } finally {
        model.updateMany = claim;
      }
    });
  });

  describe("Refresh Token Minting", () => {
    // A rotation is a compare-and-swap on the stored refresh-token hash, and a swap is
    // only a swap when it changes the row. Without a per-mint id the refresh payload is
    // {userId,email,role,sessionId} with whole-second iat/exp, so two mints of one payload
    // inside one second are byte-identical and a rotation re-mints the token it consumed.
    // Redis is absent here by construction (the suite nulls the instance), which is exactly
    // the deployment shape where nothing else makes a mint unique.
    const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    const decodeToken = (token: string): jwt.JwtPayload => jwt.decode(token) as jwt.JwtPayload;

    /** Builds the core directly: `generateTokens` is core surface, not part of the facade. */
    const buildCore = (): InstanceType<typeof AuthServiceCore> =>
      new AuthServiceCore(
        new PrismaAdminUserRepository(mockPrisma.prisma as never),
        mfaService,
        new PrismaRoleRepository(mockPrisma.prisma as never),
        new PrismaAdminSessionRepository(mockPrisma.prisma as never),
        new InMemoryAuditLogRepository()
      );

    /** Both mints are started before either is awaited, so they share one tick. */
    const mintTwiceInOneTick = async (): Promise<[AuthTokens, AuthTokens]> => {
      const core = buildCore();
      const args = [
        "admin-user-1",
        "minting@example.com",
        "ADMIN",
        "session-1",
        { userAgent: "Mozilla/5.0", ipAddress: "192.168.1.100" },
        1,
      ] as const;

      const [first, second] = await Promise.all([
        core.generateTokens(...args),
        core.generateTokens(...args),
      ]);

      return [first, second];
    };

    it("mints two distinct refresh tokens when one payload is signed twice in the same tick", async () => {
      const [first, second] = await mintTwiceInOneTick();

      expect(first.refreshToken).not.toBe(second.refreshToken);
      expect(hashRefreshToken(first.refreshToken)).not.toBe(hashRefreshToken(second.refreshToken));
      expect(decodeToken(first.refreshToken).jti).toMatch(UUID_V4);
      expect(decodeToken(second.refreshToken).jti).toMatch(UUID_V4);
      expect(decodeToken(first.refreshToken).jti).not.toBe(decodeToken(second.refreshToken).jti);
    });

    it("carries an identical payload across those two mints apart from the per-mint id", async () => {
      const [first, second] = await mintTwiceInOneTick();

      const withoutJti = (token: string): jwt.JwtPayload => {
        const { jti: _jti, ...rest } = decodeToken(token);
        return rest;
      };

      // Uniqueness must come from the per-mint id alone. A mint that changed the session,
      // the subject or the role to become unique would rotate a different session's row.
      expect(withoutJti(first.refreshToken)).toEqual(withoutJti(second.refreshToken));
      expect(decodeToken(first.refreshToken).sessionId).toBe("session-1");
      expect(decodeToken(first.refreshToken).jti).not.toBe(decodeToken(second.refreshToken).jti);
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
