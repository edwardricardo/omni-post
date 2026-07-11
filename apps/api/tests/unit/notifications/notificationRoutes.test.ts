/**
 * @file notificationRoutes.test.ts
 * @description Unit tests for notification management endpoints.
 *   Uses mocked Prisma stores and a real Fastify instance to test HTTP endpoint behavior.
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from "vitest";
import { createMockPrismaModule, createStore, buildModelMock } from "../helpers/mockPrisma.js";
import { InMemoryAuditLogRepository } from "../helpers/InMemoryAuditLogRepository.js";

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const { mockPrisma } = createMockPrismaModule();

// Notification defaults
const notificationDefaults = {
  isRead: false,
  readAt: null,
  resourceType: null,
  resourceId: null,
  actorId: null,
  actorName: null,
  metadata: null,
};

// NotificationPreference defaults
const notifPrefDefaults = {
  enabled: true,
};

// Add extra models needed by notification routes and their repositories
const extraModels = {
  notification: buildModelMock(createStore(), notificationDefaults),
  notificationPreference: buildModelMock(createStore(), notifPrefDefaults),
  teamMember: buildModelMock(createStore(), {
    isActive: true,
    role: "MEMBER",
    avatarUrl: null,
    invitedBy: null,
  }),
  post: buildModelMock(createStore()),
  adminUserPermission: buildModelMock(createStore()),
};
Object.assign(mockPrisma.prisma, extraModels);

vi.mock("@infra/prisma", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, prisma: mockPrisma.prisma };
});

vi.mock("../../../src/auth/customerAuthMiddleware.js", async () => {
  const { createCustomerAuthMock } = await import("../helpers/mockAuthMiddleware.js");
  return createCustomerAuthMock();
});

vi.mock("../../../src/lib/logger.js", () => {
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
  return { logger: noopLogger, authLogger: noopLogger, createLogger: () => noopLogger };
});

// No ioredis mock needed -- we register a mock NotificationBroadcaster directly

// ---------------------------------------------------------------------------
// Dynamic imports after mocks
// ---------------------------------------------------------------------------

const Fastify = (await import("fastify")).default;
const fastifyCookie = (await import("@fastify/cookie")).default;
const { notificationRoutes } = await import("../../../src/notifications/notificationRoutes.js");
const { authRoutes } = await import("../../../src/auth/authRoutes.js");
const { setupContainer } = await import("../../../src/infrastructure/container/setup.js");
const { TOKENS } = await import("../../../src/infrastructure/container/types.js");
const { AuthService, setRedisInstance } = await import("../../../src/auth/authService.js");
const { MfaService } = await import("../../../src/admin/auth/MfaService.js");
const { PrismaAdminMfaUserRepository } =
  await import("../../../src/infrastructure/adapters/PrismaAdminMfaUserRepository.js");
const { PrismaCustomerMfaUserRepository } =
  await import("../../../src/infrastructure/adapters/PrismaCustomerMfaUserRepository.js");
const { PrismaAdminUserRepository } =
  await import("../../../src/infrastructure/repositories/PrismaAdminUserRepository.js");
const { PrismaRoleRepository } =
  await import("../../../src/infrastructure/repositories/PrismaRoleRepository.js");
const { PrismaAdminSessionRepository } =
  await import("../../../src/infrastructure/repositories/PrismaAdminSessionRepository.js");

setRedisInstance(null as never);

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const timestamp = Date.now();
const adminEmail = `notif-admin-${timestamp}@example.com`;
const testPassword = "TestPassword123";

let app: import("fastify").FastifyInstance;
let adminToken: string;
let testMemberId: string;
let createdNotificationIds: string[] = [];

// Mock NotificationBroadcaster (avoids Redis dependency)
const mockBroadcaster = {
  broadcast: vi.fn().mockResolvedValue(undefined),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  initialize: vi.fn(),
  shutdown: vi.fn().mockResolvedValue(undefined),
  getActiveConnectionCount: vi.fn().mockReturnValue(0),
};

async function createTestApp() {
  const localApp = Fastify({ logger: false });
  const container = setupContainer({ prisma: mockPrisma.prisma as never });

  const adminUserRepo = new PrismaAdminUserRepository(mockPrisma.prisma as never);
  const roleRepo = new PrismaRoleRepository(mockPrisma.prisma as never);
  const sessionRepo = new PrismaAdminSessionRepository(mockPrisma.prisma as never);
  const mfaSvc = new MfaService(
    new PrismaAdminMfaUserRepository(mockPrisma.prisma as never),
    new PrismaCustomerMfaUserRepository(mockPrisma.prisma as never),
    new InMemoryAuditLogRepository()
  );
  const authSvc = new AuthService(
    mockPrisma.prisma,
    adminUserRepo,
    mfaSvc,
    roleRepo,
    sessionRepo,
    new InMemoryAuditLogRepository()
  );
  container.registerInstance(TOKENS.AuthService, authSvc);

  // Override NotificationBroadcaster with mock (no Redis needed)
  container.registerInstance(TOKENS.NotificationBroadcaster, mockBroadcaster);

  localApp.decorate("container", container);
  await localApp.register(fastifyCookie);
  await localApp.register(authRoutes);
  await localApp.register(notificationRoutes);
  await localApp.ready();
  return { app: localApp, authSvc };
}

describe("notificationRoutes Integration Tests", () => {
  let authSvc: InstanceType<typeof AuthService>;

  beforeAll(async () => {
    const result = await createTestApp();
    app = result.app;
    authSvc = result.authSvc;

    // Create an account for the team member
    const account = await (mockPrisma.prisma.account as { create: Function }).create({
      data: {
        email: `notif-account-${timestamp}@example.com`,
        name: "Notification Test Account",
        subscription: "PRO",
        maxProjects: 5,
      },
    });

    // Create a team member (notifications FK target)
    const member = await (
      mockPrisma.prisma as Record<string, { create: Function }>
    ).teamMember.create({
      data: {
        accountId: account.id,
        email: `notif-member-${timestamp}@example.com`,
        name: "Notification Recipient",
        role: "MEMBER",
      },
    });
    testMemberId = member.id;

    // Register admin user and get token
    await authSvc.registerAdmin(adminEmail, testPassword, "Notification Admin", "ADMIN");
    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: adminEmail, password: testPassword },
    });
    const loginBody = JSON.parse(loginRes.body);
    adminToken = loginBody.data?.accessToken ?? "";
  });

  afterAll(async () => {
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
      expect(response.statusCode).toBe(401);
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
      expect(response.statusCode).toBe(201);
      expect(body.ok).toBe(true);
      expect(body.data?.id).toBeTruthy();
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

      expect(response.statusCode).toBe(400);
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

      expect(response.statusCode).toBe(400);
    });
  });

  // --- GET /notifications ---

  describe("GET /notifications", () => {
    beforeAll(async () => {
      // Seed notifications via mock prisma
      const notifModel = mockPrisma.prisma as Record<string, { createMany: Function }>;
      await notifModel.notification.createMany({
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

    it("returns 401 without auth token", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/notifications",
      });
      expect(response.statusCode).toBe(401);
    });

    it("lists notifications for authenticated user", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/notifications",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data?.items)).toBeTruthy();
    });

    it("supports unreadOnly filter parameter", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/notifications?unreadOnly=true",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data?.items)).toBeTruthy();
    });
  });

  // --- GET /notifications/unread-count ---

  describe("GET /notifications/unread-count", () => {
    it("returns 401 without auth token", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/notifications/unread-count",
      });
      expect(response.statusCode).toBe(401);
    });

    it("returns unread count for authenticated user", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/notifications/unread-count",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(typeof body.data?.count === "number").toBeTruthy();
    });
  });

  // --- PATCH /notifications/:id/read ---

  describe("PATCH /notifications/:id/read", () => {
    let readableNotificationId: string;

    beforeAll(async () => {
      const notifModel = mockPrisma.prisma as Record<string, { create: Function }>;
      const notification = await notifModel.notification.create({
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

    it("returns 401 without auth token", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: `/notifications/${readableNotificationId}/read`,
      });
      expect(response.statusCode).toBe(401);
    });

    it("marks notification as read successfully", async () => {
      const response = await app.inject({
        method: "PATCH",
        url: `/notifications/${readableNotificationId}/read`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data?.read).toBe(true);
    });

    it("returns 404 for non-existent notification", async () => {
      const fakeId = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
      const response = await app.inject({
        method: "PATCH",
        url: `/notifications/${fakeId}/read`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(404);
      expect(body.ok).toBe(false);
    });
  });

  // --- POST /notifications/mark-all-read ---

  describe("POST /notifications/mark-all-read", () => {
    it("returns 401 without auth token", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/notifications/mark-all-read",
      });
      expect(response.statusCode).toBe(401);
    });

    it("marks all notifications as read for authenticated user", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/notifications/mark-all-read",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(typeof body.data?.count === "number").toBeTruthy();
    });
  });

  // --- GET /notifications/preferences ---

  describe("GET /notifications/preferences", () => {
    it("returns 401 without auth token", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/notifications/preferences",
      });
      expect(response.statusCode).toBe(401);
    });

    it("returns preferences list for authenticated user", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/notifications/preferences",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(response.body);
      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data?.preferences)).toBeTruthy();
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
      expect(response.statusCode).toBe(401);
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
      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data?.preferences)).toBeTruthy();
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

      expect(response.statusCode).toBe(400);
    });
  });
});
