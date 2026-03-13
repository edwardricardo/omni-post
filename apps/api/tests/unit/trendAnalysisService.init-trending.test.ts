/**
 * Unit Tests for TrendAnalysisService - Initialization, Trending Content, and Circuit Breaker
 *
 * Tests service instantiation, method exposure, trending content retrieval with
 * filters and limits, required field validation, and circuit breaker/cache utilities.
 */

import { describe, it, beforeEach, expect } from "vitest";
import { TrendAnalysisService } from "../../src/trends/trendAnalysisService.js";
import { createService } from "./trendAnalysisService.test-helpers.js";

describe("TrendAnalysisService - Initialization", () => {
  it("should initialize with prisma and logger", () => {
    const service = createService();

    expect(service).toBeTruthy();
  });

  it("should expose trending content method", () => {
    const service = createService();

    expect(typeof service.getTrendingContent).toBe("function");
  });

  it("should expose trend prediction method", () => {
    const service = createService();

    expect(typeof service.generateTrendPredictions).toBe("function");
  });

  it("should expose viral content analysis method", () => {
    const service = createService();

    expect(typeof service.analyzeViralContent).toBe("function");
  });

  it("should expose content opportunity discovery method", () => {
    const service = createService();

    expect(typeof service.discoverContentOpportunities).toBe("function");
  });
});

describe("TrendAnalysisService - Trending Content", () => {
  let service: TrendAnalysisService;

  beforeEach(() => {
    service = createService();
  });

  it("should retrieve trending content without filters", async () => {
    const result = await service.getTrendingContent();

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(Array.isArray(result.value)).toBeTruthy();
    }
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

  it("should filter trending content by category", async () => {
    const result = await service.getTrendingContent({ category: "education" });

    expect(result.ok).toBeTruthy();
    if (result.ok && result.value.length > 0) {
      const hasCategory = result.value.some(
        (trend) => trend.characteristics.category === "education"
      );
      expect(hasCategory || result.value.length === 0).toBeTruthy();
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

  it("should include all required trend fields", async () => {
    const result = await service.getTrendingContent({ limit: 1 });

    expect(result.ok).toBeTruthy();
    if (result.ok && result.value.length > 0) {
      const trend = result.value[0]!;

      expect(trend.id).toBeTruthy();
      expect(trend.type).toBeTruthy();
      expect(trend.title).toBeTruthy();
      expect(trend.metrics).toBeTruthy();
      expect(trend.trend).toBeTruthy();
      expect(trend.demographics).toBeTruthy();
      expect(trend.characteristics).toBeTruthy();
      expect(trend.viralFactors).toBeTruthy();
      expect(trend.opportunity).toBeTruthy();
    }
  });

  it("should include metrics with proper structure", async () => {
    const result = await service.getTrendingContent({ limit: 1 });

    if (result.ok && result.value.length > 0) {
      const metrics = result.value[0]!.metrics;

      expect(typeof metrics.views === "number").toBeTruthy();
      expect(typeof metrics.likes === "number").toBeTruthy();
      expect(typeof metrics.shares === "number").toBeTruthy();
      expect(typeof metrics.comments === "number").toBeTruthy();
      expect(typeof metrics.growthRate === "number").toBeTruthy();
      expect(typeof metrics.viralScore === "number").toBeTruthy();
      expect(metrics.viralScore >= 0 && metrics.viralScore <= 100).toBeTruthy();
    }
  });

  it("should include trend phase information", async () => {
    const result = await service.getTrendingContent({ limit: 1 });

    if (result.ok && result.value.length > 0) {
      const trendInfo = result.value[0]!.trend;
      const validPhases = ["emerging", "growing", "peak", "declining", "stable"];

      expect(validPhases.includes(trendInfo.phase)).toBeTruthy();
      expect(trendInfo.momentum >= 0 && trendInfo.momentum <= 100).toBeTruthy();
      expect(trendInfo.sustainability >= 0 && trendInfo.sustainability <= 100).toBeTruthy();
      expect(typeof trendInfo.estimatedLifespan === "number").toBeTruthy();
    }
  });

  it("should include opportunity assessment", async () => {
    const result = await service.getTrendingContent({ limit: 1 });

    if (result.ok && result.value.length > 0) {
      const opportunity = result.value[0]!.opportunity;
      const validDifficulties = ["low", "medium", "high"];

      expect(validDifficulties.includes(opportunity.entryDifficulty)).toBeTruthy();
      expect(opportunity.saturationLevel >= 0 && opportunity.saturationLevel <= 100).toBeTruthy();
      expect(
        opportunity.remainingPotential >= 0 && opportunity.remainingPotential <= 100
      ).toBeTruthy();
      expect(Array.isArray(opportunity.recommendedApproach)).toBeTruthy();
    }
  });
});

describe("TrendAnalysisService - Circuit Breaker", () => {
  let service: TrendAnalysisService;

  beforeEach(() => {
    service = createService();
  });

  it("should provide circuit breaker status", () => {
    const status = service.getCircuitBreakerStatus();

    expect(typeof status === "object").toBeTruthy();
  });

  it("should expose cache clearing method", () => {
    expect(() => {
      service.clearCache();
    }).not.toThrow();
  });

  it("should expose metrics registry", () => {
    const registry = TrendAnalysisService.getMetricsRegistry();

    expect(registry).toBeTruthy();
  });
});

describe("TrendAnalysisService - Helper Methods (Pattern/Shift)", () => {
  let service: TrendAnalysisService;

  beforeEach(() => {
    service = createService();
  });

  it("should generate pattern insights from trending content", async () => {
    const result = await service.getTrendingContent({ limit: 5 });

    if (result.ok && result.value.length > 0) {
      const reportResult = await service.generateTrendReport({
        period: { start: new Date("2024-01-01"), end: new Date("2024-01-31") },
      });

      if (reportResult.ok) {
        expect(reportResult.value.insights.patterns.length > 0).toBeTruthy();
      }
    }
  });

  it("should generate shift insights from trending content", async () => {
    const reportResult = await service.generateTrendReport({
      period: { start: new Date("2024-01-01"), end: new Date("2024-01-31") },
    });

    if (reportResult.ok) {
      expect(reportResult.value.insights.shifts.length > 0).toBeTruthy();
    }
  });
});
