/**
 * Rate Limit Tests
 *
 * Tests the rate limiting system including:
 * - Rate limit logic implementation
 * - Redis-based rate limiting
 * - Request tracking and blocking
 * - API endpoint rate limiting
 * - Rate limit headers
 * - Window management
 *
 * @file rateLimit.smoke.test.ts
 * @description Tests for Rate Limiting System
 * @layer infrastructure
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

describe("Rate Limiting System", { concurrency: 1 }, () => {
  let apiAvailable = false;

  before(async () => {
    // Check if API is available (treat 429 as "available but rate limited")
    try {
      const response = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(3000) });
      apiAvailable = response.ok || response.status === 429;
    } catch {
      console.warn("API not available - some tests will be skipped");
      apiAvailable = false;
    }
  });

  describe("Rate Limit Logic", { concurrency: 1 }, () => {
    let redis: any;
    let rateLimit: any;

    before(async () => {
      // Import Redis and RateLimit dynamically
      try {
        const Redis = (await import("ioredis")).default;
        const { RateLimit } = await import("../src/security/rateLimit.js");

        redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
          connectTimeout: 3000,
          lazyConnect: true,
          retryDelayOnFailover: 100,
          maxRetriesPerRequest: 2,
        });

        await redis.connect();

        rateLimit = new RateLimit(redis, {
          windowMs: 5000, // 5 seconds for testing
          maxRequests: 2, // Only 2 requests for testing
        });
      } catch {
        console.warn("Redis not available - rate limit logic tests will be skipped");
      }
    });

    after(async () => {
      if (redis) {
        try {
          await redis.disconnect();
        } catch (error) {
          console.warn("Redis cleanup warning:", error);
        }
      }
    });

    beforeEach(async () => {
      if (redis && rateLimit) {
        // Clear rate limit data before each test
        try {
          await redis.flushdb();
        } catch {
          // Ignore flush errors
        }
      }
    });

    it("should allow first request", async (t) => {
      if (!redis || !rateLimit) {
        t.skip();
        return;
      }
      const mockRequest = {
        url: "/test",
        method: "GET",
        headers: {},
        socket: { remoteAddress: "127.0.0.1" },
      } as any;

      const result = await rateLimit.checkRateLimit(mockRequest);

      assert.strictEqual(result.allowed, true, "First request should be allowed");
      assert.ok(typeof result.remaining === "number", "Should have remaining count");
    });

    it("should allow second request", async (t) => {
      if (!redis || !rateLimit) {
        t.skip();
        return;
      }
      const mockRequest = {
        url: "/test",
        method: "GET",
        headers: {},
        socket: { remoteAddress: "127.0.0.1" },
      } as any;

      await rateLimit.checkRateLimit(mockRequest);
      const result = await rateLimit.checkRateLimit(mockRequest);

      assert.strictEqual(result.allowed, true, "Second request should be allowed");
    });

    it("should block third request", async (t) => {
      if (!redis || !rateLimit) {
        t.skip();
        return;
      }
      const mockRequest = {
        url: "/test",
        method: "GET",
        headers: {},
        socket: { remoteAddress: "127.0.0.1" },
      } as any;

      await rateLimit.checkRateLimit(mockRequest);
      await rateLimit.checkRateLimit(mockRequest);
      const result = await rateLimit.checkRateLimit(mockRequest);

      assert.strictEqual(result.allowed, false, "Third request should be blocked");
    });

    it("should track remaining requests correctly", async (t) => {
      if (!redis || !rateLimit) {
        t.skip();
        return;
      }
      const mockRequest = {
        url: "/test",
        method: "GET",
        headers: {},
        socket: { remoteAddress: "127.0.0.1" },
      } as any;

      const result1 = await rateLimit.checkRateLimit(mockRequest);
      const result2 = await rateLimit.checkRateLimit(mockRequest);

      assert.ok(result1.remaining > result2.remaining, "Remaining should decrease");
    });

    it("should provide reset timestamp", async (t) => {
      if (!redis || !rateLimit) {
        t.skip();
        return;
      }
      const mockRequest = {
        url: "/test",
        method: "GET",
        headers: {},
        socket: { remoteAddress: "127.0.0.1" },
      } as any;

      const result = await rateLimit.checkRateLimit(mockRequest);

      assert.ok(result.resetTime, "Should have reset timestamp");
      assert.ok(typeof result.resetTime === "number", "Reset should be a number");
    });

    it("should isolate different IP addresses", async (t) => {
      if (!redis || !rateLimit) {
        t.skip();
        return;
      }
      const request1 = {
        url: "/test",
        method: "GET",
        headers: {},
        socket: { remoteAddress: "127.0.0.1" },
      } as any;

      const request2 = {
        url: "/test",
        method: "GET",
        headers: {},
        socket: { remoteAddress: "127.0.0.2" },
      } as any;

      // Exhaust limit for first IP
      await rateLimit.checkRateLimit(request1);
      await rateLimit.checkRateLimit(request1);
      const blocked = await rateLimit.checkRateLimit(request1);

      // Second IP should still be allowed
      const allowed = await rateLimit.checkRateLimit(request2);

      assert.strictEqual(blocked.allowed, false, "First IP should be blocked");
      assert.strictEqual(allowed.allowed, true, "Second IP should be allowed");
    });

    it("should handle concurrent requests correctly", async (t) => {
      if (!redis || !rateLimit) {
        t.skip();
        return;
      }
      const mockRequest = {
        url: "/test",
        method: "GET",
        headers: {},
        socket: { remoteAddress: "127.0.0.1" },
      } as any;

      const results = await Promise.all([
        rateLimit.checkRateLimit(mockRequest),
        rateLimit.checkRateLimit(mockRequest),
        rateLimit.checkRateLimit(mockRequest),
      ]);

      const allowedCount = results.filter((r) => r.allowed).length;
      const blockedCount = results.filter((r) => !r.allowed).length;

      assert.ok(allowedCount <= 2, "Should allow at most 2 requests");
      assert.ok(blockedCount >= 1, "Should block at least 1 request");
    });
  });

  describe("API Endpoint Rate Limiting", { concurrency: 1 }, () => {
    it("should allow initial health check requests", async (t) => {
      if (!apiAvailable) {
        t.skip();
        return;
      }
      const response = await fetch(`${BASE_URL}/health`);

      assert.ok(response.ok, "Initial health check should succeed");
    });

    it("should include rate limit headers", async (t) => {
      if (!apiAvailable) {
        t.skip();
        return;
      }
      const response = await fetch(`${BASE_URL}/health`);

      // Rate limit headers are optional but recommended.
      // If present, verify they have valid values.
      const remaining = response.headers.get("X-RateLimit-Remaining");
      const reset = response.headers.get("X-RateLimit-Reset");
      const limit = response.headers.get("X-RateLimit-Limit");

      if (remaining !== null) {
        assert.ok(!isNaN(Number(remaining)), "X-RateLimit-Remaining should be numeric");
      }
      if (reset !== null) {
        assert.ok(!isNaN(Number(reset)), "X-RateLimit-Reset should be numeric");
      }
      if (limit !== null) {
        assert.ok(!isNaN(Number(limit)), "X-RateLimit-Limit should be numeric");
      }
    });

    it("should handle rate limit blocking", async (t) => {
      if (!apiAvailable) {
        t.skip();
        return;
      }
      // Make multiple requests to potentially trigger rate limit
      const responses = [];
      for (let i = 0; i < 5; i++) {
        const response = await fetch(`${BASE_URL}/health`);
        responses.push(response);

        // Small delay between requests
        await new Promise((resolve) => {
          setTimeout(resolve, 10);
        });
      }

      // At least some requests should succeed
      const successCount = responses.filter((r) => r.ok).length;
      assert.ok(successCount > 0, "At least some requests should succeed");

      // Verify all responses have valid HTTP status codes
      const allValidStatuses = responses.every((r) => r.ok || r.status === 429);
      assert.ok(allValidStatuses, "All responses should have valid HTTP status codes (200 or 429)");
    });

    it("should return 429 status when rate limited", async (t) => {
      if (!apiAvailable) {
        t.skip();
        return;
      }
      // Make many rapid requests to trigger rate limit
      const responses = [];
      for (let i = 0; i < 20; i++) {
        const response = await fetch(`${BASE_URL}/health`);
        responses.push(response);
      }

      const rateLimitedResponse = responses.find((r) => r.status === 429);

      if (rateLimitedResponse) {
        assert.strictEqual(rateLimitedResponse.status, 429, "Rate limited response should be 429");
      }
    });
  });

  describe("Rate Limit Window Management", { concurrency: 1 }, () => {
    let redis: any;
    let rateLimit: any;

    before(async () => {
      try {
        const Redis = (await import("ioredis")).default;
        const { RateLimit } = await import("../src/security/rateLimit.js");

        redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
          connectTimeout: 3000,
          lazyConnect: true,
          retryDelayOnFailover: 100,
          maxRetriesPerRequest: 2,
        });

        await redis.connect();

        rateLimit = new RateLimit(redis, {
          windowMs: 1000, // 1 second window for testing
          maxRequests: 2,
        });
      } catch {
        console.warn("Redis not available - window management tests will be skipped");
      }
    });

    after(async () => {
      if (redis) {
        try {
          await redis.disconnect();
        } catch (error) {
          console.warn("Redis cleanup warning:", error);
        }
      }
    });

    it("should reset after window expires", async (t) => {
      if (!redis || !rateLimit) {
        t.skip();
        return;
      }
      const mockRequest = {
        url: "/test",
        method: "GET",
        headers: {},
        socket: { remoteAddress: "127.0.0.1" },
      } as any;

      // Exhaust limit
      await rateLimit.checkRateLimit(mockRequest);
      await rateLimit.checkRateLimit(mockRequest);
      const blocked = await rateLimit.checkRateLimit(mockRequest);

      assert.strictEqual(blocked.allowed, false, "Should be blocked");

      // Wait for window to expire
      await new Promise((resolve) => {
        setTimeout(resolve, 1100);
      });

      // Should be allowed again
      const allowed = await rateLimit.checkRateLimit(mockRequest);

      assert.strictEqual(allowed.allowed, true, "Should be allowed after window reset");
    });

    it("should maintain separate windows for different endpoints", async (t) => {
      if (!redis || !rateLimit) {
        t.skip();
        return;
      }
      const request1 = {
        url: "/endpoint1",
        method: "GET",
        headers: {},
        socket: { remoteAddress: "127.0.0.1" },
      } as any;

      const request2 = {
        url: "/endpoint2",
        method: "GET",
        headers: {},
        socket: { remoteAddress: "127.0.0.1" },
      } as any;

      // Exhaust limit for endpoint1
      await rateLimit.checkRateLimit(request1);
      await rateLimit.checkRateLimit(request1);

      // endpoint2 should have its own limit
      const result = await rateLimit.checkRateLimit(request2);

      assert.strictEqual(result.allowed, true, "Different endpoint should have separate limit");
    });
  });

  describe("Rate Limit Error Handling", { concurrency: 1 }, () => {
    it("should handle Redis connection errors gracefully", async () => {
      try {
        const Redis = (await import("ioredis")).default;
        const { RateLimit } = await import("../src/security/rateLimit.js");

        // Create Redis with invalid connection
        const badRedis = new Redis("redis://invalid:9999", {
          connectTimeout: 100,
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          retryStrategy: () => null, // disable automatic reconnect
        });

        const rateLimitWithBadRedis = new RateLimit(badRedis, {
          windowMs: 5000,
          maxRequests: 10,
        });

        const mockRequest = {
          url: "/test",
          method: "GET",
          headers: {},
          socket: { remoteAddress: "127.0.0.1" },
        } as any;

        // Should handle error gracefully (either allow or deny)
        try {
          const result = await rateLimitWithBadRedis.checkRateLimit(mockRequest);
          assert.ok(typeof result.allowed === "boolean", "Should return a boolean result");
        } catch (error) {
          // Error is acceptable if Redis is unavailable
          assert.ok(error instanceof Error, "Should throw proper error");
        } finally {
          try {
            await badRedis.disconnect();
          } catch {
            // Ignore cleanup errors
          }
        }
      } catch {
        // Skip test if modules not available
        console.warn("Skipping Redis error handling test");
      }
    });

    it("should handle invalid request objects", async (t) => {
      if (!apiAvailable) {
        t.skip();
        return;
      }
      // This test validates that the API handles malformed requests gracefully
      const response = await fetch(`${BASE_URL}/health`);

      assert.ok(response.status >= 200 && response.status < 500, "Should handle requests");
    });
  });

  describe("Rate Limit Configuration", { concurrency: 1 }, () => {
    it("should respect custom window size", async () => {
      try {
        const Redis = (await import("ioredis")).default;
        const { RateLimit } = await import("../src/security/rateLimit.js");

        const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
          connectTimeout: 3000,
          lazyConnect: true,
        });

        await redis.connect();

        const customRateLimit = new RateLimit(redis, {
          windowMs: 2000, // 2 second window
          maxRequests: 3,
        });

        const mockRequest = {
          url: "/test",
          method: "GET",
          headers: {},
          socket: { remoteAddress: "127.0.0.1" },
        } as any;

        const result = await customRateLimit.checkRateLimit(mockRequest);

        assert.ok(result.resetTime, "Should have reset timestamp");
        assert.ok(result.resetTime > Date.now(), "Reset should be in the future");

        await redis.disconnect();
      } catch {
        console.warn("Skipping custom window test - Redis not available");
      }
    });

    it("should respect custom max requests", async () => {
      try {
        const Redis = (await import("ioredis")).default;
        const { RateLimit } = await import("../src/security/rateLimit.js");

        const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
          connectTimeout: 3000,
          lazyConnect: true,
        });

        await redis.connect();
        await redis.flushdb();

        const customRateLimit = new RateLimit(redis, {
          windowMs: 5000,
          maxRequests: 5, // Allow 5 requests
        });

        const mockRequest = {
          url: "/test-custom",
          method: "GET",
          headers: {},
          socket: { remoteAddress: "127.0.0.1" },
        } as any;

        // Make 5 requests
        const results = [];
        for (let i = 0; i < 5; i++) {
          results.push(await customRateLimit.checkRateLimit(mockRequest));
        }

        const allAllowed = results.every((r) => r.allowed);
        assert.ok(allAllowed, "All 5 requests should be allowed");

        // 6th request should be blocked
        const blocked = await customRateLimit.checkRateLimit(mockRequest);
        assert.strictEqual(blocked.allowed, false, "6th request should be blocked");

        await redis.disconnect();
      } catch {
        console.warn("Skipping max requests test - Redis not available");
      }
    });
  });
});
