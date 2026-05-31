/**
 * @file httpRateLimitPreHandler.test.ts
 * @description Unit tests for the HTTP rate-limit preHandler: path→rule
 *              matching, header emission, 429 on denial, and fail-open on a
 *              limiter error.
 * @layer infrastructure
 */

import { describe, it, expect, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { RateLimiterPort, RateLimitDecision, RateLimitOptions } from "@ports/core";
import {
  createHttpRateLimitPreHandler,
  RateLimitConfigs,
  STANDARD_ROUTE_RULES,
  EXPENSIVE_ENDPOINT_RULES,
} from "../../../src/security/httpRateLimitPreHandler.js";

function fakeReq(url: string): FastifyRequest {
  return {
    url,
    headers: { "x-forwarded-for": "9.9.9.9" },
    socket: { remoteAddress: "9.9.9.9" },
  } as unknown as FastifyRequest;
}

function fakeReply(): FastifyReply & {
  headers: Record<string, string>;
  statusCode?: number;
  body?: unknown;
} {
  const reply = {
    headers: {} as Record<string, string>,
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    header(k: string, v: string) {
      this.headers[k] = v;
      return this;
    },
    code(n: number) {
      this.statusCode = n;
      return this;
    },
    send(b: unknown) {
      this.body = b;
      return this;
    },
  };
  return reply as unknown as FastifyReply & {
    headers: Record<string, string>;
    statusCode?: number;
    body?: unknown;
  };
}

function limiterReturning(decision: RateLimitDecision): {
  port: RateLimiterPort;
  calls: Array<{ key: string; opts?: RateLimitOptions }>;
} {
  const calls: Array<{ key: string; opts?: RateLimitOptions }> = [];
  const port: RateLimiterPort = {
    tryConsume: vi.fn(async (key: string, opts?: RateLimitOptions) => {
      calls.push({ key, ...(opts !== undefined && { opts }) });
      return decision;
    }),
  };
  return { port, calls };
}

const ALLOW: RateLimitDecision = { allowed: true, remaining: 42, resetAtMs: 1_000_000 };

describe("createHttpRateLimitPreHandler", () => {
  it("applies the default config for an unmatched route", async () => {
    const { port, calls } = limiterReturning(ALLOW);
    const handler = createHttpRateLimitPreHandler(port, {
      defaultConfig: RateLimitConfigs.STANDARD,
      rules: [...STANDARD_ROUTE_RULES, ...EXPENSIVE_ENDPOINT_RULES],
    });

    await handler(fakeReq("/posts"), fakeReply());

    expect(calls[0]?.opts?.capacity).toBe(RateLimitConfigs.STANDARD.maxRequests);
    expect(calls[0]?.opts?.refillWindowMs).toBe(RateLimitConfigs.STANDARD.windowMs);
    expect(calls[0]?.key).toBe("9.9.9.9:/posts");
  });

  it("applies the matched rule config (first prefix match wins)", async () => {
    const { port, calls } = limiterReturning(ALLOW);
    const handler = createHttpRateLimitPreHandler(port, {
      defaultConfig: RateLimitConfigs.STANDARD,
      rules: [...STANDARD_ROUTE_RULES, ...EXPENSIVE_ENDPOINT_RULES],
    });

    // /analytics/cross-platform is CRITICAL (5/min) in the expensive rules.
    await handler(fakeReq("/analytics/cross-platform"), fakeReply());

    expect(calls[0]?.opts?.capacity).toBe(RateLimitConfigs.CRITICAL_EXPENSIVE.maxRequests);
  });

  it("sets rate-limit headers on an allowed request", async () => {
    const { port } = limiterReturning(ALLOW);
    const handler = createHttpRateLimitPreHandler(port, {
      defaultConfig: RateLimitConfigs.STANDARD,
      rules: [],
    });
    const reply = fakeReply();

    await handler(fakeReq("/posts"), reply);

    expect(reply.headers["X-RateLimit-Remaining"]).toBe("42");
    expect(reply.headers["X-RateLimit-Reset"]).toBe("1000000");
    expect(reply.statusCode).toBeUndefined();
  });

  it("responds 429 with Retry-After when denied", async () => {
    const { port } = limiterReturning({
      allowed: false,
      remaining: 0,
      resetAtMs: 2_000_000,
      retryAfterMs: 30_000,
    });
    const handler = createHttpRateLimitPreHandler(port, {
      defaultConfig: RateLimitConfigs.STRICT,
      rules: [],
    });
    const reply = fakeReply();

    await handler(fakeReq("/publish/x"), reply);

    expect(reply.statusCode).toBe(429);
    expect(reply.headers["Retry-After"]).toBe("30");
    expect((reply.body as { error: string }).error).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("fails open (no 429) when the limiter throws", async () => {
    const port: RateLimiterPort = {
      tryConsume: vi.fn(async () => {
        throw new Error("redis down");
      }),
    };
    const handler = createHttpRateLimitPreHandler(port, {
      defaultConfig: RateLimitConfigs.STANDARD,
      rules: [],
    });
    const reply = fakeReply();

    await handler(fakeReq("/posts"), reply);

    expect(reply.statusCode).toBeUndefined();
    expect(reply.body).toBeUndefined();
  });
});
