#!/usr/bin/env tsx
/**
 * Unit Tests for schedulingRoutes
 *
 * Covers:
 *   GET  /admin/posts/scheduled
 *   POST /admin/posts/:id/cancel
 *   POST /admin/posts/:id/reschedule
 *   GET  /api/scheduling/slots
 *   GET  /api/analytics/optimal-times
 *   GET  /api/scheduling/rules
 *   POST /api/scheduling/slots
 *   POST /api/scheduling/slots/bulk
 */

// Suppress console output during tests
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
import { schedulingRoutes } from "../../src/admin/schedulingRoutes.js";
import { setupContainer } from "../../src/infrastructure/container/setup.js";
import { prisma } from "@infra/prisma";
import { createTestAdminUser, cleanupTestAdminUsersByEmail } from "./admin/adminTestHelper.js";

async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const container = setupContainer({ prisma });
  app.decorate("container", container);
  await app.register(fastifyCookie);
  await app.register(schedulingRoutes);
  await app.ready();
  return app;
}

const timestamp = Date.now();
const adminEmail = `scheduling-test-${timestamp}@example.com`;
const testPassword = "TestPassword123";

let app: FastifyInstance;
let adminToken: string;
let testAccountId: string;
let testProjectId: string;
// Scheduling rules created during tests (for cleanup)
const createdRuleIds: string[] = [];

