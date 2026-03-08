#!/usr/bin/env tsx
/**
 * Unit Tests for mfaRoutes
 * Testing all MFA HTTP endpoints
 *
 * Coverage Target: 95%+
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Fastify, { FastifyInstance } from "fastify";
import { ZodTypeProvider, serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { mfaRoutes } from "../../src/auth/mfaRoutes.js";
import { AuthService } from "../../src/auth/authService.js";
import { MfaService } from "../../src/auth/mfaService.js";
import { auditService } from "../../src/audit/auditService.js";
import { prisma } from "@infra/prisma";
import { PrismaAdminUserRepository } from "../../src/infrastructure/repositories/PrismaAdminUserRepository.js";
import { Container } from "../../src/infrastructure/container/Container.js";
import { TOKENS } from "../../src/infrastructure/container/types.js";

// Shared service instances — the same AuthService is used both to create tokens
// (in before()) and to verify them inside the route handler, so JWT secrets match.
const adminUserRepo = new PrismaAdminUserRepository(prisma);
const mfaService = new MfaService(adminUserRepo);
const authService = new AuthService(adminUserRepo, mfaService);

// Create test Fastify instance
async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  typedApp.setValidatorCompiler(validatorCompiler);
  typedApp.setSerializerCompiler(serializerCompiler);

  // Register the same service instances used in before() so JWT secrets match.
  // mfaRoutes resolves MfaService, AuditService, PrismaClient, and AuthService (via middleware).
  const container = new Container();
  container.registerInstance(TOKENS.AuthService, authService);
  container.registerInstance(TOKENS.MfaService, mfaService);
  container.registerInstance(TOKENS.AuditService, auditService);
  typedApp.decorate("container", container);

  await typedApp.register(mfaRoutes);

  return typedApp;
}

const timestamp = Date.now();
const userEmail = `user-mfa-${timestamp}@example.com`;
const adminEmail = `admin-mfa-${timestamp}@example.com`;
const testPassword = "TestPassword123!";

let app: FastifyInstance;
let userToken: string;
let adminToken: string;
let userId: string;
let _adminUserId: string;
let _mfaSecret: string;
let _backupCodes: string[];

describe("mfaRoutes Unit Tests", { concurrency: 1 }, () => {
  before(async () => {
    app = await createTestApp();

    // Create regular user
    const userResult = await authService.registerAdmin(
      userEmail,
      testPassword,
      "MFA User",
      "ADMIN"
    );
    if (userResult.ok) {
      userId = userResult.value.id;
    }

    // Create admin user
    const adminResult = await authService.registerAdmin(
      adminEmail,
      testPassword,
      "MFA Admin",
      "ADMIN"
    );
    if (adminResult.ok) {
      _adminUserId = adminResult.value.id;
    }

    // Login to get tokens
    const userLogin = await authService.login(
      { email: userEmail, password: testPassword },
      "127.0.0.1",
      "test-agent"
    );
    if (userLogin.ok && "tokens" in userLogin.value) {
      userToken = userLogin.value.tokens.accessToken;
    }

    const adminLogin = await authService.login(
      { email: adminEmail, password: testPassword },
      "127.0.0.1",
      "test-agent"
    );
    if (adminLogin.ok && "tokens" in adminLogin.value) {
      adminToken = adminLogin.value.tokens.accessToken;
    }
  });

  after(async () => {
    // Cleanup
    const testUsers = await prisma.adminUser.findMany({
      where: { email: { contains: `-mfa-${timestamp}` } },
    });

    for (const user of testUsers) {
      await prisma.auditLog.deleteMany({ where: { userId: user.id } });
      await prisma.adminSession.deleteMany({ where: { userId: user.id } });
      await prisma.adminUser.delete({ where: { id: user.id } });
    }

    await app.close();
  });

  describe("GET /auth/mfa/status", () => {
    it("should get MFA status for authenticated user", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/auth/mfa/status",
        headers: { authorization: `Bearer ${userToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(body.data?.mfa);
      assert.strictEqual(typeof body.data?.mfa?.enabled, "boolean");
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/auth/mfa/status",
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe("POST /auth/mfa/setup", () => {
    it("should setup MFA for authenticated user", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/mfa/setup",
        headers: { authorization: `Bearer ${userToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(body.data?.setup?.qrCodeUrl);
      assert.ok(body.data?.setup?.manualEntryKey);
      assert.ok(Array.isArray(body.data?.setup?.backupCodes));
      assert.strictEqual(body.data?.setup?.backupCodes?.length, 8);

      _mfaSecret = body.data?.setup?.manualEntryKey || "";
      _backupCodes = body.data?.setup?.backupCodes || [];
    });

    it("should reject duplicate setup", async () => {
      // First, enable MFA by verifying setup
      const setupResult = await mfaService.setupMfa(userId, userEmail);
      if (setupResult.ok) {
        // Generate a valid token
        const { authenticator } = await import("otplib");
        const token = authenticator.generate(setupResult.value.secret);
        await mfaService.verifyMfaSetup(userId, token);
      }

      const response = await app.inject({
        method: "POST",
        url: "/auth/mfa/setup",
        headers: { authorization: `Bearer ${userToken}` },
      });

      assert.strictEqual(response.statusCode, 409);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.error, "MFA is already enabled for this user");

      // Cleanup - disable MFA for subsequent tests
      await prisma.adminUser.update({
        where: { id: userId },
        data: { mfaEnabled: false, mfaSecret: null },
      });
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/mfa/setup",
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe("POST /auth/mfa/verify-setup", () => {
    it("should reject invalid token format", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/mfa/verify-setup",
        headers: { authorization: `Bearer ${userToken}` },
        payload: {
          token: "12345",
        },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject without token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/mfa/verify-setup",
        headers: { authorization: `Bearer ${userToken}` },
        payload: {},
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/mfa/verify-setup",
        payload: {
          token: "123456",
        },
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe("POST /auth/mfa/verify", () => {
    it("should reject invalid request body", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/mfa/verify",
        payload: {
          userId: "invalid-id",
        },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject missing userId", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/mfa/verify",
        payload: {
          token: "123456",
        },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject missing token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/mfa/verify",
        payload: {
          userId: userId,
        },
      });

      assert.strictEqual(response.statusCode, 400);
    });
  });

  describe("POST /auth/mfa/disable", () => {
    it("should reject when MFA not enabled", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/mfa/disable",
        headers: { authorization: `Bearer ${userToken}` },
        payload: {
          token: "123456",
        },
      });

      assert.strictEqual(response.statusCode, 400);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.error, "MFA is not enabled for this user");
    });

    it("should reject invalid token format", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/mfa/disable",
        headers: { authorization: `Bearer ${userToken}` },
        payload: {
          token: "12",
        },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/mfa/disable",
        payload: {
          token: "123456",
        },
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe("POST /auth/mfa/regenerate-backup-codes", () => {
    it("should reject when MFA not enabled", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/mfa/regenerate-backup-codes",
        headers: { authorization: `Bearer ${userToken}` },
        payload: {
          token: "123456",
        },
      });

      assert.strictEqual(response.statusCode, 400);

      const body = JSON.parse(response.body);
      assert.strictEqual(body.error, "MFA is not enabled for this user");
    });

    it("should reject invalid token format", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/mfa/regenerate-backup-codes",
        headers: { authorization: `Bearer ${userToken}` },
        payload: {
          token: "12",
        },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/auth/mfa/regenerate-backup-codes",
        payload: {
          token: "123456",
        },
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe("GET /admin/users/:userId/mfa/status", () => {
    it("should get MFA status for any user as admin", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/admin/users/${userId}/mfa/status`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(body.data?.userId);
      assert.ok(body.data?.mfa);
    });

    it("should reject invalid userId format", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/admin/users/invalid-id/mfa/status",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject non-existent user", async () => {
      const fakeId = "123e4567-e89b-12d3-a456-426614174000";
      const response = await app.inject({
        method: "GET",
        url: `/admin/users/${fakeId}/mfa/status`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      assert.strictEqual(response.statusCode, 404);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: `/admin/users/${userId}/mfa/status`,
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe("POST /admin/users/:userId/mfa/force-disable", () => {
    it("should reject without reason", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/users/${userId}/mfa/force-disable`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {},
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject reason too short", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/users/${userId}/mfa/force-disable`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          reason: "short",
        },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should force disable MFA with valid reason", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/users/${userId}/mfa/force-disable`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          reason: "User requested MFA reset due to lost authenticator device",
        },
      });

      const body = JSON.parse(response.body);

      assert.strictEqual(response.statusCode, 200);
      assert.strictEqual(body.ok, true);
      assert.ok(body.data?.message);
    });

    it("should reject invalid userId format", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/admin/users/invalid-id/mfa/force-disable",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          reason: "Valid reason for MFA reset",
        },
      });

      assert.strictEqual(response.statusCode, 400);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "POST",
        url: `/admin/users/${userId}/mfa/force-disable`,
        payload: {
          reason: "Valid reason for MFA reset",
        },
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });
});
