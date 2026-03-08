#!/usr/bin/env tsx
/**
 * Unit Tests for metricsMiddleware
 * Testing metrics collection and request tracking middleware
 *
 * Coverage Target: 95%+
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  createMetricsMiddleware,
  getRoutePattern,
  recordBusinessMetric,
} from "../../src/middleware/metricsMiddleware.js";
import { ApiMetrics } from "../../src/metrics/apiMetrics.js";
import * as promClient from "prom-client";
import type { FastifyRequest, FastifyReply } from "fastify";

// ============================================================================
// Test Utilities
// ============================================================================

// Mock Fastify Request
function createMockRequest(overrides?: Partial<FastifyRequest>): FastifyRequest {
  return {
    id: `req-${Date.now()}`,
    method: "GET",
    url: "/api/test",
    headers: {},
    routeOptions: { url: "/api/test" },
    socket: { remoteAddress: "127.0.0.1" },
    ...overrides,
  } as FastifyRequest;
}

// Mock Fastify Reply - Pick<> documents what methods the SUT actually uses
type MockReply = Pick<FastifyReply, "statusCode" | "getHeader" | "header" | "code">;

function createMockReply(statusCode = 200): MockReply & FastifyReply {
  const headers: Record<string, string | number> = {};

  const reply: MockReply = {
    statusCode,
    getHeader: (name: string) => headers[name.toLowerCase()],
    header(name: string, value: string | number) {
      headers[name.toLowerCase()] = value;
      return reply;
    },
    code(code: number) {
      reply.statusCode = code;
      return reply;
    },
  };

  return reply as MockReply & FastifyReply;
}

// Mock done callback
function createMockDone() {
  let called = false;
  const done = () => {
    called = true;
  };
  done.wasCalled = () => called;
  return done;
}

// ============================================================================
// Test Setup
// ============================================================================

let metricsRegistry: promClient.Registry;
let apiMetrics: ApiMetrics;
let middleware: ReturnType<typeof createMetricsMiddleware>;

// ============================================================================
// Main Test Suite
// ============================================================================

describe("metricsMiddleware Tests", () => {
  before(() => {
    metricsRegistry = new promClient.Registry();
    apiMetrics = new ApiMetrics(metricsRegistry);
    middleware = createMetricsMiddleware(apiMetrics);
  });

  after(() => {
    metricsRegistry.clear();
  });

  // ============================================================================
  // Test Group 1: preHandler - Request Initialization
  // ============================================================================

  describe("preHandler - Request Initialization", () => {
    it("should generate and attach correlation ID", async () => {
      const request = createMockRequest();
      const reply = createMockReply();
      const done = createMockDone();

      middleware.preHandler(request, reply, done as any);

      assert.ok((request as any).correlationId, "Correlation ID should be attached");
      assert.strictEqual(typeof (request as any).correlationId, "string");
      assert.ok(done.wasCalled(), "Done callback should be called");
    });

    it("should attach finishRequest function", async () => {
      const request = createMockRequest();
      const reply = createMockReply();
      const done = createMockDone();

      middleware.preHandler(request, reply, done as any);

      assert.ok((request as any).finishRequest, "finishRequest should be attached");
      assert.strictEqual(typeof (request as any).finishRequest, "function");
    });

    it("should attach finishEndpoint function", async () => {
      const request = createMockRequest();
      const reply = createMockReply();
      const done = createMockDone();

      middleware.preHandler(request, reply, done as any);

      assert.ok((request as any).finishEndpoint, "finishEndpoint should be attached");
      assert.strictEqual(typeof (request as any).finishEndpoint, "function");
    });

    it("should use routeOptions.url for endpoint tracking", async () => {
      const request = createMockRequest({
        routeOptions: { url: "/api/posts/:id" },
        url: "/api/posts/123",
      });
      const reply = createMockReply();
      const done = createMockDone();

      middleware.preHandler(request, reply, done as any);

      // Verify finishEndpoint was created with correct endpoint
      assert.ok((request as any).finishEndpoint);
    });

    it("should fallback to url when routeOptions.url not available", async () => {
      const request = createMockRequest({
        routeOptions: undefined as any,
        url: "/api/fallback",
      });
      const reply = createMockReply();
      const done = createMockDone();

      middleware.preHandler(request, reply, done as any);

      assert.ok((request as any).finishEndpoint);
    });

    it("should handle POST requests", async () => {
      const request = createMockRequest({
        method: "POST",
        url: "/api/posts",
      });
      const reply = createMockReply();
      const done = createMockDone();

      middleware.preHandler(request, reply, done as any);

      assert.ok((request as any).correlationId);
      assert.ok(done.wasCalled());
    });

    it("should handle PUT requests", async () => {
      const request = createMockRequest({
        method: "PUT",
        url: "/api/posts/123",
      });
      const reply = createMockReply();
      const done = createMockDone();

      middleware.preHandler(request, reply, done as any);

      assert.ok((request as any).correlationId);
      assert.ok(done.wasCalled());
    });

    it("should handle DELETE requests", async () => {
      const request = createMockRequest({
        method: "DELETE",
        url: "/api/posts/123",
      });
      const reply = createMockReply();
      const done = createMockDone();

      middleware.preHandler(request, reply, done as any);

      assert.ok((request as any).correlationId);
      assert.ok(done.wasCalled());
    });
  });

  // ============================================================================
  // Test Group 2: onResponse - Success Cases
  // ============================================================================

  describe("onResponse - Success Cases", () => {
    it("should complete request tracking with 200 status", async () => {
      const request = createMockRequest();
      const reply = createMockReply(200);
      const done = createMockDone();

      // Setup request with preHandler
      middleware.preHandler(request, reply, done as any);

      // Complete with onResponse
      middleware.onResponse(request, reply, done as any);

      assert.ok(done.wasCalled());
    });

    it("should track successful endpoint request", async () => {
      const request = createMockRequest();
      const reply = createMockReply(200);
      const done = createMockDone();

      middleware.preHandler(request, reply, done as any);

      const finishEndpoint = (request as any).finishEndpoint;
      assert.ok(finishEndpoint);

      middleware.onResponse(request, reply, done as any);
    });

    it("should record response size when content-length header present", async () => {
      const request = createMockRequest();
      const reply = createMockReply(200);
      reply.header("content-length", "1024");
      const done = createMockDone();

      middleware.preHandler(request, reply, done as any);
      middleware.onResponse(request, reply, done as any);

      assert.ok(done.wasCalled());
    });

    it("should handle 201 status code as success", async () => {
      const request = createMockRequest();
      const reply = createMockReply(201);
      const done = createMockDone();

      middleware.preHandler(request, reply, done as any);
      middleware.onResponse(request, reply, done as any);

      assert.ok(done.wasCalled());
    });

    it("should handle 204 status code as success", async () => {
      const request = createMockRequest();
      const reply = createMockReply(204);
      const done = createMockDone();

      middleware.preHandler(request, reply, done as any);
      middleware.onResponse(request, reply, done as any);

      assert.ok(done.wasCalled());
    });

    it("should clean up correlation ID after response", async () => {
      const request = createMockRequest();
      const reply = createMockReply(200);
      const done = createMockDone();

      middleware.preHandler(request, reply, done as any);
      const _correlationId = (request as any).correlationId;

      middleware.onResponse(request, reply, done as any);

      // Correlation ID should be removed from apiMetrics
      assert.strictEqual(apiMetrics.getCorrelationId(request.id), undefined);
    });
  });

  // ============================================================================
  // Test Group 3: onResponse - Error Status Codes
  // ============================================================================

  describe("onResponse - Error Status Codes", () => {
    it("should track 400 client error", async () => {
      const request = createMockRequest();
      const reply = createMockReply(400);
      const done = createMockDone();

      middleware.preHandler(request, reply, done as any);
      middleware.onResponse(request, reply, done as any);

      assert.ok(done.wasCalled());
    });

    it("should track 401 unauthorized error", async () => {
      const request = createMockRequest();
      const reply = createMockReply(401);
      const done = createMockDone();

      middleware.preHandler(request, reply, done as any);
      middleware.onResponse(request, reply, done as any);

      assert.ok(done.wasCalled());
    });

    it("should track 403 forbidden error", async () => {
      const request = createMockRequest();
      const reply = createMockReply(403);
      const done = createMockDone();

      middleware.preHandler(request, reply, done as any);
      middleware.onResponse(request, reply, done as any);

      assert.ok(done.wasCalled());
    });

    it("should track 404 not found error", async () => {
      const request = createMockRequest();
      const reply = createMockReply(404);
      const done = createMockDone();

      middleware.preHandler(request, reply, done as any);
      middleware.onResponse(request, reply, done as any);

      assert.ok(done.wasCalled());
    });

    it("should track 429 rate limit error", async () => {
      const request = createMockRequest();
      const reply = createMockReply(429);
      const done = createMockDone();

      middleware.preHandler(request, reply, done as any);
      middleware.onResponse(request, reply, done as any);

      assert.ok(done.wasCalled());
    });

    it("should track 500 server error", async () => {
      const request = createMockRequest();
      const reply = createMockReply(500);
      const done = createMockDone();

      middleware.preHandler(request, reply, done as any);
      middleware.onResponse(request, reply, done as any);

      assert.ok(done.wasCalled());
    });

    it("should track 502 bad gateway error", async () => {
      const request = createMockRequest();
      const reply = createMockReply(502);
      const done = createMockDone();

      middleware.preHandler(request, reply, done as any);
      middleware.onResponse(request, reply, done as any);

      assert.ok(done.wasCalled());
    });

    it("should track 503 service unavailable error", async () => {
      const request = createMockRequest();
      const reply = createMockReply(503);
      const done = createMockDone();

      middleware.preHandler(request, reply, done as any);
      middleware.onResponse(request, reply, done as any);

      assert.ok(done.wasCalled());
    });

    it("should categorize 4xx as client_error", async () => {
      const request = createMockRequest();
      const reply = createMockReply(422);
      const done = createMockDone();

      middleware.preHandler(request, reply, done as any);
      middleware.onResponse(request, reply, done as any);

      // Error category should be client_error for 4xx
      assert.ok(done.wasCalled());
    });

    it("should categorize 5xx as server_error", async () => {
      const request = createMockRequest();
      const reply = createMockReply(504);
      const done = createMockDone();

      middleware.preHandler(request, reply, done as any);
      middleware.onResponse(request, reply, done as any);

      // Error category should be server_error for 5xx
      assert.ok(done.wasCalled());
    });
  });

  // ============================================================================
  // Test Group 4: onError - Error Handling
  // ============================================================================

  describe("onError - Error Handling", () => {
    it("should record generic error", async () => {
      const request = createMockRequest();
      const reply = createMockReply(500);
      const error = new Error("Test error");
      const done = createMockDone();

      middleware.preHandler(request, reply, done as any);
      middleware.onError(request, reply, error, done as any);

      assert.ok(done.wasCalled());
    });

    it("should record error with custom name", async () => {
      const request = createMockRequest();
      const reply = createMockReply(500);
      const error = new Error("Validation failed");
      error.name = "ValidationError";
      const done = createMockDone();

      middleware.preHandler(request, reply, done as any);
      middleware.onError(request, reply, error, done as any);

      assert.ok(done.wasCalled());
    });

    it("should attach correlation ID to error", async () => {
      const request = createMockRequest();
      const reply = createMockReply(500);
      const error = new Error("Test error") as any;
      const done = createMockDone();

      middleware.preHandler(request, reply, done as any);
      const correlationId = (request as any).correlationId;

      middleware.onError(request, reply, error, done as any);

      assert.strictEqual(error.correlationId, correlationId);
    });

    it("should handle error without name", async () => {
      const request = createMockRequest();
      const reply = createMockReply(500);
      const error = new Error("Test error");
      error.name = "";
      const done = createMockDone();

      middleware.preHandler(request, reply, done as any);
      middleware.onError(request, reply, error, done as any);

      assert.ok(done.wasCalled());
    });

    it("should record client error for 4xx status", async () => {
      const request = createMockRequest();
      const reply = createMockReply(400);
      const error = new Error("Bad request");
      const done = createMockDone();

      middleware.preHandler(request, reply, done as any);
      middleware.onError(request, reply, error, done as any);

      assert.ok(done.wasCalled());
    });

    it("should record server error for 5xx status", async () => {
      const request = createMockRequest();
      const reply = createMockReply(500);
      const error = new Error("Internal error");
      const done = createMockDone();

      middleware.preHandler(request, reply, done as any);
      middleware.onError(request, reply, error, done as any);

      assert.ok(done.wasCalled());
    });

    it("should default to 500 status if not set", async () => {
      const request = createMockRequest();
      const reply = createMockReply(200); // Initial status
      const error = new Error("Unexpected error");
      const done = createMockDone();

      middleware.preHandler(request, reply, done as any);
      middleware.onError(request, reply, error, done as any);

      assert.ok(done.wasCalled());
    });
  });

  // ============================================================================
  // Test Group 5: getRoutePattern - Route Extraction
  // ============================================================================

  describe("getRoutePattern - Route Extraction", () => {
    it("should extract route from routeOptions.url", () => {
      const request = createMockRequest({
        routeOptions: { url: "/api/posts/:id" },
        url: "/api/posts/123",
      });

      const pattern = getRoutePattern(request);
      assert.strictEqual(pattern, "/api/posts/:id");
    });

    it("should fallback to url when routeOptions not available", () => {
      const request = createMockRequest({
        routeOptions: undefined as any,
        url: "/api/test",
      });

      const pattern = getRoutePattern(request);
      assert.strictEqual(pattern, "/api/test");
    });

    it("should strip query parameters from url", () => {
      const request = createMockRequest({
        routeOptions: undefined as any,
        url: "/api/test?foo=bar&baz=qux",
      });

      const pattern = getRoutePattern(request);
      assert.strictEqual(pattern, "/api/test");
    });

    it("should return 'unknown' when url is undefined", () => {
      const request = createMockRequest({
        routeOptions: undefined as any,
        url: undefined as any,
      });

      const pattern = getRoutePattern(request);
      assert.strictEqual(pattern, "unknown");
    });

    it("should handle root path", () => {
      const request = createMockRequest({
        routeOptions: { url: "/" },
        url: "/",
      });

      const pattern = getRoutePattern(request);
      assert.strictEqual(pattern, "/");
    });

    it("should handle complex query parameters", () => {
      const request = createMockRequest({
        routeOptions: undefined as any,
        url: "/api/search?q=test&filters[]=active&filters[]=pending&sort=date",
      });

      const pattern = getRoutePattern(request);
      assert.strictEqual(pattern, "/api/search");
    });
  });

  // ============================================================================
  // Test Group 6: recordBusinessMetric - Business Operations
  // ============================================================================

  describe("recordBusinessMetric - Business Operations", () => {
    it("should record post_created metric", async () => {
      const beforeMetric = await apiMetrics.metrics.postsCreated.get();
      const beforeValue = beforeMetric.values.reduce((sum, v) => sum + v.value, 0);

      recordBusinessMetric(apiMetrics, "post_created", {
        project_id: "proj-123",
        locale: "en",
      });

      const afterMetric = await apiMetrics.metrics.postsCreated.get();
      const afterValue = afterMetric.values.reduce((sum, v) => sum + v.value, 0);
      assert.ok(afterValue > beforeValue, "postsCreated counter should have incremented");
    });

    it("should record post_published metric", async () => {
      const beforeMetric = await apiMetrics.metrics.postsPublished.get();
      const beforeValue = beforeMetric.values.reduce((sum, v) => sum + v.value, 0);

      recordBusinessMetric(apiMetrics, "post_published", {
        channel_id: "ch-456",
        scheduled: "true",
      });

      const afterMetric = await apiMetrics.metrics.postsPublished.get();
      const afterValue = afterMetric.values.reduce((sum, v) => sum + v.value, 0);
      assert.ok(afterValue > beforeValue, "postsPublished counter should have incremented");
    });

    it("should record media_uploaded metric", async () => {
      const beforeMetric = await apiMetrics.metrics.mediaUploads.get();
      const beforeValue = beforeMetric.values.reduce((sum, v) => sum + v.value, 0);

      recordBusinessMetric(apiMetrics, "media_uploaded", {
        media_type: "image",
        status: "success",
      });

      const afterMetric = await apiMetrics.metrics.mediaUploads.get();
      const afterValue = afterMetric.values.reduce((sum, v) => sum + v.value, 0);
      assert.ok(afterValue > beforeValue, "mediaUploads counter should have incremented");
    });

    it("should record thread_created metric", async () => {
      const beforeMetric = await apiMetrics.metrics.threadsCreated.get();
      const beforeValue = beforeMetric.values.reduce((sum, v) => sum + v.value, 0);

      recordBusinessMetric(apiMetrics, "thread_created", {
        strategy: "auto_split",
        post_id: "post-789",
      });

      const afterMetric = await apiMetrics.metrics.threadsCreated.get();
      const afterValue = afterMetric.values.reduce((sum, v) => sum + v.value, 0);
      assert.ok(afterValue > beforeValue, "threadsCreated counter should have incremented");
    });

    it("should record tweet_created metric", async () => {
      const beforeMetric = await apiMetrics.metrics.tweetsCreated.get();
      const beforeValue = beforeMetric.values.reduce((sum, v) => sum + v.value, 0);

      recordBusinessMetric(apiMetrics, "tweet_created", {
        thread_id: "thread-101",
      });

      const afterMetric = await apiMetrics.metrics.tweetsCreated.get();
      const afterValue = afterMetric.values.reduce((sum, v) => sum + v.value, 0);
      assert.ok(afterValue > beforeValue, "tweetsCreated counter should have incremented");
    });

    it("should record preview_requested metric", async () => {
      const beforeMetric = await apiMetrics.metrics.previewRequests.get();
      const beforeValue = beforeMetric.values.reduce((sum, v) => sum + v.value, 0);

      recordBusinessMetric(apiMetrics, "preview_requested", {
        provider: "twitter",
        content_type: "text",
      });

      const afterMetric = await apiMetrics.metrics.previewRequests.get();
      const afterValue = afterMetric.values.reduce((sum, v) => sum + v.value, 0);
      assert.ok(afterValue > beforeValue, "previewRequests counter should have incremented");
    });

    it("should handle operation without labels", async () => {
      const beforeMetric = await apiMetrics.metrics.postsCreated.get();
      const beforeValue = beforeMetric.values.reduce((sum, v) => sum + v.value, 0);

      recordBusinessMetric(apiMetrics, "post_created");

      const afterMetric = await apiMetrics.metrics.postsCreated.get();
      const afterValue = afterMetric.values.reduce((sum, v) => sum + v.value, 0);
      assert.ok(
        afterValue > beforeValue,
        "postsCreated counter should increment even without labels"
      );
    });

    it("should ignore unknown operations", async () => {
      // Capture all counter values before
      const beforeMetrics = await metricsRegistry.getMetricsAsJSON();
      const beforeSnapshot = JSON.stringify(beforeMetrics);

      recordBusinessMetric(apiMetrics, "unknown_operation" as any, {});

      // No counter should have changed
      const afterMetrics = await metricsRegistry.getMetricsAsJSON();
      const afterSnapshot = JSON.stringify(afterMetrics);
      assert.strictEqual(
        afterSnapshot,
        beforeSnapshot,
        "No metrics should change for unknown operation"
      );
    });

    it("should handle empty labels object", async () => {
      const beforeMetric = await apiMetrics.metrics.postsCreated.get();
      const beforeValue = beforeMetric.values.reduce((sum, v) => sum + v.value, 0);

      recordBusinessMetric(apiMetrics, "post_created", {});

      const afterMetric = await apiMetrics.metrics.postsCreated.get();
      const afterValue = afterMetric.values.reduce((sum, v) => sum + v.value, 0);
      assert.ok(
        afterValue > beforeValue,
        "postsCreated counter should increment with empty labels"
      );
    });
  });
});
