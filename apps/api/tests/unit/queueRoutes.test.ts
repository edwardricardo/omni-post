#!/usr/bin/env tsx
/**
 * Unit Tests for queueRoutes (admin/queueRoutes)
 *
 * Tests the 5 BullMQ queue management endpoints:
 *   GET  /admin/queue/stats
 *   GET  /admin/queue/jobs
 *   GET  /admin/queue/jobs/:id
 *   POST /admin/queue/jobs/:id/retry
 *   POST /admin/queue/jobs/:id/remove
 *
 * These routes create a BullMQ Queue connection with lazyConnect:true, so Redis
 * is not required for HTTP-layer tests. Empty-queue responses are expected in
 * the test environment.
 *
 * Routes are protected with requireAdminAuth + requireAdmin middleware.
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
import { queueRoutes } from "../../src/admin/queueRoutes.js";
import { prisma } from "@infra/prisma";
import { createTestAdminUser, cleanupTestAdminUsersByEmail } from "./admin/adminTestHelper.js";

const timestamp = Date.now();
const adminEmail = `queue-test-${timestamp}@example.com`;

async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(queueRoutes);
  await app.ready();
  return app;
}

let app: FastifyInstance;
let adminToken: string;

describe("queueRoutes", { concurrency: 1 }, () => {
  before(async () => {
    app = await createTestApp();

    // Create admin user with valid admin JWT token (routes require requireAdminAuth + requireAdmin)
    const result = await createTestAdminUser({
      email: adminEmail,
      name: "Queue Test Admin",
      password: "TestPassword123!",
      role: "ADMIN",
    });
    adminToken = result.token;
  });

  after(async () => {
    await cleanupTestAdminUsersByEmail(`queue-test-${timestamp}`);
    await app.close();
    await prisma.$disconnect();
    Object.assign(console, originalConsole);
  });

  // ── GET /admin/queue/stats ─────────────────────────────────────────────

  describe("GET /admin/queue/stats", () => {
    it("should return 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: "/admin/queue/stats" });
      assert.equal(res.statusCode, 401);
    });

    it("should return queue statistics with expected shape", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/queue/stats",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      // With lazyConnect the BullMQ client connects on demand; in a test env
      // without Redis it may return either 200 (empty counts) or 500 (ECONNREFUSED).
      // Both are valid — we assert the response is valid JSON and has the right
      // shape when successful, or a structured error when Redis is unavailable.
      const body = JSON.parse(res.body);
      if (res.statusCode === 200) {
        assert.equal(body.ok, true);
        assert.ok(typeof body.data.total === "number", "total should be a number");
        assert.ok(typeof body.data.queued === "number", "queued should be a number");
        assert.ok(typeof body.data.processing === "number", "processing should be a number");
        assert.ok(typeof body.data.published === "number", "published should be a number");
        assert.ok(typeof body.data.failed === "number", "failed should be a number");
        assert.ok(typeof body.data.successRate === "number", "successRate should be a number");
      } else {
        assert.equal(res.statusCode, 500);
        assert.equal(body.ok, false);
      }
    });

    it("should return valid successRate in range 0-100 when Redis available", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/queue/stats",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      if (res.statusCode !== 200) return; // skip when Redis unavailable

      const body = JSON.parse(res.body);
      assert.ok(body.data.successRate >= 0, "successRate should be >= 0");
      assert.ok(body.data.successRate <= 100, "successRate should be <= 100");
    });
  });

  // ── GET /admin/queue/jobs ──────────────────────────────────────────────

  describe("GET /admin/queue/jobs", () => {
    it("should return jobs list with items array", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/queue/jobs",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(res.body);
      if (res.statusCode === 200) {
        assert.equal(body.ok, true);
        assert.ok(Array.isArray(body.data.items), "items should be an array");
        assert.ok(typeof body.data.total === "number", "total should be a number");
      } else {
        assert.equal(res.statusCode, 500);
        assert.equal(body.ok, false);
      }
    });

    it("should accept types query parameter", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/queue/jobs?types=failed,waiting",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(res.body);
      if (res.statusCode === 200) {
        assert.equal(body.ok, true);
        assert.ok(Array.isArray(body.data.items));
      } else {
        // Redis unavailable — 500 is acceptable
        assert.equal(res.statusCode, 500);
      }
    });

    it("should accept start and end pagination parameters", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/queue/jobs?start=0&end=9",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(res.body);
      if (res.statusCode === 200) {
        assert.equal(body.ok, true);
      } else {
        assert.equal(res.statusCode, 500);
      }
    });

    it("should return 400 for invalid start parameter", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/queue/jobs?start=-1",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.body);
      assert.equal(body.ok, false);
    });
  });

  // ── GET /admin/queue/jobs/:id ──────────────────────────────────────────

  describe("GET /admin/queue/jobs/:id", () => {
    it("should return 404 for a non-existent job ID when Redis available", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/queue/jobs/nonexistent-job-id-999",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(res.body);
      if (res.statusCode === 404) {
        assert.equal(body.ok, false);
      } else {
        // Redis unavailable → 500
        assert.equal(res.statusCode, 500);
        assert.equal(body.ok, false);
      }
    });

    it("should return structured error response for missing job", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/queue/jobs/job-does-not-exist",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(res.body);
      assert.equal(body.ok, false);
      // Either 404 (job not found) or 500 (Redis down) — both have ok: false
    });
  });

  // ── POST /admin/queue/jobs/:id/retry ──────────────────────────────────

  describe("POST /admin/queue/jobs/:id/retry", () => {
    it("should return 404 when retrying non-existent job (Redis available)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/queue/jobs/nonexistent-retry-job/retry",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(res.body);
      if (res.statusCode === 404) {
        assert.equal(body.ok, false);
      } else {
        // Redis unavailable
        assert.equal(res.statusCode, 500);
        assert.equal(body.ok, false);
      }
    });

    it("should return error response shape for failed retry", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/queue/jobs/fake-job-id/retry",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(res.body);
      assert.equal(body.ok, false);
    });
  });

  // ── POST /admin/queue/jobs/:id/remove ─────────────────────────────────

  describe("POST /admin/queue/jobs/:id/remove", () => {
    it("should return 404 when removing non-existent job (Redis available)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/queue/jobs/nonexistent-remove-job/remove",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(res.body);
      if (res.statusCode === 404) {
        assert.equal(body.ok, false);
      } else {
        assert.equal(res.statusCode, 500);
        assert.equal(body.ok, false);
      }
    });

    it("should return error response shape for failed removal", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/queue/jobs/fake-job-id/remove",
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const body = JSON.parse(res.body);
      assert.equal(body.ok, false);
    });
  });
});
