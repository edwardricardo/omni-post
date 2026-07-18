/**
 * @file adminRateLimit.test.ts
 * @description Verifies the admin-auth rate-limit middleware keys its bucket via
 *              the canonical `resolveClientIp` resolver (socket peer under the
 *              test's fail-closed hop count) rather than the spoofable leftmost
 *              X-Forwarded-For entry that a raw `request.ip` read would expose.
 * @layer infrastructure
 */

import { describe, it, expect, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { RateLimiterPort, RateLimitDecision, RateLimitOptions } from "@ports/core";
import { rateLimit } from "../../../src/admin/auth/adminAuthMiddleware.js";

const ALLOW: RateLimitDecision = { allowed: true, remaining: 10, resetAtMs: 1_000 };

function makeRequest(opts: { socket: string; ip: string; xff: string; url: string }): {
  request: FastifyRequest;
  calls: string[];
} {
  const calls: string[] = [];
  const limiter: RateLimiterPort = {
    tryConsume: vi.fn(async (key: string, _o?: RateLimitOptions) => {
      calls.push(key);
      return ALLOW;
    }),
  };
  const request = {
    ip: opts.ip,
    socket: { remoteAddress: opts.socket },
    headers: { "x-forwarded-for": opts.xff },
    routeOptions: { url: opts.url },
    server: { container: { resolve: () => limiter } },
  } as unknown as FastifyRequest;
  return { request, calls };
}

function fakeReply(): FastifyReply {
  return {
    header: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  } as unknown as FastifyReply;
}

describe("admin rateLimit middleware", () => {
  it("keys by the resolver's IP (socket), not the leftmost X-Forwarded-For", async () => {
    const { request, calls } = makeRequest({
      socket: "10.0.0.1",
      ip: "1.1.1.1",
      xff: "1.1.1.1",
      url: "/admin/auth/login",
    });

    await rateLimit(5, 900_000)(request, fakeReply());

    expect(calls[0]).toBe("admin:10.0.0.1:/admin/auth/login");
    expect(calls[0]).not.toContain("1.1.1.1");
  });
});
