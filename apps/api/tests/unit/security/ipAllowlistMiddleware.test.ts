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
  // Mirror the socket peer to `ip` by default: the resolver keys on the socket
  // under the test's fail-closed hop count (TRUSTED_PROXY_HOP_COUNT=0), so the
  // socket is the source of truth unless a test overrides it explicitly.
  const ip = (overrides.ip as string | undefined) ?? "192.168.1.100";
  return {
    url: "/admin/users",
    ip,
    method: "GET",
    headers: {},
    socket: { remoteAddress: ip },
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

  describe("IP derivation via resolveClientIp (spoof-resistance)", () => {
    it("denies a spoofed allowlisted IP placed in X-Forwarded-For", async () => {
      const prisma = makeMockPrisma({
        ipAllowlistEnabled: true,
        ipAllowlist: ["203.0.113.50"],
      });
      const hook = createIpAllowlistMiddleware(prisma);
      const reply = makeMockReply();

      // Attacker's socket (127.0.0.1) is NOT allowlisted; it forges the
      // allowlisted 203.0.113.50 as the leftmost XFF entry. The old
      // leftmost-extraction let this bypass; the resolver now denies it.
      await hook(
        makeMockRequest({
          ip: "127.0.0.1",
          headers: { "x-forwarded-for": "203.0.113.50, 70.41.3.18" },
        }),
        reply
      );

      expect(reply.status).toHaveBeenCalledWith(403);
    });

    it("allows when the socket peer is allowlisted regardless of X-Forwarded-For", async () => {
      const prisma = makeMockPrisma({
        ipAllowlistEnabled: true,
        ipAllowlist: ["203.0.113.50"],
      });
      const hook = createIpAllowlistMiddleware(prisma);
      const reply = makeMockReply();

      await hook(
        makeMockRequest({
          ip: "203.0.113.50",
          headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
        }),
        reply
      );

      expect(reply.status).not.toHaveBeenCalled();
    });
  });
});
