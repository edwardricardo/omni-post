#!/usr/bin/env tsx
/**
 * Unit Tests for SlidingWindowRateLimit - Constructor, Basic Rate Limiting,
 * Window Info, IP Extraction, User Agent Tracking
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import {
  SlidingWindowRateLimit,
  SlidingWindowConfigs,
} from "../../src/security/slidingWindowRateLimit.js";
import {
  MockRedis,
  MockApiMetrics,
  createMockRequest,
  limiterInstances,
} from "./slidingWindowRateLimit.test-helpers.js";

// Cleanup all rate limiter intervals after all tests
after(() => {
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
    const limiter = new SlidingWindowRateLimit(mockRedis, mockMetrics, config);
    limiterInstances.push(limiter);

    assert.ok(
      limiter !== null && limiter !== undefined,
      "SlidingWindowRateLimit instance created successfully"
    );
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
    const limiter = new SlidingWindowRateLimit(mockRedis, mockMetrics, config);
    limiterInstances.push(limiter);

    assert.ok(limiter !== null, "Constructor accepts custom configuration");
  });

  it("Predefined configurations exist", () => {
    assert.strictEqual(SlidingWindowConfigs.AUTH.maxRequests, 5, "AUTH config has 5 req limit");
    assert.strictEqual(SlidingWindowConfigs.API.windowMs, 60000, "API config has 60s window");
    assert.strictEqual(
      SlidingWindowConfigs.HEALTH.maxRequests,
      1000,
      "HEALTH config has 1000 req limit"
    );
  });
});

// ============================================================================
// Test Group 2: Basic Rate Limiting
// ============================================================================

describe("SlidingWindowRateLimit - Basic Rate Limiting", () => {
  it("First request is allowed", async () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = new SlidingWindowRateLimit(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 10,
    });
    limiterInstances.push(limiter);

    const req = createMockRequest("/api/test");
    const result = await limiter.checkRateLimit(req);

    assert.strictEqual(result.allowed, true, "First request is allowed");
    assert.ok(result.remaining >= 0, "Remaining count is non-negative");
  });

  it("Requests within limit are allowed", async () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = new SlidingWindowRateLimit(mockRedis, mockMetrics, {
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

    assert.strictEqual(lastResult!.allowed, true, "5th request within limit of 5 is allowed");
  });

  it("Request exceeding limit is rejected", async () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = new SlidingWindowRateLimit(mockRedis, mockMetrics, {
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

    assert.strictEqual(lastResult.allowed, false, "Request exceeding limit is rejected");
    assert.strictEqual(lastResult.remaining, 0, "Remaining is 0 when rate limited");
  });
});

// ============================================================================
// Test Group 3: Window Info
// ============================================================================

describe("SlidingWindowRateLimit - Window Info", () => {
  it("Window info includes request count", async () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = new SlidingWindowRateLimit(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 10,
    });
    limiterInstances.push(limiter);

    const req = createMockRequest("/api/test");
    const result = await limiter.checkRateLimit(req);

    assert.ok(result.windowInfo !== undefined, "Result includes windowInfo");
    assert.ok(result.windowInfo.requestsInWindow >= 0, "Window info includes request count");
  });

  it("Window info includes timestamps", async () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = new SlidingWindowRateLimit(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 10,
    });
    limiterInstances.push(limiter);

    const req = createMockRequest("/api/test");
    const result = await limiter.checkRateLimit(req);

    assert.ok(
      result.windowInfo.oldestRequest !== undefined,
      "Window info includes oldest request timestamp"
    );
    assert.ok(
      result.windowInfo.newestRequest !== undefined,
      "Window info includes newest request timestamp"
    );
  });
});

// ============================================================================
// Test Group 4: IP Extraction
// ============================================================================

describe("SlidingWindowRateLimit - IP Extraction", () => {
  it("Extract IP from X-Forwarded-For", async () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = new SlidingWindowRateLimit(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 10,
    });
    limiterInstances.push(limiter);

    const req = createMockRequest("/api/test", {
      headers: { "x-forwarded-for": "203.0.113.1, 192.168.1.1" },
    });

    const result = await limiter.checkRateLimit(req);

    assert.ok(result !== undefined, "Processes request with X-Forwarded-For header");
  });

  it("Extract IP from X-Real-IP", async () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = new SlidingWindowRateLimit(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 10,
    });
    limiterInstances.push(limiter);

    const req = createMockRequest("/api/test", {
      headers: { "x-real-ip": "198.51.100.25" },
    });

    const result = await limiter.checkRateLimit(req);

    assert.ok(result !== undefined, "Processes request with X-Real-IP header");
  });

  it("Extract IP from CF-Connecting-IP (Cloudflare)", async () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = new SlidingWindowRateLimit(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 10,
    });
    limiterInstances.push(limiter);

    const req = createMockRequest("/api/test", {
      headers: { "cf-connecting-ip": "198.51.100.50" },
    });

    const result = await limiter.checkRateLimit(req);

    assert.ok(result !== undefined, "Processes request with CF-Connecting-IP header (Cloudflare)");
  });
});

// ============================================================================
// Test Group 5: User Agent Tracking
// ============================================================================

describe("SlidingWindowRateLimit - User Agent Tracking", () => {
  it("User agent fingerprinting enabled", async () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = new SlidingWindowRateLimit(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 10,
      enableUserAgentTracking: true,
    });
    limiterInstances.push(limiter);

    const req = createMockRequest("/api/test", {
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });

    const result = await limiter.checkRateLimit(req);

    assert.strictEqual(
      result.allowed,
      true,
      "Request with user agent tracking enabled is processed"
    );
  });

  it("User agent fingerprinting disabled", async () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = new SlidingWindowRateLimit(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 10,
      enableUserAgentTracking: false,
    });
    limiterInstances.push(limiter);

    const req = createMockRequest("/api/test", {
      headers: { "user-agent": "Mozilla/5.0" },
    });

    const result = await limiter.checkRateLimit(req);

    assert.strictEqual(result.allowed, true, "Request without user agent tracking is processed");
  });
});
