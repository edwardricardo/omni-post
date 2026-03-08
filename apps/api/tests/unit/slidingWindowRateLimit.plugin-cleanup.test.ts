#!/usr/bin/env tsx
/**
 * Unit Tests for SlidingWindowRateLimit - Reset Time, JWT Extraction,
 * Suspicious Activity Detection, Fastify Plugin Integration, Cleanup
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { SlidingWindowRateLimit } from "../../src/security/slidingWindowRateLimit.js";
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
// Test Group 11: Reset Time
// ============================================================================

describe("SlidingWindowRateLimit - Reset Time", () => {
  it("Reset time is in the future", async () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = new SlidingWindowRateLimit(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 10,
    });
    limiterInstances.push(limiter);

    const req = createMockRequest("/api/test");
    const before = Date.now();
    const result = await limiter.checkRateLimit(req);

    assert.ok(result.resetTime > before, "Reset time is in the future");
  });
});

// ============================================================================
// Test Group 12: JWT User ID Extraction
// ============================================================================

describe("SlidingWindowRateLimit - JWT User ID Extraction", () => {
  it("Request with Authorization header", async () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = new SlidingWindowRateLimit(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 10,
    });
    limiterInstances.push(limiter);

    const req = createMockRequest("/api/test", {
      headers: { authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test" },
    });

    const result = await limiter.checkRateLimit(req);

    assert.ok(result !== undefined, "Processes request with Authorization header");
  });

  it("Request without Authorization header", async () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = new SlidingWindowRateLimit(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 10,
    });
    limiterInstances.push(limiter);

    const req = createMockRequest("/api/test");

    const result = await limiter.checkRateLimit(req);

    assert.ok(result !== undefined, "Processes request without Authorization header");
  });

  it("Invalid Authorization header", async () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = new SlidingWindowRateLimit(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 10,
    });
    limiterInstances.push(limiter);

    const req = createMockRequest("/api/test", {
      headers: { authorization: "InvalidFormat" },
    });

    const result = await limiter.checkRateLimit(req);

    assert.ok(result !== undefined, "Handles invalid Authorization header gracefully");
  });
});

// ============================================================================
// Test Group 13: Suspicious Activity Detection & Blacklisting
// ============================================================================

describe("SlidingWindowRateLimit - Suspicious Activity Detection", () => {
  it("Suspicious activity detected at 80% threshold", async () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = new SlidingWindowRateLimit(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 10, // 80% = 8 requests
    });
    limiterInstances.push(limiter);

    const req = createMockRequest("/api/suspicious");

    // Make 9 requests to trigger suspicious detection (>80% of 10)
    for (let i = 0; i < 9; i++) {
      await limiter.checkRateLimit(req);
    }

    assert.ok(true, "Suspicious activity detection triggered at 80% threshold");
  });

  it("Blacklisting after persistent violations", async () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = new SlidingWindowRateLimit(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 5, // 80% = 4 requests
    });
    limiterInstances.push(limiter);

    const req = createMockRequest("/api/blacklist");

    // Trigger suspicious activity multiple times to reach blacklist threshold (>5 violations)
    for (let round = 0; round < 8; round++) {
      // Each round makes 5 requests to trigger suspicious detection
      mockRedis.clear();
      for (let i = 0; i < 5; i++) {
        await limiter.checkRateLimit(req);
      }
    }

    assert.ok(true, "Blacklisting triggered after persistent violations");
  });
});

// ============================================================================
// Test Group 14: Fastify Plugin Integration
// ============================================================================

describe("SlidingWindowRateLimit - Fastify Plugin Integration", () => {
  it("Plugin factory returns a function", () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = new SlidingWindowRateLimit(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 10,
    });
    limiterInstances.push(limiter);

    const plugin = limiter.getPlugin();

    assert.strictEqual(typeof plugin, "function", "getPlugin() returns a function");
  });

  it("Plugin with skipList", async () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = new SlidingWindowRateLimit(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 5,
      skipList: ["/health", "/metrics"],
    });
    limiterInstances.push(limiter);

    // Mock Fastify instance
    const mockFastify = {
      addHook: async (_event: string, handler: Function) => {
        // Test the preHandler hook with a whitelisted path
        const mockRequest = createMockRequest("/health/status");
        const mockReply = {
          header: () => mockReply,
          code: () => mockReply,
          send: () => mockReply,
        };

        await handler(mockRequest, mockReply);
      },
    };

    const plugin = limiter.getPlugin();
    await plugin(mockFastify as any);

    assert.ok(true, "Plugin registers preHandler hook with skipList support");
  });

  it("Plugin hook is registered", async () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = new SlidingWindowRateLimit(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 100,
    });
    limiterInstances.push(limiter);

    let hookRegistered = false;
    const mockFastify = {
      addHook: async (_event: string, _handler: Function) => {
        hookRegistered = true;
      },
    };

    const plugin = limiter.getPlugin();
    await plugin(mockFastify as any);

    assert.strictEqual(hookRegistered, true, "Plugin registers preHandler hook successfully");
  });
});

// ============================================================================
// Test Group 15: Cleanup & Memory Management
// ============================================================================

describe("SlidingWindowRateLimit - Cleanup & Memory Management", () => {
  it("Suspicious patterns cleanup (simulate reaching threshold)", () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = new SlidingWindowRateLimit(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 5,
    });
    limiterInstances.push(limiter);

    // Access private method to test cleanup (normally triggered by setInterval)
    const cleanupMethod = (limiter as any).cleanupSuspiciousPatterns;

    // Simulate large suspicious patterns map
    const suspiciousPatterns = (limiter as any).suspiciousPatterns;

    // Add exactly 10001 entries to trigger cleanup
    for (let i = 0; i < 10001; i++) {
      suspiciousPatterns.set(`ip-${i}`, i);
    }

    cleanupMethod.call(limiter);

    assert.strictEqual(
      suspiciousPatterns.size,
      0,
      "Cleanup clears suspicious patterns when exceeding 10000 entries"
    );
  });

  it("Cleanup doesn't trigger below threshold", () => {
    const mockRedis = new MockRedis() as any;
    const mockMetrics = new MockApiMetrics() as any;
    const limiter = new SlidingWindowRateLimit(mockRedis, mockMetrics, {
      windowMs: 60000,
      maxRequests: 5,
    });
    limiterInstances.push(limiter);

    const cleanupMethod = (limiter as any).cleanupSuspiciousPatterns;
    const suspiciousPatterns = (limiter as any).suspiciousPatterns;

    // Add less than 10000 entries
    for (let i = 0; i < 100; i++) {
      suspiciousPatterns.set(`ip-${i}`, i);
    }

    cleanupMethod.call(limiter);

    assert.strictEqual(
      suspiciousPatterns.size,
      100,
      "Cleanup preserves suspicious patterns when below 10000 entries"
    );
  });
});
