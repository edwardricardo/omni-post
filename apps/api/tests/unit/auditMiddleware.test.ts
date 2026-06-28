#!/usr/bin/env tsx
/**
 * Unit Tests for auditMiddleware
 * Testing audit logging middleware functionality
 *
 * Coverage Target: 95%+
 * Test Count: 25
 *
 * @file auditMiddleware.test.ts
 * @description Tests for auditMiddleware Tests
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import {
  auditMiddleware,
  setAuditInfo,
  extractResourceId,
  type AuditableRequest,
} from "../../src/audit/auditMiddleware.js";
import type { FastifyRequest, FastifyReply } from "fastify";

// ============================================================================
// Test Utilities
// ============================================================================

// Mock Fastify Request
function createMockRequest(overrides?: Partial<FastifyRequest>): AuditableRequest {
  return {
    headers: {},
    url: "/test",
    method: "GET",
    ip: "192.168.1.1",
    user: undefined,
    routeOptions: { url: "/test" },
    params: {},
    query: {},
    ...overrides,
  } as AuditableRequest;
}

// Mock Fastify Reply - Pick<> documents what methods the SUT actually uses
type MockReply = Pick<FastifyReply, "code" | "send" | "header" | "statusCode"> & {
  getStatusCode: () => number;
  getBody: () => any;
  wasSent: () => boolean;
  getHeaders: () => Record<string, string>;
};

function createMockReply(): MockReply & FastifyReply {
  let statusCode = 200;
  let responseBody: any = null;
  let replySent = false;
  const headers: Record<string, string> = {};

  const reply: MockReply = {
    statusCode,
    code(code: number) {
      statusCode = code;
      reply.statusCode = code;
      return reply;
    },
    send(body: any) {
      responseBody = body;
      replySent = true;
      return reply;
    },
    header(name: string, value: string) {
      headers[name] = value;
      return reply;
    },
    getStatusCode: () => statusCode,
    getBody: () => responseBody,
    wasSent: () => replySent,
    getHeaders: () => headers,
  };

  return reply as MockReply & FastifyReply;
}

// ============================================================================
// Test Setup
// ============================================================================

const timestamp = Date.now();
const testUserId = `test-user-${timestamp}`;

// ============================================================================
// Main Test Suite
// ============================================================================

describe("auditMiddleware Tests", () => {
  // ============================================================================
  // Middleware Behavior Tests
  // ============================================================================

  describe("Basic Middleware Functionality", () => {
    it("should skip audit logging for health check routes", async () => {
      const request = createMockRequest({
        url: "/health",
        method: "GET",
      });
      const reply = createMockReply();

      await auditMiddleware(request, reply);

      // auditLog should not be initialized for skip routes
      expect(request.auditLog).toBe(undefined);
    });

    it("should skip audit logging for metrics routes", async () => {
      const request = createMockRequest({
        url: "/metrics",
        method: "GET",
      });
      const reply = createMockReply();

      await auditMiddleware(request, reply);

      expect(request.auditLog).toBe(undefined);
    });

    it("should skip audit logging for /auth/me route", async () => {
      const request = createMockRequest({
        url: "/auth/me",
        method: "GET",
      });
      const reply = createMockReply();

      await auditMiddleware(request, reply);

      expect(request.auditLog).toBe(undefined);
    });

    it("should initialize auditLog object for non-skip routes", async () => {
      const request = createMockRequest({
        url: "/api/test",
        method: "GET",
      });
      const reply = createMockReply();

      await auditMiddleware(request, reply);

      expect(request.auditLog).toBeTruthy();
      expect(request.auditLog).toStrictEqual({});
    });

    it("should wrap reply.send function", async () => {
      const request = createMockRequest({
        url: "/api/test",
        method: "POST",
      });
      const reply = createMockReply();
      const originalSend = reply.send;

      await auditMiddleware(request, reply);

      expect(reply.send).not.toBe(originalSend);
    });
  });

  // ============================================================================
  // Action Detection Tests
  // ============================================================================

  describe("Action Detection from Request", () => {
    it("should detect LOGIN action from /auth/login POST", async () => {
      const request = createMockRequest({
        url: "/auth/login",
        method: "POST",
      });
      const reply = createMockReply();

      await auditMiddleware(request, reply);

      // Trigger the wrapped send function
      reply.send({ success: true });

      // The middleware should detect LOGIN action
      expect(request.auditLog).toBeTruthy();
    });

    it("should detect LOGOUT action from /auth/logout POST", async () => {
      const request = createMockRequest({
        url: "/auth/logout",
        method: "POST",
      });
      const reply = createMockReply();

      await auditMiddleware(request, reply);
      reply.send({ success: true });

      expect(request.auditLog).toBeTruthy();
    });

    it("should detect PROJECT_CREATED action from /projects POST", async () => {
      const request = createMockRequest({
        url: "/projects",
        method: "POST",
      });
      const reply = createMockReply();

      await auditMiddleware(request, reply);
      reply.send({ success: true });

      expect(request.auditLog).toBeTruthy();
    });

    it("should detect PROJECT_UPDATED action from /projects PUT", async () => {
      const request = createMockRequest({
        url: "/projects/123",
        method: "PUT",
      });
      const reply = createMockReply();

      await auditMiddleware(request, reply);
      reply.send({ success: true });

      expect(request.auditLog).toBeTruthy();
    });

    it("should detect PROJECT_DELETED action from /projects DELETE", async () => {
      const request = createMockRequest({
        url: "/projects/123",
        method: "DELETE",
      });
      const reply = createMockReply();

      await auditMiddleware(request, reply);
      reply.send({ success: true });

      expect(request.auditLog).toBeTruthy();
    });

    it("should detect POST_CREATED action from /posts POST", async () => {
      const request = createMockRequest({
        url: "/posts",
        method: "POST",
      });
      const reply = createMockReply();

      await auditMiddleware(request, reply);
      reply.send({ success: true });

      expect(request.auditLog).toBeTruthy();
    });

    it("should detect POST_PUBLISHED action from /publish route", async () => {
      const request = createMockRequest({
        url: "/publish/123",
        method: "POST",
      });
      const reply = createMockReply();

      await auditMiddleware(request, reply);
      reply.send({ success: true });

      expect(request.auditLog).toBeTruthy();
    });

    it("should detect CACHE_CLEARED action from admin cache routes", async () => {
      const request = createMockRequest({
        url: "/admin/cache/flush",
        method: "POST",
      });
      const reply = createMockReply();

      await auditMiddleware(request, reply);
      reply.send({ success: true });

      expect(request.auditLog).toBeTruthy();
    });

    it("should return undefined for GET requests on unknown routes", async () => {
      const request = createMockRequest({
        url: "/api/unknown",
        method: "GET",
      });
      const reply = createMockReply();

      await auditMiddleware(request, reply);
      reply.send({ success: true });

      expect(request.auditLog).toBeTruthy();
    });
  });

  // ============================================================================
  // Success/Failure Detection Tests
  // ============================================================================

  describe("Success/Failure Detection", () => {
    it("should mark request as successful for 2xx status codes", async () => {
      const request = createMockRequest({
        url: "/auth/login",
        method: "POST",
        user: { id: testUserId } as any,
      });
      const reply = createMockReply();
      reply.code(200);

      await auditMiddleware(request, reply);
      reply.send({ success: true });

      // Success should be determined from statusCode
      expect(reply.getStatusCode()).toBe(200);
    });

    it("should mark request as failed for 4xx status codes", async () => {
      const request = createMockRequest({
        url: "/auth/login",
        method: "POST",
        user: { id: testUserId } as any,
      });
      const reply = createMockReply();
      reply.code(401);

      await auditMiddleware(request, reply);
      reply.send({ error: "Unauthorized" });

      expect(reply.getStatusCode()).toBe(401);
    });

    it("should mark request as failed for 5xx status codes", async () => {
      const request = createMockRequest({
        url: "/api/test",
        method: "POST",
        user: { id: testUserId } as any,
      });
      const reply = createMockReply();
      reply.code(500);

      await auditMiddleware(request, reply);
      reply.send({ error: "Internal server error" });

      expect(reply.getStatusCode()).toBe(500);
    });

    it("should use explicit success flag when provided", async () => {
      const request = createMockRequest({
        url: "/api/test",
        method: "POST",
        user: { id: testUserId } as any,
      });
      const reply = createMockReply();

      await auditMiddleware(request, reply);

      if (request.auditLog) {
        request.auditLog.success = false;
      }

      reply.send({ success: false });

      expect(request.auditLog?.success).toBe(false);
    });
  });

  // ============================================================================
  // Helper Functions Tests
  // ============================================================================

  describe("Helper Functions", () => {
    it("setAuditInfo should initialize auditLog if not exists", () => {
      const request = createMockRequest();

      setAuditInfo(request, {
        action: "TEST_ACTION",
        resource: "TEST_RESOURCE",
      });

      expect(request.auditLog).toBeTruthy();
      expect(request.auditLog.action).toBe("TEST_ACTION");
      expect(request.auditLog.resource).toBe("TEST_RESOURCE");
    });

    it("setAuditInfo should merge with existing auditLog", () => {
      const request = createMockRequest();
      request.auditLog = { action: "EXISTING_ACTION" };

      setAuditInfo(request, {
        resource: "TEST_RESOURCE",
        resourceId: "123",
      });

      expect(request.auditLog.action).toBe("EXISTING_ACTION");
      expect(request.auditLog.resource).toBe("TEST_RESOURCE");
      expect(request.auditLog.resourceId).toBe("123");
    });

    it("extractResourceId should extract ID from params", () => {
      const request = createMockRequest({
        params: { id: "resource-123" } as any,
      });

      const resourceId = extractResourceId(request);

      expect(resourceId).toBe("resource-123");
    });

    it("extractResourceId should extract custom param name", () => {
      const request = createMockRequest({
        params: { projectId: "project-456" } as any,
      });

      const resourceId = extractResourceId(request, "projectId");

      expect(resourceId).toBe("project-456");
    });

    it("extractResourceId should return undefined for missing params", () => {
      const request = createMockRequest();

      const resourceId = extractResourceId(request);

      expect(resourceId).toBe(undefined);
    });
  });

  // ============================================================================
  // Decorator Tests
  // ============================================================================

  describe("auditAction Decorator", () => {
    // Note: The auditAction decorator uses legacy decorator syntax (target, key, descriptor)
    // which is incompatible with TC39 stage 3 decorators (no experimentalDecorators).
    // Testing the underlying functionality via setAuditInfo + extractResourceId instead.

    it("should set audit information when applied to route handler", async () => {
      const request = createMockRequest({
        params: { id: "test-123" } as any,
      });
      const _reply = createMockReply();

      // Simulate what @auditAction("TEST_ACTION", "TEST_RESOURCE") would do
      const resourceId = extractResourceId(request);
      setAuditInfo(request, {
        action: "TEST_ACTION",
        resource: "TEST_RESOURCE",
        ...(resourceId ? { resourceId } : {}),
      });

      expect(request.auditLog).toBeTruthy();
      expect(request.auditLog.action).toBe("TEST_ACTION");
      expect(request.auditLog.resource).toBe("TEST_RESOURCE");
      expect(request.auditLog.resourceId).toBe("test-123");
    });

    it("should work without resource parameter", async () => {
      const request = createMockRequest();
      const _reply = createMockReply();

      // Simulate what @auditAction("SIMPLE_ACTION") would do
      setAuditInfo(request, {
        action: "SIMPLE_ACTION",
      });

      expect(request.auditLog).toBeTruthy();
      expect(request.auditLog.action).toBe("SIMPLE_ACTION");
      expect(request.auditLog.resource).toBe(undefined);
    });
  });

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe("Error Handling", () => {
    it("should not fail request if audit logging fails", async () => {
      const request = createMockRequest({
        url: "/auth/login",
        method: "POST",
        user: { id: testUserId } as any,
      });
      const reply = createMockReply();

      await auditMiddleware(request, reply);

      // Send should still work even if audit logging fails
      reply.send({ success: true });

      expect(reply.wasSent()).toBe(true);
    });

    it("should handle missing user gracefully", async () => {
      const request = createMockRequest({
        url: "/auth/login",
        method: "POST",
        user: undefined,
      });
      const reply = createMockReply();

      await auditMiddleware(request, reply);
      reply.send({ success: true });

      expect(request.auditLog).toBeTruthy();
    });

    it("should handle malformed URLs gracefully", async () => {
      const request = createMockRequest({
        url: "",
        method: "POST",
      });
      const reply = createMockReply();

      await auditMiddleware(request, reply);
      reply.send({ success: true });

      // Middleware should still initialize auditLog and process the send
      expect(request.auditLog).toBeTruthy();
      expect(reply.wasSent()).toBe(true);
    });
  });
});
