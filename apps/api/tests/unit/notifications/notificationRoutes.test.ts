#!/usr/bin/env tsx
/**
 * @file notificationRoutes.test.ts
 * @description Integration-style route tests for notification management endpoints.
 *   Uses real DI container with Prisma for integration-style route testing.
 * @layer infrastructure
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";
import {
  type ZodTypeProvider,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { notificationRoutes } from "../../../src/notifications/notificationRoutes.js";
import type { AuthService } from "../../../src/auth/authService.js";
import { prisma } from "@infra/prisma";
import { setupContainer } from "../../../src/infrastructure/container/setup.js";
import { TOKENS } from "../../../src/infrastructure/container/types.js";

// --- Test helpers ---

let containerAuthService: AuthService;

async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  typedApp.setValidatorCompiler(validatorCompiler);
  typedApp.setSerializerCompiler(serializerCompiler);

  const container = setupContainer({ prisma });
  containerAuthService = container.resolve<AuthService>(TOKENS.AuthService);
  typedApp.decorate("container", container);

  await typedApp.register(notificationRoutes);
  return typedApp;
}

const timestamp = Date.now();
const adminEmail = `notif-admin-${timestamp}@example.com`;
const testPassword = "TestPassword123!";

let app: FastifyInstance;
let adminToken: string;
let testAccountId: string;
let testMemberId: string;
let createdNotificationIds: string[] = [];

describe("notificationRoutes Integration Tests", { concurrency: 1 }, () => {
  before(async () => {
    app = await createTestApp();

    // Create an account for the team member
    const account = await prisma.account.create({
      data: {
        email: `notif-account-${timestamp}@example.com`,
        name: "Notification Test Account",
        subscription: "PRO",
        maxProjects: 5,
      },
    });
    testAccountId = account.id;

    // Create a team member (notifications FK target)
    const member = await prisma.teamMember.create({
      data: {
        accountId: testAccountId,
        email: `notif-member-${timestamp}@example.com`,
        name: "Notification Recipient",
        role: "MEMBER",
      },
    });
    testMemberId = member.id;

    // Create admin user for authentication
    const adminResult = await containerAuthService.registerAdmin(
      adminEmail,
      testPassword,
      "Notification Admin",
      "ADMIN"
    );
    assert.ok(adminResult.ok, "Admin registration should succeed");

    // Get auth token
    const loginResult = await containerAuthService.login(
      { email: adminEmail, password: testPassword },
      "127.0.0.1",
      "test-agent"
    );
    assert.ok(loginResult.ok, "Login should succeed");
    if (loginResult.ok && "tokens" in loginResult.value) {
      adminToken = loginResult.value.tokens.accessToken;
    }
  });

  after(async () => {
    try {
      // Clean up notifications
      await prisma.notification.deleteMany({
        where: { recipientId: testMemberId },
      });
      // Clean up notification preferences
      await prisma.notificationPreference.deleteMany({
        where: { memberId: testMemberId },
      });
      // Clean up team member
      await prisma.teamMember.deleteMany({
        where: { accountId: testAccountId },
      });
      // Clean up account
      await prisma.account.deleteMany({
        where: { id: testAccountId },
      });

      // Clean up admin user
      const adminUser = await prisma.adminUser.findUnique({
        where: { email: adminEmail },
      });
      if (adminUser) {
        await prisma.session.deleteMany({ where: { userId: adminUser.id } });
        await prisma.loginAttempt.deleteMany({
          where: { userId: adminUser.id },
        });
        await prisma.adminRoleHistory.deleteMany({
          where: { userId: adminUser.id },
        });
        await prisma.adminUser.delete({ where: { id: adminUser.id } });
      }
    } catch (_err: unknown) {
      // Cleanup is best-effort
    }

    await app.close();
  });

  beforeEach(() => {
    createdNotificationIds = [];
  });

  // --- POST /notifications ---

  describe("POST /notifications", () => {
    it("returns 401 without auth token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/notifications",
        payload: {
          recipientId: testMemberId,
          type: "COMMENT_ADDED",
          title: "New Comment",
          body: "Someone commented on your post",
        },
      });
      assert.equal(response.statusCode, 401);
    });

    it("creates notification successfully", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/notifications",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          recipientId: testMemberId,
          type: "COMMENT_ADDED",
          title: "New Comment",
          body: "Someone commented on your post",
        },
      });

      const body = JSON.parse(response.body);
      assert.equal(response.statusCode, 201);
      assert.equal(body.ok, true);
      assert.ok(body.data?.id, "Should return notification ID");
      createdNotificationIds.push(body.data.id);
    });

    it("rejects invalid notification type", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/notifications",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          recipientId: testMemberId,
          type: "INVALID_TYPE",
          title: "Bad Type",
          body: "This should fail",
        },
      });

      assert.equal(response.statusCode, 400);
    });

    it("rejects empty title", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/notifications",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          recipientId: testMemberId,
          type: "MENTION",
          title: "",
          body: "Title is empty",
        },
      });

      assert.equal(response.statusCode, 400);
    });
  });

  // --- GET /notifications ---

  describe("GET /notifications", () => {
    before(async () => {
      // Seed notifications for the admin user's ID as recipientId.
      // The route uses request.user.id so we create a TeamMember with
      // the admin user's ID to satisfy the FK, then seed notifications.
      // Instead, we query via recipientId matching admin user's ID --
      // but the FK requires a TeamMember record.
      // We seed via POST /notifications to test the full flow,
      // using testMemberId as recipient.
      await prisma.notification.createMany({
        data: [
          {
            recipientId: testMemberId,
            type: "APPROVAL_REQUESTED",
            title: "Approval Needed",
            body: "Post needs your approval",
            isRead: false,
          },
          {
            recipientId: testMemberId,
            type: "POST_APPROVED",
            title: "Post Approved",
            body: "Your post was approved",
            isRead: true,
            readAt: new Date(),
          },
          {
            recipientId: testMemberId,
            type: "MENTION",
            title: "You were mentioned",
            body: "Someone mentioned you in a comment",
            isRead: false,
          },
        ],
      });
    });

    after(async () => {
      await prisma.notification.deleteMany({
        where: { recipientId: testMemberId },
      });
    });

    it("returns 401 without auth token", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/notifications",
      });
      assert.equal(response.statusCode, 401);
    });

    it("lists notifications for authenticated user", async () => {
      // The route uses request.user.id as recipientId.
      // Since user.id is the admin user ID (not the team member ID),
      // it will return empty for that recipientId -- but still 200 OK.
      const response = await app.inject({
        method: "GET",
        url: "/notifications",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);
      assert.equal(response.statusCode, 200);
      assert.equal(body.ok, true);
      assert.ok(Array.isArray(body.data?.items), "Data should contain items array");
    });

    it("supports unreadOnly filter parameter", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/notifications?unreadOnly=true",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);
      assert.equal(response.statusCode, 200);
      assert.equal(body.ok, true);
      assert.ok(Array.isArray(body.data?.items), "Data should contain items array");
    });
  });

  // --- GET /notifications/unread-count ---

  describe("GET /notifications/unread-count", () => {
    it("returns 401 without auth token", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/notifications/unread-count",
      });
      assert.equal(response.statusCode, 401);
    });

    it("returns unread count for authenticated user", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/notifications/unread-count",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);
      assert.equal(response.statusCode, 200);
      assert.equal(body.ok, true);
      assert.ok(typeof body.data?.count === "number", "Should return numeric count");
    });
  });

  // --- PATCH /notifications/:id/read ---

  describe("PATCH /notifications/:id/read", () => {
    let readableNotificationId: string;

    before(async () => {
      const notification = await prisma.notification.create({
        data: {
          recipientId: testMemberId,
          type: "TEAM_INVITE",
          title: "Team Invite",
          body: "You have been invited to a team",
          isRead: false,
        },
      });
      readableNotificationId = notification.id;
    });

    after(async () => {
      await prisma.notification.deleteMany({
        where: { recipientId: testMemberId },
      });
    });

    it("returns 401 without auth token", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: `/notifications/${readableNotificationId}/read`,
      });
      assert.equal(response.statusCode, 401);
    });

    it("marks notification as read successfully", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: `/notifications/${readableNotificationId}/read`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);
      assert.equal(response.statusCode, 200);
      assert.equal(body.ok, true);
      assert.equal(body.data?.read, true);

      // Verify DB state
      const dbNotification = await prisma.notification.findUnique({
        where: { id: readableNotificationId },
      });
      assert.equal(dbNotification?.isRead, true, "Notification should be read in DB");
      assert.ok(dbNotification?.readAt, "readAt should be set");
    });

    it("returns 404 for non-existent notification", async () => {
      const fakeId = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
      const response = await app.inject({
        method: "PATCH",
        url: `/notifications/${fakeId}/read`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);
      assert.equal(response.statusCode, 404);
      assert.equal(body.ok, false);
    });
  });

  // --- POST /notifications/mark-all-read ---

  describe("POST /notifications/mark-all-read", () => {
    it("returns 401 without auth token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/notifications/mark-all-read",
      });
      assert.equal(response.statusCode, 401);
    });

    it("marks all notifications as read for authenticated user", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/notifications/mark-all-read",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);
      assert.equal(response.statusCode, 200);
      assert.equal(body.ok, true);
      assert.ok(
        typeof body.data?.count === "number",
        "Should return count of marked notifications"
      );
    });
  });

  // --- GET /notifications/preferences ---

  describe("GET /notifications/preferences", () => {
    it("returns 401 without auth token", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/notifications/preferences",
      });
      assert.equal(response.statusCode, 401);
    });

    it("returns preferences list for authenticated user", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/notifications/preferences",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);
      assert.equal(response.statusCode, 200);
      assert.equal(body.ok, true);
      assert.ok(Array.isArray(body.data?.preferences), "Should return preferences array");
    });
  });

  // --- PUT /notifications/preferences ---

  describe("PUT /notifications/preferences", () => {
    it("returns 401 without auth token", async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/notifications/preferences",
        payload: {
          preferences: [{ type: "MENTION", enabled: false }],
        },
      });
      assert.equal(response.statusCode, 401);
    });

    it("updates preferences successfully", async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/notifications/preferences",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          preferences: [
            { type: "MENTION", enabled: false },
            { type: "COMMENT_ADDED", enabled: true },
          ],
        },
      });

      const body = JSON.parse(response.body);
      assert.equal(response.statusCode, 200);
      assert.equal(body.ok, true);
      assert.ok(Array.isArray(body.data?.preferences), "Should return updated preferences");
    });

    it("rejects invalid notification type in preferences", async () => {
      const response = await app.inject({
        method: "PUT",
        url: "/notifications/preferences",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          preferences: [{ type: "INVALID_TYPE", enabled: true }],
        },
      });

      assert.equal(response.statusCode, 400);
    });
  });
});
