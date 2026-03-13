#!/usr/bin/env tsx
/**
 * Unit Tests for advancedRateLimit
 * Testing advanced rate limiting with Redis-backed sliding window algorithm
 *
 * Coverage Target: 95%+
 */

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { AdvancedRateLimit, RateLimitConfigs } from "../../src/security/advancedRateLimit.js";
import { ApiMetrics } from "../../src/metrics/apiMetrics.js";
import * as promClient from "prom-client";
import Redis from "ioredis";
import type { FastifyRequest } from "fastify";

// ============================================================================
// Test Utilities
// ============================================================================

// Mock Fastify Request
function createMockRequest(overrides?: Partial<FastifyRequest>): FastifyRequest {
  return {
    id: `req-${Date.now()}-${Math.random()}`,
    method: "GET",
    url: "/api/test",
    headers: {
      "user-agent": "Mozilla/5.0 (Test Agent)",
    },
    routeOptions: { url: "/api/test" },
    ip: "192.168.1.100",
    socket: { remoteAddress: "192.168.1.100" },
    ...overrides,
  } as FastifyRequest;
}

// ============================================================================
// Test Setup
// ============================================================================

let redis: Redis;
let metricsRegistry: promClient.Registry;
let apiMetrics: ApiMetrics;
let rateLimiter: AdvancedRateLimit;

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// ============================================================================
// Main Test Suite
// ============================================================================

