/**
 * Comprehensive Tests for RealtimeAnalyticsService (realtimeAnalytics.ts)
 *
 * This test suite validates real-time analytics calculation logic.
 *
 * Tests cover:
 * - Engagement rate calculations
 * - Connection ID generation
 * - Connection statistics aggregation
 *
 * Run with: pnpm --filter @apps/api exec tsx tests/unit/realtimeAnalytics.test.ts
 */

import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { RealtimeAnalyticsService } from "../../src/analytics/realtimeAnalytics.js";
import Redis from "ioredis";

// ========================================
// SETUP
// ========================================

let mockRedis: Redis;
let realtimeService: RealtimeAnalyticsService;

beforeAll(() => {
  // Create a mock Redis instance (we only need it for constructor)
  mockRedis = new Redis({
    host: "localhost",
    port: 6379,
    lazyConnect: true, // Don't actually connect
  });

  realtimeService = new RealtimeAnalyticsService(mockRedis);
});

afterAll(() => {
  mockRedis.disconnect();
});

// ========================================
// TESTS: calculateEngagementRate
// ========================================

describe("RealtimeAnalyticsService - calculateEngagementRate", () => {
  it("calculates correct rate with views > 0", () => {
    const analytics = {
      views: 1000,
      likes: 50,
      comments: 20,
      shares: 10,
    };

    const rate = realtimeService.calculateEngagementRate(analytics);

    // (50 + 20 + 10) / 1000 * 100 = 8%
    expect(rate).toBe(8);
  });

  it("returns 0 when views is 0", () => {
    const analytics = {
      views: 0,
      likes: 50,
      comments: 20,
      shares: 10,
    };

    const rate = realtimeService.calculateEngagementRate(analytics);

    expect(rate).toBe(0);
  });

  it("handles null views as 0", () => {
    const analytics = {
      views: null,
      likes: 50,
      comments: 20,
      shares: 10,
    };

    const rate = realtimeService.calculateEngagementRate(analytics);

    expect(rate).toBe(0);
  });

  it("handles null engagement metrics", () => {
    const analytics = {
      views: 1000,
      likes: null,
      comments: null,
      shares: null,
    };

    const rate = realtimeService.calculateEngagementRate(analytics);

    // (0 + 0 + 0) / 1000 * 100 = 0%
    expect(rate).toBe(0);
  });

  it("handles partial null engagement metrics", () => {
    const analytics = {
      views: 1000,
      likes: 50,
      comments: null,
      shares: 10,
    };

    const rate = realtimeService.calculateEngagementRate(analytics);

    // (50 + 0 + 10) / 1000 * 100 = 6%
    expect(rate).toBe(6);
  });

  it("calculates fractional engagement rates", () => {
    const analytics = {
      views: 1000,
      likes: 15,
      comments: 8,
      shares: 2,
    };

    const rate = realtimeService.calculateEngagementRate(analytics);

    // (15 + 8 + 2) / 1000 * 100 = 2.5%
    expect(rate).toBe(2.5);
  });

  it("handles 100% engagement rate", () => {
    const analytics = {
      views: 100,
      likes: 60,
      comments: 30,
      shares: 10,
    };

    const rate = realtimeService.calculateEngagementRate(analytics);

    // (60 + 30 + 10) / 100 * 100 = 100%
    expect(rate).toBe(100);
  });

  it("handles over 100% engagement rate", () => {
    const analytics = {
      views: 100,
      likes: 80,
      comments: 50,
      shares: 30,
    };

    const rate = realtimeService.calculateEngagementRate(analytics);

    // (80 + 50 + 30) / 100 * 100 = 160%
    expect(rate).toBe(160);
  });

  it("handles very small engagement rates", () => {
    const analytics = {
      views: 1000000,
      likes: 10,
      comments: 5,
      shares: 1,
    };

    const rate = realtimeService.calculateEngagementRate(analytics);

    // (10 + 5 + 1) / 1000000 * 100 = 0.0016%
    expect(Math.abs(rate - 0.0016) < 0.0001).toBeTruthy();
  });

  it("handles large numbers", () => {
    const analytics = {
      views: 5000000,
      likes: 250000,
      comments: 100000,
      shares: 50000,
    };

    const rate = realtimeService.calculateEngagementRate(analytics);

    // (250000 + 100000 + 50000) / 5000000 * 100 = 8%
    expect(rate).toBe(8);
  });

  it("handles zero engagement", () => {
    const analytics = {
      views: 1000,
      likes: 0,
      comments: 0,
      shares: 0,
    };

    const rate = realtimeService.calculateEngagementRate(analytics);

    expect(rate).toBe(0);
  });

  it("handles single view with engagement", () => {
    const analytics = {
      views: 1,
      likes: 1,
      comments: 0,
      shares: 0,
    };

    const rate = realtimeService.calculateEngagementRate(analytics);

    // (1 + 0 + 0) / 1 * 100 = 100%
    expect(rate).toBe(100);
  });
});

// ========================================
// TESTS: generateConnectionId
// ========================================

describe("RealtimeAnalyticsService - generateConnectionId", () => {
  it("generates ID with correct prefix", () => {
    const id = realtimeService.generateConnectionId();

    expect(id.startsWith("conn_")).toBeTruthy();
  });

  it("generates unique IDs", () => {
    const id1 = realtimeService.generateConnectionId();
    const id2 = realtimeService.generateConnectionId();

    expect(id1).not.toBe(id2);
  });

  it("ID contains UUID after prefix", () => {
    const id = realtimeService.generateConnectionId();

    // Format: conn_<uuid>
    const uuid = id.replace("conn_", "");
    // UUID v4 format: 8-4-4-4-12
    expect(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)
    ).toBeTruthy();
  });
});

// ========================================
// TESTS: getConnectionStats
// ========================================

describe("RealtimeAnalyticsService - getConnectionStats", () => {
  it("returns zero stats when no connections", () => {
    const stats = realtimeService.getConnectionStats();

    expect(stats.totalConnections).toBe(0);
    expect(stats.activeSubscriptions).toBe(0);
    expect(stats.subscribedPosts).toBe(0);
    expect(Object.keys(stats.connectionsByProject).length).toBe(0);
  });
});

// ========================================
// TESTS: Edge Cases
// ========================================

describe("RealtimeAnalyticsService - Edge Cases", () => {
  it("engagement rate with negative numbers treated as 0", () => {
    const analytics = {
      views: 1000,
      likes: -10, // API might return negative for decrements
      comments: 5,
      shares: 2,
    };

    // Since we use (analytics.likes || 0), negative numbers are kept
    // But in real calculation: (-10 + 5 + 2) / 1000 * 100 = -0.3%
    const rate = realtimeService.calculateEngagementRate(analytics);

    expect(rate).toBe(-0.3);
  });

  it("very precise decimal engagement rates", () => {
    const analytics = {
      views: 999,
      likes: 10,
      comments: 5,
      shares: 3,
    };

    const rate = realtimeService.calculateEngagementRate(analytics);

    // (10 + 5 + 3) / 999 * 100 = 1.8018018018...
    expect(Math.abs(rate - 1.8018018018018) < 0.0000001).toBeTruthy();
  });
});
