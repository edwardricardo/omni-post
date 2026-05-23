#!/usr/bin/env tsx
/**
 * Integration Tests for auth endpoint rate limiting
 *
 * Verifies that POST /auth/login and POST /auth/register correctly enforce
 * per-route rate limits configured via config.rateLimit in authRoutes.ts.
 *
 * Design:
 *  - Creates a minimal Fastify app with ONLY @fastify/rate-limit + auth routes.
 *  - Uses the in-memory store (no Redis option) so the test is fully self-contained.
 *  - Mocks authService methods so the handler succeeds for under-limit requests
 *    (the rate limiter fires in the onRequest hook, before the handler, so the
 *    mock prevents spurious DB/Redis errors on the "allowed" path).
 *  - errorResponseBuilder returns AppError.tooManyRequests(), matching the fix
 *    applied in index.ts — this ensures the centralized error handler emits 429.
 *
 * Body format on 429 (produced by createErrorHandler + AppError.tooManyRequests):
 *   { ok: false, error: { code: "RATE_LIMIT_EXCEEDED", message: "...",
 *                         requestId: "...", timestamp: "..." } }
 *
 * @module tests/unit/authRateLimit
 *
 * @file authRateLimit.test.ts
 * @description Tests for Auth endpoint rate limiting
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, beforeEach, vi, expect } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { ZodTypeProvider, serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import fastifyCookie from "@fastify/cookie";
import fastifyRateLimit from "@fastify/rate-limit";
import { authRoutes } from "../../src/auth/authRoutes.js";
import { AppError } from "../../src/lib/errors/AppError.js";
import { createErrorHandler } from "../../src/lib/errors/errorHandler.js";
import { prisma } from "@infra/prisma";
import { Container } from "../../src/infrastructure/container/Container.js";
import { TOKENS } from "../../src/infrastructure/container/types.js";
import { AuthService } from "../../src/auth/authService.js";
import { MfaService } from "../../src/auth/mfaService.js";
import { PrismaAdminUserRepository } from "../../src/infrastructure/repositories/PrismaAdminUserRepository.js";

// ─────────────────────────────────────────────────────────────────────────────
// Console suppression — prevents authService constructor log from corrupting TAP
// ─────────────────────────────────────────────────────────────────────────────
let _originalConsoleLog: typeof console.log;
let _originalConsoleError: typeof console.error;
let _originalConsoleWarn: typeof console.warn;

// ─────────────────────────────────────────────────────────────────────────────
// Shared mock return values
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal success value returned by authService.login mock */
const MOCK_LOGIN_SUCCESS = {
  ok: true as const,
  value: {
    user: {
      id: "mock-user-id",
      email: "test@example.com",
      name: "Test User",
      role: "ADMIN" as const,
      isActive: true,
      emailVerified: true,
      mfaEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastLoginAt: null,
    },
    tokens: {
      accessToken: "mock-access-token",
      refreshToken: "mock-refresh-token",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    },
  },
};

/** Minimal success value returned by authService.registerAdmin mock */
const MOCK_REGISTER_SUCCESS = {
  ok: true as const,
  value: {
    id: "mock-user-id",
    email: "new@example.com",
    name: "New User",
    role: "ADMIN" as const,
    isActive: true,
    emailVerified: true,
    mfaEnabled: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastLoginAt: null,
  },
};

/** Minimal success value returned by authService.logout mock */
const MOCK_LOGOUT_SUCCESS = { ok: true as const, value: undefined };

/** Minimal success value returned by authService.refreshTokens mock */
const MOCK_REFRESH_SUCCESS = {
  ok: true as const,
  value: {
    accessToken: "mock-access-token-2",
    refreshToken: "mock-refresh-token-2",
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// App factory — minimal setup: error handler + rate-limit plugin + auth routes
// ─────────────────────────────────────────────────────────────────────────────

async function createTestApp(): Promise<{ app: FastifyInstance; authService: AuthService }> {
  // trustProxy: true is required so that Fastify uses the x-forwarded-for header
  // as req.ip.  Without it, all app.inject() calls share the same loopback IP
  // and per-IP rate-limit isolation tests cannot distinguish between clients.
  const fastifyApp = Fastify({ logger: false, trustProxy: true });
  const typedApp = fastifyApp.withTypeProvider<ZodTypeProvider>();
  typedApp.setValidatorCompiler(validatorCompiler);
  typedApp.setSerializerCompiler(serializerCompiler);

  // Centralized error handler — same as production. Required so AppError thrown
  // by errorResponseBuilder is serialized correctly with the right status code.
  typedApp.setErrorHandler(createErrorHandler(typedApp.log));

  // Build a fresh container per test app so rate-limit tests are fully isolated.
  // authRoutes only needs AuthService from the container — register just that.
  const adminUserRepo = new PrismaAdminUserRepository(prisma);
  const mfaService = new MfaService(adminUserRepo);
  const authService = new AuthService(prisma, adminUserRepo, mfaService);

  const container = new Container();
  container.registerInstance(TOKENS.AuthService, authService);

  typedApp.decorate("container", container);

  // Cookie support is required by auth routes (they call reply.setCookie)
  await typedApp.register(fastifyCookie);

  // Register @fastify/rate-limit with global:false and NO Redis → uses in-memory
  // store.  The test must not depend on an external Redis process.
  //
  // errorResponseBuilder mirrors the production fix in index.ts:
  // return AppError.tooManyRequests() so the centralized error handler emits 429.
  await typedApp.register(fastifyRateLimit, {
    global: false,
    // No `redis` option → LocalStore (in-memory) is used automatically
    errorResponseBuilder: (_request, context) =>
      AppError.tooManyRequests(`Too many requests. Retry in ${context.after}.`, context.ttl),
  });

  // Register auth routes — they carry config.rateLimit on each route definition
  await typedApp.register(authRoutes);

  return { app: typedApp, authService };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** POST /auth/login with a fixed IP to keep rate-limit key consistent */
async function postLogin(app: FastifyInstance, ip = "192.168.1.1") {
  return app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: "test@example.com", password: "TestPassword1!" },
    headers: { "x-forwarded-for": ip },
  });
}

