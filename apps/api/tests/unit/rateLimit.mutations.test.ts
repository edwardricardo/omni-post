/**
 * @file rateLimit.mutations.test.ts
 * @description Mutation-killing boundary tests for RateLimit.
 *              Targets: findConfig, getClientKey edge cases, checkRateLimit
 *              boundary at maxRequests, remaining calculation, EXPENSIVE_ENDPOINT_RULES.
 * @layer test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  RateLimit,
  RateLimitConfigs,
  EXPENSIVE_ENDPOINT_RULES,
} from "../../src/security/rateLimit.js";
import type { FastifyRequest } from "fastify";

vi.mock("../../src/lib/logger.js", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// ============================================================================
// Mock Redis
// ============================================================================

class MockRedis {
  private data = new Map<string, Array<{ score: number; member: string }>>();
  private shouldFailExec = false;
  private shouldThrow = false;

  setFailExec(v: boolean) {
    this.shouldFailExec = v;
  }
  setThrow(v: boolean) {
    this.shouldThrow = v;
  }

  pipeline() {
    const cmds: Array<() => any> = [];
    const self = this;
    return {
      zremrangebyscore(key: string, min: number, max: number) {
        cmds.push(() => {
          if (self.shouldThrow) throw new Error("Redis error");
          const items = self.data.get(key) || [];
          const filtered = items.filter((i) => i.score < min || i.score > max);
          self.data.set(key, filtered);
          return [null, items.length - filtered.length];
        });
        return this;
      },
      zcard(key: string) {
        cmds.push(() => {
          if (self.shouldThrow) throw new Error("Redis error");
          return [null, (self.data.get(key) || []).length];
        });
        return this;
      },
      zadd(key: string, score: number, member: string) {
        cmds.push(() => {
          if (self.shouldThrow) throw new Error("Redis error");
          const items = self.data.get(key) || [];
          items.push({ score, member });
          self.data.set(key, items);
          return [null, 1];
        });
        return this;
      },
      expire(_key: string, _seconds: number) {
        cmds.push(() => [null, 1]);
        return this;
      },
      async exec() {
        if (self.shouldFailExec) return null;
        if (self.shouldThrow) throw new Error("Redis error");
        return cmds.map((fn) => fn());
      },
    };
  }

  async zrem(key: string, member: string) {
    const items = this.data.get(key) || [];
    const filtered = items.filter((i) => i.member !== member);
    this.data.set(key, filtered);
    return items.length - filtered.length;
  }

  clear() {
    this.data.clear();
  }
}

function makeReq(url: string, overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    url,
    headers: {},
    socket: { remoteAddress: "10.0.0.1" },
    ...overrides,
  } as any;
}

// ============================================================================
// Tests
// ============================================================================

describe("RateLimit — mutation-killing boundaries", () => {
  let redis: MockRedis;

  beforeEach(() => {
    vi.clearAllMocks();
    redis = new MockRedis();
  });

  // --------------------------------------------------------------------------
  // findConfig
  // --------------------------------------------------------------------------

  describe("findConfig rule matching", () => {
    it("returns matching rule config when URL starts with rule path", async () => {
      const rl = new RateLimit(redis as any, { windowMs: 60000, maxRequests: 100 });
      rl.addRule("/api/auth", { windowMs: 60000, maxRequests: 3 });

      // Uses /api/auth/login → should match /api/auth rule
      const config = (rl as any).findConfig("/api/auth/login");
      expect(config.maxRequests).toBe(3);
    });

    it("returns first matching rule when multiple rules match", async () => {
      const rl = new RateLimit(redis as any, { windowMs: 60000, maxRequests: 100 });
      rl.addRule("/api", { windowMs: 60000, maxRequests: 50 });
      rl.addRule("/api/auth", { windowMs: 60000, maxRequests: 3 });

      // /api/auth/login matches both, first rule wins
      const config = (rl as any).findConfig("/api/auth/login");
      expect(config.maxRequests).toBe(50);
    });

    it("returns default config when no rules match", async () => {
      const rl = new RateLimit(redis as any, { windowMs: 60000, maxRequests: 100 });
      rl.addRule("/api/auth", { windowMs: 60000, maxRequests: 3 });

      const config = (rl as any).findConfig("/other/path");
      expect(config.maxRequests).toBe(100);
    });

    it("does not match if URL does not start with path", async () => {
      const rl = new RateLimit(redis as any, { windowMs: 60000, maxRequests: 100 });
      rl.addRule("/api/auth", { windowMs: 60000, maxRequests: 3 });

      const config = (rl as any).findConfig("/other/api/auth");
      expect(config.maxRequests).toBe(100);
    });
  });

  // --------------------------------------------------------------------------
  // getClientKey
  // --------------------------------------------------------------------------

  describe("getClientKey edge cases", () => {
    it("prefers x-forwarded-for over socket.remoteAddress", () => {
      const rl = new RateLimit(redis as any, RateLimitConfigs.STANDARD);
      const req = makeReq("/api/test", {
        headers: { "x-forwarded-for": "203.0.113.1" },
        socket: { remoteAddress: "10.0.0.1" } as any,
      });
      const key = (rl as any).getClientKey(req);
      expect(key).toContain("203.0.113.1");
      expect(key).not.toContain("10.0.0.1");
    });

    it("handles x-forwarded-for with multiple comma-separated IPs", () => {
      const rl = new RateLimit(redis as any, RateLimitConfigs.STANDARD);
      const req = makeReq("/api/test", {
        headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3" },
      });
      const key = (rl as any).getClientKey(req);
      expect(key).toContain("1.1.1.1");
      expect(key).not.toContain("2.2.2.2");
    });

    it("includes URL in key for path-specific rate limiting", () => {
      const rl = new RateLimit(redis as any, RateLimitConfigs.STANDARD);
      const req = makeReq("/api/specific");
      const key = (rl as any).getClientKey(req);
      expect(key).toContain("/api/specific");
    });

    it("handles array IP value", () => {
      const rl = new RateLimit(redis as any, RateLimitConfigs.STANDARD);
      const req = makeReq("/api/test", {
        headers: { "x-forwarded-for": ["5.5.5.5", "6.6.6.6"] as any },
      });
      const key = (rl as any).getClientKey(req);
      expect(key).toContain("5.5.5.5");
    });
  });

  // --------------------------------------------------------------------------
  // checkRateLimit — boundary conditions
  // --------------------------------------------------------------------------

  describe("checkRateLimit boundaries", () => {
    it("allows request at maxRequests - 1 count with remaining 1", async () => {
      const rl = new RateLimit(redis as any, { windowMs: 60000, maxRequests: 3 });
      const req = makeReq("/api/test");

      // First and second request (currentCount is pre-add via zcard)
      await rl.checkRateLimit(req);
      const result = await rl.checkRateLimit(req);

      // zcard returns count before add: 1, so remaining = 3 - 1 - 1 = 1
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1);
    });

    it("rejects request at exactly maxRequests count (>= boundary)", async () => {
      const rl = new RateLimit(redis as any, { windowMs: 60000, maxRequests: 2 });
      const req = makeReq("/api/test");

      // Fill up to maxRequests
      await rl.checkRateLimit(req);
      await rl.checkRateLimit(req);

      // This should be rejected because currentCount (2) >= maxRequests (2)
      const result = await rl.checkRateLimit(req);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it("remaining decreases by 1 each request", async () => {
      const rl = new RateLimit(redis as any, { windowMs: 60000, maxRequests: 5 });
      const req = makeReq("/api/test");

      const r1 = await rl.checkRateLimit(req);
      expect(r1.remaining).toBe(4); // 5 - 0 - 1 = 4

      const r2 = await rl.checkRateLimit(req);
      expect(r2.remaining).toBe(3); // 5 - 1 - 1 = 3
    });

    it("remaining is 0 when rejected", async () => {
      const rl = new RateLimit(redis as any, { windowMs: 60000, maxRequests: 1 });
      const req = makeReq("/api/test");

      await rl.checkRateLimit(req);
      const result = await rl.checkRateLimit(req);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it("resetTime is now + windowMs", async () => {
      const rl = new RateLimit(redis as any, { windowMs: 30000, maxRequests: 10 });
      const req = makeReq("/api/test");

      const before = Date.now();
      const result = await rl.checkRateLimit(req);
      const after = Date.now();

      expect(result.resetTime).toBeGreaterThanOrEqual(before + 30000);
      expect(result.resetTime).toBeLessThanOrEqual(after + 30000);
    });
  });

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------

  describe("error handling", () => {
    it("returns fail-open with full remaining on null pipeline", async () => {
      redis.setFailExec(true);
      const rl = new RateLimit(redis as any, { windowMs: 60000, maxRequests: 10 });
      const req = makeReq("/api/test");

      const result = await rl.checkRateLimit(req);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(10);
    });

    it("returns fail-open on Redis throw", async () => {
      redis.setThrow(true);
      const rl = new RateLimit(redis as any, { windowMs: 60000, maxRequests: 7 });
      const req = makeReq("/api/test");

      const result = await rl.checkRateLimit(req);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(7);
    });

    it("resetTime on error is in the future", async () => {
      redis.setThrow(true);
      const rl = new RateLimit(redis as any, { windowMs: 60000, maxRequests: 5 });
      const req = makeReq("/api/test");

      const before = Date.now();
      const result = await rl.checkRateLimit(req);
      expect(result.resetTime).toBeGreaterThanOrEqual(before + 60000);
    });
  });

  // --------------------------------------------------------------------------
  // RateLimitConfigs completeness
  // --------------------------------------------------------------------------

  describe("RateLimitConfigs values", () => {
    it("STANDARD: 100 req per 60s", () => {
      expect(RateLimitConfigs.STANDARD).toEqual({ windowMs: 60_000, maxRequests: 100 });
    });

    it("HEALTH: 120 req per 60s", () => {
      expect(RateLimitConfigs.HEALTH).toEqual({ windowMs: 60_000, maxRequests: 120 });
    });

    it("STRICT: 10 req per 60s", () => {
      expect(RateLimitConfigs.STRICT).toEqual({ windowMs: 60_000, maxRequests: 10 });
    });

    it("AUTH: 5 req per 900s", () => {
      expect(RateLimitConfigs.AUTH).toEqual({ windowMs: 900_000, maxRequests: 5 });
    });

    it("UPLOAD: 20 req per 300s", () => {
      expect(RateLimitConfigs.UPLOAD).toEqual({ windowMs: 300_000, maxRequests: 20 });
    });

    it("CRITICAL_EXPENSIVE: 5 req per 60s", () => {
      expect(RateLimitConfigs.CRITICAL_EXPENSIVE).toEqual({ windowMs: 60_000, maxRequests: 5 });
    });

    it("HEAVY_EXPENSIVE: 10 req per 60s", () => {
      expect(RateLimitConfigs.HEAVY_EXPENSIVE).toEqual({ windowMs: 60_000, maxRequests: 10 });
    });

    it("MODERATE_EXPENSIVE: 20 req per 60s", () => {
      expect(RateLimitConfigs.MODERATE_EXPENSIVE).toEqual({ windowMs: 60_000, maxRequests: 20 });
    });
  });

  // --------------------------------------------------------------------------
  // EXPENSIVE_ENDPOINT_RULES
  // --------------------------------------------------------------------------

  describe("EXPENSIVE_ENDPOINT_RULES", () => {
    it("has rules defined", () => {
      expect(EXPENSIVE_ENDPOINT_RULES.length).toBeGreaterThan(0);
    });

    it("includes critical analytics paths", () => {
      const criticalPaths = EXPENSIVE_ENDPOINT_RULES.filter(
        (r) => r.config === RateLimitConfigs.CRITICAL_EXPENSIVE
      );
      expect(criticalPaths.length).toBeGreaterThan(0);

      const paths = criticalPaths.map((r) => r.path);
      expect(paths).toContain("/analytics/cross-platform");
      expect(paths).toContain("/analytics/roi/calculate");
    });

    it("includes heavy search paths", () => {
      const heavyPaths = EXPENSIVE_ENDPOINT_RULES.filter(
        (r) => r.config === RateLimitConfigs.HEAVY_EXPENSIVE
      );
      const paths = heavyPaths.map((r) => r.path);
      expect(paths).toContain("/posts/search");
    });

    it("includes moderate analytics paths", () => {
      const moderatePaths = EXPENSIVE_ENDPOINT_RULES.filter(
        (r) => r.config === RateLimitConfigs.MODERATE_EXPENSIVE
      );
      expect(moderatePaths.length).toBeGreaterThan(0);
    });

    it("every rule has a path and config", () => {
      for (const rule of EXPENSIVE_ENDPOINT_RULES) {
        expect(rule.path).toBeTruthy();
        expect(rule.config).toBeTruthy();
        expect(rule.config.windowMs).toBeGreaterThan(0);
        expect(rule.config.maxRequests).toBeGreaterThan(0);
      }
    });
  });
});
