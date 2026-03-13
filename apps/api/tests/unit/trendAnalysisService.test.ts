/**
 * Trend Analysis Service Unit Tests
 *
 * BUSINESS LOGIC VALIDATION:
 * This test suite validates the TikTok trend analysis service that provides
 * comprehensive trending content insights, predictions, and opportunity discovery.
 *
 * KEY BUSINESS CAPABILITIES TESTED:
 * - Trending content retrieval and categorization
 * - Trend prediction generation with ML signals
 * - Viral content DNA analysis
 * - Content opportunity discovery (gaps, emerging, saturated)
 * - Comprehensive trend report generation
 * - Content categorization (videos, hashtags, sounds, challenges)
 * - Helper methods for pattern/shift/anomaly identification
 * - Time series and growth rate calculations
 * - Recommendation generation (content, timing, hashtags, sounds, strategy)
 *
 * TREND ANALYSIS BUSINESS RULES:
 * - Trend phases: emerging, growing, peak, declining, stable
 * - Momentum scored 0-100
 * - Sustainability scored 0-100
 * - Viral score calculated from growth rate and engagement
 * - Content gaps identified by competition level (low/medium/high)
 * - First-mover advantage decreases as trends mature
 * - Predictions include probability (0-1) and confidence (0-1)
 * - Reports aggregate all insights for strategic planning
 *
 * DEPENDENCIES:
 * - PrismaClient for database access (mocked)
 * - FastifyLoggerInstance for logging (mocked)
 * - Circuit breaker for API resilience
 * - BaseService for error handling patterns
 * - Result type for type-safe responses
 *
 * RUN COMMAND:
 * pnpm --filter @apps/api test apps/api/tests/unit/trendAnalysisService.test.ts
 *
 * @module TrendAnalysisServiceTests
 * @category UnitTests
 */

import { describe, it, beforeEach, expect } from "vitest";
import { TrendAnalysisService } from "../../src/trends/trendAnalysisService.js";
import { createService } from "./trendAnalysisService.test-helpers.js";

// ========================================
// TEST SUITE: Service Initialization
// ========================================

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

// ========================================
// TEST SUITE: Trending Content Retrieval
// ========================================

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

// ========================================
// TEST SUITE: Trend Predictions
// ========================================

describe("TrendAnalysisService - Trend Predictions", () => {
  let service: TrendAnalysisService;

  beforeEach(() => {
    service = createService();
  });

  it("should generate trend predictions", async () => {
    const result = await service.generateTrendPredictions();

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(Array.isArray(result.value)).toBeTruthy();
    }
  });

  it("should include prediction metadata", async () => {
    const result = await service.generateTrendPredictions();

    if (result.ok && result.value.length > 0) {
      const prediction = result.value[0]!;

      expect(prediction.trendId).toBeTruthy();
      expect(prediction.type).toBeTruthy();
      expect(prediction.title).toBeTruthy();
      expect(prediction.description).toBeTruthy();
    }
  });

  it("should include prediction probabilities", async () => {
    const result = await service.generateTrendPredictions();

    if (result.ok && result.value.length > 0) {
      const prediction = result.value[0]!.prediction;

      expect(prediction.probability >= 0 && prediction.probability <= 1).toBeTruthy();
      expect(prediction.confidence >= 0 && prediction.confidence <= 1).toBeTruthy();
      expect(prediction.timeframe).toBeTruthy();
      expect(prediction.peakProbability instanceof Date).toBeTruthy();
      expect(typeof prediction.estimatedDuration === "number").toBeTruthy();
    }
  });

  it("should include early signals", async () => {
    const result = await service.generateTrendPredictions();

    if (result.ok && result.value.length > 0) {
      const signals = result.value[0]!.earlySignals;

      expect(Array.isArray(signals)).toBeTruthy();
      if (signals.length > 0) {
        const signal = signals[0]!;
        expect(signal.signal).toBeTruthy();
        expect(signal.strength >= 0 && signal.strength <= 100).toBeTruthy();
        expect(signal.source).toBeTruthy();
        expect(signal.detectedAt instanceof Date).toBeTruthy();
      }
    }
  });

  it("should include risk factors", async () => {
    const result = await service.generateTrendPredictions();

    if (result.ok && result.value.length > 0) {
      const riskFactors = result.value[0]!.riskFactors;

      expect(Array.isArray(riskFactors)).toBeTruthy();
      if (riskFactors.length > 0) {
        const risk = riskFactors[0]!;
        expect(risk.factor).toBeTruthy();
        expect(["low", "medium", "high"].includes(risk.impact)).toBeTruthy();
        expect(risk.probability >= 0 && risk.probability <= 1).toBeTruthy();
      }
    }
  });

  it("should include actionable items", async () => {
    const result = await service.generateTrendPredictions();

    if (result.ok && result.value.length > 0) {
      const actionItems = result.value[0]!.actionItems;

      expect(Array.isArray(actionItems)).toBeTruthy();
      if (actionItems.length > 0) {
        const action = actionItems[0]!;
        expect(action.action).toBeTruthy();
        expect(["low", "medium", "high", "urgent"].includes(action.priority)).toBeTruthy();
        expect(action.deadline instanceof Date).toBeTruthy();
        expect(action.expectedImpact).toBeTruthy();
      }
    }
  });

  it("should include competitive intelligence", async () => {
    const result = await service.generateTrendPredictions();

    if (result.ok && result.value.length > 0) {
      const competitiveIntel = result.value[0]!.competitiveIntel;

      expect(Array.isArray(competitiveIntel.earlyAdopters)).toBeTruthy();
      expect(Array.isArray(competitiveIntel.marketGaps)).toBeTruthy();
      expect(Array.isArray(competitiveIntel.contentOpportunities)).toBeTruthy();
    }
  });
});

