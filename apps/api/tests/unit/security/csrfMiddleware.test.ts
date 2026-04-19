/**
 * @file csrfMiddleware.test.ts
 * @description Unit tests for CSRF token validation middleware.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { PrismaClient } from "@infra/prisma";
import { createCsrfMiddleware } from "../../../src/security/csrfMiddleware.js";

function makeMockPrisma(csrfToken: string | null = null) {
  return {
    adminSession: {
      findFirst: vi.fn().mockResolvedValue(csrfToken ? { csrfToken } : null),
    },
  } as unknown as PrismaClient;
}

function makeMockRequest(
  overrides: Partial<FastifyRequest & { auth?: { user?: { id?: string } } }> = {}
): FastifyRequest {
  return {
    url: "/admin/users",
    method: "POST",
    headers: {},
    auth: { user: { id: "user-1" } },
    ...overrides,
  } as unknown as FastifyRequest;
}

function makeMockReply() {
  const reply = {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return reply as unknown as FastifyReply;
}

describe("csrfMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips GET requests", async () => {
    const prisma = makeMockPrisma();
    const hook = createCsrfMiddleware(prisma);
    const reply = makeMockReply();

    await hook(makeMockRequest({ method: "GET" }), reply);

    expect(reply.status).not.toHaveBeenCalled();
    expect(prisma.adminSession.findFirst).not.toHaveBeenCalled();
  });

  it("skips HEAD requests", async () => {
    const prisma = makeMockPrisma();
    const hook = createCsrfMiddleware(prisma);
    const reply = makeMockReply();

    await hook(makeMockRequest({ method: "HEAD" }), reply);

    expect(reply.status).not.toHaveBeenCalled();
  });

  it("skips OPTIONS requests", async () => {
    const prisma = makeMockPrisma();
    const hook = createCsrfMiddleware(prisma);
    const reply = makeMockReply();

    await hook(makeMockRequest({ method: "OPTIONS" }), reply);

    expect(reply.status).not.toHaveBeenCalled();
  });

  it("skips non-admin routes", async () => {
    const prisma = makeMockPrisma();
    const hook = createCsrfMiddleware(prisma);
    const reply = makeMockReply();

    await hook(makeMockRequest({ url: "/api/posts", method: "POST" }), reply);

    expect(reply.status).not.toHaveBeenCalled();
  });

  it("skips exempt routes (login)", async () => {
    const prisma = makeMockPrisma();
    const hook = createCsrfMiddleware(prisma);
    const reply = makeMockReply();

    await hook(makeMockRequest({ url: "/admin/auth/login", method: "POST" }), reply);

    expect(reply.status).not.toHaveBeenCalled();
  });

  it("skips exempt routes (refresh)", async () => {
    const prisma = makeMockPrisma();
    const hook = createCsrfMiddleware(prisma);
    const reply = makeMockReply();

    await hook(makeMockRequest({ url: "/admin/auth/refresh", method: "POST" }), reply);

    expect(reply.status).not.toHaveBeenCalled();
  });

  it("returns 403 when X-CSRF-Token header missing on POST", async () => {
    const prisma = makeMockPrisma("valid-csrf-token");
    const hook = createCsrfMiddleware(prisma);
    const reply = makeMockReply();

    await hook(makeMockRequest({ method: "POST", headers: {} }), reply);

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "CSRF_MISSING" }),
      })
    );
  });

  it("returns 403 when CSRF token does not match session", async () => {
    const prisma = makeMockPrisma("real-csrf-token");
    const hook = createCsrfMiddleware(prisma);
    const reply = makeMockReply();

    await hook(
      makeMockRequest({
        method: "POST",
        headers: { "x-csrf-token": "wrong-token" },
      }),
      reply
    );

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "CSRF_INVALID" }),
      })
    );
  });

  it("allows request when CSRF token matches session", async () => {
    const prisma = makeMockPrisma("valid-csrf-token-uuid");
    const hook = createCsrfMiddleware(prisma);
    const reply = makeMockReply();

    await hook(
      makeMockRequest({
        method: "POST",
        headers: { "x-csrf-token": "valid-csrf-token-uuid" },
      }),
      reply
    );

    expect(reply.status).not.toHaveBeenCalled();
  });

  it("skips validation when no auth context (auth middleware handles it)", async () => {
    const prisma = makeMockPrisma("csrf-token");
    const hook = createCsrfMiddleware(prisma);
    const reply = makeMockReply();

    await hook(
      makeMockRequest({
        method: "POST",
        headers: { "x-csrf-token": "csrf-token" },
        auth: undefined,
      }),
      reply
    );

    // No 403 — auth middleware will reject the request, not CSRF middleware
    expect(reply.status).not.toHaveBeenCalled();
    expect(prisma.adminSession.findFirst).not.toHaveBeenCalled();
  });
});
