/**
 * Unit Tests for TrendAnalysisService - Trending Content and Circuit Breaker
 *
 * Tests trending content retrieval with a type filter and a limit, and the
 * cache clearing of the circuit breaker.
 *
 * @file trendAnalysisService.init-trending.test.ts
 * @description Tests for TrendAnalysisService - Trending Content
 * @layer infrastructure
 */

import { describe, it, beforeEach, expect } from "vitest";
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
