/**
 * @file analyticsRoutes.test.ts
 * @description Unit tests for analyticsRoutes. Uses mocked Prisma stores and
 *              a real Fastify instance to test HTTP endpoint behavior.
 *
 * Covers:
 *   GET /api/admin/analytics/metrics
 *   GET /api/admin/compliance/metrics
 *   GET /api/admin/compliance/audit-logs
 *   GET /api/admin/compliance/gdpr
 * @layer infrastructure
 */

import { describe, it, beforeAll, afterAll, expect, vi } from "vitest";
import { createMockPrismaModule, createStore, buildModelMock } from "./helpers/mockPrisma.js";

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

const { mockPrisma } = createMockPrismaModule();

// Add extra models that analyticsRoutes handlers use (post, channel, analytics,
// adminUserPermission, publishLog, gdprSettings, securitySettings)
const gdprStore = createStore();
gdprStore.add({
  id: "gdpr-singleton",
  privacyPolicyUrl: null,
  termsOfServiceUrl: null,
  dpoType: "NONE",
  dpoEmail: null,
  dpoUrl: null,
  dataRetentionDays: 365,
  enableAutoDataDeletion: false,
  dsarResponseDays: 30,
  enableRightToErasure: false,
  updatedBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});
const securityStore = createStore();
securityStore.add({
  id: "security-singleton",
  mfaRequired: false,
  sessionTimeout: 3600,
  maxConcurrentSessions: 5,
  ipAllowlist: [],
  passwordMinLength: 8,
  passwordRequireUppercase: true,
  passwordRequireLowercase: true,
  passwordRequireNumbers: true,
  passwordRequireSpecial: true,
  passwordExpireDays: 90,
  enableAuditLog: true,
  updatedBy: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});
const extraModels = {
  post: buildModelMock(createStore()),
  channel: buildModelMock(createStore()),
  analytics: buildModelMock(createStore()),
  adminUserPermission: buildModelMock(createStore()),
  publishLog: buildModelMock(createStore()),
  gdprSettings: buildModelMock(gdprStore),
  securitySettings: buildModelMock(securityStore),
};
Object.assign(mockPrisma.prisma, extraModels);

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
  return { logger: noopLogger, authLogger: noopLogger, createLogger: () => noopLogger };
});

// ---------------------------------------------------------------------------
// Dynamic imports after mocks
// ---------------------------------------------------------------------------

const Fastify = (await import("fastify")).default;
const { analyticsRoutes } = await import("../../src/admin/analyticsRoutes.js");
const { setupContainer } = await import("../../src/infrastructure/container/setup.js");
const { generateAdminToken } = await import("./admin/adminTestHelper.js");

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const timestamp = Date.now();
const adminEmail = `analytics-test-${timestamp}@example.com`;

async function createTestApp() {
  const app = Fastify({ logger: false });
  const container = setupContainer({ prisma: mockPrisma.prisma as never });
  app.decorate("container", container);
  const fastifyCookie = (await import("@fastify/cookie")).default;
  await app.register(fastifyCookie);
  await app.register(analyticsRoutes);
  await app.ready();
  return app;
}

let app: import("fastify").FastifyInstance;
let adminToken: string;