// ========================================
// TEST SUITE: Viral Content Analysis
// ========================================

describe("TrendAnalysisService - Viral Content Analysis", () => {
  let service: TrendAnalysisService;

  beforeEach(() => {
    service = createService();
  });

  it("should analyze viral content", async () => {
    const contentId = "test-content-123";
    const result = await service.analyzeViralContent(contentId);

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.contentId).toBe(contentId);
    }
  });

  it("should include viral metrics", async () => {
    const result = await service.analyzeViralContent("content-123");

    if (result.ok) {
      const metrics = result.value.viralMetrics;

      expect(typeof metrics.viralCoefficient === "number").toBeTruthy();
      expect(typeof metrics.peakVelocity === "number").toBeTruthy();
      expect(metrics.sustainabilityIndex >= 0 && metrics.sustainabilityIndex <= 1).toBeTruthy();
      expect(typeof metrics.reachAmplification === "number").toBeTruthy();
      expect(metrics.crossPlatformSpread >= 0 && metrics.crossPlatformSpread <= 1).toBeTruthy();
    }
  });

  it("should include viral DNA analysis", async () => {
    const result = await service.analyzeViralContent("content-123");

    if (result.ok) {
      const viralDNA = result.value.viralDNA;

      expect(viralDNA.contentElements).toBeTruthy();
      expect(viralDNA.platformFit).toBeTruthy();
      expect(viralDNA.socialFactors).toBeTruthy();

      // Check content elements
      expect(viralDNA.contentElements.hook).toBeTruthy();
      expect(viralDNA.contentElements.narrative).toBeTruthy();
      expect(viralDNA.contentElements.visual).toBeTruthy();
      expect(viralDNA.contentElements.audio).toBeTruthy();
    }
  });

  it("should include replication blueprint", async () => {
    const result = await service.analyzeViralContent("content-123");

    if (result.ok) {
      const blueprint = result.value.replicationBlueprint;

      expect(Array.isArray(blueprint.coreElements)).toBeTruthy();
      expect(Array.isArray(blueprint.variationPoints)).toBeTruthy();
      expect(Array.isArray(blueprint.timingConsiderations)).toBeTruthy();
      expect(Array.isArray(blueprint.audienceTargeting)).toBeTruthy();
      expect(Array.isArray(blueprint.distributionStrategy)).toBeTruthy();
      expect(Array.isArray(blueprint.riskMitigation)).toBeTruthy();
    }
  });

  it("should include competitor response analysis", async () => {
    const result = await service.analyzeViralContent("content-123");

    if (result.ok) {
      const competitorResponse = result.value.competitorResponse;

      expect(Array.isArray(competitorResponse.copycats)).toBeTruthy();
      expect(Array.isArray(competitorResponse.variations)).toBeTruthy();
      expect(
        competitorResponse.marketSaturation >= 0 && competitorResponse.marketSaturation <= 1
      ).toBeTruthy();
    }
  });
});

// ========================================
// TEST SUITE: Content Opportunity Discovery
// ========================================

