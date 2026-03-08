/**
 * Comprehensive Tests for ROICalculator (roiCalculator.ts)
 *
 * This test suite validates the ROI calculation logic for social media marketing.
 *
 * Tests cover:
 * - Date range calculation
 * - Seasonal factor adjustments
 * - Cache key generation
 *
 * Run with: pnpm --filter @apps/api exec tsx tests/unit/roiCalculator.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ROICalculator } from "../../src/analytics/roiCalculator.js";
import type { ProjectQueryRepositoryPort } from "../../src/domain/repositories/ProjectQueryRepository.js";

/**
 * Minimal stub — ROICalculator tests only exercise pure-math methods
 * (calculateDateRange, getSeasonalFactor, generateCacheKey) so the
 * repository is never actually called.
 */
const stubProjectRepo: ProjectQueryRepositoryPort = {
  getPostIds: async () => [],
  getPostsWithContent: async () => [],
  getPostsWithAnalytics: async () => [],
  getPublishedPosts: async () => [],
  countPosts: async () => 0,
  getByAccountId: async () => [],
  findById: async () => null,
};

describe("ROICalculator - Initialization", () => {
  it("initializes with default cost model", () => {
    const calculator = new ROICalculator(stubProjectRepo);
    assert.ok(calculator instanceof ROICalculator, "Should be a ROICalculator instance");
  });
});

describe("ROICalculator - Date Range Calculation", () => {
  it("calculates 7 days correctly", () => {
    const calculator = new ROICalculator(stubProjectRepo);
    const { startDate, endDate } = calculator.calculateDateRange("7d");

    const daysDiff = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    assert.strictEqual(daysDiff, 7);
  });

  it("calculates 30 days correctly", () => {
    const calculator = new ROICalculator(stubProjectRepo);
    const { startDate, endDate } = calculator.calculateDateRange("30d");

    const daysDiff = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    assert.strictEqual(daysDiff, 30);
  });

  it("calculates 90 days correctly", () => {
    const calculator = new ROICalculator(stubProjectRepo);
    const { startDate, endDate } = calculator.calculateDateRange("90d");

    const daysDiff = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    assert.strictEqual(daysDiff, 90);
  });

  it("calculates 1 year correctly", () => {
    const calculator = new ROICalculator(stubProjectRepo);
    const { startDate, endDate } = calculator.calculateDateRange("1y");

    const daysDiff = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    assert.ok(daysDiff >= 365 && daysDiff <= 366);
  });

  it("uses custom dates when provided", () => {
    const calculator = new ROICalculator(stubProjectRepo);
    const customStart = new Date("2024-01-01");
    const customEnd = new Date("2024-01-31");

    const { startDate, endDate } = calculator.calculateDateRange("custom", customStart, customEnd);

    assert.strictEqual(startDate.getTime(), customStart.getTime());
    assert.strictEqual(endDate.getTime(), customEnd.getTime());
  });
});

describe("ROICalculator - Seasonal Factors", () => {
  it("returns higher factor for November (holiday season)", () => {
    const calculator = new ROICalculator(stubProjectRepo);
    const novemberFactor = calculator.getSeasonalFactor(10); // November is month 10 (0-indexed)
    const averageFactor = 1.0;

    assert.ok(novemberFactor > averageFactor);
  });

  it("returns higher factor for December (holiday season)", () => {
    const calculator = new ROICalculator(stubProjectRepo);
    const decemberFactor = calculator.getSeasonalFactor(11); // December is month 11 (0-indexed)
    const averageFactor = 1.0;

    assert.ok(decemberFactor > averageFactor);
  });

  it("returns lower factor for February (slow season)", () => {
    const calculator = new ROICalculator(stubProjectRepo);
    const februaryFactor = calculator.getSeasonalFactor(1); // February is month 1 (0-indexed)
    const averageFactor = 1.0;

    assert.ok(februaryFactor < averageFactor);
  });

  it("returns factors within reasonable range", () => {
    const calculator = new ROICalculator(stubProjectRepo);

    for (let month = 0; month < 12; month++) {
      const factor = calculator.getSeasonalFactor(month);
      assert.ok(factor >= 0.5 && factor <= 2.0);
    }
  });
});

describe("ROICalculator - Cache Key Generation", () => {
  it("creates unique key for account and time range", () => {
    const calculator = new ROICalculator(stubProjectRepo);
    const key = calculator.generateCacheKey({
      accountId: "acc-123",
      timeRange: "30d",
    });

    assert.ok(key.includes("acc-123"));
    assert.ok(key.includes("30d"));
  });

  it("includes project ID when provided", () => {
    const calculator = new ROICalculator(stubProjectRepo);
    const key = calculator.generateCacheKey({
      accountId: "acc-123",
      projectId: "proj-456",
      timeRange: "7d",
    });

    assert.ok(key.includes("proj-456"));
  });

  it("creates different keys for different accounts", () => {
    const calculator = new ROICalculator(stubProjectRepo);
    const key1 = calculator.generateCacheKey({
      accountId: "acc-123",
      timeRange: "30d",
    });
    const key2 = calculator.generateCacheKey({
      accountId: "acc-456",
      timeRange: "30d",
    });

    assert.notStrictEqual(key1, key2);
  });

  it("creates different keys for different time ranges", () => {
    const calculator = new ROICalculator(stubProjectRepo);
    const key1 = calculator.generateCacheKey({
      accountId: "acc-123",
      timeRange: "7d",
    });
    const key2 = calculator.generateCacheKey({
      accountId: "acc-123",
      timeRange: "30d",
    });

    assert.notStrictEqual(key1, key2);
  });
});
