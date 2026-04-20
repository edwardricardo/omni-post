#!/usr/bin/env tsx
/**
 * Unit Tests for webhookDashboardRoutes
 * Testing all webhook dashboard HTTP endpoints
 *
 * Coverage Target: 95%+
 */

import { describe, it, beforeAll, afterAll, beforeEach, vi, expect } from "vitest";

vi.mock("@infra/prisma", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  const { createMockPrismaModule } = await import("./helpers/mockPrisma.js");
  const { mockPrisma } = createMockPrismaModule();
  // Store on globalThis so we can access it later
  (globalThis as Record<string, unknown>).__webhookTestMockPrisma = mockPrisma;
  return { ...original, prisma: mockPrisma.prisma };
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

import Fastify, { FastifyInstance } from "fastify";
import { ZodTypeProvider, serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { registerWebhookDashboardRoutes } from "../../src/webhooks/webhookDashboardRoutes.js";
import { webhookDashboardService } from "../../src/webhooks/webhookDashboardService.js";
import { AuthService } from "../../src/auth/authService.js";
import { MfaService } from "../../src/auth/mfaService.js";
import { PrismaAdminUserRepository } from "../../src/infrastructure/repositories/PrismaAdminUserRepository.js";
import { prisma } from "@infra/prisma";
import { createTestContainer } from "../../src/infrastructure/container/setup.js";
import { TOKENS } from "../../src/infrastructure/container/types.js";
import { RbacService } from "../../src/auth/rbacService.js";
import { ok, err } from "@shared/types";
import jwt from "jsonwebtoken";

// Generate a valid JWT token structure for the mocked middleware to decode
const testToken = jwt.sign(
  { sub: "test-user-123", email: "test@example.com", role: "ADMIN", accountId: "test-account-123" },
  "test-secret-for-mock",
  { expiresIn: "1h" }
);

// Create a local authService instance for mocking (no global singleton)
const adminUserRepo = new PrismaAdminUserRepository(prisma);
const mfaSvc = new MfaService(adminUserRepo);
const authService = new AuthService(adminUserRepo, mfaSvc);

// Mock user for authentication
const mockUser = {
  id: "test-user-123",
  email: "test@example.com",
  role: "ADMIN" as const,
};

// Mock dashboard metrics response
const mockMetrics = {
  totalEvents: 100,
  processedEvents: 90,
  failedEvents: 10,
  successRate: 90,
  avgProcessingTime: 150,
  queueDepth: 5,
  realtimeConnections: 3,
  byProvider: {
    X: {
      total: 50,
      success: 45,
      failed: 5,
      successRate: 90,
      avgProcessingTime: 120,
    },
    INSTAGRAM: {
      total: 50,
      success: 45,
      failed: 5,
      successRate: 90,
      avgProcessingTime: 180,
    },
  },
  byEventType: {
    "post.published": 60,
    "post.deleted": 20,
    "profile.updated": 20,
  },
  timeline: [
    {
      timestamp: "2025-01-01T00:00:00Z",
      total: 10,
      success: 9,
      failed: 1,
    },
    {
      timestamp: "2025-01-01T01:00:00Z",
      total: 15,
      success: 14,
      failed: 1,
    },
  ],
};

// Mock recent events response
const mockEvents = {
  events: [
    {
      id: "event-1",
      provider: "X",
      eventType: "post.published",
      status: "COMPLETED",
      receivedAt: "2025-01-01T12:00:00Z",
      processedAt: "2025-01-01T12:00:01Z",
      processingTimeMs: 1000,
    },
    {
      id: "event-2",
      provider: "INSTAGRAM",
      eventType: "post.deleted",
      status: "FAILED",
      receivedAt: "2025-01-01T11:00:00Z",
      errorMessage: "Invalid webhook signature",
    },
  ],
  total: 2,
  page: 1,
  limit: 20,
  totalPages: 1,
};

// Mock event details response
const mockEventDetails = {
  id: "event-123",
  provider: "X",
  eventType: "post.published",
  status: "COMPLETED",
  receivedAt: "2025-01-01T12:00:00Z",
  processedAt: "2025-01-01T12:00:01Z",
  processingTimeMs: 1000,
  payload: { postId: "post-123", action: "published" },
  headers: { "x-webhook-signature": "sig123" },
  retryCount: 0,
};

// Mock subscriptions response
const mockSubscriptions = [
  {
    id: "sub-1",
    provider: "X",
    projectId: "project-123",
    active: true,
    eventTypes: ["post.published", "post.deleted"],
    stats: {
      totalEvents: 50,
      successfulEvents: 45,
      failedEvents: 5,
      lastEvent: "2025-01-01T12:00:00Z",
    },
  },
];

// Mock retry result
const mockRetryResult = {
  success: true,
  eventId: "event-123",
  retriedAt: "2025-01-01T13:00:00Z",
};

// Mock export result
const mockExportResult = {
  timeRange: "24h",
  csv: "id,provider,eventType,status,receivedAt\nevent-1,X,post.published,COMPLETED,2025-01-01T12:00:00Z",
};

// Mock broadcaster for SSE stream testing
const mockBroadcaster = {
  subscribeSSE(_accountId: string, _callback: (event: unknown) => void): () => void {
    return () => {};
  },
  broadcastWebhookEvent: async () => {},
  getConnectionStats: () => ({
    totalConnections: 0,
    connectionsByAccount: {},
    connectionsByProject: {},
    sseSubscriptions: 0,
  }),
  shutdown: () => {},
};

// Create test Fastify instance with a DI container so authMiddleware can resolve AuthService
async function createTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  const typedApp = app.withTypeProvider<ZodTypeProvider>();
  typedApp.setValidatorCompiler(validatorCompiler);
  typedApp.setSerializerCompiler(serializerCompiler);

  // Register authService, webhookDashboardService, and broadcaster in a minimal container
  const container = createTestContainer();
  container.registerInstance(TOKENS.AuthService, authService);
  container.registerInstance(TOKENS.WebhookDashboardService, webhookDashboardService);
  container.registerInstance(TOKENS.RealtimeWebhookBroadcaster, mockBroadcaster);
  container.registerInstance(TOKENS.RbacService, new RbacService(adminUserRepo));
  typedApp.decorate("container", container);

  await typedApp.register(registerWebhookDashboardRoutes);

  return typedApp;
}

let app: FastifyInstance;

describe("webhookDashboardRoutes", () => {
  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(() => {
    // Mock authentication service
    vi.spyOn(authService, "verifyAccessToken").mockImplementation(async (token: string) => {
      if (token && token !== "invalid-token") {
        return ok(mockUser);
      }
      return err("INVALID_TOKEN");
    });

    // Mock service methods
    vi.spyOn(webhookDashboardService, "getDashboardMetrics").mockImplementation(
      async () => mockMetrics
    );
    vi.spyOn(webhookDashboardService, "getRecentEvents").mockImplementation(async () => mockEvents);
    vi.spyOn(webhookDashboardService, "getEventDetails").mockImplementation(
      async () => mockEventDetails
    );
    vi.spyOn(webhookDashboardService, "getSubscriptions").mockImplementation(
      async () => mockSubscriptions
    );
    vi.spyOn(webhookDashboardService, "getDeadLetterQueue").mockImplementation(
      async () => mockEvents
    );
    vi.spyOn(webhookDashboardService, "retryDeadLetterEvent").mockImplementation(
      async () => mockRetryResult
    );
    vi.spyOn(webhookDashboardService, "exportWebhookEvents").mockImplementation(
      async () => mockExportResult
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /api/webhooks/dashboard/metrics", () => {
    it("should return metrics with valid authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/metrics",
        headers: { authorization: `Bearer ${testToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data.totalEvents).toBe(100);
      expect(body.data.processedEvents).toBe(90);
      expect(body.data.failedEvents).toBe(10);
      expect(body.data.successRate).toBe(90);
      expect(body.data.byProvider).toBeTruthy();
      expect(body.data.timeline).toBeTruthy();
    });

    it("should accept valid timeRange query parameter", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/metrics?timeRange=7d",
        headers: { authorization: `Bearer ${testToken}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should accept valid provider filter", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/metrics?provider=X",
        headers: { authorization: `Bearer ${testToken}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should accept valid projectId filter", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/metrics?projectId=123e4567-e89b-12d3-a456-426614174000",
        headers: { authorization: `Bearer ${testToken}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should accept valid status filter", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/metrics?status=COMPLETED",
        headers: { authorization: `Bearer ${testToken}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should reject invalid timeRange", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/metrics?timeRange=invalid",
        headers: { authorization: `Bearer ${testToken}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject invalid provider", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/metrics?provider=INVALID",
        headers: { authorization: `Bearer ${testToken}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject invalid projectId format", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/metrics?projectId=not-a-uuid",
        headers: { authorization: `Bearer ${testToken}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject invalid status", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/metrics?status=INVALID",
        headers: { authorization: `Bearer ${testToken}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/metrics",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /api/webhooks/dashboard/events", () => {
    it("should return paginated events", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/events",
        headers: { authorization: `Bearer ${testToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data.events)).toBeTruthy();
      expect(body.data.events.length).toBe(2);
      expect(body.data.total).toBe(2);
      expect(body.data.page).toBe(1);
      expect(body.data.limit).toBe(20);
    });

    it("should accept page parameter", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/events?page=2",
        headers: { authorization: `Bearer ${testToken}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should accept limit parameter", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/events?limit=50",
        headers: { authorization: `Bearer ${testToken}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should accept provider filter", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/events?provider=INSTAGRAM",
        headers: { authorization: `Bearer ${testToken}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should accept status filter", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/events?status=FAILED",
        headers: { authorization: `Bearer ${testToken}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should accept search parameter", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/events?search=post",
        headers: { authorization: `Bearer ${testToken}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should reject page less than 1", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/events?page=0",
        headers: { authorization: `Bearer ${testToken}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject limit greater than 100", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/events?limit=101",
        headers: { authorization: `Bearer ${testToken}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject invalid provider in events", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/events?provider=INVALID",
        headers: { authorization: `Bearer ${testToken}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/events",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /api/webhooks/dashboard/events/:eventId", () => {
    it("should return event details with valid UUID", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/events/123e4567-e89b-12d3-a456-426614174000",
        headers: { authorization: `Bearer ${testToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data.id).toBe("event-123");
      expect(body.data.provider).toBe("X");
      expect(body.data.status).toBe("COMPLETED");
      expect(body.data.payload).toBeTruthy();
      expect(body.data.headers).toBeTruthy();
    });

    it("should reject invalid UUID format", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/events/not-a-uuid",
        headers: { authorization: `Bearer ${testToken}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/events/123e4567-e89b-12d3-a456-426614174000",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /api/webhooks/dashboard/subscriptions", () => {
    it("should return subscriptions list", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/subscriptions",
        headers: { authorization: `Bearer ${testToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data)).toBeTruthy();
      expect(body.data.length).toBe(1);
      expect(body.data[0].provider).toBe("X");
      expect(body.data[0].stats).toBeTruthy();
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/subscriptions",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /api/webhooks/dashboard/dead-letter", () => {
    it("should return dead letter queue events", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/dead-letter",
        headers: { authorization: `Bearer ${testToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.data.events)).toBeTruthy();
      expect(body.data.page).toBe(1);
    });

    it("should accept pagination for dead letter queue", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/dead-letter?page=2&limit=10",
        headers: { authorization: `Bearer ${testToken}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should accept provider filter for DLQ", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/dead-letter?provider=X",
        headers: { authorization: `Bearer ${testToken}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should reject invalid pagination parameters", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/dead-letter?page=-1",
        headers: { authorization: `Bearer ${testToken}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/dead-letter",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("POST /api/webhooks/dashboard/dead-letter/:eventId/retry", () => {
    it("should retry dead letter event successfully", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/webhooks/dashboard/dead-letter/123e4567-e89b-12d3-a456-426614174000/retry",
        headers: { authorization: `Bearer ${testToken}` },
      });

      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.data.success).toBe(true);
      expect(body.data.eventId).toBe("event-123");
    });

    it("should reject invalid event ID for retry", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/webhooks/dashboard/dead-letter/not-a-uuid/retry",
        headers: { authorization: `Bearer ${testToken}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject retry without authentication", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/webhooks/dashboard/dead-letter/123e4567-e89b-12d3-a456-426614174000/retry",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /api/webhooks/dashboard/stream", () => {
    // SSE connection test moved to integration — requires real HTTP, not inject()
    // See: docs/development/TESTING_BACKLOG.md

    it("should reject SSE without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/stream",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /api/webhooks/dashboard/export", () => {
    it("should export webhook events as CSV", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/export",
        headers: { authorization: `Bearer ${testToken}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toBe("text/csv");
      expect(response.headers["content-disposition"]?.includes("attachment")).toBeTruthy();
      expect(response.headers["content-disposition"]?.includes("webhook-events")).toBeTruthy();
      expect(response.body.includes("id,provider,eventType")).toBeTruthy();
    });

    it("should accept timeRange for export", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/export?timeRange=7d",
        headers: { authorization: `Bearer ${testToken}` },
      });

      expect(response.statusCode).toBe(200);
      const contentDisposition = response.headers["content-disposition"];
      expect(contentDisposition).toBeTruthy();
      // Mock always returns timeRange: "24h", so check for that
      expect(contentDisposition.includes("24h")).toBeTruthy();
    });

    it("should accept provider filter for export", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/export?provider=INSTAGRAM",
        headers: { authorization: `Bearer ${testToken}` },
      });

      expect(response.statusCode).toBe(200);
    });

    it("should reject invalid query params for export", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/export?timeRange=invalid",
        headers: { authorization: `Bearer ${testToken}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it("should reject export without authentication", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/webhooks/dashboard/export",
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
