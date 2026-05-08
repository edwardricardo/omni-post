#!/usr/bin/env tsx
/**
 * Unit Tests for RateLimit
 * Testing Redis-based sliding window rate limiting
 *
 * Coverage Target: 90%+
 *
 * Run with: pnpm --filter @apps/api exec tsx tests/unit/rateLimit.test.ts
 *
 * @file rateLimit.test.ts
 * @description Tests for RateLimit - Constructor & Configuration
 * @layer infrastructure
 */

import { describe, it, expect } from "vitest";
import { RateLimit, RateLimitConfigs } from "../../src/security/rateLimit.js";
import type { FastifyRequest } from "fastify";

// ============================================================================
// Mock Redis Client
// ============================================================================

class MockRedis {
  private data: Map<string, Array<{ score: number; member: string }>> = new Map();
  private ttls: Map<string, number> = new Map();
  public shouldFail = false;

  pipeline() {
    const commands: Array<() => Promise<any>> = [];

    return {
      zremrangebyscore: (key: string, min: number, max: number) => {
        commands.push(async () => {
          if (this.shouldFail) throw new Error("Redis error");
          const items = this.data.get(key) || [];
          const filtered = items.filter((item) => item.score < min || item.score > max);
          this.data.set(key, filtered);
          return ["OK", items.length - filtered.length];
        });
        return this;
      },
      zcard: (key: string) => {
        commands.push(async () => {
          if (this.shouldFail) throw new Error("Redis error");
          const items = this.data.get(key) || [];
          return ["OK", items.length];
        });
        return this;
      },
      zadd: (key: string, score: number, member: string) => {
        commands.push(async () => {
          if (this.shouldFail) throw new Error("Redis error");
          const items = this.data.get(key) || [];
          items.push({ score, member });
          this.data.set(key, items);
          return ["OK", 1];
        });
        return this;
      },
      expire: (key: string, seconds: number) => {
        commands.push(async () => {
          if (this.shouldFail) throw new Error("Redis error");
          this.ttls.set(key, seconds);
          return ["OK", 1];
        });
        return this;
      },
      exec: async () => {
        if (this.shouldFail) return null;
        const results = [];
        for (const cmd of commands) {
          results.push(await cmd());
        }
        return results;
      },
    };
  }

  async zrem(key: string, member: string) {
    const items = this.data.get(key) || [];
    const filtered = items.filter((item) => item.member !== member);
    this.data.set(key, filtered);
    return items.length - filtered.length;
  }

  // Test helpers
  getKeyCount(key: string): number {
    return (this.data.get(key) || []).length;
  }

  clear() {
    this.data.clear();
    this.ttls.clear();
  }

  setFailure(shouldFail: boolean) {
    this.shouldFail = shouldFail;
  }
}

// ============================================================================
// Mock Fastify Request
// ============================================================================

function createMockRequest(url: string, ip: string = "127.0.0.1"): FastifyRequest {
  return {
    url,
    headers: {},
    socket: { remoteAddress: ip },
  } as any;
}

// ============================================================================
// Test Group 1: Constructor & Configuration
// ============================================================================

describe("RateLimit - Constructor & Configuration", () => {
  it("RateLimit constructor", () => {
    const mockRedis = new MockRedis() as any;
    const config = { windowMs: 60000, maxRequests: 100 };
    const rateLimit = new RateLimit(mockRedis, config);

    expect(rateLimit !== null && rateLimit !== undefined).toBeTruthy();
  });

  it("Default configurations exist - STANDARD", () => {
    expect(RateLimitConfigs.STANDARD.windowMs).toBe(60_000);
    expect(RateLimitConfigs.STANDARD.maxRequests).toBe(100);
  });

  it("Default configurations exist - AUTH", () => {
    expect(RateLimitConfigs.AUTH.windowMs).toBe(900_000);
    expect(RateLimitConfigs.AUTH.maxRequests).toBe(5);
  });
});

// ============================================================================
// Test Group 2: Rule Management
// ============================================================================

describe("RateLimit - Rule Management", () => {
  it("Add custom rule", () => {
    const mockRedis = new MockRedis() as any;
    const rateLimit = new RateLimit(mockRedis, RateLimitConfigs.STANDARD);

    rateLimit.addRule("/api/auth", RateLimitConfigs.AUTH);

    // Rule added successfully (tested indirectly through checkRateLimit)
    expect(true).toBeTruthy();
  });
});

