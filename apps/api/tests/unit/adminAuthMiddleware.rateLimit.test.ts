/**
 * @file adminAuthMiddleware.rateLimit.test.ts
 * @description The bucket the admin-auth rate-limit middleware spends: by default the bucket of
 *   the caller's address and the matched route pattern, and, when a route names a bucket, the
 *   bucket of the caller's address and that pattern, so two routes that name one pattern share
 *   one allowance.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { RateLimitDecision, RateLimitOptions, RateLimiterPort } from "@ports/core";
import { rateLimit } from "../../src/admin/auth/adminAuthMiddleware.js";

const ALLOW: RateLimitDecision = { allowed: true, remaining: 10, resetAtMs: 1_000 };
const CALLER = "198.51.100.17";
const OWN_ROUTE = "/admin/auth/password/change-required";
const NAMED_BUCKET = "/admin/auth/login";

interface Consumed {
  readonly key: string;
  readonly options: RateLimitOptions | undefined;
}

/** A request to `url` from `CALLER`, with a limiter that allows and records what it was asked. */
function makeRequest(url: string): { request: FastifyRequest; consumed: Consumed[] } {
  const consumed: Consumed[] = [];
  const limiter: RateLimiterPort = {
    tryConsume: async (key: string, options?: RateLimitOptions) => {
      consumed.push({ key, options });
      return ALLOW;
    },
  };
  const request = {
    ip: CALLER,
    socket: { remoteAddress: CALLER },
    headers: {},
    routeOptions: { url },
    server: { container: { resolve: () => limiter } },
  } as unknown as FastifyRequest;
  return { request, consumed };
}

function fakeReply(): FastifyReply {
  return {
    header: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  } as unknown as FastifyReply;
}

describe("admin rateLimit middleware — the bucket it spends", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keys the bucket by the address and the route's own pattern when no bucket is named", async () => {
    const { request, consumed } = makeRequest(OWN_ROUTE);

    await rateLimit(7, 45_000)(request, fakeReply());

    expect(consumed).toEqual([
      { key: `admin:${CALLER}:${OWN_ROUTE}`, options: { capacity: 7, refillWindowMs: 45_000 } },
    ]);
  });

  it("keys the bucket by the address and the named pattern when a bucket is named", async () => {
    const { request, consumed } = makeRequest(OWN_ROUTE);

    await rateLimit(7, 45_000, NAMED_BUCKET)(request, fakeReply());

    expect(consumed).toEqual([
      { key: `admin:${CALLER}:${NAMED_BUCKET}`, options: { capacity: 7, refillWindowMs: 45_000 } },
    ]);
  });
});