describe("AdvancedRateLimit Tests", () => {
  beforeAll(async () => {
    redis = new Redis(REDIS_URL);
    metricsRegistry = new promClient.Registry();
    apiMetrics = new ApiMetrics(metricsRegistry);

    // Wait for Redis connection
    await new Promise((resolve) => {
      if (redis.status === "ready") {
        resolve(true);
      } else {
        redis.once("ready", resolve);
      }
    });

    // Flush test keys before starting
    const keys = await redis.keys("rate_limit:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  afterAll(async () => {
    // Cleanup test keys
    const keys = await redis.keys("rate_limit:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }

    await redis.quit();
    metricsRegistry.clear();
  });

  // ============================================================================
  // Test Group 1: Basic Rate Limiting - Allow Requests
  // ============================================================================

  describe("Basic Rate Limiting - Allow Requests", () => {
    it("should allow request within rate limit", async () => {
      rateLimiter = new AdvancedRateLimit(redis, apiMetrics, {
        windowMs: 60000,
        maxRequests: 10,
      });

      const request = createMockRequest();
      const result = await rateLimiter.checkRateLimit(request);

      expect(result.allowed).toBe(true);
      expect(result.remaining >= 0).toBeTruthy();
      expect(result.resetTime > Date.now()).toBeTruthy();
    });

    it("should decrement remaining count on each request", async () => {
      rateLimiter = new AdvancedRateLimit(redis, apiMetrics, {
        windowMs: 60000,
        maxRequests: 5,
      });

      const request = createMockRequest({
        ip: "192.168.1.101",
        socket: { remoteAddress: "192.168.1.101" },
      });

      const result1 = await rateLimiter.checkRateLimit(request);
      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(4);

      const result2 = await rateLimiter.checkRateLimit(request);
      expect(result2.allowed).toBe(true);
      expect(result2.remaining).toBe(3);

      const result3 = await rateLimiter.checkRateLimit(request);
      expect(result3.allowed).toBe(true);
      expect(result3.remaining).toBe(2);
    });

    it("should track different IPs separately", async () => {
      rateLimiter = new AdvancedRateLimit(redis, apiMetrics, {
        windowMs: 60000,
        maxRequests: 5,
      });

      const request1 = createMockRequest({
        ip: "192.168.1.102",
        socket: { remoteAddress: "192.168.1.102" },
      });

      const request2 = createMockRequest({
        ip: "192.168.1.103",
        socket: { remoteAddress: "192.168.1.103" },
      });

      const result1 = await rateLimiter.checkRateLimit(request1);
      const result2 = await rateLimiter.checkRateLimit(request2);

      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(true);
      expect(result1.remaining).toBe(4);
      expect(result2.remaining).toBe(4);
    });

    it("should handle concurrent requests from same IP", async () => {
      rateLimiter = new AdvancedRateLimit(redis, apiMetrics, {
        windowMs: 60000,
        maxRequests: 10,
      });

      const request = createMockRequest({
        ip: "192.168.1.104",
        socket: { remoteAddress: "192.168.1.104" },
      });

      const results = await Promise.all([
        rateLimiter.checkRateLimit(request),
        rateLimiter.checkRateLimit(request),
        rateLimiter.checkRateLimit(request),
      ]);

      results.forEach((result) => {
        expect(result.allowed).toBe(true);
      });
    });
  });

  // ============================================================================
  // Test Group 2: Rate Limit Exceeded - Block Requests
  // ============================================================================

  describe("Rate Limit Exceeded - Block Requests", () => {
    it("should block request when limit exceeded", async () => {
      rateLimiter = new AdvancedRateLimit(redis, apiMetrics, {
        windowMs: 60000,
        maxRequests: 3,
      });

      const request = createMockRequest({
        ip: "192.168.1.105",
        socket: { remoteAddress: "192.168.1.105" },
      });

      // Make requests up to limit
      await rateLimiter.checkRateLimit(request);
      await rateLimiter.checkRateLimit(request);
      await rateLimiter.checkRateLimit(request);

      // This should be blocked
      const result = await rateLimiter.checkRateLimit(request);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.resetTime > Date.now()).toBeTruthy();
    });

    it("should return retryAfter time when blocked", async () => {
      rateLimiter = new AdvancedRateLimit(redis, apiMetrics, {
        windowMs: 60000,
        maxRequests: 2,
      });

      const request = createMockRequest({
        ip: "192.168.1.106",
        socket: { remoteAddress: "192.168.1.106" },
      });

      await rateLimiter.checkRateLimit(request);
      await rateLimiter.checkRateLimit(request);

      const result = await rateLimiter.checkRateLimit(request);

      expect(result.allowed).toBe(false);
      expect(result.resetTime > Date.now()).toBeTruthy();
    });

    it("should implement progressive blocking on repeated violations", async () => {
      rateLimiter = new AdvancedRateLimit(redis, apiMetrics, {
        windowMs: 60000,
        maxRequests: 2,
      });

      const request = createMockRequest({
        ip: "192.168.1.107",
        socket: { remoteAddress: "192.168.1.107" },
      });

      // Exhaust limit
      await rateLimiter.checkRateLimit(request);
      await rateLimiter.checkRateLimit(request);

      // First violation
      const violation1 = await rateLimiter.checkRateLimit(request);
      expect(violation1.allowed).toBe(false);

      // Subsequent violation should have longer block
      const violation2 = await rateLimiter.checkRateLimit(request);
      expect(violation2.allowed).toBe(false);
    });
  });

  // ============================================================================
  // Test Group 3: IP Extraction - X-Forwarded-For Headers
  // ============================================================================

  describe("IP Extraction - X-Forwarded-For Headers", () => {
    it("should extract IP from X-Forwarded-For header", async () => {
      rateLimiter = new AdvancedRateLimit(redis, apiMetrics, {
        windowMs: 60000,
        maxRequests: 5,
      });

      const request = createMockRequest({
        headers: {
          "x-forwarded-for": "203.0.113.195, 192.168.1.1",
          "user-agent": "Test Agent",
        },
      });

      const result = await rateLimiter.checkRateLimit(request);

      expect(result.allowed).toBe(true);
    });

    it("should extract IP from X-Real-IP header", async () => {
      rateLimiter = new AdvancedRateLimit(redis, apiMetrics, {
        windowMs: 60000,
        maxRequests: 5,
      });

      const request = createMockRequest({
        headers: {
          "x-real-ip": "203.0.113.196",
          "user-agent": "Test Agent",
        },
      });

      const result = await rateLimiter.checkRateLimit(request);

      expect(result.allowed).toBe(true);
    });

    it("should prioritize X-Forwarded-For over X-Real-IP", async () => {
      rateLimiter = new AdvancedRateLimit(redis, apiMetrics, {
        windowMs: 60000,
        maxRequests: 5,
      });

      const request = createMockRequest({
        headers: {
          "x-forwarded-for": "203.0.113.197",
          "x-real-ip": "203.0.113.198",
          "user-agent": "Test Agent",
        },
      });

      const result = await rateLimiter.checkRateLimit(request);

      expect(result.allowed).toBe(true);
    });

    it("should fallback to socket.remoteAddress", async () => {
      rateLimiter = new AdvancedRateLimit(redis, apiMetrics, {
        windowMs: 60000,
        maxRequests: 5,
      });

      const request = createMockRequest({
        headers: {
          "user-agent": "Test Agent",
        },
        socket: { remoteAddress: "192.168.1.200" },
      });

      const result = await rateLimiter.checkRateLimit(request);

      expect(result.allowed).toBe(true);
    });

    it("should handle malformed X-Forwarded-For header", async () => {
      rateLimiter = new AdvancedRateLimit(redis, apiMetrics, {
        windowMs: 60000,
        maxRequests: 5,
      });

      const request = createMockRequest({
        headers: {
          "x-forwarded-for": "",
          "user-agent": "Test Agent",
        },
        ip: "192.168.1.201",
      });

      const result = await rateLimiter.checkRateLimit(request);

      expect(result.allowed).toBe(true);
    });
  });

  // ============================================================================
  // Test Group 4: Path-Specific Rules
  // ============================================================================

  describe("Path-Specific Rules", () => {
    it("should apply path-specific rate limit", async () => {
      rateLimiter = new AdvancedRateLimit(redis, apiMetrics, {
        windowMs: 60000,
        maxRequests: 100, // Global limit
      });

      rateLimiter.addRule({
        path: "/api/auth/login",
        config: {
          windowMs: 60000,
          maxRequests: 3, // Stricter limit for login
        },
      });

      const request = createMockRequest({
        url: "/api/auth/login",
        routeOptions: { url: "/api/auth/login" },
        ip: "192.168.1.108",
        socket: { remoteAddress: "192.168.1.108" },
      });

      await rateLimiter.checkRateLimit(request);
      await rateLimiter.checkRateLimit(request);
      await rateLimiter.checkRateLimit(request);

      const result = await rateLimiter.checkRateLimit(request);
      expect(result.allowed).toBe(false);
    });

    it("should match path by prefix", async () => {
      rateLimiter = new AdvancedRateLimit(redis, apiMetrics, {
        windowMs: 60000,
        maxRequests: 100,
      });

      rateLimiter.addRule({
        path: "/api/admin",
        config: {
          windowMs: 60000,
          maxRequests: 5,
        },
      });

      const request = createMockRequest({
        url: "/api/admin/users",
        routeOptions: { url: "/api/admin/users" },
        ip: "192.168.1.109",
        socket: { remoteAddress: "192.168.1.109" },
      });

      const result = await rateLimiter.checkRateLimit(request);
      expect(result.allowed).toBe(true);
    });

    it("should match path by regex", async () => {
      rateLimiter = new AdvancedRateLimit(redis, apiMetrics, {
        windowMs: 60000,
        maxRequests: 100,
      });

      rateLimiter.addRule({
        path: /^\/api\/posts\/\d+$/,
        config: {
          windowMs: 60000,
          maxRequests: 10,
        },
      });

      const request = createMockRequest({
        url: "/api/posts/123",
        routeOptions: { url: "/api/posts/:id" },
        ip: "192.168.1.110",
        socket: { remoteAddress: "192.168.1.110" },
      });

      const result = await rateLimiter.checkRateLimit(request);
      expect(result.allowed).toBe(true);
    });

    it("should match method-specific rules", async () => {
      rateLimiter = new AdvancedRateLimit(redis, apiMetrics, {
        windowMs: 60000,
        maxRequests: 100,
      });

      rateLimiter.addRule({
        path: "/api/posts",
        method: "POST",
        config: {
          windowMs: 60000,
          maxRequests: 5,
        },
      });

      const request = createMockRequest({
        method: "POST",
        url: "/api/posts",
        routeOptions: { url: "/api/posts" },
        ip: "192.168.1.111",
        socket: { remoteAddress: "192.168.1.111" },
      });

      const result = await rateLimiter.checkRateLimit(request);
      expect(result.allowed).toBe(true);
    });

    it("should match multiple method rules", async () => {
      rateLimiter = new AdvancedRateLimit(redis, apiMetrics, {
        windowMs: 60000,
        maxRequests: 100,
      });

      rateLimiter.addRule({
        path: "/api/data",
        method: ["POST", "PUT", "DELETE"],
        config: {
          windowMs: 60000,
          maxRequests: 10,
        },
      });

      const request = createMockRequest({
        method: "PUT",
        url: "/api/data",
        routeOptions: { url: "/api/data" },
        ip: "192.168.1.112",
        socket: { remoteAddress: "192.168.1.112" },
      });

      const result = await rateLimiter.checkRateLimit(request);
      expect(result.allowed).toBe(true);
    });

    it("should not match different method", async () => {
      rateLimiter = new AdvancedRateLimit(redis, apiMetrics, {
        windowMs: 60000,
        maxRequests: 100,
      });

      rateLimiter.addRule({
        path: "/api/posts",
        method: "POST",
        config: {
          windowMs: 60000,
          maxRequests: 2,
        },
      });

      const request = createMockRequest({
        method: "GET",
        url: "/api/posts",
        routeOptions: { url: "/api/posts" },
        ip: "192.168.1.113",
        socket: { remoteAddress: "192.168.1.113" },
      });

      // Should use global limit, not rule limit
      const result = await rateLimiter.checkRateLimit(request);
      expect(result.allowed).toBe(true);
    });
  });

  // ============================================================================
  // Test Group 5: Skip List - Whitelisted Paths
  // ============================================================================

  describe("Skip List - Whitelisted Paths", () => {
    it("should skip rate limiting for whitelisted paths", async () => {
      rateLimiter = new AdvancedRateLimit(redis, apiMetrics, {
        windowMs: 60000,
        maxRequests: 1,
        skipList: ["/health", "/metrics"],
      });

      const request = createMockRequest({
        url: "/health",
        routeOptions: { url: "/health" },
      });

      // Should always allow despite low limit
      const result1 = await rateLimiter.checkRateLimit(request);
      const result2 = await rateLimiter.checkRateLimit(request);
      const result3 = await rateLimiter.checkRateLimit(request);

      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(true);
      expect(result3.allowed).toBe(true);
    });

    it("should skip rate limiting for path prefix match", async () => {
      rateLimiter = new AdvancedRateLimit(redis, apiMetrics, {
        windowMs: 60000,
        maxRequests: 1,
        skipList: ["/public"],
      });

      const request = createMockRequest({
        url: "/public/assets/logo.png",
        routeOptions: { url: "/public/assets/logo.png" },
      });

      const result = await rateLimiter.checkRateLimit(request);
      expect(result.allowed).toBe(true);
    });
  });

  // ============================================================================
  // Test Group 6: Custom Key Generator
  // ============================================================================

  describe("Custom Key Generator", () => {
    it("should use custom key generator", async () => {
      const customKeyGen = (req: FastifyRequest) => {
        return `custom:user:${req.headers["x-user-id"]}`;
      };

      rateLimiter = new AdvancedRateLimit(redis, apiMetrics, {
        windowMs: 60000,
        maxRequests: 3,
        keyGenerator: customKeyGen,
      });

      const request = createMockRequest({
        headers: {
          "x-user-id": "user-123",
          "user-agent": "Test Agent",
        },
      });

      const result1 = await rateLimiter.checkRateLimit(request);
      const result2 = await rateLimiter.checkRateLimit(request);

      expect(result1.allowed).toBe(true);
      expect(result2.allowed).toBe(true);
    });

    it("should track different custom keys separately", async () => {
      const customKeyGen = (req: FastifyRequest) => {
        return `custom:api-key:${req.headers["x-api-key"]}`;
      };

      rateLimiter = new AdvancedRateLimit(redis, apiMetrics, {
        windowMs: 60000,
        maxRequests: 2,
        keyGenerator: customKeyGen,
      });

      const request1 = createMockRequest({
        headers: {
          "x-api-key": "key-1",
          "user-agent": "Test Agent",
        },
      });

      const request2 = createMockRequest({
        headers: {
          "x-api-key": "key-2",
          "user-agent": "Test Agent",
        },
      });

      await rateLimiter.checkRateLimit(request1);
      await rateLimiter.checkRateLimit(request1);

      const result1 = await rateLimiter.checkRateLimit(request1);
      const result2 = await rateLimiter.checkRateLimit(request2);

      expect(result1.allowed).toBe(false);
      expect(result2.allowed).toBe(true);
    });
  });

  // ============================================================================
  // Test Group 7: Predefined Rate Limit Configs
  // ============================================================================

  describe("Predefined Rate Limit Configs", () => {
    it("should have STRICT config", () => {
      expect(RateLimitConfigs.STRICT.windowMs).toBe(60_000);
      expect(RateLimitConfigs.STRICT.maxRequests).toBe(10);
    });

    it("should have STANDARD config", () => {
      expect(RateLimitConfigs.STANDARD.windowMs).toBe(60_000);
      expect(RateLimitConfigs.STANDARD.maxRequests).toBe(100);
    });

    it("should have LENIENT config", () => {
      expect(RateLimitConfigs.LENIENT.windowMs).toBe(60_000);
      expect(RateLimitConfigs.LENIENT.maxRequests).toBe(300);
    });

    it("should have HEALTH config", () => {
      expect(RateLimitConfigs.HEALTH.windowMs).toBe(60_000);
      expect(RateLimitConfigs.HEALTH.maxRequests).toBe(600);
    });

    it("should have AUTH config", () => {
      expect(RateLimitConfigs.AUTH.windowMs).toBe(900_000);
      expect(RateLimitConfigs.AUTH.maxRequests).toBe(5);
    });

    it("should have UPLOAD config", () => {
      expect(RateLimitConfigs.UPLOAD.windowMs).toBe(300_000);
      expect(RateLimitConfigs.UPLOAD.maxRequests).toBe(20);
    });
  });

  // ============================================================================
  // Test Group 8: Error Handling - Redis Failures
  // ============================================================================

  describe("Error Handling - Redis Failures", () => {
    it("should allow request on Redis failure", async () => {
      // Create a disconnected Redis instance
      const badRedis = new Redis({
        host: "invalid-host-that-does-not-exist",
        port: 9999,
        maxRetriesPerRequest: 0,
        retryStrategy: () => null,
      });

      const badRateLimiter = new AdvancedRateLimit(badRedis, apiMetrics, {
        windowMs: 60000,
        maxRequests: 5,
      });

      const request = createMockRequest({
        ip: "192.168.1.114",
        socket: { remoteAddress: "192.168.1.114" },
      });

      const result = await badRateLimiter.checkRateLimit(request);

      // Should allow on error
      expect(result.allowed).toBe(true);

      await badRedis.quit();
    });
  });
});