/** POST /auth/register with a fixed IP */
async function postRegister(app: FastifyInstance, ip = "192.168.1.2") {
  return app.inject({
    method: "POST",
    url: "/auth/register",
    payload: { email: "new@example.com", password: "TestPassword1!", name: "New User" },
    headers: { "x-forwarded-for": ip },
  });
}

/** POST /auth/refresh with a dummy cookie and fixed IP */
async function postRefresh(app: FastifyInstance, ip = "192.168.1.3") {
  return app.inject({
    method: "POST",
    url: "/auth/refresh",
    cookies: { refreshToken: "mock-refresh-token" },
    headers: { "x-forwarded-for": ip },
  });
}

/** POST /auth/logout with a dummy cookie and fixed IP */
async function postLogout(app: FastifyInstance, ip = "192.168.1.4") {
  return app.inject({
    method: "POST",
    url: "/auth/logout",
    cookies: { refreshToken: "mock-refresh-token" },
    headers: { "x-forwarded-for": ip },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Auth endpoint rate limiting", () => {
  beforeAll(() => {
    _originalConsoleLog = console.log;
    _originalConsoleError = console.error;
    _originalConsoleWarn = console.warn;
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};
  });

  afterAll(() => {
    console.log = _originalConsoleLog;
    console.error = _originalConsoleError;
    console.warn = _originalConsoleWarn;
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("POST /auth/login — max 5 per 15 minutes", () => {
    let app: FastifyInstance;
    let authService: AuthService;

    beforeAll(async () => {
      ({ app, authService } = await createTestApp());
    });

    beforeEach(() => {
      vi.spyOn(authService, "login").mockImplementation(async () => MOCK_LOGIN_SUCCESS);
    });

    afterAll(async () => {
      await app.close();
    });

    it("should allow the first 5 requests (under the limit)", async () => {
      for (let i = 1; i <= 5; i++) {
        const res = await postLogin(app);
        expect(res.statusCode).not.toBe(429);
      }
    });

    it("should return 429 on the 6th request", async () => {
      const res = await postLogin(app);
      expect(res.statusCode).toBe(429);
    });

    it("should return the correct error body shape on 429", async () => {
      // Already exceeded from previous tests — any further request returns 429
      const res = await postLogin(app);
      expect(res.statusCode).toBe(429);

      const body = JSON.parse(res.body);
      expect(body.ok).toBe(false);
      // The centralized error handler wraps in { ok: false, error: { code, message, ... } }
      expect(body.error?.code).toBe("RATE_LIMIT_EXCEEDED");
      expect(typeof body.error?.message === "string" && body.error.message.length > 0).toBeTruthy();
      expect(typeof body.error?.requestId === "string").toBeTruthy();
      expect(typeof body.error?.timestamp === "string").toBeTruthy();
    });

    it("should include standard rate-limit headers on a 429 response", async () => {
      const res = await postLogin(app);
      expect(res.statusCode).toBe(429);

      // @fastify/rate-limit v10 uses lowercase header names by default
      const limit = res.headers["x-ratelimit-limit"];
      const remaining = res.headers["x-ratelimit-remaining"];
      const reset = res.headers["x-ratelimit-reset"];

      expect(limit !== undefined).toBeTruthy();
      expect(remaining !== undefined).toBeTruthy();
      expect(reset !== undefined).toBeTruthy();

      expect(String(limit)).toBe("5");
      expect(String(remaining)).toBe("0");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("POST /auth/register — max 10 per 1 hour", () => {
    let app: FastifyInstance;
    let authService: AuthService;

    beforeAll(async () => {
      ({ app, authService } = await createTestApp());
    });

    beforeEach(() => {
      vi.spyOn(authService, "registerAdmin").mockImplementation(async () => MOCK_REGISTER_SUCCESS);
    });

    afterAll(async () => {
      await app.close();
    });

    it("should allow the first 10 requests (under the limit)", async () => {
      for (let i = 1; i <= 10; i++) {
        const res = await postRegister(app);
        expect(res.statusCode).not.toBe(429);
      }
    });

    it("should return 429 on the 11th request", async () => {
      const res = await postRegister(app);
      expect(res.statusCode).toBe(429);
    });

    it("should return the correct error body shape on 429", async () => {
      const res = await postRegister(app);
      expect(res.statusCode).toBe(429);

      const body = JSON.parse(res.body);
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe("RATE_LIMIT_EXCEEDED");
      expect(typeof body.error?.message === "string" && body.error.message.length > 0).toBeTruthy();
    });

    it("should include rate-limit headers with limit=10 on a 429", async () => {
      const res = await postRegister(app);
      expect(res.statusCode).toBe(429);

      const limit = res.headers["x-ratelimit-limit"];
      const remaining = res.headers["x-ratelimit-remaining"];

      expect(limit !== undefined).toBeTruthy();
      expect(remaining !== undefined).toBeTruthy();
      expect(String(limit)).toBe("10");
      expect(String(remaining)).toBe("0");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("POST /auth/refresh — max 20 per 15 minutes", () => {
    let app: FastifyInstance;
    let authService: AuthService;

    beforeAll(async () => {
      ({ app, authService } = await createTestApp());
    });

    beforeEach(() => {
      vi.spyOn(authService, "refreshTokens").mockImplementation(async () => MOCK_REFRESH_SUCCESS);
    });

    afterAll(async () => {
      await app.close();
    });

    it("should allow the first 20 requests (under the limit)", async () => {
      for (let i = 1; i <= 20; i++) {
        const res = await postRefresh(app);
        expect(res.statusCode).not.toBe(429);
      }
    });

    it("should return 429 on the 21st request", async () => {
      const res = await postRefresh(app);
      expect(res.statusCode).toBe(429);
    });

    it("should include rate-limit headers with limit=20 on a 429", async () => {
      const res = await postRefresh(app);
      expect(res.statusCode).toBe(429);

      const limit = res.headers["x-ratelimit-limit"];
      expect(limit !== undefined).toBeTruthy();
      expect(String(limit)).toBe("20");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("POST /auth/logout — max 20 per 15 minutes", () => {
    let app: FastifyInstance;
    let authService: AuthService;

    beforeAll(async () => {
      ({ app, authService } = await createTestApp());
    });

    beforeEach(() => {
      vi.spyOn(authService, "logout").mockImplementation(async () => MOCK_LOGOUT_SUCCESS);
    });

    afterAll(async () => {
      await app.close();
    });

    it("should allow the first 20 requests (under the limit)", async () => {
      for (let i = 1; i <= 20; i++) {
        const res = await postLogout(app);
        expect(res.statusCode).not.toBe(429);
      }
    });

    it("should return 429 on the 21st request", async () => {
      const res = await postLogout(app);
      expect(res.statusCode).toBe(429);
    });

    it("should include rate-limit headers with limit=20 on a 429", async () => {
      const res = await postLogout(app);
      expect(res.statusCode).toBe(429);

      const limit = res.headers["x-ratelimit-limit"];
      expect(limit !== undefined).toBeTruthy();
      expect(String(limit)).toBe("20");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("Rate-limit isolation between different IPs", () => {
    let app: FastifyInstance;
    let authService: AuthService;

    beforeAll(async () => {
      ({ app, authService } = await createTestApp());
    });

    beforeEach(() => {
      vi.spyOn(authService, "login").mockImplementation(async () => MOCK_LOGIN_SUCCESS);
    });

    afterAll(async () => {
      await app.close();
    });

    it("should NOT rate-limit a different IP even after another IP is exhausted", async () => {
      const ipA = "10.0.0.1";
      const ipB = "10.0.0.2";

      // Exhaust the login limit (5 requests) for IP-A
      for (let i = 0; i < 5; i++) {
        await postLogin(app, ipA);
      }

      // IP-A must now be blocked
      const blockedRes = await postLogin(app, ipA);
      expect(blockedRes.statusCode).toBe(429);

      // IP-B (different address) must still be allowed
      const allowedRes = await postLogin(app, ipB);
      expect(allowedRes.statusCode).not.toBe(429);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("Rate-limit isolation between routes", () => {
    let app: FastifyInstance;
    let authService: AuthService;

    beforeAll(async () => {
      ({ app, authService } = await createTestApp());
    });

    beforeEach(() => {
      vi.spyOn(authService, "login").mockImplementation(async () => MOCK_LOGIN_SUCCESS);
      vi.spyOn(authService, "registerAdmin").mockImplementation(async () => MOCK_REGISTER_SUCCESS);
    });

    afterAll(async () => {
      await app.close();
    });

    it("exhausting /auth/login limit should NOT affect /auth/register limit", async () => {
      const sharedIp = "172.16.0.1";

      // Exhaust the login limit (5 requests)
      for (let i = 0; i < 5; i++) {
        await postLogin(app, sharedIp);
      }

      // Login must be blocked for this IP
      const loginBlocked = await postLogin(app, sharedIp);
      expect(loginBlocked.statusCode).toBe(429);

      // Register from the same IP must still be allowed (separate per-route counter)
      const registerAllowed = await postRegister(app, sharedIp);
      expect(registerAllowed.statusCode).not.toBe(429);
    });
  });
});
