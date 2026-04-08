/**
 * @file schedulingRoutes.test.ts
 * @description Unit tests for admin scheduling routes and client scheduling routes.
 *              Uses mocked Prisma stores and a real Fastify instance.
 *
 * Admin routes (schedulingRoutes):
 *   GET  /admin/posts/scheduled
 *   POST /admin/posts/:id/cancel
 *   POST /admin/posts/:id/reschedule
 *
 * Client routes (schedulingClientRoutes):
 *   GET  /api/scheduling/slots
 *   GET  /api/analytics/optimal-times
 *   GET  /api/scheduling/rules
 *   POST /api/scheduling/slots
 *   POST /api/scheduling/slots/bulk
 * @layer test
 */

import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";
import { createMockPrismaModule, createStore, buildModelMock } from "./helpers/mockPrisma.js";

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const { mockPrisma } = createMockPrismaModule();

// Scheduling handlers use post, channel, analytics, publishLog, schedulingRule, postContent.
// Post defaults include empty relation arrays so include: { publishLogs, contents } works.
const postDefaults = {
  status: "DRAFT",
  scheduledAt: null,
  publishedAt: null,
  deletedAt: null,
  publishLogs: [],
  contents: [],
  project: null,
};
const extraModels = {
  post: buildModelMock(createStore(), postDefaults),
  postContent: buildModelMock(createStore()),
  channel: buildModelMock(createStore()),
  analytics: buildModelMock(createStore()),
  publishLog: buildModelMock(createStore()),
  schedulingRule: buildModelMock(createStore()),
  adminUserPermission: buildModelMock(createStore()),
};
Object.assign(mockPrisma.prisma, extraModels);

vi.mock("@infra/prisma", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, prisma: mockPrisma.prisma };
});

