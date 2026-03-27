/**
 * @file advancedRateLimit.mutations.test.ts
 * @description Mutation-killing boundary tests for AdvancedRateLimit.
 *              Targets: calculateBlockDuration, findMatchingRule edge cases,
 *              createFingerprint, extractIP, checkRateLimit blocked/reset paths,
 *              getPlugin headers and error handling.
 * @layer test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AdvancedRateLimit, RateLimitConfigs } from "../../src/security/advancedRateLimit.js";
import type { FastifyRequest } from "fastify";

vi.mock("../../src/lib/logger.js", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ============================================================================
// Mock Redis
// ============================================================================

function createMockRedis(
  overrides: {
    status?: string;
    hgetallData?: Record<string, string>;
    shouldThrow?: boolean;
  } = {}
) {
  const { status = "ready", hgetallData = {}, shouldThrow = false } = overrides;

  return {
    status,
    on: vi.fn(),
    pipeline: vi.fn(() => ({
      hgetall: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockImplementation(async () => {
        if (shouldThrow) throw new Error("Redis pipeline error");
        return [
          [null, hgetallData],
          [null, 1],
        ];
      }),
    })),
    hmset: vi.fn().mockResolvedValue("OK"),
  };
}

function createMockMetrics() {
  return {
    metrics: {
      rateLimitBlocked: { inc: vi.fn() },
      rateLimitRequests: { inc: vi.fn() },
      rateLimitErrors: { inc: vi.fn() },
    },
  };
}

function makeReq(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    method: "GET",
    url: "/api/test",
    headers: { "user-agent": "Mozilla/5.0 (Test)" },
    routeOptions: { url: "/api/test" },
    ip: "10.0.0.1",
    socket: { remoteAddress: "10.0.0.1" },
    ...overrides,
  } as FastifyRequest;
}

// ============================================================================
// Tests
// ============================================================================

describe("AdvancedRateLimit — mutation-killing boundaries", () => {
  let metrics: ReturnType<typeof createMockMetrics>;

  beforeEach(() => {
    vi.clearAllMocks();
    metrics = createMockMetrics();
  });

  // --------------------------------------------------------------------------
  // calculateBlockDuration
  // --------------------------------------------------------------------------

  describe("calculateBlockDuration", () => {
    it("returns 1 minute for first violation (violations=1)", () => {
      const redis = createMockRedis();
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });
      const duration = (rl as any).calculateBlockDuration(1);
      expect(duration).toBe(60 * 1000); // 1 minute
    });

    it("returns 5 minutes for second violation (violations=2)", () => {
      const redis = createMockRedis();
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });
      const duration = (rl as any).calculateBlockDuration(2);
      expect(duration).toBe(5 * 60 * 1000);
    });

    it("returns 15 minutes for third violation (violations=3)", () => {
      const redis = createMockRedis();
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });
      const duration = (rl as any).calculateBlockDuration(3);
      expect(duration).toBe(15 * 60 * 1000);
    });

    it("returns 1 hour for fourth violation (violations=4)", () => {
      const redis = createMockRedis();
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });
      const duration = (rl as any).calculateBlockDuration(4);
      expect(duration).toBe(60 * 60 * 1000);
    });

    it("returns 6 hours for fifth violation (violations=5)", () => {
      const redis = createMockRedis();
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });
      const duration = (rl as any).calculateBlockDuration(5);
      expect(duration).toBe(360 * 60 * 1000);
    });

    it("caps at 6 hours for violations beyond 5", () => {
      const redis = createMockRedis();
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });
      const duration = (rl as any).calculateBlockDuration(100);
      expect(duration).toBe(360 * 60 * 1000);
    });

    it("returns 1 minute fallback for violations=0", () => {
      const redis = createMockRedis();
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });
      // violations=0 → index = -1 → multipliers[-1] is undefined → fallback 1
      const duration = (rl as any).calculateBlockDuration(0);
      expect(duration).toBe(60 * 1000);
    });
  });

  // --------------------------------------------------------------------------
  // extractIP edge cases
  // --------------------------------------------------------------------------

  describe("extractIP", () => {
    it("returns first IP from x-forwarded-for with multiple IPs", () => {
      const redis = createMockRedis();
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });
      const req = makeReq({
        headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8", "user-agent": "t" },
      });
      const ip = (rl as any).extractIP(req);
      expect(ip).toBe("1.2.3.4");
    });

    it("skips x-forwarded-for when it is empty string (falsy)", () => {
      const redis = createMockRedis();
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });
      // empty string is falsy → falls through to socket.remoteAddress
      const req = makeReq({
        headers: { "x-forwarded-for": "", "user-agent": "t" },
        socket: { remoteAddress: "9.9.9.9" } as any,
      });
      const ip = (rl as any).extractIP(req);
      expect(ip).toBe("9.9.9.9");
    });

    it("uses x-real-ip when x-forwarded-for is absent", () => {
      const redis = createMockRedis();
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });
      const req = makeReq({
        headers: { "x-real-ip": "7.7.7.7", "user-agent": "t" },
      });
      const ip = (rl as any).extractIP(req);
      expect(ip).toBe("7.7.7.7");
    });

    it("returns 'unknown' when no IP source available", () => {
      const redis = createMockRedis();
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });
      const req = makeReq({ headers: { "user-agent": "t" }, socket: {} as any });
      const ip = (rl as any).extractIP(req);
      expect(ip).toBe("unknown");
    });
  });

  // --------------------------------------------------------------------------
  // createFingerprint
  // --------------------------------------------------------------------------

  describe("createFingerprint", () => {
    it("includes user-agent length in base36", () => {
      const redis = createMockRedis();
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });
      const fp = (rl as any).createFingerprint("Mozilla/5.0");
      expect(fp).toContain("Mozilla/5.0".length.toString(36));
    });

    it("uses last 10 chars of user-agent", () => {
      const redis = createMockRedis();
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });
      const fp1 = (rl as any).createFingerprint("AAAA_test_1234567890");
      const fp2 = (rl as any).createFingerprint("BBBB_test_1234567890");
      // Same last 10 chars, same length → same fingerprint
      expect(fp1).toBe(fp2);
    });

    it("strips non-alphanumeric chars from fingerprint suffix", () => {
      const redis = createMockRedis();
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });
      const fp = (rl as any).createFingerprint("test/1.0 (Special!)");
      // Should not contain / . ( ) ! or spaces in the suffix part
      const lengthPrefix = "test/1.0 (Special!)".length.toString(36);
      const suffix = fp.slice(lengthPrefix.length);
      expect(suffix).toMatch(/^[a-z0-9]*$/);
    });
  });

  // --------------------------------------------------------------------------
  // findMatchingRule
  // --------------------------------------------------------------------------

  describe("findMatchingRule", () => {
    it("returns null when no rules defined", () => {
      const redis = createMockRedis();
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });
      const req = makeReq();
      const rule = (rl as any).findMatchingRule(req);
      expect(rule).toBeNull();
    });

    it("matches exact string path", () => {
      const redis = createMockRedis();
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });
      rl.addRule({ path: "/api/test", config: { windowMs: 1000, maxRequests: 1 } });
      const req = makeReq({ routeOptions: { url: "/api/test" } as any });
      const rule = (rl as any).findMatchingRule(req);
      expect(rule).not.toBeNull();
      expect(rule.config.maxRequests).toBe(1);
    });

    it("matches string path prefix", () => {
      const redis = createMockRedis();
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });
      rl.addRule({ path: "/api/auth", config: { windowMs: 1000, maxRequests: 2 } });
      const req = makeReq({ routeOptions: { url: "/api/auth/login" } as any });
      const rule = (rl as any).findMatchingRule(req);
      expect(rule).not.toBeNull();
    });

    it("skips rule when method does not match (string)", () => {
      const redis = createMockRedis();
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });
      rl.addRule({ path: "/api/test", method: "POST", config: { windowMs: 1000, maxRequests: 1 } });
      const req = makeReq({ method: "GET", routeOptions: { url: "/api/test" } as any });
      const rule = (rl as any).findMatchingRule(req);
      expect(rule).toBeNull();
    });

    it("skips rule when method not in array", () => {
      const redis = createMockRedis();
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });
      rl.addRule({
        path: "/api/test",
        method: ["POST", "PUT"],
        config: { windowMs: 1000, maxRequests: 1 },
      });
      const req = makeReq({ method: "GET", routeOptions: { url: "/api/test" } as any });
      const rule = (rl as any).findMatchingRule(req);
      expect(rule).toBeNull();
    });

    it("matches when no method constraint", () => {
      const redis = createMockRedis();
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });
      rl.addRule({ path: "/api/test", config: { windowMs: 1000, maxRequests: 1 } });
      const req = makeReq({ method: "DELETE", routeOptions: { url: "/api/test" } as any });
      const rule = (rl as any).findMatchingRule(req);
      expect(rule).not.toBeNull();
    });

    it("falls back to req.url when routeOptions.url absent", () => {
      const redis = createMockRedis();
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });
      rl.addRule({ path: "/fallback", config: { windowMs: 1000, maxRequests: 1 } });
      const req = makeReq({ url: "/fallback/path" });
      delete (req as any).routeOptions;
      const rule = (rl as any).findMatchingRule(req);
      expect(rule).not.toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // checkRateLimit — blocked bucket path
  // --------------------------------------------------------------------------

  describe("checkRateLimit — blocked bucket", () => {
    it("rejects when bucket is blocked and blockExpiry in future", async () => {
      const futureBlock = (Date.now() + 60000).toString();
      const redis = createMockRedis({
        hgetallData: {
          count: "10",
          resetTime: (Date.now() + 60000).toString(),
          blocked: "true",
          blockExpiry: futureBlock,
        },
      });
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 5,
      });
      const result = await rl.checkRateLimit(makeReq());
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.resetTime).toBe(parseInt(futureBlock));
    });

    it("allows when bucket was blocked but blockExpiry is past", async () => {
      const pastBlock = (Date.now() - 1000).toString();
      const redis = createMockRedis({
        hgetallData: {
          count: "2",
          resetTime: (Date.now() + 60000).toString(),
          blocked: "true",
          blockExpiry: pastBlock,
        },
      });
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 5,
      });
      const result = await rl.checkRateLimit(makeReq());
      expect(result.allowed).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // checkRateLimit — window reset
  // --------------------------------------------------------------------------

  describe("checkRateLimit — window reset", () => {
    it("resets count when window expired", async () => {
      const redis = createMockRedis({
        hgetallData: {
          count: "99",
          resetTime: (Date.now() - 1000).toString(), // expired
          blocked: "false",
        },
      });
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 5,
      });
      const result = await rl.checkRateLimit(makeReq());
      expect(result.allowed).toBe(true);
      // Count was reset to 0, then incremented to 1 → remaining = 5 - 1 = 4
      expect(result.remaining).toBe(4);
    });
  });

  // --------------------------------------------------------------------------
  // checkRateLimit — limit exceeded with onLimitReached
  // --------------------------------------------------------------------------

  describe("checkRateLimit — limit exceeded", () => {
    it("calls onLimitReached when set", async () => {
      const onLimitReached = vi.fn();
      const redis = createMockRedis({
        hgetallData: {
          count: "5",
          resetTime: (Date.now() + 60000).toString(),
          blocked: "false",
        },
      });
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 5,
        onLimitReached,
      });
      const result = await rl.checkRateLimit(makeReq());
      expect(result.allowed).toBe(false);
      expect(onLimitReached).toHaveBeenCalledOnce();
    });

    it("does not call onLimitReached when not set", async () => {
      const redis = createMockRedis({
        hgetallData: {
          count: "5",
          resetTime: (Date.now() + 60000).toString(),
          blocked: "false",
        },
      });
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 5,
      });
      // Should not throw
      const result = await rl.checkRateLimit(makeReq());
      expect(result.allowed).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // checkRateLimit — redis not ready (fail-open)
  // --------------------------------------------------------------------------

  describe("checkRateLimit — redis not ready", () => {
    it("allows request when redis status is not ready", async () => {
      const redis = createMockRedis({ status: "connecting" });
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 5,
      });
      const result = await rl.checkRateLimit(makeReq());
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(5);
      expect(metrics.metrics.rateLimitErrors.inc).toHaveBeenCalledWith({
        error_type: "redis_not_ready",
      });
    });
  });

  // --------------------------------------------------------------------------
  // checkRateLimit — redis pipeline throws
  // --------------------------------------------------------------------------

  describe("checkRateLimit — redis error", () => {
    it("allows request on pipeline error (fail-open)", async () => {
      const redis = createMockRedis({ shouldThrow: true });
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 7,
      });
      const result = await rl.checkRateLimit(makeReq());
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(7);
      expect(metrics.metrics.rateLimitErrors.inc).toHaveBeenCalledWith({
        error_type: "redis_failure",
      });
    });
  });

  // --------------------------------------------------------------------------
  // skipList
  // --------------------------------------------------------------------------

  describe("skipList", () => {
    it("skips rate limit for paths in skipList", async () => {
      const redis = createMockRedis();
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 1,
        skipList: ["/health"],
      });
      const req = makeReq({ url: "/health/live", routeOptions: { url: "/health/live" } as any });
      const result = await rl.checkRateLimit(req);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1);
    });

    it("does not skip for non-matching path", async () => {
      const redis = createMockRedis();
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 100,
        skipList: ["/health"],
      });
      const req = makeReq({ url: "/api/test", routeOptions: { url: "/api/test" } as any });
      const result = await rl.checkRateLimit(req);
      // Should go through normal flow, not skip
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(99); // was incremented
    });
  });

  // --------------------------------------------------------------------------
  // getPlugin
  // --------------------------------------------------------------------------

  describe("getPlugin", () => {
    it("returns a plugin function", () => {
      const redis = createMockRedis();
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });
      const plugin = rl.getPlugin();
      expect(typeof plugin).toBe("function");
    });

    it("plugin registers preHandler hook", async () => {
      const redis = createMockRedis();
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });
      const plugin = rl.getPlugin();
      const addHook = vi.fn();
      await plugin({ addHook } as any);
      expect(addHook).toHaveBeenCalledWith("preHandler", expect.any(Function));
    });

    it("preHandler sets rate limit headers on allowed request", async () => {
      const redis = createMockRedis();
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });
      const plugin = rl.getPlugin();

      let handler: any;
      await plugin({
        addHook: (_name: string, fn: any) => {
          handler = fn;
        },
      } as any);

      const req = makeReq();
      const headers: Record<string, string> = {};
      const reply = {
        header: vi.fn((name: string, value: string) => {
          headers[name] = value;
          return reply;
        }),
        code: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      };

      await handler(req, reply);

      expect(reply.header).toHaveBeenCalledWith("X-RateLimit-Remaining", expect.any(String));
      expect(reply.header).toHaveBeenCalledWith("X-RateLimit-Reset", expect.any(String));
      expect(reply.code).not.toHaveBeenCalled();
    });

    it("preHandler returns 429 when rate limit exceeded", async () => {
      const redis = createMockRedis({
        hgetallData: {
          count: "10",
          resetTime: (Date.now() + 60000).toString(),
          blocked: "false",
        },
      });
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 5,
      });
      const plugin = rl.getPlugin();

      let handler: any;
      await plugin({
        addHook: (_name: string, fn: any) => {
          handler = fn;
        },
      } as any);

      const req = makeReq();
      const reply = {
        header: vi.fn().mockReturnThis(),
        code: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      };

      await handler(req, reply);

      expect(reply.code).toHaveBeenCalledWith(429);
      expect(reply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: false,
          error: "RATE_LIMIT_EXCEEDED",
        })
      );
    });

    it("preHandler catches errors and allows request", async () => {
      const redis = createMockRedis({ shouldThrow: true });
      const rl = new AdvancedRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });
      const plugin = rl.getPlugin();

      let handler: any;
      await plugin({
        addHook: (_name: string, fn: any) => {
          handler = fn;
        },
      } as any);

      const req = makeReq();
      const reply = {
        header: vi.fn().mockReturnThis(),
        code: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      };

      // Should not throw
      await handler(req, reply);
      // Should still set headers since fail-open returns allowed=true
      expect(reply.header).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // RateLimitConfigs completeness
  // --------------------------------------------------------------------------

  describe("RateLimitConfigs", () => {
    it("HEALTH_TEST has testMode flag", () => {
      expect(RateLimitConfigs.HEALTH_TEST.testMode).toBe(true);
      expect(RateLimitConfigs.HEALTH_TEST.maxRequests).toBe(50);
    });

    it("LENIENT allows 300 req/min", () => {
      expect(RateLimitConfigs.LENIENT).toEqual({ windowMs: 60_000, maxRequests: 300 });
    });

    it("HEALTH allows 600 req/min", () => {
      expect(RateLimitConfigs.HEALTH).toEqual({ windowMs: 60_000, maxRequests: 600 });
    });
  });
});