describe("analyticsRoutes Unit Tests", () => {
  beforeAll(async () => {
    app = await createTestApp();

    // Generate a valid admin JWT token directly
    adminToken = generateAdminToken({
      id: "analytics-admin-test-id",
      email: adminEmail,
      name: "Analytics Test Admin",
      role: "ADMIN",
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // ── GET /api/admin/analytics/metrics ──────────────────────────────────────

  it("should return 401 without auth for analytics metrics", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/analytics/metrics",
    });
    expect(res.statusCode).toBe(401);
  });

  it("should return analytics metrics with auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/analytics/metrics",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect(body.data).toBeTruthy();
    expect("accounts" in body.data).toBeTruthy();
    expect("projects" in body.data).toBeTruthy();
    expect("posts" in body.data).toBeTruthy();
    expect("channels" in body.data).toBeTruthy();
    expect("engagement" in body.data).toBeTruthy();
    expect("generatedAt" in body.data).toBeTruthy();
    expect(typeof body.data.accounts.total === "number").toBeTruthy();
    expect(typeof body.data.posts.successRate === "number").toBeTruthy();
    expect(typeof body.data.engagement.engagementRate === "number").toBeTruthy();
  });

  it("should return analytics metrics with date range params", async () => {
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const endDate = new Date().toISOString();
    const res = await app.inject({
      method: "GET",
      url: `/admin/analytics/metrics?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect(body.data.period.startDate !== null).toBeTruthy();
    expect(body.data.period.endDate !== null).toBeTruthy();
  });

  it("should return analytics metrics with provider filter", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/analytics/metrics?provider=X",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect("channels" in body.data).toBeTruthy();
  });

  // ── GET /api/admin/compliance/metrics ────────────────────────────────────

  it("should return 401 without auth for compliance metrics", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/compliance/metrics",
    });
    expect(res.statusCode).toBe(401);
  });

  it("should return compliance metrics with auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/compliance/metrics",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect(body.data).toBeTruthy();
    expect("summary" in body.data).toBeTruthy();
    expect("userActivity" in body.data).toBeTruthy();
    expect("topActions" in body.data).toBeTruthy();
    expect("topResources" in body.data).toBeTruthy();
    expect("gdpr" in body.data).toBeTruthy();
    expect("generatedAt" in body.data).toBeTruthy();
    expect(typeof body.data.summary.complianceScore === "number").toBeTruthy();
    expect(typeof body.data.summary.totalAuditLogs === "number").toBeTruthy();
    expect(typeof body.data.summary.successRate === "number").toBeTruthy();
    expect(typeof body.data.gdpr.totalDataSubjects === "number").toBeTruthy();
    expect(typeof body.data.gdpr.exportRequests === "number").toBeTruthy();
    expect(Array.isArray(body.data.topActions)).toBeTruthy();
    expect(Array.isArray(body.data.topResources)).toBeTruthy();
  });

  // ── GET /api/admin/compliance/audit-logs ─────────────────────────────────

  it("should return 401 without auth for compliance audit logs", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/compliance/audit-logs",
    });
    expect(res.statusCode).toBe(401);
  });

  it("should return paginated audit logs with auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/compliance/audit-logs",
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
    expect(typeof body.data.pagination.page === "number").toBeTruthy();
  });

  it("should respect page and limit pagination params", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/compliance/audit-logs?page=1&limit=5",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect(body.data.pagination.page).toBe(1);
    expect(body.data.pagination.limit).toBe(5);
    expect(body.data.data.length <= 5).toBeTruthy();
  });

  it("should accept sorting params for audit logs", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/compliance/audit-logs?sortBy=createdAt&sortOrder=asc",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect(Array.isArray(body.data.data)).toBeTruthy();
  });

  it("should filter audit logs by action", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/compliance/audit-logs?action=LOGIN",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect(Array.isArray(body.data.data)).toBeTruthy();
  });

  it("should filter audit logs by date range", async () => {
    const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const endDate = new Date().toISOString();
    const res = await app.inject({
      method: "GET",
      url: `/admin/compliance/audit-logs?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect(Array.isArray(body.data.data)).toBeTruthy();
  });

  // ── GET /api/admin/compliance/gdpr ───────────────────────────────────────

  it("should return 401 without auth for GDPR data", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/compliance/gdpr",
    });
    expect(res.statusCode).toBe(401);
  });

  it("should return GDPR data with no query params", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/compliance/gdpr",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect(body.data).toBeTruthy();
    expect("summary" in body.data).toBeTruthy();
    expect("dataSubjects" in body.data).toBeTruthy();
    expect("generatedAt" in body.data).toBeTruthy();
    expect(Array.isArray(body.data.dataSubjects)).toBeTruthy();
    expect(typeof body.data.summary.totalDataSubjects === "number").toBeTruthy();
  });

  it("should return GDPR data filtered by accountId", async () => {
    const nonExistentId = "a0000000-0000-4000-8000-000000000000";
    const res = await app.inject({
      method: "GET",
      url: `/admin/compliance/gdpr?accountId=${nonExistentId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect(body.data.dataSubjects.length).toBe(0);
  });

  it("should return GDPR data with requestType filter", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/compliance/gdpr?requestType=export",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect(body.data.requestType).toBe("export");
  });

  it("should return GDPR data with status filter", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/compliance/gdpr?status=pending",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBeTruthy();
    expect(body.data.status).toBe("pending");
  });
});
