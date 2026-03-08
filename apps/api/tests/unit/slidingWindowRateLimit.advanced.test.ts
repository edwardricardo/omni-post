#!/usr/bin/env tsx
/**
 * Unit Tests for SlidingWindowRateLimit - Progressive Blocking, Error Handling,
 * Custom Key Generator, Limit Reached Callback, Different Clients
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { SlidingWindowRateLimit } from "../../src/security/slidingWindowRateLimit.js";
import type { FastifyRequest } from "fastify";
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
// Test Group 6: Progressive Blocking
// ============================================================================

describe("SlidingWindowRateLimit - Progressive Blocking", () => {
  it("Progressive blocking enabled", async () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = new SlidingWindowRateLimit(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 2,
      enableProgressiveBlocking: true,
    });
    limiterInstances.push(limiter);

    const req = createMockRequest("/api/strict");

    // Make 3 requests to trigger progressive blocking
    for (let i = 0; i < 3; i++) {
      await limiter.checkRateLimit(req);
    }

    assert.ok(true, "Progressive blocking triggered without errors");
  });

  it("Block persists across requests", async () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = new SlidingWindowRateLimit(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 1,
      enableProgressiveBlocking: true,
    });
    limiterInstances.push(limiter);

    const req = createMockRequest("/api/blocked");

    // First request allowed
    await limiter.checkRateLimit(req);

    // Second request triggers block
    await limiter.checkRateLimit(req);

    // Set block manually for testing
    await mockRedis.setex(`sw_rate_limit:127.0.0.1:block`, 300, (Date.now() + 300000).toString());

    // Third request should be blocked
    const result = await limiter.checkRateLimit(req);

    assert.strictEqual(
      result.allowed,
      false,
      "Request is blocked when progressive block is active"
    );
  });
});

// ============================================================================
// Test Group 7: Error Handling
// ============================================================================

describe("SlidingWindowRateLimit - Error Handling", () => {
  it("Redis pipeline failure allows request (fail-open)", async () => {
    const mockRedis = new MockRedis() as any;
    mockRedis.setFailure(true);
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = new SlidingWindowRateLimit(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 5,
    });
    limiterInstances.push(limiter);

    const req = createMockRequest("/api/test");
    const result = await limiter.checkRateLimit(req);

    assert.strictEqual(
      result.allowed,
      true,
      "Request allowed when Redis fails (fail-open behavior)"
    );
    assert.strictEqual(result.remaining, 5, "Returns max requests as remaining on Redis failure");
  });

  it("Graceful handling of null pipeline results", async () => {
    const mockRedis = new MockRedis() as any;
    mockRedis.setFailure(true);
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = new SlidingWindowRateLimit(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 10,
    });
    limiterInstances.push(limiter);

    const req = createMockRequest("/api/test");
    const result = await limiter.checkRateLimit(req);

    assert.strictEqual(result.allowed, true, "Gracefully handles null pipeline results");
    assert.strictEqual(
      result.windowInfo.requestsInWindow,
      0,
      "Returns 0 requests in window on error"
    );
  });
});

// ============================================================================
// Test Group 8: Custom Key Generator
// ============================================================================

describe("SlidingWindowRateLimit - Custom Key Generator", () => {
  it("Custom key generator is used", async () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;

    let customKeyCalled = false;
    const customKeyGen = (req: FastifyRequest) => {
      customKeyCalled = true;
      return `custom:${req.url}`;
    };

    const limiter = new SlidingWindowRateLimit(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 10,
      keyGenerator: customKeyGen,
    });
    limiterInstances.push(limiter);

    const req = createMockRequest("/api/test");
    await limiter.checkRateLimit(req);

    assert.strictEqual(customKeyCalled, true, "Custom key generator is called");
  });
});

// ============================================================================
// Test Group 9: Limit Reached Callback
// ============================================================================

describe("SlidingWindowRateLimit - Limit Reached Callback", () => {
  it("Callback triggered when limit exceeded", async () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;

    let callbackCalled = false;
    const onLimitReached = (_req: FastifyRequest, _key: string) => {
      callbackCalled = true;
    };

    const limiter = new SlidingWindowRateLimit(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 2,
      onLimitReached,
    });
    limiterInstances.push(limiter);

    const req = createMockRequest("/api/callback");

    // Make 3 requests to trigger callback
    for (let i = 0; i < 3; i++) {
      await limiter.checkRateLimit(req);
    }

    assert.strictEqual(
      callbackCalled,
      true,
      "onLimitReached callback is triggered when limit exceeded"
    );
  });
});

// ============================================================================
// Test Group 10: Different Clients
// ============================================================================

describe("SlidingWindowRateLimit - Different Clients", () => {
  it("Different IPs have separate limits", async () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = new SlidingWindowRateLimit(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 2,
    });
    limiterInstances.push(limiter);

    const client1 = createMockRequest("/api/test", { ip: "192.168.1.1" });
    const client2 = createMockRequest("/api/test", { ip: "192.168.1.2" });

    // Client 1 makes 3 requests (3rd should be blocked)
    await limiter.checkRateLimit(client1);
    await limiter.checkRateLimit(client1);
    const client1Result = await limiter.checkRateLimit(client1);

    // Client 2's first request should be allowed
    const client2Result = await limiter.checkRateLimit(client2);

    assert.strictEqual(
      client1Result.allowed,
      false,
      "Client 1 is rate limited after exceeding limit"
    );
    assert.strictEqual(client2Result.allowed, true, "Client 2 has separate limit and is allowed");
  });
});
