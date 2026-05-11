/**
 * @file channelRoutes.test.ts
 * @description Unit tests for channelRoutes. Uses mocked Prisma stores and
 *              a real Fastify instance to test HTTP endpoint behavior.
 *
 * Tests all 6 channel management endpoints:
 *   POST   /channels                    - create channel
 *   GET    /channels/:channelId         - get channel by ID
 *   GET    /projects/:projectId/channels - list channels by project
 *   PUT    /channels/:channelId         - update channel
 *   DELETE /channels/:channelId         - soft-delete channel
 *   DELETE /channels/:channelId/hard    - hard-delete (SUPER_ADMIN only)
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";
import { createMockPrismaModule, createStore, buildModelMock } from "./helpers/mockPrisma.js";

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const { mockPrisma, stores } = createMockPrismaModule();

// Channel routes use channel, publishLog, analytics models via repositories.
// Project store records need domain-mapper-compatible defaults.
const projectDefaults = {
  locale: "en",
  isInCrisisMode: false,
  crisisStartedAt: null,
  crisisReason: null,
  crisisModeHistory: [],
  deletedAt: null,
  channels: [],
  posts: [],
};
const channelDefaults = {
  handle: "",
  provider: "X",
  credentials: {},
  deletedAt: null,
};

// Replace project mock with one that has correct defaults
(mockPrisma.prisma as Record<string, unknown>).project = buildModelMock(
  stores.project,
  projectDefaults
);

const extraModels = {
  channel: buildModelMock(createStore(), channelDefaults),
  publishLog: buildModelMock(createStore()),
  analytics: buildModelMock(createStore()),
  adminUserPermission: buildModelMock(createStore()),
  post: buildModelMock(createStore()),
};
Object.assign(mockPrisma.prisma, extraModels);

vi.mock("@infra/prisma", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, prisma: mockPrisma.prisma };
});

vi.mock("../../src/auth/customerAuthMiddleware.js", async () => {
  const { createCustomerAuthMock } = await import("./helpers/mockAuthMiddleware.js");
  return createCustomerAuthMock();
});

vi.mock("../../src/admin/auth/adminAuthMiddleware.js", async () => {
  const { createAdminAuthMock } = await import("./helpers/mockAuthMiddleware.js");
  return createAdminAuthMock();
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
  return { logger: noopLogger, authLogger: noopLogger, createLogger: () => noopLogger };
});

// ---------------------------------------------------------------------------
// Dynamic imports after mocks
// ---------------------------------------------------------------------------

const Fastify = (await import("fastify")).default;
const fastifyCookie = (await import("@fastify/cookie")).default;
const { channelRoutes } = await import("../../src/channels/channelRoutes.js");
const { authRoutes } = await import("../../src/auth/authRoutes.js");
const { setupContainer } = await import("../../src/infrastructure/container/setup.js");
const { TOKENS } = await import("../../src/infrastructure/container/types.js");
const { AuthService, setRedisInstance } = await import("../../src/auth/authService.js");
const { MfaService } = await import("../../src/auth/mfaService.js");
const { PrismaAdminUserRepository } =
  await import("../../src/infrastructure/repositories/PrismaAdminUserRepository.js");

setRedisInstance(null as never);

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const timestamp = Date.now();
const adminEmail = `channel-admin-${timestamp}@example.com`;
const testPassword = "TestPassword123";
const NONEXISTENT_UUID = "a0000000-0000-4000-8000-000000000000";

let app: import("fastify").FastifyInstance;
let testProjectId: string;
let testAccountId: string;
let createdChannelId: string;

async function createTestApp() {
  const localApp = Fastify({ logger: false });
  const container = setupContainer({ prisma: mockPrisma.prisma as never });

  // Wire up AuthService so auth routes work for hard-delete SUPER_ADMIN test
  const adminUserRepo = new PrismaAdminUserRepository(mockPrisma.prisma as never);
  const mfaSvc = new MfaService(adminUserRepo);
  const authSvc = new AuthService(adminUserRepo, mfaSvc);
  container.registerInstance(TOKENS.AuthService, authSvc);

  localApp.decorate("container", container);
  await localApp.register(fastifyCookie);
  await localApp.register(authRoutes);
  await localApp.register(channelRoutes);
  await localApp.ready();
  return { app: localApp, authSvc };
}

/**
 * Builds a fake customer JWT for the channel-route tests. The mocked
 * requireClientAuth decodes payload without verifying signature, so any
 * well-formed three-segment token works as long as the payload carries
 * sub + accountId + roleName + permissions.
 */
