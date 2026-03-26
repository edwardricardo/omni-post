/**
 * @file slidingWindowRateLimit.mutations.test.ts
 * @description Mutation-killing tests for SlidingWindowRateLimit. Targets all
 *   survived mutants: boundary conditions, exact return values, operator
 *   replacements, conditional negations, and string literal mutations.
 * @layer unit
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  SlidingWindowRateLimit,
  SlidingWindowConfigs,
} from "../../src/security/slidingWindowRateLimit.js";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockRedis(overrides: Record<string, unknown> = {}) {
  const store = {
    keyValues: new Map<string, string>(),
    sortedSets: new Map<string, Array<{ score: number; member: string }>>(),
  };

  const mockRedis = {
    get: vi.fn(async (key: string) => store.keyValues.get(key) ?? null),
    setex: vi.fn(async (_key: string, _seconds: number, value: string) => {
      store.keyValues.set(_key, value);
      return "OK";
    }),
    incr: vi.fn(async (key: string) => {
      const cur = parseInt(store.keyValues.get(key) ?? "0", 10);
      const next = cur + 1;
      store.keyValues.set(key, String(next));
      return next;
    }),
    expire: vi.fn(async () => 1),
    zrem: vi.fn(async () => 1),
    pipeline: vi.fn(() => {
      const chain = {
        zremrangebyscore: vi.fn().mockReturnValue(chain),
        zadd: vi.fn().mockReturnValue(chain),
        zcount: vi.fn().mockReturnValue(chain),
        zrange: vi.fn().mockReturnValue(chain),
        expire: vi.fn().mockReturnValue(chain),
        exec: vi.fn(async () => [
          [null, 0], // zremrangebyscore
          [null, 1], // zadd
          [null, 1], // zcount  (requestsInWindow)
          [null, [`${Date.now()}-uuid`]], // zrange oldest
          [null, [`${Date.now()}-uuid`]], // zrange newest
          [null, 1], // expire
        ]),
      };
      return chain;
    }),
    on: vi.fn(),
    _store: store,
    ...overrides,
  };

  return mockRedis;
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

function createMockRequest(overrides: Record<string, unknown> = {}) {
  return {
    headers: { "user-agent": "TestAgent/1.0" },
    socket: { remoteAddress: "127.0.0.1" },
    routeOptions: { url: "/api/test" },
    url: "/api/test",
    ...overrides,
  } as any;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("SlidingWindowRateLimit - mutation killing", () => {
  let limiter: SlidingWindowRateLimit;

  afterEach(() => {
    limiter?.destroy();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // 1. Predefined configs exact values
  // =========================================================================

  describe("SlidingWindowConfigs exact values", () => {
    it("AUTH windowMs is 15 minutes", () => {
      expect(SlidingWindowConfigs.AUTH.windowMs).toBe(15 * 60 * 1000);
    });

    it("AUTH enableProgressiveBlocking is true", () => {
      expect(SlidingWindowConfigs.AUTH.enableProgressiveBlocking).toBe(true);
    });

    it("API maxRequests is 100", () => {
      expect(SlidingWindowConfigs.API.maxRequests).toBe(100);
    });

    it("API enableProgressiveBlocking is true", () => {
      expect(SlidingWindowConfigs.API.enableProgressiveBlocking).toBe(true);
    });

    it("HEALTH enableProgressiveBlocking is false", () => {
      expect(SlidingWindowConfigs.HEALTH.enableProgressiveBlocking).toBe(false);
    });

    it("HEALTH windowMs is 60000", () => {
      expect(SlidingWindowConfigs.HEALTH.windowMs).toBe(60000);
    });
  });

  // =========================================================================
  // 2. Constructor defaults
  // =========================================================================

  describe("constructor defaults", () => {
    it("applies default precision of 10 when not provided", () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });
      const cfg = (limiter as any).globalConfig;
      expect(cfg.precision).toBe(10);
    });

    it("applies default enableGeoBlocking true when not provided", () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });
      expect((limiter as any).globalConfig.enableGeoBlocking).toBe(true);
    });

    it("applies default enableUserAgentTracking true when not provided", () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });
      expect((limiter as any).globalConfig.enableUserAgentTracking).toBe(true);
    });

    it("applies default enableProgressiveBlocking true when not provided", () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });
      expect((limiter as any).globalConfig.enableProgressiveBlocking).toBe(true);
    });

    it("overrides precision when explicitly provided", () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
        precision: 20,
      });
      expect((limiter as any).globalConfig.precision).toBe(20);
    });

    it("preserves skipList when provided", () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
        skipList: ["/health"],
      });
      expect((limiter as any).globalConfig.skipList).toEqual(["/health"]);
    });

    it("does not set skipList when not provided", () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });
      expect((limiter as any).globalConfig.skipList).toBeUndefined();
    });

    it("preserves keyGenerator when provided", () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      const kg = () => "custom-key";
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
        keyGenerator: kg,
      });
      expect((limiter as any).globalConfig.keyGenerator).toBe(kg);
    });

    it("preserves onLimitReached when provided", () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      const cb = vi.fn();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
        onLimitReached: cb,
      });
      expect((limiter as any).globalConfig.onLimitReached).toBe(cb);
    });

    it("registers Redis error handler on construction", () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });
      expect(redis.on).toHaveBeenCalledWith("error", expect.any(Function));
    });
  });

  // =========================================================================
  // 3. checkRateLimit — blockedUntil branch
  // =========================================================================

  describe("checkRateLimit blockedUntil handling", () => {
    it("blocks when blockedUntil is in the future", async () => {
      const futureTs = String(Date.now() + 60000);
      const redis = createMockRedis({
        get: vi.fn(async () => futureTs),
      });
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });

      const result = await limiter.checkRateLimit(createMockRequest());

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.resetTime).toBe(parseInt(futureTs));
      expect(result.windowInfo.requestsInWindow).toBe(10);
      expect(metrics.metrics.rateLimitBlocked.inc).toHaveBeenCalledWith({
        type: "progressive_block",
        path: "/api/test",
      });
    });

    it("allows when blockedUntil is expired (now >= parseInt)", async () => {
      const redis = createMockRedis({
        get: vi.fn(async () => String(Date.now() - 1)),
      });
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });

      const result = await limiter.checkRateLimit(createMockRequest());

      expect(result.allowed).toBe(true);
    });

    it("allows when blockedUntil is in the past", async () => {
      const redis = createMockRedis({
        get: vi.fn(async () => String(Date.now() - 10000)),
      });
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });

      const result = await limiter.checkRateLimit(createMockRequest());

      expect(result.allowed).toBe(true);
    });

    it("allows when blockedUntil is null", async () => {
      const redis = createMockRedis({
        get: vi.fn(async () => null),
      });
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });

      const result = await limiter.checkRateLimit(createMockRequest());

      expect(result.allowed).toBe(true);
    });
  });

  // =========================================================================
  // 4. checkRateLimit — pipeline results parsing
  // =========================================================================

  describe("checkRateLimit pipeline results", () => {
    it("throws and fails open when pipeline returns null", async () => {
      const redis = createMockRedis();
      redis.pipeline.mockReturnValue({
        zremrangebyscore: vi.fn().mockReturnThis(),
        zadd: vi.fn().mockReturnThis(),
        zcount: vi.fn().mockReturnThis(),
        zrange: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn(async () => null),
      });
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 5,
      });

      const result = await limiter.checkRateLimit(createMockRequest());

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(5);
      expect(result.windowInfo.requestsInWindow).toBe(0);
      expect(metrics.metrics.rateLimitErrors.inc).toHaveBeenCalledWith({
        error_type: "sliding_window_failure",
      });
    });

    it("defaults requestsInWindow to 0 when results[2] is null", async () => {
      const redis = createMockRedis();
      redis.pipeline.mockReturnValue({
        zremrangebyscore: vi.fn().mockReturnThis(),
        zadd: vi.fn().mockReturnThis(),
        zcount: vi.fn().mockReturnThis(),
        zrange: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn(async () => [
          [null, 0],
          [null, 1],
          [null, null], // requestsInWindow is null
          [null, []],
          [null, []],
          [null, 1],
        ]),
      });
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 5,
      });

      const result = await limiter.checkRateLimit(createMockRequest());

      expect(result.allowed).toBe(true);
      expect(result.windowInfo.requestsInWindow).toBe(0);
      expect(result.remaining).toBe(5);
    });

    it("uses now as oldestRequest when zrange returns empty array", async () => {
      const before = Date.now();
      const redis = createMockRedis();
      redis.pipeline.mockReturnValue({
        zremrangebyscore: vi.fn().mockReturnThis(),
        zadd: vi.fn().mockReturnThis(),
        zcount: vi.fn().mockReturnThis(),
        zrange: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn(async () => [
          [null, 0],
          [null, 1],
          [null, 1],
          [null, []], // empty oldest
          [null, []], // empty newest
          [null, 1],
        ]),
      });
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });

      const result = await limiter.checkRateLimit(createMockRequest());
      const after = Date.now();

      expect(result.windowInfo.oldestRequest).toBeGreaterThanOrEqual(before);
      expect(result.windowInfo.oldestRequest).toBeLessThanOrEqual(after);
      expect(result.windowInfo.newestRequest).toBeGreaterThanOrEqual(before);
      expect(result.windowInfo.newestRequest).toBeLessThanOrEqual(after);
    });

    it("parses oldestRequest timestamp from member string", async () => {
      const ts = 1700000000000;
      const redis = createMockRedis();
      redis.pipeline.mockReturnValue({
        zremrangebyscore: vi.fn().mockReturnThis(),
        zadd: vi.fn().mockReturnThis(),
        zcount: vi.fn().mockReturnThis(),
        zrange: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn(async () => [
          [null, 0],
          [null, 1],
          [null, 2],
          [null, [`${ts}-abc-def`]], // oldest
          [null, [`${ts + 1000}-xyz`]], // newest
          [null, 1],
        ]),
      });
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });

      const result = await limiter.checkRateLimit(createMockRequest());

      expect(result.windowInfo.oldestRequest).toBe(ts);
      expect(result.windowInfo.newestRequest).toBe(ts + 1000);
    });
  });

  // =========================================================================
  // 5. checkRateLimit — exact boundary: maxRequests vs requestsInWindow
  // =========================================================================

  describe("checkRateLimit boundary: maxRequests comparison", () => {
    function makeLimiterWithCount(count: number, maxRequests: number) {
      const redis = createMockRedis();
      redis.pipeline.mockReturnValue({
        zremrangebyscore: vi.fn().mockReturnThis(),
        zadd: vi.fn().mockReturnThis(),
        zcount: vi.fn().mockReturnThis(),
        zrange: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn(async () => [
          [null, 0],
          [null, 1],
          [null, count],
          [null, [`${Date.now()}-a`]],
          [null, [`${Date.now()}-b`]],
          [null, 1],
        ]),
      });
      const metrics = createMockMetrics();
      const lim = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests,
        enableProgressiveBlocking: false,
      });
      return { limiter: lim, redis, metrics };
    }

    it("allows when requestsInWindow equals maxRequests exactly", async () => {
      const { limiter: lim } = makeLimiterWithCount(5, 5);
      limiter = lim;

      const result = await limiter.checkRateLimit(createMockRequest());

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(0);
    });

    it("blocks when requestsInWindow equals maxRequests + 1", async () => {
      const { limiter: lim, redis, metrics } = makeLimiterWithCount(6, 5);
      limiter = lim;

      const result = await limiter.checkRateLimit(createMockRequest());

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(redis.zrem).toHaveBeenCalled();
      expect(metrics.metrics.rateLimitBlocked.inc).toHaveBeenCalledWith({
        type: "sliding_window_exceeded",
        path: "/api/test",
      });
    });

    it("remaining is maxRequests - requestsInWindow when below limit", async () => {
      const { limiter: lim } = makeLimiterWithCount(3, 10);
      limiter = lim;

      const result = await limiter.checkRateLimit(createMockRequest());

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(7);
    });

    it("remaining is 0 via Math.max when requestsInWindow equals maxRequests", async () => {
      const { limiter: lim } = makeLimiterWithCount(5, 5);
      limiter = lim;

      const result = await limiter.checkRateLimit(createMockRequest());

      expect(result.remaining).toBe(0);
    });
  });

  // =========================================================================
  // 6. checkRateLimit — onLimitReached and enableProgressiveBlocking
  // =========================================================================

  describe("checkRateLimit onLimitReached callback", () => {
    it("calls onLimitReached when limit exceeded", async () => {
      const onLimitReached = vi.fn();
      const redis = createMockRedis();
      redis.pipeline.mockReturnValue({
        zremrangebyscore: vi.fn().mockReturnThis(),
        zadd: vi.fn().mockReturnThis(),
        zcount: vi.fn().mockReturnThis(),
        zrange: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn(async () => [
          [null, 0],
          [null, 1],
          [null, 11], // exceeds maxRequests=10
          [null, [`${Date.now()}-a`]],
          [null, [`${Date.now()}-b`]],
          [null, 1],
        ]),
      });
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
        onLimitReached,
        enableProgressiveBlocking: false,
      });

      const req = createMockRequest();
      await limiter.checkRateLimit(req);

      expect(onLimitReached).toHaveBeenCalledWith(req, expect.any(String));
    });

    it("does not call onLimitReached when limit is not exceeded", async () => {
      const onLimitReached = vi.fn();
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
        onLimitReached,
      });

      await limiter.checkRateLimit(createMockRequest());

      expect(onLimitReached).not.toHaveBeenCalled();
    });

    it("calls applyProgressiveBlocking when enabled and limit exceeded", async () => {
      const redis = createMockRedis();
      redis.pipeline.mockReturnValue({
        zremrangebyscore: vi.fn().mockReturnThis(),
        zadd: vi.fn().mockReturnThis(),
        zcount: vi.fn().mockReturnThis(),
        zrange: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn(async () => [
          [null, 0],
          [null, 1],
          [null, 6], // exceeds maxRequests=5
          [null, [`${Date.now()}-a`]],
          [null, [`${Date.now()}-b`]],
          [null, 1],
        ]),
      });
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 5,
        enableProgressiveBlocking: true,
      });

      await limiter.checkRateLimit(createMockRequest());

      // applyProgressiveBlocking calls incr, expire, setex
      expect(redis.incr).toHaveBeenCalled();
      expect(redis.setex).toHaveBeenCalled();
    });

    it("does not call applyProgressiveBlocking when disabled", async () => {
      const redis = createMockRedis();
      redis.pipeline.mockReturnValue({
        zremrangebyscore: vi.fn().mockReturnThis(),
        zadd: vi.fn().mockReturnThis(),
        zcount: vi.fn().mockReturnThis(),
        zrange: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn(async () => [
          [null, 0],
          [null, 1],
          [null, 6],
          [null, [`${Date.now()}-a`]],
          [null, [`${Date.now()}-b`]],
          [null, 1],
        ]),
      });
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 5,
        enableProgressiveBlocking: false,
      });

      await limiter.checkRateLimit(createMockRequest());

      expect(redis.incr).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 7. checkRateLimit — error path (fail-open)
  // =========================================================================

  describe("checkRateLimit error path", () => {
    it("returns fail-open response with correct shape on Redis error", async () => {
      const redis = createMockRedis({
        get: vi.fn(async () => {
          throw new Error("Connection refused");
        }),
      });
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 30000,
        maxRequests: 7,
      });

      const before = Date.now();
      const result = await limiter.checkRateLimit(createMockRequest());
      const after = Date.now();

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(7);
      expect(result.resetTime).toBeGreaterThanOrEqual(before + 30000);
      expect(result.resetTime).toBeLessThanOrEqual(after + 30000);
      expect(result.windowInfo.requestsInWindow).toBe(0);
      expect(result.windowInfo.oldestRequest).toBeGreaterThanOrEqual(before);
      expect(result.windowInfo.newestRequest).toBeLessThanOrEqual(after);
      expect(metrics.metrics.rateLimitErrors.inc).toHaveBeenCalledWith({
        error_type: "sliding_window_failure",
      });
    });
  });

  // =========================================================================
  // 8. checkRateLimit — resetTime and metrics on allowed path
  // =========================================================================

  describe("checkRateLimit allowed path metrics and resetTime", () => {
    it("sets resetTime to oldestRequest + windowMs", async () => {
      const oldestTs = 1700000000000;
      const redis = createMockRedis();
      redis.pipeline.mockReturnValue({
        zremrangebyscore: vi.fn().mockReturnThis(),
        zadd: vi.fn().mockReturnThis(),
        zcount: vi.fn().mockReturnThis(),
        zrange: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn(async () => [
          [null, 0],
          [null, 1],
          [null, 3],
          [null, [`${oldestTs}-aaa`]],
          [null, [`${oldestTs + 5000}-bbb`]],
          [null, 1],
        ]),
      });
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });

      const result = await limiter.checkRateLimit(createMockRequest());

      expect(result.resetTime).toBe(oldestTs + 60000);
      expect(metrics.metrics.rateLimitRequests.inc).toHaveBeenCalledWith({
        status: "allowed",
        path: "/api/test",
      });
    });
  });

  // =========================================================================
  // 9. generateKey
  // =========================================================================

  describe("generateKey", () => {
    it("uses custom keyGenerator when provided", async () => {
      const keyGen = vi.fn(() => "custom:my-key");
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
        keyGenerator: keyGen,
      });

      await limiter.checkRateLimit(createMockRequest());

      expect(keyGen).toHaveBeenCalled();
      expect(redis.get).toHaveBeenCalledWith("custom:my-key:block");
    });

    it("includes ua fingerprint when enableUserAgentTracking is true", async () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
        enableUserAgentTracking: true,
      });

      await limiter.checkRateLimit(createMockRequest());

      const getCall = redis.get.mock.calls[0]?.[0] as string;
      expect(getCall).toContain("ua:");
    });

    it("excludes ua fingerprint when enableUserAgentTracking is false", async () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
        enableUserAgentTracking: false,
      });

      await limiter.checkRateLimit(createMockRequest());

      const getCall = redis.get.mock.calls[0]?.[0] as string;
      expect(getCall).not.toContain("ua:");
    });

    it("uses unknown for user-agent when header is missing", async () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
        enableUserAgentTracking: false,
      });

      await limiter.checkRateLimit(createMockRequest({ headers: {} }));

      expect(redis.get).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 10. extractIP
  // =========================================================================

  describe("extractIP", () => {
    it("returns first IP from x-forwarded-for with multiple IPs", async () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
        enableUserAgentTracking: false,
      });

      await limiter.checkRateLimit(
        createMockRequest({
          headers: { "x-forwarded-for": "10.0.0.1, 10.0.0.2, 10.0.0.3" },
        })
      );

      const getCall = redis.get.mock.calls[0]?.[0] as string;
      expect(getCall).toContain("10.0.0.1");
      expect(getCall).not.toContain("10.0.0.2");
    });

    it("returns single IP from x-forwarded-for", async () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
        enableUserAgentTracking: false,
      });

      await limiter.checkRateLimit(
        createMockRequest({
          headers: { "x-forwarded-for": "203.0.113.50" },
        })
      );

      const getCall = redis.get.mock.calls[0]?.[0] as string;
      expect(getCall).toContain("203.0.113.50");
    });

    it("uses x-real-ip when x-forwarded-for is absent", async () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
        enableUserAgentTracking: false,
      });

      await limiter.checkRateLimit(
        createMockRequest({
          headers: { "x-real-ip": "198.51.100.25" },
        })
      );

      const getCall = redis.get.mock.calls[0]?.[0] as string;
      expect(getCall).toContain("198.51.100.25");
    });

    it("uses cf-connecting-ip when other headers absent", async () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
        enableUserAgentTracking: false,
      });

      await limiter.checkRateLimit(
        createMockRequest({
          headers: { "cf-connecting-ip": "172.16.0.1" },
        })
      );

      const getCall = redis.get.mock.calls[0]?.[0] as string;
      expect(getCall).toContain("172.16.0.1");
    });

    it("falls back to socket.remoteAddress", async () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
        enableUserAgentTracking: false,
      });

      await limiter.checkRateLimit(
        createMockRequest({
          headers: {},
          socket: { remoteAddress: "192.168.99.1" },
        })
      );

      const getCall = redis.get.mock.calls[0]?.[0] as string;
      expect(getCall).toContain("192.168.99.1");
    });

    it("returns unknown when no IP source available", async () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
        enableUserAgentTracking: false,
      });

      await limiter.checkRateLimit(
        createMockRequest({
          headers: {},
          socket: { remoteAddress: undefined },
        })
      );

      const getCall = redis.get.mock.calls[0]?.[0] as string;
      expect(getCall).toContain("unknown");
    });
  });

  // =========================================================================
  // 11. extractUserId
  // =========================================================================

  describe("extractUserId", () => {
    it("returns null for Bearer token so key has no user segment", async () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
        enableUserAgentTracking: false,
      });

      await limiter.checkRateLimit(
        createMockRequest({
          headers: { authorization: "Bearer some-jwt-token" },
        })
      );

      const getCall = redis.get.mock.calls[0]?.[0] as string;
      expect(getCall).not.toContain("user:");
    });

    it("returns null when no authorization header", async () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
        enableUserAgentTracking: false,
      });

      await limiter.checkRateLimit(createMockRequest({ headers: {} }));

      const getCall = redis.get.mock.calls[0]?.[0] as string;
      expect(getCall).not.toContain("user:");
    });

    it("returns null for non-Bearer authorization", async () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
        enableUserAgentTracking: false,
      });

      await limiter.checkRateLimit(
        createMockRequest({
          headers: { authorization: "Basic dXNlcjpwYXNz" },
        })
      );

      const getCall = redis.get.mock.calls[0]?.[0] as string;
      expect(getCall).not.toContain("user:");
    });
  });

  // =========================================================================
  // 12. createUserAgentFingerprint
  // =========================================================================

  describe("createUserAgentFingerprint", () => {
    it("replaces version numbers with X so different versions match", () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });

      const fp1 = (limiter as any).createUserAgentFingerprint("Mozilla/5.0");
      const fp2 = (limiter as any).createUserAgentFingerprint("Mozilla/6.0");

      expect(fp1).toBe(fp2);
    });

    it("removes special characters from fingerprint", () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });

      const fp = (limiter as any).createUserAgentFingerprint("Test/1.0 (Linux; x86_64)");
      expect(typeof fp).toBe("string");
      expect(fp.length).toBeLessThanOrEqual(16);
    });

    it("truncates to 50 chars before encoding", () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });

      const longUA = "A".repeat(200);
      const fp = (limiter as any).createUserAgentFingerprint(longUA);

      expect(fp.length).toBe(16);
    });

    it("returns base64-encoded string sliced to 16 chars", () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });

      const fp = (limiter as any).createUserAgentFingerprint("short");

      expect(fp.length).toBeLessThanOrEqual(16);
      expect(typeof fp).toBe("string");
    });
  });

  // =========================================================================
  // 13. getRequestPath
  // =========================================================================

  describe("getRequestPath", () => {
    it("returns routeOptions.url when available", async () => {
      const redis = createMockRedis();
      redis.pipeline.mockReturnValue({
        zremrangebyscore: vi.fn().mockReturnThis(),
        zadd: vi.fn().mockReturnThis(),
        zcount: vi.fn().mockReturnThis(),
        zrange: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn(async () => [
          [null, 0],
          [null, 1],
          [null, 1],
          [null, [`${Date.now()}-a`]],
          [null, [`${Date.now()}-b`]],
          [null, 1],
        ]),
      });
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });

      await limiter.checkRateLimit(
        createMockRequest({
          routeOptions: { url: "/api/v1/posts" },
          url: "/api/v1/posts?q=test",
        })
      );

      expect(metrics.metrics.rateLimitRequests.inc).toHaveBeenCalledWith({
        status: "allowed",
        path: "/api/v1/posts",
      });
    });

    it("falls back to req.url when routeOptions.url is absent", async () => {
      const redis = createMockRedis();
      redis.pipeline.mockReturnValue({
        zremrangebyscore: vi.fn().mockReturnThis(),
        zadd: vi.fn().mockReturnThis(),
        zcount: vi.fn().mockReturnThis(),
        zrange: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn(async () => [
          [null, 0],
          [null, 1],
          [null, 1],
          [null, [`${Date.now()}-a`]],
          [null, [`${Date.now()}-b`]],
          [null, 1],
        ]),
      });
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });

      await limiter.checkRateLimit(
        createMockRequest({
          routeOptions: {},
          url: "/fallback-url",
        })
      );

      expect(metrics.metrics.rateLimitRequests.inc).toHaveBeenCalledWith({
        status: "allowed",
        path: "/fallback-url",
      });
    });

    it("returns unknown when neither routeOptions.url nor req.url exist", async () => {
      const redis = createMockRedis();
      redis.pipeline.mockReturnValue({
        zremrangebyscore: vi.fn().mockReturnThis(),
        zadd: vi.fn().mockReturnThis(),
        zcount: vi.fn().mockReturnThis(),
        zrange: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn(async () => [
          [null, 0],
          [null, 1],
          [null, 1],
          [null, [`${Date.now()}-a`]],
          [null, [`${Date.now()}-b`]],
          [null, 1],
        ]),
      });
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });

      await limiter.checkRateLimit(
        createMockRequest({
          routeOptions: {},
          url: undefined,
        })
      );

      expect(metrics.metrics.rateLimitRequests.inc).toHaveBeenCalledWith({
        status: "allowed",
        path: "unknown",
      });
    });
  });

  // =========================================================================
  // 14. detectSuspiciousActivity
  // =========================================================================

  describe("detectSuspiciousActivity", () => {
    it("marks suspicious when requestsInWindow > 80% threshold", async () => {
      const redis = createMockRedis();
      redis.pipeline.mockReturnValue({
        zremrangebyscore: vi.fn().mockReturnThis(),
        zadd: vi.fn().mockReturnThis(),
        zcount: vi.fn().mockReturnThis(),
        zrange: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn(async () => [
          [null, 0],
          [null, 1],
          [null, 9], // 9 > 10*0.8=8
          [null, [`${Date.now()}-a`]],
          [null, [`${Date.now()}-b`]],
          [null, 1],
        ]),
      });
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
        enableProgressiveBlocking: false,
      });

      await limiter.checkRateLimit(createMockRequest());

      expect(metrics.metrics.rateLimitRequests.inc).toHaveBeenCalledWith({
        status: "suspicious",
        path: "/api/test",
      });
      expect((limiter as any).suspiciousPatterns.size).toBeGreaterThan(0);
    });

    it("does not mark suspicious at exactly 80% threshold", async () => {
      const redis = createMockRedis();
      redis.pipeline.mockReturnValue({
        zremrangebyscore: vi.fn().mockReturnThis(),
        zadd: vi.fn().mockReturnThis(),
        zcount: vi.fn().mockReturnThis(),
        zrange: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn(async () => [
          [null, 0],
          [null, 1],
          [null, 8], // 8 <= 10*0.8=8
          [null, [`${Date.now()}-a`]],
          [null, [`${Date.now()}-b`]],
          [null, 1],
        ]),
      });
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
        enableProgressiveBlocking: false,
      });

      await limiter.checkRateLimit(createMockRequest());

      const calls = metrics.metrics.rateLimitRequests.inc.mock.calls;
      const suspiciousCalls = calls.filter((c: any) => c[0]?.status === "suspicious");
      expect(suspiciousCalls.length).toBe(0);
    });

    it("blacklists after more than 5 violations", async () => {
      const redis = createMockRedis();
      redis.pipeline.mockReturnValue({
        zremrangebyscore: vi.fn().mockReturnThis(),
        zadd: vi.fn().mockReturnThis(),
        zcount: vi.fn().mockReturnThis(),
        zrange: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn(async () => [
          [null, 0],
          [null, 1],
          [null, 9], // suspicious
          [null, [`${Date.now()}-a`]],
          [null, [`${Date.now()}-b`]],
          [null, 1],
        ]),
      });
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
        enableProgressiveBlocking: false,
      });

      for (let i = 0; i < 7; i++) {
        await limiter.checkRateLimit(createMockRequest());
      }

      expect(redis.setex).toHaveBeenCalledWith(
        expect.stringContaining("blacklist:"),
        300,
        expect.any(String)
      );
    });

    it("does not blacklist at exactly 5 violations", async () => {
      const redis = createMockRedis();
      redis.pipeline.mockReturnValue({
        zremrangebyscore: vi.fn().mockReturnThis(),
        zadd: vi.fn().mockReturnThis(),
        zcount: vi.fn().mockReturnThis(),
        zrange: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn(async () => [
          [null, 0],
          [null, 1],
          [null, 9],
          [null, [`${Date.now()}-a`]],
          [null, [`${Date.now()}-b`]],
          [null, 1],
        ]),
      });
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
        enableProgressiveBlocking: false,
      });

      // 5 calls: violations go from 0->1, 1->2, ..., 4->5
      // condition is > 5, so at 5 it should NOT blacklist
      for (let i = 0; i < 5; i++) {
        await limiter.checkRateLimit(createMockRequest());
      }

      const setexCalls = redis.setex.mock.calls.filter(
        (c: any) => typeof c[0] === "string" && c[0].includes("blacklist:")
      );
      expect(setexCalls.length).toBe(0);
    });
  });

  // =========================================================================
  // 15. applyProgressiveBlocking durations
  // =========================================================================

  describe("applyProgressiveBlocking", () => {
    async function getBlockSecondsForViolation(violationNumber: number) {
      const redis = createMockRedis({
        incr: vi.fn(async () => violationNumber),
      });
      const metrics = createMockMetrics();
      const lim = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 5,
      });
      limiter = lim;

      await (lim as any).applyProgressiveBlocking("test-key", 1);

      const setexCall = redis.setex.mock.calls[0];
      return setexCall?.[1] as number;
    }

    it("blocks for 5 minutes on first violation", async () => {
      const seconds = await getBlockSecondsForViolation(1);
      expect(seconds).toBe(300);
    });

    it("blocks for 15 minutes on second violation", async () => {
      const seconds = await getBlockSecondsForViolation(2);
      expect(seconds).toBe(900);
    });

    it("blocks for 1 hour on third violation", async () => {
      const seconds = await getBlockSecondsForViolation(3);
      expect(seconds).toBe(3600);
    });

    it("blocks for 6 hours on fourth violation", async () => {
      const seconds = await getBlockSecondsForViolation(4);
      expect(seconds).toBe(21600);
    });

    it("blocks for 24 hours on fifth violation", async () => {
      const seconds = await getBlockSecondsForViolation(5);
      expect(seconds).toBe(86400);
    });

    it("caps at 24 hours for violations beyond array length", async () => {
      const seconds = await getBlockSecondsForViolation(100);
      expect(seconds).toBe(86400);
    });

    it("calls expire with 3600 on violation key", async () => {
      const redis = createMockRedis({
        incr: vi.fn(async () => 1),
      });
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 5,
      });

      await (limiter as any).applyProgressiveBlocking("key-123", 1);

      expect(redis.expire).toHaveBeenCalledWith("key-123:violations", 3600);
    });
  });

  // =========================================================================
  // 16. cleanupSuspiciousPatterns
  // =========================================================================

  describe("cleanupSuspiciousPatterns", () => {
    it("clears map when size exceeds 10000", () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });

      const patterns = (limiter as any).suspiciousPatterns as Map<string, number>;
      for (let i = 0; i < 10001; i++) {
        patterns.set(`key-${i}`, i);
      }

      (limiter as any).cleanupSuspiciousPatterns();

      expect(patterns.size).toBe(0);
    });

    it("does not clear map when size is exactly 10000", () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });

      const patterns = (limiter as any).suspiciousPatterns as Map<string, number>;
      for (let i = 0; i < 10000; i++) {
        patterns.set(`key-${i}`, i);
      }

      (limiter as any).cleanupSuspiciousPatterns();

      expect(patterns.size).toBe(10000);
    });

    it("does not clear map when size is below 10000", () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });

      const patterns = (limiter as any).suspiciousPatterns as Map<string, number>;
      patterns.set("a", 1);
      patterns.set("b", 2);

      (limiter as any).cleanupSuspiciousPatterns();

      expect(patterns.size).toBe(2);
    });
  });

  // =========================================================================
  // 17. destroy
  // =========================================================================

  describe("destroy", () => {
    it("clears cleanup timer", () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });

      expect((limiter as any).cleanupTimer).not.toBeNull();

      limiter.destroy();

      expect((limiter as any).cleanupTimer).toBeNull();
    });

    it("clears suspiciousPatterns map", () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });

      const patterns = (limiter as any).suspiciousPatterns as Map<string, number>;
      patterns.set("ip1", 3);
      patterns.set("ip2", 5);

      limiter.destroy();

      expect(patterns.size).toBe(0);
    });

    it("is safe to call multiple times", () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });

      limiter.destroy();
      expect(() => limiter.destroy()).not.toThrow();
      expect((limiter as any).cleanupTimer).toBeNull();
    });
  });

  // =========================================================================
  // 18. getPlugin — Fastify integration
  // =========================================================================

  describe("getPlugin", () => {
    it("skips rate limiting for paths matching skipList", async () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 5,
        skipList: ["/health", "/metrics"],
      });

      let capturedHandler: Function | null = null;
      const mockFastify = {
        addHook: (_event: string, handler: Function) => {
          capturedHandler = handler;
        },
      };

      const plugin = limiter.getPlugin();
      await plugin(mockFastify as any);

      const mockReply = {
        header: vi.fn().mockReturnThis(),
        code: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      };

      await capturedHandler!(
        createMockRequest({
          routeOptions: { url: "/health/check" },
          url: "/health/check",
        }),
        mockReply
      );

      expect(mockReply.header).not.toHaveBeenCalled();
    });

    it("does not skip for paths not in skipList", async () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 100,
        skipList: ["/health"],
      });

      let capturedHandler: Function | null = null;
      const mockFastify = {
        addHook: (_event: string, handler: Function) => {
          capturedHandler = handler;
        },
      };

      const plugin = limiter.getPlugin();
      await plugin(mockFastify as any);

      const mockReply = {
        header: vi.fn().mockReturnThis(),
        code: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      };

      await capturedHandler!(createMockRequest(), mockReply);

      expect(mockReply.header).toHaveBeenCalledWith("X-RateLimit-Limit", "100");
    });

    it("sets all rate limit headers on allowed request", async () => {
      const redis = createMockRedis();
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
      });

      let capturedHandler: Function | null = null;
      const mockFastify = {
        addHook: (_event: string, handler: Function) => {
          capturedHandler = handler;
        },
      };

      const plugin = limiter.getPlugin();
      await plugin(mockFastify as any);

      const mockReply = {
        header: vi.fn().mockReturnThis(),
        code: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      };

      await capturedHandler!(createMockRequest(), mockReply);

      expect(mockReply.header).toHaveBeenCalledWith("X-RateLimit-Limit", "10");
      expect(mockReply.header).toHaveBeenCalledWith("X-RateLimit-Remaining", expect.any(String));
      expect(mockReply.header).toHaveBeenCalledWith("X-RateLimit-Reset", expect.any(String));
      expect(mockReply.header).toHaveBeenCalledWith("X-RateLimit-Window", "60000");
      expect(mockReply.header).toHaveBeenCalledWith(
        "X-RateLimit-Requests-In-Window",
        expect.any(String)
      );
      expect(mockReply.header).not.toHaveBeenCalledWith("Retry-After", expect.any(String));
      expect(mockReply.code).not.toHaveBeenCalled();
    });

    it("returns 429 with correct body when rate limited", async () => {
      const redis = createMockRedis();
      redis.pipeline.mockReturnValue({
        zremrangebyscore: vi.fn().mockReturnThis(),
        zadd: vi.fn().mockReturnThis(),
        zcount: vi.fn().mockReturnThis(),
        zrange: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn(async () => [
          [null, 0],
          [null, 1],
          [null, 20], // exceeds maxRequests=5
          [null, [`${Date.now()}-a`]],
          [null, [`${Date.now()}-b`]],
          [null, 1],
        ]),
      });
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 5,
        enableProgressiveBlocking: false,
      });

      let capturedHandler: Function | null = null;
      const mockFastify = {
        addHook: (_event: string, handler: Function) => {
          capturedHandler = handler;
        },
      };

      const plugin = limiter.getPlugin();
      await plugin(mockFastify as any);

      const mockReply = {
        header: vi.fn().mockReturnThis(),
        code: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      };

      await capturedHandler!(createMockRequest(), mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(429);
      expect(mockReply.header).toHaveBeenCalledWith("Retry-After", expect.any(String));
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: false,
          error: "RATE_LIMIT_EXCEEDED",
          message: "Request rate limit exceeded. Please slow down.",
          retryAfter: expect.any(String),
          windowInfo: expect.objectContaining({
            requestsInWindow: 20,
          }),
        })
      );
    });

    it("handles errors in preHandler without crashing", async () => {
      const redis = createMockRedis({
        get: vi.fn(async () => {
          throw new Error("Redis exploded");
        }),
      });
      redis.pipeline.mockReturnValue({
        zremrangebyscore: vi.fn().mockReturnThis(),
        zadd: vi.fn().mockReturnThis(),
        zcount: vi.fn().mockReturnThis(),
        zrange: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn(async () => {
          throw new Error("Pipeline exploded");
        }),
      });
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 5,
      });

      let capturedHandler: Function | null = null;
      const mockFastify = {
        addHook: (_event: string, handler: Function) => {
          capturedHandler = handler;
        },
      };

      const plugin = limiter.getPlugin();
      await plugin(mockFastify as any);

      const mockReply = {
        header: vi.fn().mockReturnThis(),
        code: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      };

      await expect(capturedHandler!(createMockRequest(), mockReply)).resolves.not.toThrow();
    });

    it("calculates Retry-After as ceil of seconds until reset", async () => {
      const nowish = Date.now();

      const redis = createMockRedis();
      redis.pipeline.mockReturnValue({
        zremrangebyscore: vi.fn().mockReturnThis(),
        zadd: vi.fn().mockReturnThis(),
        zcount: vi.fn().mockReturnThis(),
        zrange: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn(async () => [
          [null, 0],
          [null, 1],
          [null, 11], // exceeds 10
          [null, [`${nowish - 30000}-a`]], // oldest: reset = oldest+60s = nowish+30s
          [null, [`${nowish}-b`]],
          [null, 1],
        ]),
      });
      const metrics = createMockMetrics();
      limiter = new SlidingWindowRateLimit(redis as any, metrics as any, {
        windowMs: 60000,
        maxRequests: 10,
        enableProgressiveBlocking: false,
      });

      let capturedHandler: Function | null = null;
      const mockFastify = {
        addHook: (_event: string, handler: Function) => {
          capturedHandler = handler;
        },
      };

      const plugin = limiter.getPlugin();
      await plugin(mockFastify as any);

      const mockReply = {
        header: vi.fn().mockReturnThis(),
        code: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      };

      await capturedHandler!(createMockRequest(), mockReply);

      const retryAfterCall = mockReply.header.mock.calls.find((c: any) => c[0] === "Retry-After");
      expect(retryAfterCall).toBeDefined();
      const retryAfterValue = parseInt(retryAfterCall![1] as string, 10);
      expect(retryAfterValue).toBeGreaterThan(0);
      expect(retryAfterValue).toBeLessThanOrEqual(31);
    });
  });
});