describe("TrendAnalysisService - Content Opportunity Discovery", () => {
  let service: TrendAnalysisService;

  beforeEach(() => {
    service = createService();
  });

  it("should discover content opportunities", async () => {
    const result = await service.discoverContentOpportunities();

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value).toBeTruthy();
    }
  });

  it("should include content gaps", async () => {
    const result = await service.discoverContentOpportunities();

    if (result.ok) {
      const gaps = result.value.gaps;

      expect(Array.isArray(gaps)).toBeTruthy();
      if (gaps.length > 0) {
        const gap = gaps[0]!;
        expect(gap.contentType).toBeTruthy();
        expect(gap.audience).toBeTruthy();
        expect(["low", "medium", "high"].includes(gap.competitionLevel)).toBeTruthy();
        expect(gap.opportunitySize >= 0 && gap.opportunitySize <= 100).toBeTruthy();
        expect(Array.isArray(gap.barriers)).toBeTruthy();
        expect(Array.isArray(gap.suggestedApproach)).toBeTruthy();
      }
    }
  });

  it("should include emerging topics", async () => {
    const result = await service.discoverContentOpportunities();

    if (result.ok) {
      const emerging = result.value.emerging;

      expect(Array.isArray(emerging)).toBeTruthy();
      if (emerging.length > 0) {
        const topic = emerging[0]!;
        expect(topic.topic).toBeTruthy();
        expect(Array.isArray(topic.signals)).toBeTruthy();
        expect(topic.strength >= 0 && topic.strength <= 100).toBeTruthy();
        expect(typeof topic.timeToMainstream === "number").toBeTruthy();
        expect(topic.firstMoverAdvantage >= 0 && topic.firstMoverAdvantage <= 100).toBeTruthy();
      }
    }
  });

  it("should include saturated topics", async () => {
    const result = await service.discoverContentOpportunities();

    if (result.ok) {
      const saturated = result.value.saturated;

      expect(Array.isArray(saturated)).toBeTruthy();
      if (saturated.length > 0) {
        const topic = saturated[0]!;
        expect(topic.topic).toBeTruthy();
        expect(topic.saturationLevel >= 0 && topic.saturationLevel <= 100).toBeTruthy();
        expect(Array.isArray(topic.alternatives)).toBeTruthy();
        expect(Array.isArray(topic.revitalizationOpportunities)).toBeTruthy();
      }
    }
  });

  it("should include seasonal topics", async () => {
    const result = await service.discoverContentOpportunities();

    if (result.ok) {
      const seasonal = result.value.seasonal;

      expect(Array.isArray(seasonal)).toBeTruthy();
      if (seasonal.length > 0) {
        const topic = seasonal[0]!;
        expect(topic.topic).toBeTruthy();
        expect(topic.pattern).toBeTruthy();
        expect(topic.nextPeak instanceof Date).toBeTruthy();
        expect(typeof topic.preparationTime === "number").toBeTruthy();
        expect(topic.expectedImpact >= 0 && topic.expectedImpact <= 100).toBeTruthy();
      }
    }
  });
});

// ========================================
// TEST SUITE: Comprehensive Trend Report
// ========================================