vi.mock("../../src/auth/customerAuthMiddleware.js", () => ({
  requireClientAuth: async (
    request: { headers: { authorization?: string } },
    reply: { code: (n: number) => { send: (b: unknown) => void } }
  ) => {
    const auth = request.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) {
      reply.code(401).send({ ok: false, error: "Authentication required" });
    }
  },
}));

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
const { schedulingRoutes } = await import("../../src/admin/schedulingRoutes.js");
const { schedulingClientRoutes } = await import("../../src/scheduling/schedulingClientRoutes.js");
const { setupContainer } = await import("../../src/infrastructure/container/setup.js");
const { generateAdminToken } = await import("./admin/adminTestHelper.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const prisma = mockPrisma.prisma as Record<string, unknown>;
const timestamp = Date.now();
const adminEmail = `scheduling-test-${timestamp}@example.com`;

async function createTestApp() {
  const app = Fastify({ logger: false });
  const container = setupContainer({ prisma: mockPrisma.prisma as never });
  app.decorate("container", container);
  await app.register(fastifyCookie);
  await app.register(schedulingRoutes);
  await app.register(schedulingClientRoutes);
  await app.ready();
  return app;
}

let app: import("fastify").FastifyInstance;
let adminToken: string;
let testAccountId: string;
let testProjectId: string;
const createdRuleIds: string[] = [];

describe("schedulingRoutes Unit Tests", () => {
  beforeAll(async () => {
    app = await createTestApp();

    adminToken = generateAdminToken({
      id: "scheduling-admin-test-id",
      email: adminEmail,
      name: "Scheduling Test Admin",
      role: "ADMIN",
    });

    // Create test account and project via mock prisma
    const account = await (prisma.account as { create: Function }).create({
      data: {
        name: `Scheduling Test Account ${timestamp}`,
        email: `scheduling-account-${timestamp}@example.com`,
        maxProjects: 5,
      },
    });
    testAccountId = account.id;

    const project = await (prisma.project as { create: Function }).create({
      data: { name: `Scheduling Test Project ${timestamp}`, accountId: testAccountId },
    });
    testProjectId = project.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // ── GET /admin/posts/scheduled ─────────────────────────────────────────────

  it("should return 401 without auth for scheduled posts list", async () => {
    const res = await app.inject({ method: "GET", url: "/admin/posts/scheduled" });
    expect(res.statusCode).toBe(401);
  });

  it("should return paginated scheduled posts with auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/posts/scheduled",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect(body.data).toBeTruthy();
    expect("data" in body.data).toBeTruthy();
    expect("pagination" in body.data).toBeTruthy();
    expect(Array.isArray(body.data.data)).toBeTruthy();
    expect(typeof body.data.pagination.total === "number").toBeTruthy();
  });

  it("should filter scheduled posts by projectId", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/admin/posts/scheduled?projectId=${testProjectId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect(Array.isArray(body.data.data)).toBeTruthy();
  });

  // ── POST /admin/posts/:id/cancel ──────────────────────────────────────────

  it("should return 401 without auth for cancel post", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/posts/a0000000-0000-4000-8000-000000000000/cancel",
    });
    expect(res.statusCode).toBe(401);
  });

  it("should return 404 when cancelling non-existent post", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/posts/a0000000-0000-4000-8000-000000000000/cancel",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
  });

  it("should return 400 when cancelling a non-scheduled post", async () => {
    // Create a DRAFT post
    const post = await (prisma.post as { create: Function }).create({
      data: { projectId: testProjectId, status: "DRAFT" },
    });

    const res = await app.inject({
      method: "POST",
      url: `/admin/posts/${post.id}/cancel`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
  });

  it("should successfully cancel a scheduled post", async () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const post = await (prisma.post as { create: Function }).create({
      data: { projectId: testProjectId, status: "SCHEDULED", scheduledAt: futureDate },
    });

    const res = await app.inject({
      method: "POST",
      url: `/admin/posts/${post.id}/cancel`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect(body.data.status).toBe("DRAFT");
  });

  // ── POST /admin/posts/:id/reschedule ──────────────────────────────────────

  it("should return 401 without auth for reschedule post", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/posts/a0000000-0000-4000-8000-000000000000/reschedule",
      payload: { scheduledAt: new Date(Date.now() + 3600000).toISOString() },
    });
    expect(res.statusCode).toBe(401);
  });

  it("should return 404 when rescheduling non-existent post", async () => {
    const futureTime = new Date(Date.now() + 3600000).toISOString();
    const res = await app.inject({
      method: "POST",
      url: "/admin/posts/a0000000-0000-4000-8000-000000000000/reschedule",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { scheduledAt: futureTime },
    });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
  });

  it("should successfully reschedule a post to a future time", async () => {
    const initialDate = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const post = await (prisma.post as { create: Function }).create({
      data: { projectId: testProjectId, status: "SCHEDULED", scheduledAt: initialDate },
    });

    const newDate = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const res = await app.inject({
      method: "POST",
      url: `/admin/posts/${post.id}/reschedule`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { scheduledAt: newDate, timezone: "UTC" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect(body.data.status).toBe("SCHEDULED");
    expect(body.data.scheduledAt).toBeTruthy();
  });

  // ── GET /api/scheduling/slots ──────────────────────────────────────────────

  it("should return 401 without auth for scheduling slots", async () => {
    const res = await app.inject({ method: "GET", url: "/api/scheduling/slots" });
    expect(res.statusCode).toBe(401);
  });

  it("should return 404 for non-existent project in scheduling slots", async () => {
    const startDate = new Date().toISOString();
    const endDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const res = await app.inject({
      method: "GET",
      url: `/api/scheduling/slots?projectId=a0000000-0000-4000-8000-000000000000&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
  });

  it("should return scheduling slots for a valid project", async () => {
    const startDate = new Date().toISOString();
    const endDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const res = await app.inject({
      method: "GET",
      url: `/api/scheduling/slots?projectId=${testProjectId}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect(body.data).toBeTruthy();
    expect("slots" in body.data).toBeTruthy();
    expect("rules" in body.data).toBeTruthy();
    expect(Array.isArray(body.data.slots)).toBeTruthy();
    expect(body.data.projectId).toBe(testProjectId);
  });

  // ── GET /api/analytics/optimal-times ─────────────────────────────────────

  it("should return 401 without auth for optimal posting times", async () => {
    const res = await app.inject({ method: "GET", url: "/api/analytics/optimal-times" });
    expect(res.statusCode).toBe(401);
  });

  it("should return 404 for non-existent project in optimal times", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/analytics/optimal-times?projectId=a0000000-0000-4000-8000-000000000000",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
  });

  it("should return optimal posting times for a valid project", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/analytics/optimal-times?projectId=${testProjectId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect(body.data).toBeTruthy();
    expect("optimalTimes" in body.data).toBeTruthy();
    expect(Array.isArray(body.data.optimalTimes)).toBeTruthy();
    expect(body.data.projectId).toBe(testProjectId);
  });

  it("should return optimal times with lookbackDays param", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/analytics/optimal-times?projectId=${testProjectId}&lookbackDays=7`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect(Array.isArray(body.data.optimalTimes)).toBeTruthy();
  });

  // ── GET /api/scheduling/rules ──────────────────────────────────────────────

  it("should return 401 without auth for scheduling rules", async () => {
    const res = await app.inject({ method: "GET", url: "/api/scheduling/rules" });
    expect(res.statusCode).toBe(401);
  });

  it("should return 404 for non-existent project in scheduling rules", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/scheduling/rules?projectId=a0000000-0000-4000-8000-000000000000",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
  });

  it("should return scheduling rules for a valid project", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/scheduling/rules?projectId=${testProjectId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect(body.data).toBeTruthy();
    expect("rules" in body.data).toBeTruthy();
    expect(Array.isArray(body.data.rules)).toBeTruthy();
    expect(body.data.projectId).toBe(testProjectId);
    expect(typeof body.data.total === "number").toBeTruthy();
  });

  it("should filter scheduling rules by isActive", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/scheduling/rules?projectId=${testProjectId}&isActive=true`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect(Array.isArray(body.data.rules)).toBeTruthy();
  });

  // ── POST /api/scheduling/slots ─────────────────────────────────────────────

  it("should return 401 without auth for create slot", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/scheduling/slots",
      payload: { projectId: testProjectId, dayOfWeek: 1, hour: 9, providers: ["X"] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("should return 404 when creating slot for non-existent project", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/scheduling/slots",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        projectId: "a0000000-0000-4000-8000-000000000000",
        dayOfWeek: 1,
        hour: 9,
        providers: ["X"],
      },
    });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
  });

  it("should create a schedule slot successfully", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/scheduling/slots",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        projectId: testProjectId,
        dayOfWeek: 1,
        hour: 9,
        minute: 0,
        timezone: "UTC",
        providers: ["X"],
        isActive: true,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect(body.data).toBeTruthy();
    expect(body.data.id).toBeTruthy();
    expect(body.data.projectId).toBe(testProjectId);
    expect(Array.isArray(body.data.platforms)).toBeTruthy();
    expect(body.data.slot).toBeTruthy();
    expect(body.data.slot.dayOfWeek).toBe(1);
    expect(body.data.slot.hour).toBe(9);
    createdRuleIds.push(body.data.id);
  });

  it("should return 400 for missing required fields when creating slot", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/scheduling/slots",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { projectId: testProjectId },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
  });

  // ── POST /api/scheduling/slots/bulk ──────────────────────────────────────

  it("should return 401 without auth for bulk create slots", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/scheduling/slots/bulk",
      payload: {
        projectId: testProjectId,
        slots: [{ dayOfWeek: 2, hour: 10, providers: ["INSTAGRAM"] }],
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("should return 404 when bulk creating slots for non-existent project", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/scheduling/slots/bulk",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        projectId: "a0000000-0000-4000-8000-000000000000",
        slots: [{ dayOfWeek: 2, hour: 10, providers: ["INSTAGRAM"] }],
      },
    });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
  });

  it("should bulk create schedule slots successfully", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/scheduling/slots/bulk",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        projectId: testProjectId,
        slots: [
          { dayOfWeek: 2, hour: 10, minute: 30, providers: ["INSTAGRAM"] },
          { dayOfWeek: 4, hour: 14, minute: 0, providers: ["X", "FACEBOOK"] },
        ],
        timezone: "UTC",
        isActive: true,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect(body.data).toBeTruthy();
    expect(body.data.total).toBe(2);
    expect(Array.isArray(body.data.slots)).toBeTruthy();
    expect(body.data.slots.length).toBe(2);
    for (const slot of body.data.slots) {
      createdRuleIds.push(slot.id);
    }
  });

  it("should return 400 for empty slots array in bulk create", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/scheduling/slots/bulk",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { projectId: testProjectId, slots: [] },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(false);
  });
});
