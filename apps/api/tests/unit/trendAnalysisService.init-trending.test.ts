/**
 * Unit Tests for TrendAnalysisService - Initialization, Trending Content, and Circuit Breaker
 *
 * Tests service instantiation, method exposure, trending content retrieval with
 * filters and limits, required field validation, and circuit breaker/cache utilities.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { TrendAnalysisService } from "../../src/trends/trendAnalysisService.js";
import { createService } from "./trendAnalysisService.test-helpers.js";

describe("TrendAnalysisService - Initialization", { concurrency: 1 }, () => {
  it("should initialize with prisma and logger", () => {
    const service = createService();

    assert.ok(service, "Service should be created");
  });

  it("should expose trending content method", () => {
    const service = createService();

    assert.strictEqual(
      typeof service.getTrendingContent,
      "function",
      "Should have getTrendingContent method"
    );
  });

  it("should expose trend prediction method", () => {
    const service = createService();

    assert.strictEqual(
      typeof service.generateTrendPredictions,
      "function",
      "Should have generateTrendPredictions method"
    );
  });

  it("should expose viral content analysis method", () => {
    const service = createService();

    assert.strictEqual(
      typeof service.analyzeViralContent,
      "function",
      "Should have analyzeViralContent method"
    );
  });

  it("should expose content opportunity discovery method", () => {
    const service = createService();

    assert.strictEqual(
      typeof service.discoverContentOpportunities,
      "function",
      "Should have discoverContentOpportunities method"
    );
  });
});

describe("TrendAnalysisService - Trending Content", { concurrency: 1 }, () => {
  let service: TrendAnalysisService;

  beforeEach(() => {
    service = createService();
  });

  it("should retrieve trending content without filters", async () => {
    const result = await service.getTrendingContent();

    assert.ok(result.ok, "Should return successful result");
    if (result.ok) {
      assert.ok(Array.isArray(result.value), "Should return array of trending content");
    }
  });

  it("should filter trending content by type", async () => {
    const result = await service.getTrendingContent({ type: "hashtag" });

    assert.ok(result.ok, "Should return successful result");
    if (result.ok) {
      result.value.forEach((trend) => {
        assert.strictEqual(trend.type, "hashtag", "All trends should be hashtags");
      });
    }
  });

  it("should filter trending content by category", async () => {
    const result = await service.getTrendingContent({ category: "education" });

    assert.ok(result.ok, "Should return successful result");
    if (result.ok && result.value.length > 0) {
      const hasCategory = result.value.some(
        (trend) => trend.characteristics.category === "education"
      );
      assert.ok(hasCategory || result.value.length === 0, "Should filter by category");
    }
  });

  it("should limit number of results", async () => {
    const limit = 1;
    const result = await service.getTrendingContent({ limit });

    assert.ok(result.ok, "Should return successful result");
    if (result.ok) {
      assert.ok(result.value.length <= limit, `Should return at most ${limit} results`);
    }
  });

  it("should include all required trend fields", async () => {
    const result = await service.getTrendingContent({ limit: 1 });

    assert.ok(result.ok, "Should return successful result");
    if (result.ok && result.value.length > 0) {
      const trend = result.value[0]!;

      assert.ok(trend.id, "Trend should have ID");
      assert.ok(trend.type, "Trend should have type");
      assert.ok(trend.title, "Trend should have title");
      assert.ok(trend.metrics, "Trend should have metrics");
      assert.ok(trend.trend, "Trend should have trend data");
      assert.ok(trend.demographics, "Trend should have demographics");
      assert.ok(trend.characteristics, "Trend should have characteristics");
      assert.ok(trend.viralFactors, "Trend should have viral factors");
      assert.ok(trend.opportunity, "Trend should have opportunity data");
    }
  });

  it("should include metrics with proper structure", async () => {
    const result = await service.getTrendingContent({ limit: 1 });

    if (result.ok && result.value.length > 0) {
      const metrics = result.value[0]!.metrics;

      assert.ok(typeof metrics.views === "number", "Should have views count");
      assert.ok(typeof metrics.likes === "number", "Should have likes count");
      assert.ok(typeof metrics.shares === "number", "Should have shares count");
      assert.ok(typeof metrics.comments === "number", "Should have comments count");
      assert.ok(typeof metrics.growthRate === "number", "Should have growth rate");
      assert.ok(typeof metrics.viralScore === "number", "Should have viral score");
      assert.ok(
        metrics.viralScore >= 0 && metrics.viralScore <= 100,
        "Viral score should be 0-100"
      );
    }
  });

  it("should include trend phase information", async () => {
    const result = await service.getTrendingContent({ limit: 1 });

    if (result.ok && result.value.length > 0) {
      const trendInfo = result.value[0]!.trend;
      const validPhases = ["emerging", "growing", "peak", "declining", "stable"];

      assert.ok(validPhases.includes(trendInfo.phase), "Should have valid trend phase");
      assert.ok(trendInfo.momentum >= 0 && trendInfo.momentum <= 100, "Momentum should be 0-100");
      assert.ok(
        trendInfo.sustainability >= 0 && trendInfo.sustainability <= 100,
        "Sustainability should be 0-100"
      );
      assert.ok(typeof trendInfo.estimatedLifespan === "number", "Should have estimated lifespan");
    }
  });

  it("should include opportunity assessment", async () => {
    const result = await service.getTrendingContent({ limit: 1 });

    if (result.ok && result.value.length > 0) {
      const opportunity = result.value[0]!.opportunity;
      const validDifficulties = ["low", "medium", "high"];

      assert.ok(
        validDifficulties.includes(opportunity.entryDifficulty),
        "Should have valid entry difficulty"
      );
      assert.ok(
        opportunity.saturationLevel >= 0 && opportunity.saturationLevel <= 100,
        "Saturation should be 0-100"
      );
      assert.ok(
        opportunity.remainingPotential >= 0 && opportunity.remainingPotential <= 100,
        "Remaining potential should be 0-100"
      );
      assert.ok(Array.isArray(opportunity.recommendedApproach), "Should have recommended approach");
    }
  });
});

describe("TrendAnalysisService - Circuit Breaker", { concurrency: 1 }, () => {
  let service: TrendAnalysisService;

  beforeEach(() => {
    service = createService();
  });

  it("should provide circuit breaker status", () => {
    const status = service.getCircuitBreakerStatus();

    assert.ok(typeof status === "object", "Should return circuit breaker status object");
  });

  it("should expose cache clearing method", () => {
    assert.doesNotThrow(() => {
      service.clearCache();
    }, "Should clear cache without error");
  });

  it("should expose metrics registry", () => {
    const registry = TrendAnalysisService.getMetricsRegistry();

    assert.ok(registry, "Should return metrics registry");
  });
});

describe("TrendAnalysisService - Helper Methods (Pattern/Shift)", { concurrency: 1 }, () => {
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
        assert.ok(reportResult.value.insights.patterns.length > 0, "Should generate patterns");
      }
    }
  });

  it("should generate shift insights from trending content", async () => {
    const reportResult = await service.generateTrendReport({
      period: { start: new Date("2024-01-01"), end: new Date("2024-01-31") },
    });

    if (reportResult.ok) {
      assert.ok(reportResult.value.insights.shifts.length > 0, "Should generate shifts");
    }
  });
});
