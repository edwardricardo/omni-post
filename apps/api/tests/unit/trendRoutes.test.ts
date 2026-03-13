#!/usr/bin/env tsx
/**
 * Unit Tests for trendRoutes
 *
 * Tests all 5 trend analysis endpoints:
 *   GET /trends/analysis
 *   GET /trends/viral
 *   GET /trends/opportunities
 *   GET /trends/predictions
 *   GET /trends/report
 *
 * Tier 1: requires PostgreSQL (DI container setup) but no Redis.
 * The TrendAnalysisService uses mock data so all endpoints return 200
 * without any external API calls.
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

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import fastifyCookie from "@fastify/cookie";
import { trendRoutes } from "../../src/trends/trendRoutes.js";
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
  await app.register(trendRoutes);
  await app.ready();
  return app;
}

const timestamp = Date.now();
const testEmail = `trend-test-${timestamp}@example.com`;
const testPassword = "TestPassword123";

let app: FastifyInstance;
let authToken: string;

describe("trendRoutes", () => {
  beforeAll(async () => {
    app = await createTestApp();

    // Register and log in a test user
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: testEmail, password: testPassword, name: "Trend Tester" },
    });

    const loginRes = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: testEmail, password: testPassword },
    });
    const loginBody = JSON.parse(loginRes.body);
    authToken = loginBody.data?.accessToken ?? "";
  });

  afterAll(async () => {
    try {
      await prisma.adminUser.deleteMany({
        where: { email: { startsWith: `trend-test-${timestamp}` } },
      });
    } catch {
      // Defensive cleanup
    }
    await app.close();
    Object.assign(console, originalConsole);
  });

  // ── GET /trends/analysis ─────────────────────────────────────────────────

  describe("GET /trends/analysis", () => {
    it("should return trending content without filters", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/trends/analysis",
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data)).toBeTruthy();
    });

    it("should accept valid type filter", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/trends/analysis?type=hashtag",
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
    });

    it("should accept valid timeframe filter", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/trends/analysis?timeframe=7d&limit=10",
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
    });

    it("should reject invalid type enum value", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/trends/analysis?type=invalid_type",
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(res.statusCode).toBe(400);
    });

    it("should reject limit exceeding maximum", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/trends/analysis?limit=999",
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /trends/viral ────────────────────────────────────────────────────

  describe("GET /trends/viral", () => {
    it("should analyze viral content for a given contentId", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/trends/viral?contentId=trend_dance_2024",
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
      expect(body.data).toBeTruthy();
    });

    it("should return 400 when contentId is missing", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/trends/viral",
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(res.statusCode).toBe(400);
    });

    it("should return 400 when contentId is empty string", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/trends/viral?contentId=",
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /trends/opportunities ─────────────────────────────────────────────

  describe("GET /trends/opportunities", () => {
    it("should return content opportunities without filters", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/trends/opportunities",
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
      expect(body.data).toBeTruthy();
    });

    it("should accept category and region filters", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/trends/opportunities?category=dance&region=US",
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
    });

    it("should accept competitorAnalysis flag", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/trends/opportunities?competitorAnalysis=true",
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
    });
  });

  // ── GET /trends/predictions ───────────────────────────────────────────────

  describe("GET /trends/predictions", () => {
    it("should return trend predictions without filters", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/trends/predictions",
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
      expect(body.data).toBeTruthy();
    });

    it("should accept timeHorizon parameter", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/trends/predictions?timeHorizon=short",
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
    });

    it("should reject invalid timeHorizon value", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/trends/predictions?timeHorizon=invalid",
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /trends/report ────────────────────────────────────────────────────

  describe("GET /trends/report", () => {
    it("should generate trend report without filters", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/trends/report",
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
      expect(body.data).toBeTruthy();
      // Report should have augmented metadata from TrendReportBuilder
      expect(body.data.builderMeta).toBeTruthy();
      expect(body.data.extendedInsights).toBeTruthy();
      expect(body.data.extendedRecommendations).toBeTruthy();
    });

    it("should accept valid startDate and endDate", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/trends/report?startDate=2026-01-01&endDate=2026-01-31",
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
    });

    it("should reject invalid date format", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/trends/report?startDate=01-01-2026",
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(res.statusCode).toBe(400);
    });

    it("should accept includeCompetitors flag", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/trends/report?includeCompetitors=true",
        headers: { authorization: `Bearer ${authToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
    });
  });
});
