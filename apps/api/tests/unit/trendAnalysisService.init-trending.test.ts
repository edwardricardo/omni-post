/**
 * Unit Tests for TrendAnalysisService - Trending Content, Trend Report and Circuit Breaker
 *
 * Tests trending content retrieval with a type filter and a limit, the region
 * and category a trend report carries from its filters, and the cache clearing
 * of the circuit breaker.
 *
 * @file trendAnalysisService.init-trending.test.ts
 * @description Tests for TrendAnalysisService - Trending Content and Trend Report
 * @layer infrastructure
 */

import { describe, it, beforeEach, expect } from "vitest";
import assert from "node:assert/strict";
import { TrendAnalysisService } from "../../src/trends/trendAnalysisService.js";
import { createService } from "./trendAnalysisService.test-helpers.js";

describe("TrendAnalysisService - Trending Content", () => {
  let service: TrendAnalysisService;

  beforeEach(() => {
    service = createService();
  });

  it("should filter trending content by type", async () => {
    const result = await service.getTrendingContent({ type: "hashtag" });

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      result.value.forEach((trend) => {
        expect(trend.type).toBe("hashtag");
      });
    }
  });

  it("should limit number of results", async () => {
    const limit = 1;
    const result = await service.getTrendingContent({ limit });

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.length <= limit).toBeTruthy();
    }
  });
});

describe("TrendAnalysisService - Trend Report", () => {
  const period = { start: new Date("2024-01-01"), end: new Date("2024-01-31") };
  let service: TrendAnalysisService;

  beforeEach(() => {
    service = createService();
  });

  it("returns the requested region when given a region filter", async () => {
    const result = await service.generateTrendReport({ period, region: "US" });

    assert.ok(result.ok);
    expect(result.value.region).toBe("US");
  });

  it("returns the requested category when given a category filter", async () => {
    const result = await service.generateTrendReport({ period, category: "education" });

    assert.ok(result.ok);
    expect(result.value.category).toBe("education");
  });
});

describe("TrendAnalysisService - Circuit Breaker", () => {
  let service: TrendAnalysisService;

  beforeEach(() => {
    service = createService();
  });

  it("should expose cache clearing method", () => {
    expect(() => {
      service.clearCache();
    }).not.toThrow();
  });
});
