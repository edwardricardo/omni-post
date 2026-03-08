#!/usr/bin/env tsx
/**
 * Unit Tests for channelRoutes
 *
 * Tests all 6 channel management endpoints:
 *   POST   /channels                    — create channel
 *   GET    /channels/:channelId         — get channel by ID
 *   GET    /projects/:projectId/channels — list channels by project
 *   PUT    /channels/:channelId         — update channel
 *   DELETE /channels/:channelId         — soft-delete channel
 *   DELETE /channels/:channelId/hard    — hard-delete (SUPER_ADMIN only)
 *
 * Tier 1: requires PostgreSQL.
 * channelRoutes has NO auth middleware on the first 5 routes (protected at
 * the network layer). Only /channels/:channelId/hard requires SUPER_ADMIN.
 */

const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
};
console.log = () => {};
console.info = () => {};
console.warn = () => {};
console.error = () => {};

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Fastify, { FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import { channelRoutes } from "../../src/channels/channelRoutes.js";
import { authRoutes } from "../../src/auth/authRoutes.js";
import { prisma } from "@infra/prisma";
import { setupContainer } from "../../src/infrastructure/container/setup.js";
import { TOKENS } from "../../src/infrastructure/container/types.js";
import { AuthService } from "../../src/auth/authService.js";
import { MfaService } from "../../src/auth/mfaService.js";
import { PrismaAdminUserRepository } from "../../src/infrastructure/repositories/PrismaAdminUserRepository.js";

async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const container = setupContainer({ prisma });
  // Override AuthService with a locally-constructed instance (no global singleton)
  const adminUserRepo = new PrismaAdminUserRepository(prisma);
  const mfaSvc = new MfaService(adminUserRepo);
  container.registerInstance(TOKENS.AuthService, new AuthService(adminUserRepo, mfaSvc));
  app.decorate("container", container);
  await app.register(fastifyCookie);
  await app.register(authRoutes);
  await app.register(channelRoutes);
  await app.ready();
  return app;
}

const timestamp = Date.now();
const adminEmail = `channel-admin-${timestamp}@example.com`;
const testPassword = "TestPassword123";
const NONEXISTENT_UUID = "a0000000-0000-4000-8000-000000000000";

let app: FastifyInstance;
let testProjectId: string;
let testAccountId: string;
let createdChannelId: string;

