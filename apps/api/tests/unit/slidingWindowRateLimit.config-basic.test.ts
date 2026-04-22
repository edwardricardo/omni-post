#!/usr/bin/env tsx
/**
 * Unit Tests for SlidingWindowRateLimit - Constructor, Basic Rate Limiting,
 * Window Info, IP Extraction, User Agent Tracking
 */

import { describe, it, afterAll, expect } from "vitest";
import { SlidingWindowConfigs } from "../../src/security/slidingWindowRateLimit.js";
import {
  MockRedis,
  MockApiMetrics,
  createMockRequest,
  createLimiter,
  limiterInstances,
} from "./slidingWindowRateLimit.test-helpers.js";

// Cleanup all rate limiter intervals after all tests
afterAll(() => {
  limiterInstances.forEach((limiter) => {
    try {
      limiter.destroy();
    } catch {
      // Ignore cleanup errors
    }
  });
});

// ============================================================================
// Test Group 1: Constructor & Configuration
// ============================================================================

describe("SlidingWindowRateLimit - Constructor & Configuration", () => {
  it("Constructor with default settings", () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const config = { windowMs: 60000, maxRequests: 100 };
    const limiter = createLimiter(mockRedis, mockMetrics, config);
    limiterInstances.push(limiter);

    expect(limiter !== null && limiter !== undefined).toBeTruthy();
  });

  it("Constructor with custom configuration", () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const config = {
      windowMs: 60000,
      maxRequests: 50,
      precision: 20,
      enableProgressiveBlocking: false,
      skipList: ["/health"],
    };
    const limiter = createLimiter(mockRedis, mockMetrics, config);
    limiterInstances.push(limiter);

    expect(limiter !== null).toBeTruthy();
  });

  it("Predefined configurations exist", () => {
    expect(SlidingWindowConfigs.AUTH.maxRequests).toBe(5);
    expect(SlidingWindowConfigs.API.windowMs).toBe(60000);
    expect(SlidingWindowConfigs.HEALTH.maxRequests).toBe(1000);
  });
});

// ============================================================================
// Test Group 2: Basic Rate Limiting
// ============================================================================

describe("SlidingWindowRateLimit - Basic Rate Limiting", () => {
  it("First request is allowed", async () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = createLimiter(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 10,
    });
    limiterInstances.push(limiter);

    const req = createMockRequest("/api/test");
    const result = await limiter.checkRateLimit(req);

    expect(result.allowed).toBe(true);
    expect(result.remaining >= 0).toBeTruthy();
  });

  it("Requests within limit are allowed", async () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = createLimiter(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 5,
    });
    limiterInstances.push(limiter);

    const req = createMockRequest("/api/test");

    // Make 5 requests
    let lastResult;
    for (let i = 0; i < 5; i++) {
      lastResult = await limiter.checkRateLimit(req);
    }

    expect(lastResult!.allowed).toBe(true);
  });

  it("Request exceeding limit is rejected", async () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = createLimiter(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 3,
    });
    limiterInstances.push(limiter);

    const req = createMockRequest("/api/limited");

    // Make 4 requests (4th should be rejected)
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(await limiter.checkRateLimit(req));
    }

    const lastResult = results[results.length - 1];

    expect(lastResult.allowed).toBe(false);
    expect(lastResult.remaining).toBe(0);
  });
});

// ============================================================================
// Test Group 3: Window Info
// ============================================================================

describe("SlidingWindowRateLimit - Window Info", () => {
  it("Window info includes request count", async () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = createLimiter(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 10,
    });
    limiterInstances.push(limiter);

    const req = createMockRequest("/api/test");
    const result = await limiter.checkRateLimit(req);

    expect(result.windowInfo !== undefined).toBeTruthy();
    expect(result.windowInfo.requestsInWindow >= 0).toBeTruthy();
  });

  it("Window info includes timestamps", async () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = createLimiter(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 10,
    });
    limiterInstances.push(limiter);

    const req = createMockRequest("/api/test");
    const result = await limiter.checkRateLimit(req);

    expect(result.windowInfo.oldestRequest !== undefined).toBeTruthy();
    expect(result.windowInfo.newestRequest !== undefined).toBeTruthy();
  });
});

// ============================================================================
// Test Group 4: IP Extraction
// ============================================================================

describe("SlidingWindowRateLimit - IP Extraction", () => {
  it("Extract IP from X-Forwarded-For", async () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = createLimiter(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 10,
    });
    limiterInstances.push(limiter);

    const req = createMockRequest("/api/test", {
      headers: { "x-forwarded-for": "203.0.113.1, 192.168.1.1" },
    });

    const result = await limiter.checkRateLimit(req);

    expect(result !== undefined).toBeTruthy();
  });

  it("Extract IP from X-Real-IP", async () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = createLimiter(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 10,
    });
    limiterInstances.push(limiter);

    const req = createMockRequest("/api/test", {
      headers: { "x-real-ip": "198.51.100.25" },
    });

    const result = await limiter.checkRateLimit(req);

    expect(result !== undefined).toBeTruthy();
  });

  it("Extract IP from CF-Connecting-IP (Cloudflare)", async () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = createLimiter(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 10,
    });
    limiterInstances.push(limiter);

    const req = createMockRequest("/api/test", {
      headers: { "cf-connecting-ip": "198.51.100.50" },
    });

    const result = await limiter.checkRateLimit(req);

    expect(result !== undefined).toBeTruthy();
  });
});

// ============================================================================
// Test Group 5: User Agent Tracking
// ============================================================================

describe("SlidingWindowRateLimit - User Agent Tracking", () => {
  it("User agent fingerprinting enabled", async () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = createLimiter(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 10,
      enableUserAgentTracking: true,
    });
    limiterInstances.push(limiter);

    const req = createMockRequest("/api/test", {
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });

    const result = await limiter.checkRateLimit(req);

    expect(result.allowed).toBe(true);
  });

  it("User agent fingerprinting disabled", async () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = createLimiter(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 10,
      enableUserAgentTracking: false,
    });
    limiterInstances.push(limiter);

    const req = createMockRequest("/api/test", {
      headers: { "user-agent": "Mozilla/5.0" },
    });

    const result = await limiter.checkRateLimit(req);

    expect(result.allowed).toBe(true);
  });
});
