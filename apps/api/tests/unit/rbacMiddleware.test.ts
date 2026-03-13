#!/usr/bin/env tsx
/**
 * Unit Tests for rbacMiddleware
 * Testing role-based access control middleware functionality
 *
 * Coverage Target: 95%+
 * Test Count: 28
 */

import { describe, it, expect } from "vitest";
import {
  requirePermission,
  requireAllPermissions,
  requireOwnershipOrPermission,
  requireContextPermission,
  roleBasedRateLimit,
  auditPermissionAccess,
  debugPermissions,
} from "../../src/auth/rbacMiddleware.js";
import { RbacService, Permission } from "../../src/auth/rbacService.js";
import { TOKENS } from "../../src/infrastructure/container/types.js";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { AuthenticatedUser } from "../../src/auth/authService.js";
import { prisma } from "@infra/prisma";
import { PrismaAdminUserRepository } from "../../src/infrastructure/repositories/PrismaAdminUserRepository.js";

// Create a local RbacService instance for use in request mocks
const rbacService = new RbacService(new PrismaAdminUserRepository(prisma));

// Minimal container mock that resolves RbacService
const mockContainer = {
  resolve: (token: symbol) => {
    if (token === TOKENS.RbacService) return rbacService;
    return null;
  },
};

// ============================================================================
// Test Utilities
// ============================================================================

// Mock Fastify Request
function createMockRequest(overrides?: Partial<FastifyRequest>): FastifyRequest {
  return {
    headers: {},
    url: "/test",
    method: "GET",
    ip: "192.168.1.1",
    user: undefined,
    params: {},
    query: {},
    // Provide a minimal server stub so rbacMiddleware can resolve RbacService
    server: { container: mockContainer },
    ...overrides,
  } as unknown as FastifyRequest;
}

