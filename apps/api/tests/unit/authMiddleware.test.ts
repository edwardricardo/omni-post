/**
 * @file authMiddleware.test.ts
 * @description Unit tests for adminAuthMiddleware — authentication and authorization
 *              middleware for admin routes. Mocks adminAuthService to test token
 *              validation, role-based access control, and rate limiting.
 * @layer infrastructure
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type { FastifyRequest, FastifyReply } from "fastify";
import { ok, err } from "@shared/types";
import type { AccessTokenPayload, AuthErrorCode } from "../../src/admin/auth/adminAuthTypes.js";

// ---------------------------------------------------------------------------
// Mock adminAuthService before importing SUT
// ---------------------------------------------------------------------------

const mockVerifyAccessToken =
  vi.fn<(token: string) => import("@shared/types").Result<AccessTokenPayload, AuthErrorCode>>();

vi.mock("../../src/admin/auth/AdminAuthService.js", () => ({
  adminAuthService: {
    verifyAccessToken: mockVerifyAccessToken,
  },
  AdminAuthService: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import SUT after mocks
// ---------------------------------------------------------------------------

const { requireAdminAuth, requireSuperAdmin, requireAdmin, rateLimit } =
  await import("../../src/admin/auth/adminAuthMiddleware.js");

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeAccessTokenPayload(overrides?: Partial<AccessTokenPayload>): AccessTokenPayload {
  return {
    sub: "user-001",
    email: "admin@example.com",
    name: "Test Admin",
    role: "ADMIN",
    type: "access",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 900,
    ...overrides,
  };
}

interface MockReplyAccessors {
  getStatusCode: () => number;
  getBody: () => unknown;
  wasSent: () => boolean;
}

function createMockReply(): MockReplyAccessors & FastifyReply {
  let statusCode = 200;
  let responseBody: unknown = null;
  let replySent = false;

  const reply = {
    status(code: number) {
      statusCode = code;
      return reply;
    },
    send(body: unknown) {
      responseBody = body;
      replySent = true;
      return reply;
    },
    header(_name: string, _value: string) {
      return reply;
    },
    getStatusCode: () => statusCode,
    getBody: () => responseBody,
    wasSent: () => replySent,
  };

  return reply as unknown as MockReplyAccessors & FastifyReply;
}

function createMockRequest(overrides?: Partial<FastifyRequest>): FastifyRequest {
  return {
    headers: {},
    ip: "127.0.0.1",
    routeOptions: { url: "/test" },
    ...overrides,
  } as unknown as FastifyRequest;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("adminAuthMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // requireAdminAuth
  // =========================================================================

  describe("requireAdminAuth", () => {
    describe("Success Cases", () => {
      it("populates request.auth when given a valid Bearer token", async () => {
        const payload = makeAccessTokenPayload({ role: "SUPER_ADMIN" });
        mockVerifyAccessToken.mockReturnValue(ok(payload));

        const request = createMockRequest({
          headers: { authorization: "Bearer valid-token-123" },
        });
        const reply = createMockReply();

        await requireAdminAuth(request, reply);

        assert.strictEqual(reply.wasSent(), false);
        assert.ok(request.auth, "request.auth should be defined");
        assert.strictEqual(request.auth.user.id, payload.sub);
        assert.strictEqual(request.auth.user.email, payload.email);
        assert.strictEqual(request.auth.user.name, payload.name);
        assert.strictEqual(request.auth.user.role, "SUPER_ADMIN");
        expect(mockVerifyAccessToken).toHaveBeenCalledWith("valid-token-123");
      });

      it("populates request.auth with deviceId when payload includes it", async () => {
        const payload = makeAccessTokenPayload({ deviceId: "device-abc" });
        mockVerifyAccessToken.mockReturnValue(ok(payload));

        const request = createMockRequest({
          headers: { authorization: "Bearer token-with-device" },
        });
        const reply = createMockReply();

        await requireAdminAuth(request, reply);

        assert.strictEqual(reply.wasSent(), false);
        assert.ok(request.auth);
        assert.strictEqual(request.auth.deviceId, "device-abc");
      });
    });

    describe("Failure Cases", () => {
      it("returns 401 when no Authorization header is present", async () => {
        const request = createMockRequest({ headers: {} });
        const reply = createMockReply();

        await requireAdminAuth(request, reply);

        assert.strictEqual(reply.wasSent(), true);
        assert.strictEqual(reply.getStatusCode(), 401);
        const body = reply.getBody() as Record<string, unknown>;
        assert.strictEqual((body.error as Record<string, unknown>)?.code, "INVALID_TOKEN");
        expect(mockVerifyAccessToken).not.toHaveBeenCalled();
      });

      it("returns 401 when Authorization header lacks Bearer prefix", async () => {
        const request = createMockRequest({
          headers: { authorization: "Basic some-token" },
        });
        const reply = createMockReply();

        await requireAdminAuth(request, reply);

        assert.strictEqual(reply.wasSent(), true);
        assert.strictEqual(reply.getStatusCode(), 401);
        expect(mockVerifyAccessToken).not.toHaveBeenCalled();
      });

      it("returns 401 when token verification fails with INVALID_TOKEN", async () => {
        mockVerifyAccessToken.mockReturnValue(err("INVALID_TOKEN" as AuthErrorCode));

        const request = createMockRequest({
          headers: { authorization: "Bearer bad-token" },
        });
        const reply = createMockReply();

        await requireAdminAuth(request, reply);

        assert.strictEqual(reply.wasSent(), true);
        assert.strictEqual(reply.getStatusCode(), 401);
        const body = reply.getBody() as Record<string, unknown>;
        assert.strictEqual((body.error as Record<string, unknown>)?.code, "INVALID_TOKEN");
      });

      it("returns 401 when token verification fails with TOKEN_EXPIRED", async () => {
        mockVerifyAccessToken.mockReturnValue(err("TOKEN_EXPIRED" as AuthErrorCode));

        const request = createMockRequest({
          headers: { authorization: "Bearer expired-token" },
        });
        const reply = createMockReply();

        await requireAdminAuth(request, reply);

        assert.strictEqual(reply.wasSent(), true);
        assert.strictEqual(reply.getStatusCode(), 401);
        const body = reply.getBody() as Record<string, unknown>;
        const errorObj = body.error as Record<string, unknown>;
        assert.strictEqual(errorObj.code, "TOKEN_EXPIRED");
        expect(errorObj.message).toContain("expired");
      });
    });
  });

  // =========================================================================
  // requireAdmin (SUPER_ADMIN or ADMIN)
  // =========================================================================

  describe("requireAdmin", () => {
    describe("Success Cases", () => {
      it("passes when user has ADMIN role", async () => {
        const request = createMockRequest();
        request.auth = {
          user: {
            id: "user-001",
            email: "admin@example.com",
            name: "Admin User",
            role: "ADMIN",
            isActive: true,
            emailVerified: true,
            mfaEnabled: false,
            timezone: null,
            locale: null,
            department: null,
            team: null,
            lastLoginAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          sessionId: "session-001",
        };
        const reply = createMockReply();

        await requireAdmin(request, reply);

        assert.strictEqual(reply.wasSent(), false);
      });

      it("passes when user has SUPER_ADMIN role", async () => {
        const request = createMockRequest();
        request.auth = {
          user: {
            id: "user-002",
            email: "superadmin@example.com",
            name: "Super Admin",
            role: "SUPER_ADMIN",
            isActive: true,
            emailVerified: true,
            mfaEnabled: false,
            timezone: null,
            locale: null,
            department: null,
            team: null,
            lastLoginAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          sessionId: "session-002",
        };
        const reply = createMockReply();

        await requireAdmin(request, reply);

        assert.strictEqual(reply.wasSent(), false);
      });
    });

    describe("Failure Cases", () => {
      it("returns 401 when request.auth is not set", async () => {
        const request = createMockRequest();
        const reply = createMockReply();

        await requireAdmin(request, reply);

        assert.strictEqual(reply.wasSent(), true);
        assert.strictEqual(reply.getStatusCode(), 401);
        const body = reply.getBody() as Record<string, unknown>;
        assert.strictEqual((body.error as Record<string, unknown>)?.code, "INVALID_TOKEN");
      });

      it("returns 403 when user has SUPPORT role", async () => {
        const request = createMockRequest();
        request.auth = {
          user: {
            id: "user-003",
            email: "support@example.com",
            name: "Support User",
            role: "SUPPORT",
            isActive: true,
            emailVerified: true,
            mfaEnabled: false,
            timezone: null,
            locale: null,
            department: null,
            team: null,
            lastLoginAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          sessionId: "session-003",
        };
        const reply = createMockReply();

        await requireAdmin(request, reply);

        assert.strictEqual(reply.wasSent(), true);
        assert.strictEqual(reply.getStatusCode(), 403);
        const body = reply.getBody() as Record<string, unknown>;
        assert.strictEqual((body.error as Record<string, unknown>)?.code, "PERMISSION_DENIED");
      });
    });
  });

  // =========================================================================
  // requireSuperAdmin (SUPER_ADMIN only)
  // =========================================================================

  describe("requireSuperAdmin", () => {
    describe("Success Cases", () => {
      it("passes when user has SUPER_ADMIN role", async () => {
        const request = createMockRequest();
        request.auth = {
          user: {
            id: "user-002",
            email: "superadmin@example.com",
            name: "Super Admin",
            role: "SUPER_ADMIN",
            isActive: true,
            emailVerified: true,
            mfaEnabled: false,
            timezone: null,
            locale: null,
            department: null,
            team: null,
            lastLoginAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          sessionId: "session-002",
        };
        const reply = createMockReply();

        await requireSuperAdmin(request, reply);

        assert.strictEqual(reply.wasSent(), false);
      });
    });

    describe("Failure Cases", () => {
      it("returns 401 when request.auth is not set", async () => {
        const request = createMockRequest();
        const reply = createMockReply();

        await requireSuperAdmin(request, reply);

        assert.strictEqual(reply.wasSent(), true);
        assert.strictEqual(reply.getStatusCode(), 401);
      });

      it("returns 403 when user has ADMIN role", async () => {
        const request = createMockRequest();
        request.auth = {
          user: {
            id: "user-001",
            email: "admin@example.com",
            name: "Admin User",
            role: "ADMIN",
            isActive: true,
            emailVerified: true,
            mfaEnabled: false,
            timezone: null,
            locale: null,
            department: null,
            team: null,
            lastLoginAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          sessionId: "session-001",
        };
        const reply = createMockReply();

        await requireSuperAdmin(request, reply);

        assert.strictEqual(reply.wasSent(), true);
        assert.strictEqual(reply.getStatusCode(), 403);
        const body = reply.getBody() as Record<string, unknown>;
        assert.strictEqual((body.error as Record<string, unknown>)?.code, "PERMISSION_DENIED");
      });

      it("returns 403 when user has SUPPORT role", async () => {
        const request = createMockRequest();
        request.auth = {
          user: {
            id: "user-003",
            email: "support@example.com",
            name: "Support User",
            role: "SUPPORT",
            isActive: true,
            emailVerified: true,
            mfaEnabled: false,
            timezone: null,
            locale: null,
            department: null,
            team: null,
            lastLoginAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          sessionId: "session-003",
        };
        const reply = createMockReply();

        await requireSuperAdmin(request, reply);

        assert.strictEqual(reply.wasSent(), true);
        assert.strictEqual(reply.getStatusCode(), 403);
      });
    });
  });

  // =========================================================================
  // rateLimit
  // =========================================================================

  describe("rateLimit", () => {
    it("allows requests under the limit", async () => {
      const middleware = rateLimit(5, 60_000);
      const request = createMockRequest({
        ip: "10.0.0.1",
        routeOptions: { url: "/rate-test-allow" },
      } as unknown as Partial<FastifyRequest>);
      const reply = createMockReply();

      await middleware(request, reply);

      assert.strictEqual(reply.wasSent(), false);
    });

    it("returns 429 when rate limit is exceeded", async () => {
      const uniqueUrl = `/rate-test-exceed-${Date.now()}`;
      const middleware = rateLimit(2, 60_000);

      for (let i = 0; i < 2; i++) {
        const req = createMockRequest({
          ip: "10.0.0.2",
          routeOptions: { url: uniqueUrl },
        } as unknown as Partial<FastifyRequest>);
        const rep = createMockReply();
        await middleware(req, rep);
        assert.strictEqual(rep.wasSent(), false, `Request ${i + 1} should pass`);
      }

      // Third request should be rate limited
      const request = createMockRequest({
        ip: "10.0.0.2",
        routeOptions: { url: uniqueUrl },
      } as unknown as Partial<FastifyRequest>);
      const reply = createMockReply();

      await middleware(request, reply);

      assert.strictEqual(reply.wasSent(), true);
      assert.strictEqual(reply.getStatusCode(), 429);
      const body = reply.getBody() as Record<string, unknown>;
      assert.strictEqual((body.error as Record<string, unknown>)?.code, "RATE_LIMIT_EXCEEDED");
    });
  });
});