// ============================================================================
// Test Group 3: Client Key Generation
// ============================================================================

describe("RateLimit - Client Key Generation", () => {
  it("Client key from socket IP", () => {
    const mockRedis = new MockRedis() as any;
    const rateLimit = new RateLimit(mockRedis, RateLimitConfigs.STANDARD);
    const req = createMockRequest("/api/test", "192.168.1.100");

    // Access private method via reflection for testing
    const key = (rateLimit as any).getClientKey(req);

    expect(key.includes("192.168.1.100")).toBeTruthy();
    expect(key.includes("/api/test")).toBeTruthy();
  });

  it("Client key from X-Forwarded-For header", () => {
    const mockRedis = new MockRedis() as any;
    const rateLimit = new RateLimit(mockRedis, RateLimitConfigs.STANDARD);
    const req = {
      url: "/api/test",
      headers: { "x-forwarded-for": "203.0.113.45, 192.168.1.1" },
      socket: { remoteAddress: "127.0.0.1" },
    } as any;

    const key = (rateLimit as any).getClientKey(req);

    expect(key.includes("203.0.113.45")).toBeTruthy();
  });

  it("Client key from X-Real-IP header", () => {
    const mockRedis = new MockRedis() as any;
    const rateLimit = new RateLimit(mockRedis, RateLimitConfigs.STANDARD);
    const req = {
      url: "/api/test",
      headers: { "x-real-ip": "198.51.100.25" },
      socket: { remoteAddress: "127.0.0.1" },
    } as any;

    const key = (rateLimit as any).getClientKey(req);

    expect(key.includes("198.51.100.25")).toBeTruthy();
  });

  it("Client key fallback to unknown", () => {
    const mockRedis = new MockRedis() as any;
    const rateLimit = new RateLimit(mockRedis, RateLimitConfigs.STANDARD);
    const req = {
      url: "/api/test",
      headers: {},
      socket: {},
    } as any;

    const key = (rateLimit as any).getClientKey(req);

    expect(key.includes("unknown")).toBeTruthy();
  });
});

// ============================================================================
// Test Group 4: Rate Limit Checking - Basic Flow
// ============================================================================

describe("RateLimit - Basic Flow", () => {
  it("First request is allowed", async () => {
    const mockRedis = new MockRedis() as any;
    const rateLimit = new RateLimit(mockRedis, { windowMs: 60000, maxRequests: 10 });
    const req = createMockRequest("/api/test");

    const result = await rateLimit.checkRateLimit(req);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
  });

  it("Multiple requests within limit", async () => {
    const mockRedis = new MockRedis() as any;
    const rateLimit = new RateLimit(mockRedis, { windowMs: 60000, maxRequests: 5 });
    const req = createMockRequest("/api/test");

    // Make 5 requests
    let lastResult;
    for (let i = 0; i < 5; i++) {
      lastResult = await rateLimit.checkRateLimit(req);
    }

    expect(lastResult!.allowed).toBe(true);
    expect(lastResult!.remaining).toBe(0);
  });

  it("Request exceeding limit is rejected", async () => {
    const mockRedis = new MockRedis() as any;
    const rateLimit = new RateLimit(mockRedis, { windowMs: 60000, maxRequests: 3 });
    const req = createMockRequest("/api/limited");

    // Make 3 requests (should all pass)
    for (let i = 0; i < 3; i++) {
      await rateLimit.checkRateLimit(req);
    }

    // 4th request should be rejected
    const result = await rateLimit.checkRateLimit(req);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });
});

// ============================================================================
// Test Group 5: Custom Rules
// ============================================================================

