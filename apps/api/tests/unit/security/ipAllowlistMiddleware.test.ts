/**
 * @file ipAllowlistMiddleware.test.ts
 * @description Unit tests for IP allowlist enforcement middleware.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { PrismaClient } from "@infra/prisma";
import {
  createIpAllowlistMiddleware,
  clearAllowlistCache,
} from "../../../src/security/ipAllowlistMiddleware.js";

function makeMockPrisma(settings: { ipAllowlistEnabled: boolean; ipAllowlist: string[] } | null) {
  return {
    securitySettings: {
      findFirst: vi.fn().mockResolvedValue(settings),
    },
  } as unknown as PrismaClient;
}

function makeMockRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    url: "/admin/users",
    ip: "192.168.1.100",
    method: "GET",
    headers: {},
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

describe("ipAllowlistMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAllowlistCache();
  });

  describe("when allowlist disabled", () => {
    it("allows all requests when ipAllowlistEnabled=false", async () => {
      const prisma = makeMockPrisma({ ipAllowlistEnabled: false, ipAllowlist: [] });
      const hook = createIpAllowlistMiddleware(prisma);
      const reply = makeMockReply();

      await hook(makeMockRequest(), reply);

      expect(reply.status).not.toHaveBeenCalled();
    });

    it("allows all requests when ipAllowlist is empty", async () => {
      const prisma = makeMockPrisma({ ipAllowlistEnabled: true, ipAllowlist: [] });
      const hook = createIpAllowlistMiddleware(prisma);
      const reply = makeMockReply();

      await hook(makeMockRequest(), reply);

      expect(reply.status).not.toHaveBeenCalled();
    });

    it("allows all requests when no settings exist", async () => {
      const prisma = makeMockPrisma(null);
      const hook = createIpAllowlistMiddleware(prisma);
      const reply = makeMockReply();

      await hook(makeMockRequest(), reply);

      expect(reply.status).not.toHaveBeenCalled();
    });
  });

  describe("when allowlist enabled", () => {
    it("allows request from exact IP match", async () => {
      const prisma = makeMockPrisma({
        ipAllowlistEnabled: true,
        ipAllowlist: ["192.168.1.100"],
      });
      const hook = createIpAllowlistMiddleware(prisma);
      const reply = makeMockReply();

      await hook(makeMockRequest({ ip: "192.168.1.100" }), reply);

      expect(reply.status).not.toHaveBeenCalled();
    });

    it("allows request from IP within CIDR range", async () => {
      const prisma = makeMockPrisma({
        ipAllowlistEnabled: true,
        ipAllowlist: ["10.0.0.0/8"],
      });
      const hook = createIpAllowlistMiddleware(prisma);
      const reply = makeMockReply();

      await hook(makeMockRequest({ ip: "10.42.1.55" }), reply);

      expect(reply.status).not.toHaveBeenCalled();
    });

    it("blocks request from IP not in allowlist", async () => {
      const prisma = makeMockPrisma({
        ipAllowlistEnabled: true,
        ipAllowlist: ["10.0.0.0/8"],
      });
      const hook = createIpAllowlistMiddleware(prisma);
      const reply = makeMockReply();

      await hook(makeMockRequest({ ip: "192.168.1.100" }), reply);

      expect(reply.status).toHaveBeenCalledWith(403);
    });

    it("returns correct error shape on block", async () => {
      const prisma = makeMockPrisma({
        ipAllowlistEnabled: true,
        ipAllowlist: ["10.0.0.1"],
      });
      const hook = createIpAllowlistMiddleware(prisma);
      const reply = makeMockReply();

      await hook(makeMockRequest({ ip: "192.168.1.1" }), reply);

      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: false,
          error: expect.objectContaining({ code: "IP_NOT_ALLOWED" }),
        })
      );
    });
  });

  describe("exempt routes", () => {
    it("skips /health endpoint", async () => {
      const prisma = makeMockPrisma({ ipAllowlistEnabled: true, ipAllowlist: ["10.0.0.1"] });
      const hook = createIpAllowlistMiddleware(prisma);
      const reply = makeMockReply();

      await hook(makeMockRequest({ url: "/health", ip: "192.168.1.1" }), reply);

      expect(reply.status).not.toHaveBeenCalled();
    });

    it("skips non-admin routes", async () => {
      const prisma = makeMockPrisma({ ipAllowlistEnabled: true, ipAllowlist: ["10.0.0.1"] });
      const hook = createIpAllowlistMiddleware(prisma);
      const reply = makeMockReply();

      await hook(makeMockRequest({ url: "/api/posts", ip: "192.168.1.1" }), reply);

      expect(reply.status).not.toHaveBeenCalled();
    });
  });

  describe("caching", () => {
    it("reads from DB only once within cache TTL", async () => {
      const prisma = makeMockPrisma({ ipAllowlistEnabled: false, ipAllowlist: [] });
      const hook = createIpAllowlistMiddleware(prisma);
      const reply = makeMockReply();

      await hook(makeMockRequest(), reply);
      await hook(makeMockRequest(), reply);
      await hook(makeMockRequest(), reply);

      expect(prisma.securitySettings.findFirst).toHaveBeenCalledTimes(1);
    });
  });

  describe("IP extraction", () => {
    it("uses X-Forwarded-For when present", async () => {
      const prisma = makeMockPrisma({
        ipAllowlistEnabled: true,
        ipAllowlist: ["203.0.113.50"],
      });
      const hook = createIpAllowlistMiddleware(prisma);
      const reply = makeMockReply();

      await hook(
        makeMockRequest({
          ip: "127.0.0.1",
          headers: { "x-forwarded-for": "203.0.113.50, 70.41.3.18" },
        }),
        reply
      );

      expect(reply.status).not.toHaveBeenCalled();
    });

    it("uses first IP from X-Forwarded-For chain", async () => {
      const prisma = makeMockPrisma({
        ipAllowlistEnabled: true,
        ipAllowlist: ["70.41.3.18"],
      });
      const hook = createIpAllowlistMiddleware(prisma);
      const reply = makeMockReply();

      await hook(
        makeMockRequest({
          ip: "127.0.0.1",
          headers: { "x-forwarded-for": "203.0.113.50, 70.41.3.18" },
        }),
        reply
      );

      // First IP is 203.0.113.50, not 70.41.3.18 — should block
      expect(reply.status).toHaveBeenCalledWith(403);
    });
  });
});