function fakeCustomerToken(opts: { sub: string; accountId: string; roleName?: string }): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: opts.sub,
      accountId: opts.accountId,
      roleId: `role-${(opts.roleName ?? "OWNER").toLowerCase()}`,
      roleName: opts.roleName ?? "OWNER",
      permissions: ["channel:read", "channel:connect", "channel:disconnect", "channel:manage"],
      type: "customer",
    })
  ).toString("base64url");
  return `${header}.${payload}.signature`;
}

describe("channelRoutes", () => {
  let authSvc: InstanceType<typeof AuthService>;
  let customerToken: string;

  beforeAll(async () => {
    const result = await createTestApp();
    app = result.app;
    authSvc = result.authSvc;

    // Create account and project via mock prisma
    const account = await (mockPrisma.prisma.account as { create: Function }).create({
      data: {
        email: `account-channel-${timestamp}@example.com`,
        name: "Channel Test Account",
        subscription: "PRO",
        maxProjects: 5,
      },
    });
    testAccountId = account.id;

    const project = await (mockPrisma.prisma.project as { create: Function }).create({
      data: {
        accountId: testAccountId,
        name: `Channel Test Project ${timestamp}`,
        locale: "en",
      },
    });
    testProjectId = project.id;

    customerToken = fakeCustomerToken({
      sub: "test-customer-user-id",
      accountId: testAccountId,
      roleName: "OWNER",
    });

    // Register SUPER_ADMIN via AuthService
    await authSvc.registerAdmin(adminEmail, testPassword, "Channel Super Admin", "SUPER_ADMIN");
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Wraps app.inject to attach a customer Bearer token by default. Tests can
   * override with their own headers (e.g. SUPER_ADMIN for hard-delete).
   */
  function injectCustomer(opts: Parameters<typeof app.inject>[0]): ReturnType<typeof app.inject> {
    const o = opts as Record<string, unknown> & { headers?: Record<string, string> };
    return app.inject({
      ...o,
      headers: {
        authorization: `Bearer ${customerToken}`,
        ...(o.headers ?? {}),
      },
    } as Parameters<typeof app.inject>[0]);
  }

  // ── POST /channels ─────────────────────────────────────────────────────

  describe("POST /channels", () => {
    it("should create a channel successfully", async () => {
      const res = await injectCustomer({
        method: "POST",
        url: "/channels",
        payload: { projectId: testProjectId, name: "@testhandle", platform: "X" },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
      expect(body.data.id).toBeTruthy();
      expect(body.data.projectId).toBe(testProjectId);
      expect(body.data.name).toBe("@testhandle");
      expect(body.data.platform).toBe("X");
      expect(body.data.status).toBe("PENDING");
      createdChannelId = body.data.id;
    });

    it("should create a channel with credentials", async () => {
      const res = await injectCustomer({
        method: "POST",
        url: "/channels",
        payload: {
          projectId: testProjectId,
          name: "@ighandle",
          platform: "INSTAGRAM",
          credentials: { accessToken: "test-token-123" },
        },
      });
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
      expect(body.data.platform).toBe("INSTAGRAM");
    });

    it("should return 404 for non-existent project", async () => {
      const res = await injectCustomer({
        method: "POST",
        url: "/channels",
        payload: { projectId: NONEXISTENT_UUID, name: "@noproject", platform: "X" },
      });
      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(false);
    });

    it("should return 400 for invalid platform", async () => {
      const res = await injectCustomer({
        method: "POST",
        url: "/channels",
        payload: { projectId: testProjectId, name: "@badplatform", platform: "SNAPCHAT" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("should return 400 for missing required fields", async () => {
      const res = await injectCustomer({
        method: "POST",
        url: "/channels",
        payload: { projectId: testProjectId },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /channels/:channelId ───────────────────────────────────────────

  describe("GET /channels/:channelId", () => {
    it("should return channel by ID", async () => {
      const res = await injectCustomer({
        method: "GET",
        url: `/channels/${createdChannelId}`,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
      expect(body.data.id).toBe(createdChannelId);
      expect(body.data.projectId).toBe(testProjectId);
    });

    it("should return 404 for non-existent channel", async () => {
      const res = await injectCustomer({
        method: "GET",
        url: `/channels/${NONEXISTENT_UUID}`,
      });
      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(false);
    });

    it("should return 400 for invalid UUID format", async () => {
      const res = await injectCustomer({
        method: "GET",
        url: "/channels/not-a-valid-uuid",
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /projects/:projectId/channels ─────────────────────────────────

  describe("GET /projects/:projectId/channels", () => {
    it("should list channels for a project", async () => {
      const res = await injectCustomer({
        method: "GET",
        url: `/projects/${testProjectId}/channels`,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data)).toBeTruthy();
      expect(body.data.length >= 1).toBeTruthy();
    });

    it("returns the rich DTO shape (UX fields populated)", async () => {
      const res = await injectCustomer({
        method: "GET",
        url: `/projects/${testProjectId}/channels`,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      const row = body.data[0];
      expect(row).toMatchObject({
        id: expect.any(String),
        projectId: testProjectId,
        projectName: expect.any(String),
        provider: expect.any(String),
        providerName: expect.any(String),
        handle: expect.any(String),
        accountName: null,
        profileImage: null,
        isPrimary: expect.any(Boolean),
        isConnected: expect.any(Boolean),
        needsReauth: expect.any(Boolean),
        connectedAt: expect.any(String),
        expiredAt: null,
        lastUsedAt: null,
        usage: { postsThisMonth: 0 },
      });
      // backward-compat fields the legacy mapper used
      expect(row.platform).toBe(row.provider);
      expect(typeof row.name).toBe("string");
    });

    it("should return 404 for non-existent project", async () => {
      const res = await injectCustomer({
        method: "GET",
        url: `/projects/${NONEXISTENT_UUID}/channels`,
      });
      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(false);
    });

    it("should return 400 for invalid project UUID", async () => {
      const res = await injectCustomer({
        method: "GET",
        url: "/projects/not-a-uuid/channels",
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── PUT /channels/:channelId ───────────────────────────────────────────

  describe("PUT /channels/:channelId", () => {
    it("should update channel name", async () => {
      const res = await injectCustomer({
        method: "PUT",
        url: `/channels/${createdChannelId}`,
        payload: { name: "@updated-handle" },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
      expect(body.data.name).toBe("@updated-handle");
    });

    it("should update channel credentials", async () => {
      const res = await injectCustomer({
        method: "PUT",
        url: `/channels/${createdChannelId}`,
        payload: { credentials: { accessToken: "new-token-456" } },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
    });

    it("should return 404 for non-existent channel", async () => {
      const res = await injectCustomer({
        method: "PUT",
        url: `/channels/${NONEXISTENT_UUID}`,
        payload: { name: "@ghost" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("should return 400 for name exceeding max length", async () => {
      const res = await injectCustomer({
        method: "PUT",
        url: `/channels/${createdChannelId}`,
        payload: { name: "x".repeat(257) },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── DELETE /channels/:channelId ────────────────────────────────────────

  // ── PATCH /channels/:channelId/set-primary ────────────────────────────

  describe("PATCH /channels/:channelId/set-primary", () => {
    let primaryChannelA: string;
    let primaryChannelB: string;

    beforeAll(async () => {
      // Two channels for the same provider in the same project — A then B.
      const a = await injectCustomer({
        method: "POST",
        url: "/channels",
        payload: {
          projectId: testProjectId,
          name: "@primary-a",
          platform: "TIKTOK",
          credentials: { accessToken: "tok-a" },
        },
      });
      primaryChannelA = JSON.parse(a.body).data.id;

      const b = await injectCustomer({
        method: "POST",
        url: "/channels",
        payload: {
          projectId: testProjectId,
          name: "@primary-b",
          platform: "TIKTOK",
          credentials: { accessToken: "tok-b" },
        },
      });
      primaryChannelB = JSON.parse(b.body).data.id;
    });

    it("promotes channel A to primary", async () => {
      const res = await injectCustomer({
        method: "PATCH",
        url: `/channels/${primaryChannelA}/set-primary`,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
      expect(body.data.id).toBe(primaryChannelA);
      expect(body.data.isPrimary).toBe(true);
    });

    it("swaps primary from A to B", async () => {
      const res = await injectCustomer({
        method: "PATCH",
        url: `/channels/${primaryChannelB}/set-primary`,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.id).toBe(primaryChannelB);
      expect(body.data.isPrimary).toBe(true);
    });

    it("is idempotent when channel is already primary", async () => {
      const res = await injectCustomer({
        method: "PATCH",
        url: `/channels/${primaryChannelB}/set-primary`,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.isPrimary).toBe(true);
    });

    it("returns 404 for non-existent channel", async () => {
      const res = await injectCustomer({
        method: "PATCH",
        url: `/channels/${NONEXISTENT_UUID}/set-primary`,
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for invalid channel id", async () => {
      const res = await injectCustomer({
        method: "PATCH",
        url: `/channels/not-a-uuid/set-primary`,
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("DELETE /channels/:channelId", () => {
    let softDeleteChannelId: string;

    beforeAll(async () => {
      const res = await injectCustomer({
        method: "POST",
        url: "/channels",
        payload: { projectId: testProjectId, name: "@tobe-softdeleted", platform: "FACEBOOK" },
      });
      const body = JSON.parse(res.body);
      softDeleteChannelId = body.data.id;
    });

    it("should soft-delete channel and return deleted: true", async () => {
      const res = await injectCustomer({
        method: "DELETE",
        url: `/channels/${softDeleteChannelId}`,
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
      expect(body.data.deleted).toBe(true);
    });

    it("should return 404 for non-existent channel", async () => {
      const res = await injectCustomer({
        method: "DELETE",
        url: `/channels/${NONEXISTENT_UUID}`,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ── DELETE /channels/:channelId/hard ──────────────────────────────────

  describe("DELETE /channels/:channelId/hard (SUPER_ADMIN only)", () => {
    let hardDeleteChannelId: string;
    let superAdminToken: string;

    beforeAll(async () => {
      // Login as SUPER_ADMIN
      const loginRes = await injectCustomer({
        method: "POST",
        url: "/auth/login",
        payload: { email: adminEmail, password: testPassword },
      });
      const loginBody = JSON.parse(loginRes.body);
      superAdminToken = loginBody.data?.accessToken ?? "";

      // Create a channel to hard-delete
      const res = await injectCustomer({
        method: "POST",
        url: "/channels",
        payload: { projectId: testProjectId, name: "@tobe-harddeleted", platform: "YOUTUBE" },
      });
      const body = JSON.parse(res.body);
      hardDeleteChannelId = body.data.id;
    });

    it("should return 401 without auth token", async () => {
      // Hard-delete is admin-protected; use raw inject (no customer token).
      const res = await app.inject({
        method: "DELETE",
        url: `/channels/${hardDeleteChannelId}/hard`,
      });
      expect(res.statusCode).toBe(401);
    });

    it("should hard-delete channel with SUPER_ADMIN token", async () => {
      const res = await injectCustomer({
        method: "DELETE",
        url: `/channels/${hardDeleteChannelId}/hard`,
        headers: { authorization: `Bearer ${superAdminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
      expect(body.data.deleted).toBe(true);
    });
  });
});
