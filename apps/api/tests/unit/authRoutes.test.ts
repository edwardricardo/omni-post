/**
 * @file authRoutes.test.ts
 * @description Unit tests for authRoutes. Uses in-memory mocked Prisma stores
 *              and a real Fastify instance to test HTTP endpoint behavior.
 *              Real argon2 and JWT are used for correct crypto behavior.
 * @layer test
 */

import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";
import { createMockPrismaModule } from "./helpers/mockPrisma.js";

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

const Fastify = (await import("fastify")).default;
const { serializerCompiler, validatorCompiler } = await import("fastify-type-provider-zod");
const fastifyCookie = (await import("@fastify/cookie")).default;
const { authRoutes } = await import("../../src/auth/authRoutes.js");
const { AuthService, setRedisInstance } = await import("../../src/auth/authService.js");
const { MfaService } = await import("../../src/auth/mfaService.js");
const { PrismaAdminUserRepository } = await import(
  "../../src/infrastructure/repositories/PrismaAdminUserRepository.js"
);
const { Container } = await import("../../src/infrastructure/container/Container.js");
const { TOKENS } = await import("../../src/infrastructure/container/types.js");

// ---------------------------------------------------------------------------
// Shared service instances
// ---------------------------------------------------------------------------

// Ensure no Redis for pure unit tests
setRedisInstance(null as unknown as import("ioredis").default);

const adminUserRepo = new PrismaAdminUserRepository(mockPrisma.prisma as never);
const mfaService = new MfaService(adminUserRepo);
const authService = new AuthService(adminUserRepo, mfaService);