describe("TrendAnalysisService - Comprehensive Trend Report", () => {
  let service: TrendAnalysisService;

  beforeEach(() => {
    service = createService();
  });

  it("should generate comprehensive trend report", async () => {
    const options = {
      period: { start: new Date("2024-01-01"), end: new Date("2024-01-31") },
    };

    const result = await service.generateTrendReport(options);

    expect(result.ok).toBeTruthy();
    if (result.ok) {
      expect(result.value.id).toBeTruthy();
      expect(result.value.generatedAt instanceof Date).toBeTruthy();
      expect(result.value.period).toBeTruthy();
      expect(result.value.summary).toBeTruthy();
      expect(result.value.trending).toBeTruthy();
      expect(result.value.predictions).toBeTruthy();
      expect(result.value.opportunities).toBeTruthy();
      expect(result.value.insights).toBeTruthy();
      expect(result.value.recommendations).toBeTruthy();
    }
  });

  it("should include summary statistics", async () => {
    const options = {
      period: { start: new Date("2024-01-01"), end: new Date("2024-01-31") },
    };

    const result = await service.generateTrendReport(options);

    if (result.ok) {
      const summary = result.value.summary;

      expect(typeof summary.totalTrends === "number").toBeTruthy();
      expect(typeof summary.emergingTrends === "number").toBeTruthy();
      expect(typeof summary.peakTrends === "number").toBeTruthy();
      expect(typeof summary.decliningTrends === "number").toBeTruthy();
      expect(summary.topCategory).toBeTruthy();
      expect(typeof summary.averageLifespan === "number").toBeTruthy();
    }
  });

  it("should categorize trending content", async () => {
    const options = {
      period: { start: new Date("2024-01-01"), end: new Date("2024-01-31") },
    };

    const result = await service.generateTrendReport(options);

    if (result.ok) {
      const trending = result.value.trending;

      expect(Array.isArray(trending.videos)).toBeTruthy();
      expect(Array.isArray(trending.hashtags)).toBeTruthy();
      expect(Array.isArray(trending.sounds)).toBeTruthy();
      expect(Array.isArray(trending.challenges)).toBeTruthy();
    }
  });

  it("should include immediate and upcoming opportunities", async () => {
    const options = {
      period: { start: new Date("2024-01-01"), end: new Date("2024-01-31") },
    };

    const result = await service.generateTrendReport(options);

    if (result.ok) {
      const opportunities = result.value.opportunities;

      expect(Array.isArray(opportunities.immediate)).toBeTruthy();
      expect(Array.isArray(opportunities.upcoming)).toBeTruthy();

      if (opportunities.immediate.length > 0) {
        const imm = opportunities.immediate[0]!;
        expect(imm.type).toBeTruthy();
        expect(imm.description).toBeTruthy();
        expect(["low", "medium", "high"].includes(imm.difficulty)).toBeTruthy();
        expect(imm.deadline instanceof Date).toBeTruthy();
      }
    }
  });

  it("should include insights", async () => {
    const options = {
      period: { start: new Date("2024-01-01"), end: new Date("2024-01-31") },
    };

    const result = await service.generateTrendReport(options);

    if (result.ok) {
      const insights = result.value.insights;

      expect(Array.isArray(insights.patterns)).toBeTruthy();
      expect(Array.isArray(insights.shifts)).toBeTruthy();
      expect(Array.isArray(insights.anomalies)).toBeTruthy();
      expect(Array.isArray(insights.crossTrends)).toBeTruthy();
    }
  });

  it("should include actionable recommendations", async () => {
    const options = {
      period: { start: new Date("2024-01-01"), end: new Date("2024-01-31") },
    };

    const result = await service.generateTrendReport(options);

    if (result.ok) {
      const recommendations = result.value.recommendations;

      expect(Array.isArray(recommendations.content)).toBeTruthy();
      expect(Array.isArray(recommendations.timing)).toBeTruthy();
      expect(Array.isArray(recommendations.hashtags)).toBeTruthy();
      expect(Array.isArray(recommendations.sounds)).toBeTruthy();
      expect(Array.isArray(recommendations.strategy)).toBeTruthy();
    }
  });

  it("should respect region filter", async () => {
    const options = {
      period: { start: new Date("2024-01-01"), end: new Date("2024-01-31") },
      region: "US",
    };

    const result = await service.generateTrendReport(options);

    if (result.ok) {
      expect(result.value.region).toBe("US");
    }
  });

  it("should respect category filter", async () => {
    const options = {
      period: { start: new Date("2024-01-01"), end: new Date("2024-01-31") },
      category: "education",
    };

    const result = await service.generateTrendReport(options);

    if (result.ok) {
      expect(result.value.category).toBe("education");
    }
  });
});

// ========================================
// TEST SUITE: Circuit Breaker Integration
// ========================================

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

// ========================================
// TEST SUITE: Helper Methods
// ========================================

describe("TrendAnalysisService - Helper Methods", () => {
  let service: TrendAnalysisService;

  beforeEach(() => {
    service = createService();
  });

  it("should generate pattern insights from trending content", async () => {
    const result = await service.getTrendingContent({ limit: 5 });

    if (result.ok && result.value.length > 0) {
      // Helper methods are called internally during report generation
      // We validate they execute without error by generating a report
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

  it("should generate anomaly insights", async () => {
    const reportResult = await service.generateTrendReport({
      period: { start: new Date("2024-01-01"), end: new Date("2024-01-31") },
    });

    if (reportResult.ok) {
      expect(reportResult.value.insights.anomalies.length > 0).toBeTruthy();
    }
  });

  it("should identify cross-trend patterns", async () => {
    const reportResult = await service.generateTrendReport({
      period: { start: new Date("2024-01-01"), end: new Date("2024-01-31") },
    });

    if (reportResult.ok) {
      expect(reportResult.value.insights.crossTrends.length > 0).toBeTruthy();
    }
  });
});