describe("schedulingRoutes Unit Tests", { concurrency: 1 }, () => {
  before(async () => {
    app = await createTestApp();

    // Create admin user and generate a valid admin JWT token
    const result = await createTestAdminUser({
      email: adminEmail,
      name: "Scheduling Test Admin",
      password: testPassword,
      role: "ADMIN",
    });
    adminToken = result.token;

    // Create a test account and project for slot/rule tests
    const account = await prisma.account.create({
      data: {
        name: `Scheduling Test Account ${timestamp}`,
        email: `scheduling-account-${timestamp}@example.com`,
        maxProjects: 5,
      },
    });
    testAccountId = account.id;

    const project = await prisma.project.create({
      data: {
        name: `Scheduling Test Project ${timestamp}`,
        accountId: testAccountId,
      },
    });
    testProjectId = project.id;
  });

  after(async () => {
    // Clean up scheduling rules created in tests
    if (createdRuleIds.length > 0) {
      await prisma.schedulingRule.deleteMany({
        where: { id: { in: createdRuleIds } },
      });
    }
    // Clean up project and account
    await prisma.project.deleteMany({ where: { id: testProjectId } });
    await prisma.account.deleteMany({ where: { id: testAccountId } });
    // Clean up admin users
    await cleanupTestAdminUsersByEmail(`scheduling-test-${timestamp}`);
    await app.close();
    await prisma.$disconnect();
    Object.assign(console, originalConsole);
  });

  // ── GET /admin/posts/scheduled ─────────────────────────────────────────────

  it("should return 401 without auth for scheduled posts list", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/posts/scheduled",
    });
    assert.equal(res.statusCode, 401);
  });

  it("should return paginated scheduled posts with auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/posts/scheduled",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.ok, "Should have ok: true");
    assert.ok(body.data, "Should have value field");
    // formatPaginatedResponse returns { ok, data, pagination }
    assert.ok("data" in body.data, "Should have data field");
    assert.ok("pagination" in body.data, "Should have pagination field");
    assert.ok(Array.isArray(body.data.data), "data should be an array");
    assert.ok(
      typeof body.data.pagination.total === "number",
      "pagination.total should be a number"
    );
  });

  it("should filter scheduled posts by projectId", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/admin/posts/scheduled?projectId=${testProjectId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.ok);
    assert.ok(Array.isArray(body.data.data));
  });

  // ── POST /admin/posts/:id/cancel ──────────────────────────────────────────

  it("should return 401 without auth for cancel post", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/posts/a0000000-0000-4000-8000-000000000000/cancel",
    });
    assert.equal(res.statusCode, 401);
  });

  it("should return 404 when cancelling non-existent post", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/posts/a0000000-0000-4000-8000-000000000000/cancel",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 404);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, false);
  });

  it("should return 400 when cancelling a non-scheduled post", async () => {
    // Create a DRAFT post directly in DB (locale is on PostContent, not Post)
    const post = await prisma.post.create({
      data: {
        projectId: testProjectId,
        status: "DRAFT",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: `/admin/posts/${post.id}/cancel`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    // Clean up regardless
    await prisma.post.delete({ where: { id: post.id } });

    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, false);
  });

  it("should successfully cancel a scheduled post", async () => {
    // Create a SCHEDULED post directly in DB
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const post = await prisma.post.create({
      data: {
        projectId: testProjectId,
        status: "SCHEDULED",
        scheduledAt: futureDate,
      },
    });

    const res = await app.inject({
      method: "POST",
      url: `/admin/posts/${post.id}/cancel`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    // Clean up
    await prisma.post.delete({ where: { id: post.id } });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.ok);
    assert.equal(body.data.status, "DRAFT", "Cancelled post should have DRAFT status");
  });

  // ── POST /admin/posts/:id/reschedule ──────────────────────────────────────

  it("should return 401 without auth for reschedule post", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/posts/a0000000-0000-4000-8000-000000000000/reschedule",
      payload: { scheduledAt: new Date(Date.now() + 3600000).toISOString() },
    });
    assert.equal(res.statusCode, 401);
  });

  it("should return 404 when rescheduling non-existent post", async () => {
    const futureTime = new Date(Date.now() + 3600000).toISOString();
    const res = await app.inject({
      method: "POST",
      url: "/admin/posts/a0000000-0000-4000-8000-000000000000/reschedule",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { scheduledAt: futureTime },
    });
    assert.equal(res.statusCode, 404);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, false);
  });

  it("should successfully reschedule a post to a future time", async () => {
    // Create a SCHEDULED post
    const initialDate = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const post = await prisma.post.create({
      data: {
        projectId: testProjectId,
        status: "SCHEDULED",
        scheduledAt: initialDate,
      },
    });

    const newDate = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    const res = await app.inject({
      method: "POST",
      url: `/admin/posts/${post.id}/reschedule`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { scheduledAt: newDate, timezone: "UTC" },
    });

    // Clean up
    await prisma.post.delete({ where: { id: post.id } });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.ok);
    assert.equal(body.data.status, "SCHEDULED", "Rescheduled post should remain SCHEDULED");
    assert.ok(body.data.scheduledAt, "Should have a new scheduledAt date");
  });

  // ── GET /api/scheduling/slots ──────────────────────────────────────────────

  it("should return 401 without auth for scheduling slots", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/scheduling/slots",
    });
    assert.equal(res.statusCode, 401);
  });

  it("should return 404 for non-existent project in scheduling slots", async () => {
    const startDate = new Date().toISOString();
    const endDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const res = await app.inject({
      method: "GET",
      url: `/api/scheduling/slots?projectId=a0000000-0000-4000-8000-000000000000&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 404);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, false);
  });

  it("should return scheduling slots for a valid project", async () => {
    const startDate = new Date().toISOString();
    const endDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const res = await app.inject({
      method: "GET",
      url: `/api/scheduling/slots?projectId=${testProjectId}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.ok, "Should have ok: true");
    assert.ok(body.data, "Should have value field");
    assert.ok("slots" in body.data, "Should have slots field");
    assert.ok("rules" in body.data, "Should have rules field");
    assert.ok(Array.isArray(body.data.slots), "slots should be an array");
    assert.equal(body.data.projectId, testProjectId, "projectId should match");
  });

  // ── GET /api/analytics/optimal-times ─────────────────────────────────────

  it("should return 401 without auth for optimal posting times", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/analytics/optimal-times",
    });
    assert.equal(res.statusCode, 401);
  });

  it("should return 404 for non-existent project in optimal times", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/analytics/optimal-times?projectId=a0000000-0000-4000-8000-000000000000",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 404);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, false);
  });

  it("should return optimal posting times for a valid project", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/analytics/optimal-times?projectId=${testProjectId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.ok, "Should have ok: true");
    assert.ok(body.data, "Should have value field");
    assert.ok("optimalTimes" in body.data, "Should have optimalTimes field");
    assert.ok(Array.isArray(body.data.optimalTimes), "optimalTimes should be an array");
    assert.equal(body.data.projectId, testProjectId, "projectId should match");
  });

  it("should return optimal times with lookbackDays param", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/analytics/optimal-times?projectId=${testProjectId}&lookbackDays=7`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.ok);
    assert.ok(Array.isArray(body.data.optimalTimes));
  });

  // ── GET /api/scheduling/rules ──────────────────────────────────────────────

  it("should return 401 without auth for scheduling rules", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/scheduling/rules",
    });
    assert.equal(res.statusCode, 401);
  });

  it("should return 404 for non-existent project in scheduling rules", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/scheduling/rules?projectId=a0000000-0000-4000-8000-000000000000",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 404);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, false);
  });

  it("should return scheduling rules for a valid project", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/scheduling/rules?projectId=${testProjectId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.ok, "Should have ok: true");
    assert.ok(body.data, "Should have value field");
    assert.ok("rules" in body.data, "Should have rules field");
    assert.ok(Array.isArray(body.data.rules), "rules should be an array");
    assert.equal(body.data.projectId, testProjectId, "projectId should match");
    assert.ok(typeof body.data.total === "number", "total should be a number");
  });

  it("should filter scheduling rules by isActive", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/scheduling/rules?projectId=${testProjectId}&isActive=true`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.ok);
    assert.ok(Array.isArray(body.data.rules));
  });

  // ── POST /api/scheduling/slots ─────────────────────────────────────────────

  it("should return 401 without auth for create slot", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/scheduling/slots",
      payload: {
        projectId: testProjectId,
        dayOfWeek: 1,
        hour: 9,
        providers: ["X"],
      },
    });
    assert.equal(res.statusCode, 401);
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
    assert.equal(res.statusCode, 404);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, false);
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
    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.ok(body.ok, "Should have ok: true");
    assert.ok(body.data, "Should have value field");
    assert.ok(body.data.id, "Should have id field");
    assert.equal(body.data.projectId, testProjectId, "projectId should match");
    assert.ok(Array.isArray(body.data.platforms), "platforms should be an array");
    assert.ok(body.data.slot, "Should have slot field");
    assert.equal(body.data.slot.dayOfWeek, 1, "dayOfWeek should match");
    assert.equal(body.data.slot.hour, 9, "hour should match");
    // Track for cleanup
    createdRuleIds.push(body.data.id);
  });

  it("should return 400 for missing required fields when creating slot", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/scheduling/slots",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        // Missing dayOfWeek, hour, providers
        projectId: testProjectId,
      },
    });
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, false);
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
    assert.equal(res.statusCode, 401);
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
    assert.equal(res.statusCode, 404);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, false);
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
    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.ok(body.ok, "Should have ok: true");
    assert.ok(body.data, "Should have value field");
    assert.equal(body.data.total, 2, "Should create 2 slots");
    assert.ok(Array.isArray(body.data.slots), "slots should be an array");
    assert.equal(body.data.slots.length, 2, "Should return 2 created slots");
    // Track for cleanup
    for (const slot of body.data.slots) {
      createdRuleIds.push(slot.id);
    }
  });

  it("should return 400 for empty slots array in bulk create", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/scheduling/slots/bulk",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        projectId: testProjectId,
        slots: [],
      },
    });
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, false);
  });
});