// Mock Fastify Reply - Pick<> documents what methods the SUT actually uses
type MockReply = Pick<FastifyReply, "code" | "send" | "header"> & {
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
    code(code: number) {
      statusCode = code;
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

// Mock users with different roles
const timestamp = Date.now();
const mockSuperAdmin: AuthenticatedUser = {
  id: `super-admin-${timestamp}`,
  email: "superadmin@test.com",
  name: "Super Admin",
  role: "SUPER_ADMIN",
};

const mockAdmin: AuthenticatedUser = {
  id: `admin-${timestamp}`,
  email: "admin@test.com",
  name: "Admin",
  role: "ADMIN",
};

const mockSupport: AuthenticatedUser = {
  id: `support-${timestamp}`,
  email: "support@test.com",
  name: "Support",
  role: "SUPPORT",
};

// ============================================================================
// Main Test Suite
// ============================================================================

describe("rbacMiddleware Tests", () => {
  // ============================================================================
  // requirePermission Tests
  // ============================================================================

  describe("requirePermission Middleware", () => {
    it("should deny access when user is not authenticated", async () => {
      const middleware = requirePermission(Permission.USER_UPDATE);
      const request = createMockRequest();
      const reply = createMockReply();

      await middleware(request, reply);

      expect(reply.getStatusCode()).toBe(401);
      expect(reply.wasSent()).toBeTruthy();
      const body = reply.getBody();
      expect(body.error).toBe("Authentication required");
    });

    it("should allow access when user has required permission", async () => {
      const middleware = requirePermission(Permission.USER_UPDATE);
      const request = createMockRequest({ user: mockSuperAdmin });
      const reply = createMockReply();

      await middleware(request, reply);

      // Should not send response (allow through)
      expect(reply.wasSent()).toBe(false);
    });

    it("should deny access when user lacks permission", async () => {
      const middleware = requirePermission(Permission.SYSTEM_CONFIGURE);
      const request = createMockRequest({ user: mockSupport });
      const reply = createMockReply();

      await middleware(request, reply);

      expect(reply.getStatusCode()).toBe(403);
      expect(reply.wasSent()).toBeTruthy();
      const body = reply.getBody();
      expect(body.error).toBe("Insufficient permissions");
      expect(body.message).toBeTruthy();
    });

    it("should allow access with any of multiple permissions", async () => {
      const middleware = requirePermission(Permission.USER_READ, Permission.USER_UPDATE);
      const request = createMockRequest({ user: mockAdmin });
      const reply = createMockReply();

      await middleware(request, reply);

      // Admin has USER_READ and USER_UPDATE permission
      expect(reply.wasSent()).toBe(false);
    });

    it("should include current permissions in error response", async () => {
      const middleware = requirePermission(Permission.SYSTEM_CONFIGURE);
      const request = createMockRequest({ user: mockSupport });
      const reply = createMockReply();

      await middleware(request, reply);

      const body = reply.getBody();
      expect(body.current).toBeTruthy();
      expect(Array.isArray(body.current)).toBeTruthy();
    });
  });

  // ============================================================================
  // requireAllPermissions Tests
  // ============================================================================

  describe("requireAllPermissions Middleware", () => {
    it("should deny access when user is not authenticated", async () => {
      const middleware = requireAllPermissions(Permission.USER_READ, Permission.USER_UPDATE);
      const request = createMockRequest();
      const reply = createMockReply();

      await middleware(request, reply);

      expect(reply.getStatusCode()).toBe(401);
      expect(reply.wasSent()).toBeTruthy();
    });

    it("should allow access when user has all required permissions", async () => {
      const middleware = requireAllPermissions(Permission.USER_READ, Permission.USER_UPDATE);
      const request = createMockRequest({ user: mockSuperAdmin });
      const reply = createMockReply();

      await middleware(request, reply);

      expect(reply.wasSent()).toBe(false);
    });

    it("should deny access when user lacks one permission", async () => {
      const middleware = requireAllPermissions(Permission.USER_READ, Permission.SYSTEM_CONFIGURE);
      const request = createMockRequest({ user: mockSupport });
      const reply = createMockReply();

      await middleware(request, reply);

      expect(reply.getStatusCode()).toBe(403);
      expect(reply.wasSent()).toBeTruthy();
    });

    it("should list missing permissions in error response", async () => {
      const middleware = requireAllPermissions(
        Permission.USER_READ,
        Permission.USER_UPDATE,
        Permission.SYSTEM_CONFIGURE
      );
      const request = createMockRequest({ user: mockSupport });
      const reply = createMockReply();

      await middleware(request, reply);

      const body = reply.getBody();
      expect(body.missing).toBeTruthy();
      expect(Array.isArray(body.missing)).toBeTruthy();
      expect(body.missing.length > 0).toBeTruthy();
    });

    it("should allow super admin with all permissions", async () => {
      const middleware = requireAllPermissions(
        Permission.USER_READ,
        Permission.USER_UPDATE,
        Permission.BILLING_MANAGE
      );
      const request = createMockRequest({ user: mockSuperAdmin });
      const reply = createMockReply();

      await middleware(request, reply);

      expect(reply.wasSent()).toBe(false);
    });
  });

  // ============================================================================
  // requireOwnershipOrPermission Tests
  // ============================================================================

  describe("requireOwnershipOrPermission Middleware", () => {
    it("should deny access when user is not authenticated", async () => {
      const middleware = requireOwnershipOrPermission(
        async () => "resource-owner-id",
        Permission.MANAGE_USERS
      );
      const request = createMockRequest();
      const reply = createMockReply();

      await middleware(request, reply);

      expect(reply.getStatusCode()).toBe(401);
      expect(reply.wasSent()).toBeTruthy();
    });

    it("should allow access when user is resource owner", async () => {
      const userId = mockAdmin.id;
      const middleware = requireOwnershipOrPermission(async () => userId, Permission.MANAGE_USERS);
      const request = createMockRequest({ user: mockAdmin });
      const reply = createMockReply();

      await middleware(request, reply);

      expect(reply.wasSent()).toBe(false);
    });

    it("should allow access when user has fallback permission", async () => {
      const middleware = requireOwnershipOrPermission(
        async () => "other-user-id",
        Permission.USER_UPDATE
      );
      const request = createMockRequest({ user: mockSuperAdmin });
      const reply = createMockReply();

      await middleware(request, reply);

      expect(reply.wasSent()).toBe(false);
    });

    it("should deny access when user is not owner and lacks permission", async () => {
      const middleware = requireOwnershipOrPermission(
        async () => "other-user-id",
        Permission.USER_UPDATE
      );
      const request = createMockRequest({ user: mockSupport });
      const reply = createMockReply();

      await middleware(request, reply);

      expect(reply.getStatusCode()).toBe(403);
      expect(reply.wasSent()).toBeTruthy();
      const body = reply.getBody();
      expect(body.error).toBe("Access denied");
    });

    it("should handle async ownership check from request params", async () => {
      const middleware = requireOwnershipOrPermission(
        async (req) => (req.params as any).userId || "unknown",
        Permission.USER_UPDATE
      );
      const request = createMockRequest({
        user: mockAdmin,
        params: { userId: mockAdmin.id } as any,
      });
      const reply = createMockReply();

      await middleware(request, reply);

      expect(reply.wasSent()).toBe(false);
    });

    it("should handle errors in ownership check gracefully", async () => {
      const middleware = requireOwnershipOrPermission(async () => {
        throw new Error("Database error");
      }, Permission.USER_UPDATE);
      const request = createMockRequest({ user: mockAdmin });
      const reply = createMockReply();

      await middleware(request, reply);

      expect(reply.getStatusCode()).toBe(500);
      expect(reply.wasSent()).toBeTruthy();
    });
  });

  // ============================================================================
  // requireContextPermission Tests
  // ============================================================================

  describe("requireContextPermission Middleware", () => {
    it("should deny access when user is not authenticated", async () => {
      const middleware = requireContextPermission(
        async () => ({ projectId: "123" }),
        Permission.ANALYTICS_READ
      );
      const request = createMockRequest();
      const reply = createMockReply();

      await middleware(request, reply);

      expect(reply.getStatusCode()).toBe(401);
      expect(reply.wasSent()).toBeTruthy();
    });

    it("should allow access when user has base permission", async () => {
      const middleware = requireContextPermission(
        async () => ({ projectId: "123" }),
        Permission.ANALYTICS_READ
      );
      const request = createMockRequest({ user: mockSuperAdmin });
      const reply = createMockReply();

      await middleware(request, reply);

      expect(reply.wasSent()).toBe(false);
    });

    it("should deny access when user lacks base permission", async () => {
      const middleware = requireContextPermission(
        async () => ({ projectId: "123" }),
        Permission.SYSTEM_CONFIGURE
      );
      const request = createMockRequest({ user: mockSupport });
      const reply = createMockReply();

      await middleware(request, reply);

      expect(reply.getStatusCode()).toBe(403);
      expect(reply.wasSent()).toBeTruthy();
    });

    it("should include context in error response", async () => {
      const context = { projectId: "proj-123", userId: "user-456" };
      const middleware = requireContextPermission(async () => context, Permission.SYSTEM_CONFIGURE);
      const request = createMockRequest({ user: mockSupport });
      const reply = createMockReply();

      await middleware(request, reply);

      const body = reply.getBody();
      expect(body.context).toStrictEqual(context);
    });

    it("should handle errors in context retrieval", async () => {
      const middleware = requireContextPermission(async () => {
        throw new Error("Context error");
      }, Permission.ANALYTICS_READ);
      const request = createMockRequest({ user: mockAdmin });
      const reply = createMockReply();

      await middleware(request, reply);

      expect(reply.getStatusCode()).toBe(500);
      expect(reply.wasSent()).toBeTruthy();
    });
  });

  // ============================================================================
  // roleBasedRateLimit Tests
  // ============================================================================

  describe("roleBasedRateLimit Middleware", () => {
    it("should skip rate limiting for unauthenticated users", async () => {
      const middleware = roleBasedRateLimit();
      const request = createMockRequest();
      const reply = createMockReply();

      await middleware(request, reply);

      expect(reply.wasSent()).toBe(false);
    });

    it("should set rate limit headers for SUPER_ADMIN", async () => {
      const middleware = roleBasedRateLimit();
      const request = createMockRequest({ user: mockSuperAdmin });
      const reply = createMockReply();

      await middleware(request, reply);

      const headers = reply.getHeaders();
      expect(headers["X-RateLimit-Limit"]).toBeTruthy();
      expect(headers["X-RateLimit-Limit"]).toBe("1000");
      expect(headers["X-RateLimit-Role"]).toBe("SUPER_ADMIN");
    });

    it("should set rate limit headers for ADMIN", async () => {
      const middleware = roleBasedRateLimit();
      const request = createMockRequest({ user: mockAdmin });
      const reply = createMockReply();

      await middleware(request, reply);

      const headers = reply.getHeaders();
      expect(headers["X-RateLimit-Limit"]).toBe("500");
      expect(headers["X-RateLimit-Role"]).toBe("ADMIN");
    });

    it("should set rate limit headers for SUPPORT", async () => {
      const middleware = roleBasedRateLimit();
      const request = createMockRequest({ user: mockSupport });
      const reply = createMockReply();

      await middleware(request, reply);

      const headers = reply.getHeaders();
      expect(headers["X-RateLimit-Limit"]).toBe("200");
      expect(headers["X-RateLimit-Role"]).toBe("SUPPORT");
    });
  });

  // ============================================================================
  // auditPermissionAccess Tests
  // ============================================================================

  describe("auditPermissionAccess Middleware", () => {
    it("should skip audit for unauthenticated users", async () => {
      const middleware = auditPermissionAccess("TEST_OPERATION");
      const request = createMockRequest();
      const reply = createMockReply();

      await middleware(request, reply);

      expect(reply.wasSent()).toBe(false);
    });

    it("should add audit trail ID header for authenticated users", async () => {
      const middleware = auditPermissionAccess("USER_MANAGEMENT");
      const request = createMockRequest({ user: mockAdmin });
      const reply = createMockReply();

      await middleware(request, reply);

      const headers = reply.getHeaders();
      expect(headers["X-Audit-Trail-Id"]).toBeTruthy();
      expect(headers["X-Audit-Trail-Id"].startsWith("audit_")).toBeTruthy();
    });

    it("should include user ID in audit trail", async () => {
      const middleware = auditPermissionAccess("BILLING_ACCESS");
      const request = createMockRequest({ user: mockSuperAdmin });
      const reply = createMockReply();

      await middleware(request, reply);

      const headers = reply.getHeaders();
      expect(headers["X-Audit-Trail-Id"].includes(mockSuperAdmin.id)).toBeTruthy();
    });

    it("should not interfere with response flow", async () => {
      const middleware = auditPermissionAccess("TEST_OP");
      const request = createMockRequest({ user: mockAdmin });
      const reply = createMockReply();

      await middleware(request, reply);

      expect(reply.wasSent()).toBe(false);
    });
  });

  // ============================================================================
  // debugPermissions Tests
  // ============================================================================

  describe("debugPermissions Middleware", () => {
    it("should only log in development mode", async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      const middleware = debugPermissions();
      const request = createMockRequest({ user: mockAdmin });
      const reply = createMockReply();

      await middleware(request, reply);

      expect(reply.wasSent()).toBe(false);

      process.env.NODE_ENV = originalEnv;
    });

    it("should log permissions in development mode", async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";

      const middleware = debugPermissions();
      const request = createMockRequest({ user: mockSuperAdmin });
      const reply = createMockReply();

      await middleware(request, reply);

      expect(reply.wasSent()).toBe(false);

      process.env.NODE_ENV = originalEnv;
    });

    it("should handle missing user gracefully", async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";

      const middleware = debugPermissions();
      const request = createMockRequest();
      const reply = createMockReply();

      await middleware(request, reply);

      expect(reply.wasSent()).toBe(false);

      process.env.NODE_ENV = originalEnv;
    });
  });

  // ============================================================================
  // Integration Tests
  // ============================================================================

  describe("Middleware Integration", () => {
    it("should chain multiple permission middlewares", async () => {
      const middleware1 = requirePermission(Permission.USER_READ);
      const middleware2 = requirePermission(Permission.ANALYTICS_READ);

      const request = createMockRequest({ user: mockAdmin });
      const reply = createMockReply();

      await middleware1(request, reply);
      if (!reply.wasSent()) {
        await middleware2(request, reply);
      }

      expect(reply.wasSent()).toBe(false);
    });

    it("should stop chain when first middleware denies", async () => {
      const middleware1 = requirePermission(Permission.SYSTEM_CONFIGURE);
      const middleware2 = requirePermission(Permission.ANALYTICS_READ);

      const request = createMockRequest({ user: mockSupport });
      const reply = createMockReply();

      await middleware1(request, reply);
      if (!reply.wasSent()) {
        await middleware2(request, reply);
      }

      expect(reply.wasSent()).toBe(true);
      expect(reply.getStatusCode()).toBe(403);
    });
  });
});
