#!/usr/bin/env tsx
/**
 * Unit Tests for executiveRoutes
 *
 * Covers:
 *   GET /api/admin/executive/metrics
 *   GET /api/admin/compliance/metrics
 *   GET /api/admin/compliance/audit-logs
 *   GET /api/admin/compliance/gdpr
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
import { executiveRoutes } from "../../src/admin/executiveRoutes.js";
import { setupContainer } from "../../src/infrastructure/container/setup.js";
import { prisma } from "@infra/prisma";
import { createTestAdminUser, cleanupTestAdminUsersByEmail } from "./admin/adminTestHelper.js";

async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const container = setupContainer({ prisma });
  app.decorate("container", container);
  await app.register(fastifyCookie);
  await app.register(executiveRoutes);
  await app.ready();
  return app;
}

const timestamp = Date.now();
const adminEmail = `executive-test-${timestamp}@example.com`;
const testPassword = "TestPassword123";

let app: FastifyInstance;
let adminToken: string;

describe("executiveRoutes Unit Tests", { concurrency: 1 }, () => {
  before(async () => {
    app = await createTestApp();

    // Create admin user and generate a valid admin JWT token
    const result = await createTestAdminUser({
      email: adminEmail,
      name: "Executive Test Admin",
      password: testPassword,
      role: "ADMIN",
    });
    adminToken = result.token;
  });

  after(async () => {
    await cleanupTestAdminUsersByEmail(`executive-test-${timestamp}`);
    await app.close();
    await prisma.$disconnect();
    Object.assign(console, originalConsole);
  });

  // ── GET /api/admin/executive/metrics ──────────────────────────────────────

  it("should return 401 without auth for executive metrics", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/executive/metrics",
    });
    assert.equal(res.statusCode, 401);
  });

  it("should return executive metrics with auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/executive/metrics",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.ok, "Should have ok: true");
    assert.ok(body.data, "Should have value field");
    // Verify top-level shape
    assert.ok("accounts" in body.data, "Should have accounts field");
    assert.ok("projects" in body.data, "Should have projects field");
    assert.ok("posts" in body.data, "Should have posts field");
    assert.ok("channels" in body.data, "Should have channels field");
    assert.ok("engagement" in body.data, "Should have engagement field");
    assert.ok("generatedAt" in body.data, "Should have generatedAt field");
    // Verify nested shapes
    assert.ok(typeof body.data.accounts.total === "number", "accounts.total should be a number");
    assert.ok(
      typeof body.data.posts.successRate === "number",
      "posts.successRate should be a number"
    );
    assert.ok(
      typeof body.data.engagement.engagementRate === "number",
      "engagementRate should be a number"
    );
  });

  it("should return executive metrics with date range params", async () => {
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const endDate = new Date().toISOString();
    const res = await app.inject({
      method: "GET",
      url: `/api/admin/executive/metrics?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.ok);
    // period should be populated
    assert.ok(body.data.period.startDate !== null, "period.startDate should be set");
    assert.ok(body.data.period.endDate !== null, "period.endDate should be set");
  });

  it("should return executive metrics with provider filter", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/executive/metrics?provider=X",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.ok);
    assert.ok("channels" in body.data);
  });

  // ── GET /api/admin/compliance/metrics ────────────────────────────────────

  it("should return 401 without auth for compliance metrics", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/compliance/metrics",
    });
    assert.equal(res.statusCode, 401);
  });

  it("should return compliance metrics with auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/compliance/metrics",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.ok, "Should have ok: true");
    assert.ok(body.data, "Should have value field");
    // Verify required response shape
    assert.ok("summary" in body.data, "Should have summary field");
    assert.ok("userActivity" in body.data, "Should have userActivity field");
    assert.ok("topActions" in body.data, "Should have topActions field");
    assert.ok("topResources" in body.data, "Should have topResources field");
    assert.ok("gdpr" in body.data, "Should have gdpr field");
    assert.ok("generatedAt" in body.data, "Should have generatedAt field");
    // Verify summary shape
    assert.ok(
      typeof body.data.summary.complianceScore === "number",
      "complianceScore should be a number"
    );
    assert.ok(
      typeof body.data.summary.totalAuditLogs === "number",
      "totalAuditLogs should be a number"
    );
    assert.ok(typeof body.data.summary.successRate === "number", "successRate should be a number");
    // Verify gdpr shape
    assert.ok(
      typeof body.data.gdpr.totalDataSubjects === "number",
      "gdpr.totalDataSubjects should be a number"
    );
    assert.ok(
      typeof body.data.gdpr.exportRequests === "number",
      "gdpr.exportRequests should be a number"
    );
    // topActions should be an array
    assert.ok(Array.isArray(body.data.topActions), "topActions should be an array");
    assert.ok(Array.isArray(body.data.topResources), "topResources should be an array");
  });

  // ── GET /api/admin/compliance/audit-logs ─────────────────────────────────

  it("should return 401 without auth for compliance audit logs", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/compliance/audit-logs",
    });
    assert.equal(res.statusCode, 401);
  });

  it("should return paginated audit logs with auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/compliance/audit-logs",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.ok, "Should have ok: true");
    assert.ok(body.data, "Should have value field");
    // formatPaginatedResponse returns { ok, data, pagination } — wrapped in body.data
    assert.ok("data" in body.data, "Should have data field");
    assert.ok("pagination" in body.data, "Should have pagination field");
    assert.ok(Array.isArray(body.data.data), "data should be an array");
    assert.ok(
      typeof body.data.pagination.total === "number",
      "pagination.total should be a number"
    );
    assert.ok(typeof body.data.pagination.page === "number", "pagination.page should be a number");
  });

  it("should respect page and limit pagination params", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/compliance/audit-logs?page=1&limit=5",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.ok);
    assert.equal(body.data.pagination.page, 1, "page should be 1");
    assert.equal(body.data.pagination.limit, 5, "limit should be 5");
    assert.ok(body.data.data.length <= 5, "Should return at most 5 items");
  });

  it("should accept sorting params for audit logs", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/compliance/audit-logs?sortBy=createdAt&sortOrder=asc",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.ok);
    assert.ok(Array.isArray(body.data.data));
  });

  it("should filter audit logs by action", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/compliance/audit-logs?action=LOGIN",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.ok);
    assert.ok(Array.isArray(body.data.data));
  });

  it("should filter audit logs by date range", async () => {
    const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const endDate = new Date().toISOString();
    const res = await app.inject({
      method: "GET",
      url: `/api/admin/compliance/audit-logs?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.ok);
    assert.ok(Array.isArray(body.data.data));
  });

  // ── GET /api/admin/compliance/gdpr ───────────────────────────────────────

  it("should return 401 without auth for GDPR data", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/compliance/gdpr",
    });
    assert.equal(res.statusCode, 401);
  });

  it("should return GDPR data with no query params", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/compliance/gdpr",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.ok, "Should have ok: true");
    assert.ok(body.data, "Should have value field");
    // Verify GDPR response shape
    assert.ok("summary" in body.data, "Should have summary field");
    assert.ok("dataSubjects" in body.data, "Should have dataSubjects field");
    assert.ok("generatedAt" in body.data, "Should have generatedAt field");
    assert.ok(Array.isArray(body.data.dataSubjects), "dataSubjects should be an array");
    assert.ok(
      typeof body.data.summary.totalDataSubjects === "number",
      "totalDataSubjects should be a number"
    );
  });

  it("should return GDPR data filtered by accountId", async () => {
    // Use a known non-existent account ID to test filtering without requiring data
    const nonExistentId = "a0000000-0000-4000-8000-000000000000";
    const res = await app.inject({
      method: "GET",
      url: `/api/admin/compliance/gdpr?accountId=${nonExistentId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.ok);
    assert.equal(
      body.data.dataSubjects.length,
      0,
      "Should return no data subjects for non-existent account"
    );
  });

  it("should return GDPR data with requestType filter", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/compliance/gdpr?requestType=export",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.ok);
    assert.equal(body.data.requestType, "export", "requestType should be echoed back");
  });

  it("should return GDPR data with status filter", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/compliance/gdpr?status=pending",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.ok);
    assert.equal(body.data.status, "pending", "status should be echoed back");
  });
});
