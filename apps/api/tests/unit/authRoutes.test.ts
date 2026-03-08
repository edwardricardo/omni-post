#!/usr/bin/env tsx
/**
 * Integration Tests for authRoutes
 * Testing all authentication HTTP endpoints
 *
 * Coverage Target: 95%+
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Fastify, { FastifyInstance } from "fastify";
import { ZodTypeProvider, serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import fastifyCookie from "@fastify/cookie";
import { authRoutes } from "../../src/auth/authRoutes.js";
import { AuthService } from "../../src/auth/authService.js";
import { MfaService } from "../../src/auth/mfaService.js";
import { prisma } from "@infra/prisma";
import { PrismaAdminUserRepository } from "../../src/infrastructure/repositories/PrismaAdminUserRepository.js";
import { Container } from "../../src/infrastructure/container/Container.js";
import { TOKENS } from "../../src/infrastructure/container/types.js";

// Shared service instances — the same AuthService is used both to register/login users
// (in before()) and to verify tokens in the route handler, so JWT secrets match.
const adminUserRepo = new PrismaAdminUserRepository(prisma);
const mfaService = new MfaService(adminUserRepo);
const authService = new AuthService(adminUserRepo, mfaService);

// Create test Fastify instance
async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  typedApp.setValidatorCompiler(validatorCompiler);
  typedApp.setSerializerCompiler(serializerCompiler);

  // Register the same authService instance used in tests so JWT secrets match.
  const container = new Container();
  container.registerInstance(TOKENS.AuthService, authService);
  typedApp.decorate("container", container);

  await typedApp.register(fastifyCookie);
  await typedApp.register(authRoutes);

  return typedApp;
}

const timestamp = Date.now();
const testEmail = `test-routes-${timestamp}@example.com`;
const testPassword = "TestPassword123!";
const testName = "Test Routes User";

let app: FastifyInstance;
let _testUserId: string;
let accessToken: string;
let refreshToken: string;

describe("authRoutes Integration Tests", { concurrency: 1 }, () => {
  before(async () => {
    app = await createTestApp();
  });

  after(async () => {
    // Cleanup
    const testUsers = await prisma.adminUser.findMany({
      where: { email: { startsWith: `test-routes-${timestamp}` } },
    });

    const inactiveUser = await prisma.adminUser.findUnique({
      where: { email: `inactive-${timestamp}@example.com` },
    });

    if (inactiveUser) {
      testUsers.push(inactiveUser);
    }

    for (const user of testUsers) {
      await prisma.auditLog.deleteMany({ where: { userId: user.id } });
      await prisma.adminSession.deleteMany({ where: { userId: user.id } });
      await prisma.adminUser.delete({ where: { id: user.id } });
    }

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

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(body.data?.id);
      assert.strictEqual(body.data?.email, testEmail.toLowerCase());
      assert.strictEqual(body.data?.role, "ADMIN");

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

      assert.strictEqual(response.statusCode, 409);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.ok, false);
      assert.strictEqual(body.error, "Email already exists");
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

      assert.strictEqual(response.statusCode, 400);
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

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject missing required fields", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/register",
        payload: { email: testEmail },
      });

      assert.strictEqual(response.statusCode, 400);
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

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(body.data?.accessToken);
      assert.strictEqual(body.data?.user?.email, testEmail.toLowerCase());
      assert.ok(body.data?.expiresAt);

      const cookies = response.cookies;
      const refreshTokenCookie = cookies.find((c) => c.name === "refreshToken");

      assert.ok(refreshTokenCookie);
      assert.strictEqual(refreshTokenCookie?.httpOnly, true);
      assert.strictEqual(refreshTokenCookie?.sameSite, "Strict");
      assert.strictEqual(refreshTokenCookie?.path, "/auth");

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

      assert.strictEqual(response.statusCode, 401);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.error, "Invalid email or password");
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

      assert.strictEqual(response.statusCode, 401);
    });

    it("should reject inactive user", async () => {
      const inactiveEmail = `inactive-${timestamp}@example.com`;
      await authService.registerAdmin(inactiveEmail, testPassword, "Inactive User", "ADMIN");

      await prisma.adminUser.update({
        where: { email: inactiveEmail },
        data: { isActive: false },
      });

      const response = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: {
          email: inactiveEmail,
          password: testPassword,
        },
      });

      assert.strictEqual(response.statusCode, 403);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.error, "Account is inactive");
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

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(body.data?.accessToken);
      assert.ok(body.data?.expiresAt);

      const cookies = response.cookies;
      const newRefreshTokenCookie = cookies.find((c) => c.name === "refreshToken");
      assert.ok(newRefreshTokenCookie);

      accessToken = body.data?.accessToken || accessToken;
      refreshToken = newRefreshTokenCookie?.value || refreshToken;
    });

    it("should refresh with body token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        payload: { refreshToken: refreshToken },
      });

      assert.strictEqual(response.statusCode, 200);
    });

    it("should reject invalid refresh token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        cookies: { refreshToken: "invalid-token" },
      });

      assert.strictEqual(response.statusCode, 401);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.error, "Invalid or expired refresh token");

      const cookies = response.cookies;
      const clearedCookie = cookies.find((c) => c.name === "refreshToken");
      assert.strictEqual(clearedCookie?.value, "");
    });

    it("should reject missing refresh token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/refresh",
        payload: {},
      });

      assert.strictEqual(response.statusCode, 401);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.error, "Refresh token required");
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

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.data?.user?.email, testEmail.toLowerCase());
      assert.strictEqual(body.data?.user?.role, "ADMIN");
    });

    it("should reject without token", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/auth/me",
      });

      assert.strictEqual(response.statusCode, 401);
    });

    it("should reject invalid token", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/auth/me",
        headers: { authorization: "Bearer invalid-token" },
      });

      assert.strictEqual(response.statusCode, 401);
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

      assert.strictEqual(response.statusCode, 200);
      assert.ok(Array.isArray(body.data?.sessions));
      assert.ok(body.data?.sessions.length >= 1);

      const session = body.data?.sessions[0];
      assert.ok(session?.id);
      assert.ok(session?.ipAddress);
      assert.ok(session?.createdAt);
      assert.strictEqual(session?.refreshToken, undefined);
    });

    it("should reject without token", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/auth/sessions",
      });

      assert.strictEqual(response.statusCode, 401);
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

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.data?.message, "Logged out successfully");

      const cookies = response.cookies;
      const clearedCookie = cookies.find((c) => c.name === "refreshToken");
      assert.strictEqual(clearedCookie?.value, "");
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

      const _loginBody = JSON.parse(loginResponse.body);
      const cookies = loginResponse.cookies;
      const newRefreshToken = cookies.find((c) => c.name === "refreshToken")?.value || "";

      const response = await app.inject({
        method: "POST",
        url: "/auth/logout",
        payload: { refreshToken: newRefreshToken },
      });

      assert.strictEqual(response.statusCode, 200);
    });

    it("should reject missing refresh token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/logout",
        payload: {},
      });

      assert.strictEqual(response.statusCode, 400);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.error, "Refresh token required");
    });
  });

  describe("POST /auth/revoke-all", () => {
    before(async () => {
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

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.data?.message, "All sessions revoked successfully");
      assert.strictEqual(typeof body.data?.revokedCount, "number");

      const cookies = response.cookies;
      const clearedCookie = cookies.find((c) => c.name === "refreshToken");
      assert.strictEqual(clearedCookie?.value, "");
    });

    it("should reject without token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/revoke-all",
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });
});