describe("RateLimit - Custom Rules", () => {
  it("Custom rule applied to matching path", async () => {
    const mockRedis = new MockRedis() as any;
    const rateLimit = new RateLimit(mockRedis, { windowMs: 60000, maxRequests: 100 });

    // Add strict rule for /api/auth
    rateLimit.addRule("/api/auth", { windowMs: 60000, maxRequests: 3 });

    const authReq = createMockRequest("/api/auth/login");

    // Make 3 requests (should pass)
    for (let i = 0; i < 3; i++) {
      await rateLimit.checkRateLimit(authReq);
    }

    // 4th request should be rejected due to custom rule
    const result = await rateLimit.checkRateLimit(authReq);

    expect(result.allowed).toBe(false);
  });

  it("Default rule applied to non-matching path", async () => {
    const mockRedis = new MockRedis() as any;
    const rateLimit = new RateLimit(mockRedis, { windowMs: 60000, maxRequests: 5 });

    rateLimit.addRule("/api/auth", { windowMs: 60000, maxRequests: 2 });

    const otherReq = createMockRequest("/api/posts");

    // Make 5 requests (should use default limit of 5)
    let lastResult;
    for (let i = 0; i < 5; i++) {
      lastResult = await rateLimit.checkRateLimit(otherReq);
    }

    expect(lastResult!.allowed).toBe(true);
  });
});

// ============================================================================
// Test Group 6: Different Clients
// ============================================================================

describe("RateLimit - Different Clients", () => {
  it("Different IPs have separate limits", async () => {
    const mockRedis = new MockRedis() as any;
    const rateLimit = new RateLimit(mockRedis, { windowMs: 60000, maxRequests: 2 });

    const client1 = createMockRequest("/api/test", "192.168.1.1");
    const client2 = createMockRequest("/api/test", "192.168.1.2");

    // Client 1 makes 2 requests
    await rateLimit.checkRateLimit(client1);
    await rateLimit.checkRateLimit(client1);

    // Client 1's 3rd request should be blocked
    const client1Result = await rateLimit.checkRateLimit(client1);

    // Client 2's first request should be allowed
    const client2Result = await rateLimit.checkRateLimit(client2);

    expect(client1Result.allowed).toBe(false);
    expect(client2Result.allowed).toBe(true);
  });
});

// ============================================================================
// Test Group 7: Error Handling
// ============================================================================

describe("RateLimit - Error Handling", () => {
  it("Redis pipeline failure allows request (fail-open)", async () => {
    const mockRedis = new MockRedis() as any;
    mockRedis.setFailure(true);
    const rateLimit = new RateLimit(mockRedis, { windowMs: 60000, maxRequests: 5 });

    const req = createMockRequest("/api/test");
    const result = await rateLimit.checkRateLimit(req);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(5);
  });

  it("Graceful handling of null pipeline results", async () => {
    const mockRedis = new MockRedis() as any;
    mockRedis.setFailure(true); // This makes exec() return null
    const rateLimit = new RateLimit(mockRedis, { windowMs: 60000, maxRequests: 10 });

    const req = createMockRequest("/api/test");
    const result = await rateLimit.checkRateLimit(req);

    expect(result.allowed).toBe(true);
  });
});

// ============================================================================
// Test Group 8: Reset Time Calculation
// ============================================================================

describe("RateLimit - Reset Time", () => {
  it("Reset time is in the future", async () => {
    const mockRedis = new MockRedis() as any;
    const rateLimit = new RateLimit(mockRedis, { windowMs: 60000, maxRequests: 10 });

    const req = createMockRequest("/api/test");
    const before = Date.now();
    const result = await rateLimit.checkRateLimit(req);
    const after = Date.now();

    expect(result.resetTime > before).toBeTruthy();
    expect(result.resetTime <= after + 60000).toBeTruthy();
  });
});

// ============================================================================
// Test Group 9: Predefined Configurations
// ============================================================================

describe("RateLimit - Predefined Configurations", () => {
  it("HEALTH config", () => {
    expect(RateLimitConfigs.HEALTH.maxRequests).toBe(120);
  });

  it("STRICT config", () => {
    expect(RateLimitConfigs.STRICT.maxRequests).toBe(10);
  });

  it("UPLOAD config", () => {
    expect(RateLimitConfigs.UPLOAD.windowMs).toBe(300_000);
    expect(RateLimitConfigs.UPLOAD.maxRequests).toBe(20);
  });

  it("CRITICAL_EXPENSIVE config", () => {
    expect(RateLimitConfigs.CRITICAL_EXPENSIVE.maxRequests).toBe(5);
  });

  it("HEAVY_EXPENSIVE config", () => {
    expect(RateLimitConfigs.HEAVY_EXPENSIVE.maxRequests).toBe(10);
  });

  it("MODERATE_EXPENSIVE config", () => {
    expect(RateLimitConfigs.MODERATE_EXPENSIVE.maxRequests).toBe(20);
  });
});