// Create test Fastify instance
async function createTestApp() {
  const app = Fastify({ logger: false });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const container = new Container();
  container.registerInstance(TOKENS.AuthService, authService);
  app.decorate("container", container);

  await app.register(fastifyCookie);
  await app.register(authRoutes);

  return app;
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const timestamp = Date.now();
const testEmail = `test-routes-${timestamp}@example.com`;
const testPassword = "TestPassword123!";
const testName = "Test Routes User";

let app: ReturnType<typeof Fastify>;
let _testUserId: string;
let accessToken: string;
let refreshToken: string;

describe("authRoutes Integration Tests", () => {
  beforeAll(async () => {
    // Clear stores
    stores.adminUser.clear();
    stores.adminSession.clear();
    stores.auditLog.clear();

    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("POST /auth/register", () => {
    it("should register successfully", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          email: testEmail,
          password: testPassword,
          name: testName,
          role: "ADMIN",
        },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.id).toBeTruthy();
      expect(body.data?.email).toBe(testEmail.toLowerCase());
      expect(body.data?.role).toBe("ADMIN");

      _testUserId = body.data?.id || "";
    });

    it("should reject duplicate email", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          email: testEmail,
          password: testPassword,
          name: testName,
        },
      });

      expect(response.statusCode).toBe(409);

      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);
      expect(body.error).toBe("Email already exists");
    });

    it("should reject invalid email format", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          email: "invalid-email",
          password: testPassword,
          name: testName,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject weak password", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: {
          email: `weak-pw-${timestamp}@example.com`,
          password: "weak",
          name: testName,
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject missing required fields", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: { email: testEmail },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("POST /auth/login", () => {
    it("should login successfully", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: {
          email: testEmail,
          password: testPassword,
        },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.accessToken).toBeTruthy();
      expect(body.data?.user?.email).toBe(testEmail.toLowerCase());
      expect(body.data?.expiresAt).toBeTruthy();

      const cookies = response.cookies;
      const refreshTokenCookie = cookies.find((c: { name: string }) => c.name === "refreshToken");

      expect(refreshTokenCookie).toBeTruthy();
      expect(refreshTokenCookie?.httpOnly).toBe(true);
      expect(refreshTokenCookie?.sameSite).toBe("Strict");
      expect(refreshTokenCookie?.path).toBe("/auth");

      accessToken = body.data?.accessToken || "";
      refreshToken = refreshTokenCookie?.value || "";
    });

    it("should reject invalid credentials", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: {
          email: testEmail,
          password: "WrongPassword123!",
        },
      });

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body);
      expect(body.error).toBe("Invalid email or password");
    });

    it("should reject non-existent user", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: {
          email: "nonexistent@example.com",
          password: testPassword,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it("should reject inactive user", async () => {
      const inactiveEmail = `inactive-${timestamp}@example.com`;
      await authService.registerAdmin(inactiveEmail, testPassword, "Inactive User", "ADMIN");

      // Deactivate user via store
      const user = stores.adminUser.all().find((u) => u.email === inactiveEmail);
      if (user) {
        stores.adminUser.update(user.id as string, { isActive: false });
      }

      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: {
          email: inactiveEmail,
          password: testPassword,
        },
      });

      expect(response.statusCode).toBe(403);

      const body = JSON.parse(response.body);
      expect(body.error).toBe("Account is inactive");
    });
  });

  describe("POST /auth/refresh", () => {
    it("should refresh with valid cookie", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        cookies: { refreshToken: refreshToken },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.accessToken).toBeTruthy();
      expect(body.data?.expiresAt).toBeTruthy();

      const cookies = response.cookies;
      const newRefreshTokenCookie = cookies.find(
        (c: { name: string }) => c.name === "refreshToken"
      );
      expect(newRefreshTokenCookie).toBeTruthy();

      accessToken = body.data?.accessToken || accessToken;
      refreshToken = newRefreshTokenCookie?.value || refreshToken;
    });

    it("should refresh with body token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        payload: { refreshToken: refreshToken },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should reject invalid refresh token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        cookies: { refreshToken: "invalid-token" },
      });

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body);
      expect(body.error).toBe("Invalid or expired refresh token");

      const cookies = response.cookies;
      const clearedCookie = cookies.find((c: { name: string }) => c.name === "refreshToken");
      expect(clearedCookie?.value).toBe("");
    });

    it("should reject missing refresh token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        payload: {},
      });

      expect(response.statusCode).toBe(401);

      const body = JSON.parse(response.body);
      expect(body.error).toBe("Refresh token required");
    });
  });

  describe("GET /auth/me", () => {
    it("should return user with valid token", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: { authorization: `Bearer ${accessToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.data?.user?.email).toBe(testEmail.toLowerCase());
      expect(body.data?.user?.role).toBe("ADMIN");
    });

    it("should reject without token", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/auth/me",
      });

      expect(response.statusCode).toBe(401);
    });

    it("should reject invalid token", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: { authorization: "Bearer invalid-token" },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /auth/sessions", () => {
    it("should list sessions with valid token", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/auth/sessions",
        headers: { authorization: `Bearer ${accessToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(Array.isArray(body.data?.sessions)).toBeTruthy();
      expect(body.data?.sessions.length >= 1).toBeTruthy();

      const session = body.data?.sessions[0];
      expect(session?.id).toBeTruthy();
      expect(session?.ipAddress).toBeTruthy();
      expect(session?.createdAt).toBeTruthy();
      expect(session?.refreshToken).toBe(undefined);
    });

    it("should reject without token", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/auth/sessions",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("POST /auth/logout", () => {
    it("should logout with cookie", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/logout",
        cookies: { refreshToken: refreshToken },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.data?.message).toBe("Logged out successfully");

      const cookies = response.cookies;
      const clearedCookie = cookies.find((c: { name: string }) => c.name === "refreshToken");
      expect(clearedCookie?.value).toBe("");
    });

    it("should logout with body token after re-login", async () => {
      // Re-login first
      const loginResponse = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: {
          email: testEmail,
          password: testPassword,
        },
      });

      const cookies = loginResponse.cookies;
      const newRefreshToken =
        cookies.find((c: { name: string }) => c.name === "refreshToken")?.value || "";

      const response = await app.inject({
        method: "POST",
        url: "/auth/logout",
        payload: { refreshToken: newRefreshToken },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should reject missing refresh token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/logout",
        payload: {},
      });

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.body);
      expect(body.error).toBe("Refresh token required");
    });
  });

  describe("POST /auth/revoke-all", () => {
    beforeAll(async () => {
      // Re-login for revoke-all test
      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: {
          email: testEmail,
          password: testPassword,
        },
      });

      const body = JSON.parse(response.body);
      accessToken = body.data?.accessToken || "";
    });

    it("should revoke all sessions with valid token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/revoke-all",
        headers: { authorization: `Bearer ${accessToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.data?.message).toBe("All sessions revoked successfully");
      expect(typeof body.data?.revokedCount).toBe("number");

      const cookies = response.cookies;
      const clearedCookie = cookies.find((c: { name: string }) => c.name === "refreshToken");
      expect(clearedCookie?.value).toBe("");
    });

    it("should reject without token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/revoke-all",
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
