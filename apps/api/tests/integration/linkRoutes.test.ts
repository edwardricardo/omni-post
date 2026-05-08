/**
 * Integration Tests - Link Tracking Routes
 *
 * Tests the full HTTP request/response cycle for link tracking endpoints.
 *
 * NOTE: These tests require the API server to be running.
 * Run `pnpm dev:api` before running these tests.
 *
 * @file linkRoutes.test.ts
 * @description Tests for Link Tracking Routes Integration
 * @layer infrastructure
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import { checkApiAvailable, getBaseUrl } from "../testUtils.js";

const API_URL = getBaseUrl();

describe("Link Tracking Routes Integration", () => {
  let apiAvailable = false;
  let prisma: PrismaClient;
  let testAccountId: string;
  let testProjectId: string;

  before(async () => {
    apiAvailable = await checkApiAvailable();
    if (!apiAvailable) {
      console.log("⚠️  API server not running - link tracking integration tests will be skipped");
      return;
    }

    prisma = createTestPrismaClient();

    // Create test account and project
    const account = await prisma.account.create({
      data: {
        email: `link-routes-test-${Date.now()}@test.com`,
        name: "Link Routes Test Account",
      },
    });
    testAccountId = account.id;

    const project = await prisma.project.create({
      data: {
        accountId: account.id,
        name: `Link Routes Test Project ${Date.now()}`,
      },
    });
    testProjectId = project.id;
  });

  after(async () => {
    if (!apiAvailable) return;

    // Cleanup
    await prisma.linkClick.deleteMany({});
    await prisma.trackedLink.deleteMany({});
    await prisma.project.deleteMany({ where: { id: testProjectId } });
    await prisma.account.deleteMany({ where: { id: testAccountId } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    if (!apiAvailable) return;

    // Clean links before each test
    await prisma.linkClick.deleteMany({});
    await prisma.trackedLink.deleteMany({});
  });

  describe("POST /links", () => {
    it("should create a tracked link", async (t) => {
      if (!apiAvailable) {
        t.skip("API not available");
        return;
      }

      const response = await fetch(`${API_URL}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: testProjectId,
          originalUrl: "https://example.com/test-page",
        }),
      });

      assert.equal(response.status, 201);
      const body = await response.json();
      assert.ok(body.ok);
      assert.ok(body.data.id);
      assert.equal(body.data.originalUrl, "https://example.com/test-page");
      assert.ok(body.data.shortCode);
      assert.equal(body.data.clicks, 0);
      assert.equal(body.data.isActive, true);
    });

    it("should create a tracked link with vanity slug", async (t) => {
      if (!apiAvailable) {
        t.skip("API not available");
        return;
      }

      const response = await fetch(`${API_URL}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: testProjectId,
          originalUrl: "https://example.com/vanity-test",
          vanitySlug: "my-custom-slug",
        }),
      });

      assert.equal(response.status, 201);
      const body = await response.json();
      assert.ok(body.ok);
      assert.equal(body.data.vanitySlug, "my-custom-slug");
    });

    it("should reject invalid URL", async (t) => {
      if (!apiAvailable) {
        t.skip("API not available");
        return;
      }

      const response = await fetch(`${API_URL}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: testProjectId,
          originalUrl: "not-a-valid-url",
        }),
      });

      assert.equal(response.status, 400);
    });

    it("should reject duplicate vanity slug", async (t) => {
      if (!apiAvailable) {
        t.skip("API not available");
        return;
      }

      // Create first link with vanity slug
      await fetch(`${API_URL}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: testProjectId,
          originalUrl: "https://example.com/first",
          vanitySlug: "unique-slug",
        }),
      });

      // Try to create another with same vanity slug
      const response = await fetch(`${API_URL}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: testProjectId,
          originalUrl: "https://example.com/second",
          vanitySlug: "unique-slug",
        }),
      });

      assert.equal(response.status, 409);
    });
  });

  describe("GET /links/:id", () => {
    it("should return a tracked link by ID", async (t) => {
      if (!apiAvailable) {
        t.skip("API not available");
        return;
      }

      // Create a link first
      const createResponse = await fetch(`${API_URL}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: testProjectId,
          originalUrl: "https://example.com/get-test",
        }),
      });
      const createBody = await createResponse.json();
      const linkId = createBody.data.id;

      // Get the link
      const response = await fetch(`${API_URL}/links/${linkId}`);

      assert.equal(response.status, 200);
      const body = await response.json();
      assert.ok(body.ok);
      assert.equal(body.data.id, linkId);
      assert.equal(body.data.originalUrl, "https://example.com/get-test");
    });

    it("should return 404 for non-existent link", async (t) => {
      if (!apiAvailable) {
        t.skip("API not available");
        return;
      }

      const response = await fetch(`${API_URL}/links/00000000-0000-0000-0000-000000000000`);

      assert.equal(response.status, 404);
    });
  });

  describe("GET /links/:id/stats", () => {
    it("should return link statistics", async (t) => {
      if (!apiAvailable) {
        t.skip("API not available");
        return;
      }

      // Create a link
      const createResponse = await fetch(`${API_URL}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: testProjectId,
          originalUrl: "https://example.com/stats-test",
        }),
      });
      const createBody = await createResponse.json();
      const linkId = createBody.data.id;

      // Get stats
      const response = await fetch(`${API_URL}/links/${linkId}/stats`);

      assert.equal(response.status, 200);
      const body = await response.json();
      assert.ok(body.ok);
      assert.equal(body.data.totalClicks, 0);
      assert.ok(body.data.clicksByCountry);
    });
  });

  describe("DELETE /links/:id", () => {
    it("should delete a tracked link", async (t) => {
      if (!apiAvailable) {
        t.skip("API not available");
        return;
      }

      // Create a link
      const createResponse = await fetch(`${API_URL}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: testProjectId,
          originalUrl: "https://example.com/delete-test",
        }),
      });
      const createBody = await createResponse.json();
      const linkId = createBody.data.id;

      // Delete the link
      const deleteResponse = await fetch(`${API_URL}/links/${linkId}`, {
        method: "DELETE",
      });

      assert.equal(deleteResponse.status, 200);

      // Verify it's deleted
      const getResponse = await fetch(`${API_URL}/links/${linkId}`);

      assert.equal(getResponse.status, 404);
    });
  });

  describe("GET /r/:shortCode", () => {
    it("should redirect to original URL", async (t) => {
      if (!apiAvailable) {
        t.skip("API not available");
        return;
      }

      // Create a link
      const createResponse = await fetch(`${API_URL}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: testProjectId,
          originalUrl: "https://example.com/redirect-test",
        }),
      });
      const createBody = await createResponse.json();
      const shortCode = createBody.data.shortCode;

      // Access redirect endpoint (don't follow redirects)
      const response = await fetch(`${API_URL}/r/${shortCode}`, {
        redirect: "manual",
      });

      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), "https://example.com/redirect-test");
    });

    it("should redirect using vanity slug", async (t) => {
      if (!apiAvailable) {
        t.skip("API not available");
        return;
      }

      // Create a link with vanity slug
      await fetch(`${API_URL}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: testProjectId,
          originalUrl: "https://example.com/vanity-redirect",
          vanitySlug: "my-vanity",
        }),
      });

      // Access redirect endpoint with vanity slug
      const response = await fetch(`${API_URL}/r/my-vanity`, {
        redirect: "manual",
      });

      assert.equal(response.status, 302);
      assert.equal(response.headers.get("location"), "https://example.com/vanity-redirect");
    });

    it("should return 404 for non-existent short code", async (t) => {
      if (!apiAvailable) {
        t.skip("API not available");
        return;
      }

      const response = await fetch(`${API_URL}/r/nonexistent`);

      assert.equal(response.status, 404);
    });

    it("should increment click count on redirect", async (t) => {
      if (!apiAvailable) {
        t.skip("API not available");
        return;
      }

      // Create a link
      const createResponse = await fetch(`${API_URL}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: testProjectId,
          originalUrl: "https://example.com/click-count-test",
        }),
      });
      const createBody = await createResponse.json();
      const linkId = createBody.data.id;
      const shortCode = createBody.data.shortCode;

      // Access redirect multiple times
      await fetch(`${API_URL}/r/${shortCode}`, { redirect: "manual" });
      await fetch(`${API_URL}/r/${shortCode}`, { redirect: "manual" });
      await fetch(`${API_URL}/r/${shortCode}`, { redirect: "manual" });

      // Wait a bit for async click recording
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check click count
      const statsResponse = await fetch(`${API_URL}/links/${linkId}/stats`);
      const statsBody = await statsResponse.json();

      assert.equal(statsBody.data.totalClicks, 3);
    });
  });
});