describe("channelRoutes", { concurrency: 1 }, () => {
  before(async () => {
    app = await createTestApp();

    // Create account and project directly via Prisma (faster, no route dependency)
    const account = await prisma.account.create({
      data: {
        email: `account-channel-${timestamp}@example.com`,
        name: "Channel Test Account",
        subscription: "PRO",
        maxProjects: 5,
      },
    });
    testAccountId = account.id;

    const project = await prisma.project.create({
      data: {
        accountId: testAccountId,
        name: `Channel Test Project ${timestamp}`,
        locale: "en",
      },
    });
    testProjectId = project.id;

    // Create SUPER_ADMIN via AuthService resolved from the app's DI container
    const authSvc = app.container!.resolve<AuthService>(TOKENS.AuthService);
    await authSvc.registerAdmin(adminEmail, testPassword, "Channel Super Admin", "SUPER_ADMIN");
  });

  after(async () => {
    // Clean up channels, project, account, user
    await prisma.channel.deleteMany({ where: { projectId: testProjectId } });
    await prisma.project.deleteMany({ where: { accountId: testAccountId } });
    await prisma.account.delete({ where: { id: testAccountId } });
    await prisma.adminUser.deleteMany({
      where: { email: { startsWith: `channel-admin-${timestamp}` } },
    });
    await app.close();
    await prisma.$disconnect();
    Object.assign(console, originalConsole);
  });

  // ── POST /channels ─────────────────────────────────────────────────────

  describe("POST /channels", () => {
    it("should create a channel successfully", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/channels",
        payload: {
          projectId: testProjectId,
          name: "@testhandle",
          platform: "X",
        },
      });

      assert.equal(res.statusCode, 201);
      const body = JSON.parse(res.body);
      assert.equal(body.ok, true);
      assert.ok(body.data.id, "channel id should be present");
      assert.equal(body.data.projectId, testProjectId);
      assert.equal(body.data.name, "@testhandle");
      assert.equal(body.data.platform, "X");
      assert.equal(body.data.status, "PENDING");

      createdChannelId = body.data.id;
    });

    it("should create a channel with credentials", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/channels",
        payload: {
          projectId: testProjectId,
          name: "@ighandle",
          platform: "INSTAGRAM",
          credentials: { accessToken: "test-token-123" },
        },
      });

      assert.equal(res.statusCode, 201);
      const body = JSON.parse(res.body);
      assert.equal(body.ok, true);
      assert.equal(body.data.platform, "INSTAGRAM");
    });

    it("should return 404 for non-existent project", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/channels",
        payload: {
          projectId: NONEXISTENT_UUID,
          name: "@noproject",
          platform: "X",
        },
      });

      assert.equal(res.statusCode, 404);
      const body = JSON.parse(res.body);
      assert.equal(body.ok, false);
    });

    it("should return 400 for invalid platform", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/channels",
        payload: {
          projectId: testProjectId,
          name: "@badplatform",
          platform: "SNAPCHAT",
        },
      });

      assert.equal(res.statusCode, 400);
    });

    it("should return 400 for missing required fields", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/channels",
        payload: {
          projectId: testProjectId,
          // missing name and platform
        },
      });

      assert.equal(res.statusCode, 400);
    });
  });

  // ── GET /channels/:channelId ───────────────────────────────────────────

  describe("GET /channels/:channelId", () => {
    it("should return channel by ID", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/channels/${createdChannelId}`,
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.ok, true);
      assert.equal(body.data.id, createdChannelId);
      assert.equal(body.data.projectId, testProjectId);
    });

    it("should return 404 for non-existent channel", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/channels/${NONEXISTENT_UUID}`,
      });

      assert.equal(res.statusCode, 404);
      const body = JSON.parse(res.body);
      assert.equal(body.ok, false);
    });

    it("should return 400 for invalid UUID format", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/channels/not-a-valid-uuid",
      });

      assert.equal(res.statusCode, 400);
    });
  });

  // ── GET /projects/:projectId/channels ─────────────────────────────────

  describe("GET /projects/:projectId/channels", () => {
    it("should list channels for a project", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/projects/${testProjectId}/channels`,
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.ok, true);
      assert.ok(Array.isArray(body.data), "value should be an array");
      assert.ok(body.data.length >= 1, "should have at least one channel");
    });

    it("should return 404 for non-existent project", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/projects/${NONEXISTENT_UUID}/channels`,
      });

      assert.equal(res.statusCode, 404);
      const body = JSON.parse(res.body);
      assert.equal(body.ok, false);
    });

    it("should return 400 for invalid project UUID", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/projects/not-a-uuid/channels",
      });

      assert.equal(res.statusCode, 400);
    });
  });

  // ── PUT /channels/:channelId ───────────────────────────────────────────

  describe("PUT /channels/:channelId", () => {
    it("should update channel name", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/channels/${createdChannelId}`,
        payload: { name: "@updated-handle" },
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.ok, true);
      assert.equal(body.data.name, "@updated-handle");
    });

    it("should update channel credentials", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/channels/${createdChannelId}`,
        payload: { credentials: { accessToken: "new-token-456" } },
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.ok, true);
    });

    it("should return 404 for non-existent channel", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/channels/${NONEXISTENT_UUID}`,
        payload: { name: "@ghost" },
      });

      assert.equal(res.statusCode, 404);
    });

    it("should return 400 for name exceeding max length", async () => {
      const res = await app.inject({
        method: "PUT",
        url: `/channels/${createdChannelId}`,
        payload: { name: "x".repeat(257) },
      });

      assert.equal(res.statusCode, 400);
    });
  });

  // ── DELETE /channels/:channelId ────────────────────────────────────────

  describe("DELETE /channels/:channelId", () => {
    let softDeleteChannelId: string;

    before(async () => {
      // Create a dedicated channel for soft-delete tests
      const res = await app.inject({
        method: "POST",
        url: "/channels",
        payload: {
          projectId: testProjectId,
          name: "@tobe-softdeleted",
          platform: "FACEBOOK",
        },
      });
      const body = JSON.parse(res.body);
      softDeleteChannelId = body.data.id;
    });

    it("should soft-delete channel and return deleted: true", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/channels/${softDeleteChannelId}`,
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.ok, true);
      assert.equal(body.data.deleted, true);
    });

    it("should return 404 for non-existent channel", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/channels/${NONEXISTENT_UUID}`,
      });

      assert.equal(res.statusCode, 404);
    });
  });

  // ── DELETE /channels/:channelId/hard ──────────────────────────────────

  describe("DELETE /channels/:channelId/hard (SUPER_ADMIN only)", () => {
    let hardDeleteChannelId: string;
    let superAdminToken: string;

    before(async () => {
      // Get SUPER_ADMIN token
      const loginRes = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: adminEmail, password: testPassword },
      });
      const loginBody = JSON.parse(loginRes.body);
      superAdminToken = loginBody.data?.accessToken ?? "";

      // Create a dedicated channel for hard-delete tests
      const res = await app.inject({
        method: "POST",
        url: "/channels",
        payload: {
          projectId: testProjectId,
          name: "@tobe-harddeleted",
          platform: "YOUTUBE",
        },
      });
      const body = JSON.parse(res.body);
      hardDeleteChannelId = body.data.id;
    });

    it("should return 401 without auth token", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/channels/${hardDeleteChannelId}/hard`,
      });

      assert.equal(res.statusCode, 401);
    });

    it("should hard-delete channel with SUPER_ADMIN token", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/channels/${hardDeleteChannelId}/hard`,
        headers: { authorization: `Bearer ${superAdminToken}` },
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.ok, true);
      assert.equal(body.data.deleted, true);
    });
  });
});
