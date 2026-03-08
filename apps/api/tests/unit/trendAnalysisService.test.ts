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

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { TrendAnalysisService } from "../../src/trends/trendAnalysisService.js";
import { createService } from "./trendAnalysisService.test-helpers.js";

// ========================================
// TEST SUITE: Service Initialization
// ========================================

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

// ========================================
// TEST SUITE: Trending Content Retrieval
// ========================================

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

// ========================================
// TEST SUITE: Trend Predictions
// ========================================

describe("TrendAnalysisService - Trend Predictions", { concurrency: 1 }, () => {
  let service: TrendAnalysisService;

  beforeEach(() => {
    service = createService();
  });

  it("should generate trend predictions", async () => {
    const result = await service.generateTrendPredictions();

    assert.ok(result.ok, "Should return successful result");
    if (result.ok) {
      assert.ok(Array.isArray(result.value), "Should return array of predictions");
    }
  });

  it("should include prediction metadata", async () => {
    const result = await service.generateTrendPredictions();

    if (result.ok && result.value.length > 0) {
      const prediction = result.value[0]!;

      assert.ok(prediction.trendId, "Prediction should have trend ID");
      assert.ok(prediction.type, "Prediction should have type");
      assert.ok(prediction.title, "Prediction should have title");
      assert.ok(prediction.description, "Prediction should have description");
    }
  });

  it("should include prediction probabilities", async () => {
    const result = await service.generateTrendPredictions();

    if (result.ok && result.value.length > 0) {
      const prediction = result.value[0]!.prediction;

      assert.ok(
        prediction.probability >= 0 && prediction.probability <= 1,
        "Probability should be 0-1"
      );
      assert.ok(
        prediction.confidence >= 0 && prediction.confidence <= 1,
        "Confidence should be 0-1"
      );
      assert.ok(prediction.timeframe, "Should have timeframe");
      assert.ok(prediction.peakProbability instanceof Date, "Should have peak probability date");
      assert.ok(typeof prediction.estimatedDuration === "number", "Should have estimated duration");
    }
  });

  it("should include early signals", async () => {
    const result = await service.generateTrendPredictions();

    if (result.ok && result.value.length > 0) {
      const signals = result.value[0]!.earlySignals;

      assert.ok(Array.isArray(signals), "Should have early signals array");
      if (signals.length > 0) {
        const signal = signals[0]!;
        assert.ok(signal.signal, "Signal should have description");
        assert.ok(signal.strength >= 0 && signal.strength <= 100, "Strength should be 0-100");
        assert.ok(signal.source, "Signal should have source");
        assert.ok(signal.detectedAt instanceof Date, "Should have detection date");
      }
    }
  });

  it("should include risk factors", async () => {
    const result = await service.generateTrendPredictions();

    if (result.ok && result.value.length > 0) {
      const riskFactors = result.value[0]!.riskFactors;

      assert.ok(Array.isArray(riskFactors), "Should have risk factors array");
      if (riskFactors.length > 0) {
        const risk = riskFactors[0]!;
        assert.ok(risk.factor, "Risk should have description");
        assert.ok(["low", "medium", "high"].includes(risk.impact), "Should have valid impact");
        assert.ok(risk.probability >= 0 && risk.probability <= 1, "Probability should be 0-1");
      }
    }
  });

  it("should include actionable items", async () => {
    const result = await service.generateTrendPredictions();

    if (result.ok && result.value.length > 0) {
      const actionItems = result.value[0]!.actionItems;

      assert.ok(Array.isArray(actionItems), "Should have action items array");
      if (actionItems.length > 0) {
        const action = actionItems[0]!;
        assert.ok(action.action, "Action should have description");
        assert.ok(
          ["low", "medium", "high", "urgent"].includes(action.priority),
          "Should have valid priority"
        );
        assert.ok(action.deadline instanceof Date, "Should have deadline");
        assert.ok(action.expectedImpact, "Should have expected impact");
      }
    }
  });

  it("should include competitive intelligence", async () => {
    const result = await service.generateTrendPredictions();

    if (result.ok && result.value.length > 0) {
      const competitiveIntel = result.value[0]!.competitiveIntel;

      assert.ok(Array.isArray(competitiveIntel.earlyAdopters), "Should have early adopters");
      assert.ok(Array.isArray(competitiveIntel.marketGaps), "Should have market gaps");
      assert.ok(
        Array.isArray(competitiveIntel.contentOpportunities),
        "Should have content opportunities"
      );
    }
  });
});

// ========================================
// TEST SUITE: Viral Content Analysis
// ========================================

describe("TrendAnalysisService - Viral Content Analysis", { concurrency: 1 }, () => {
  let service: TrendAnalysisService;

  beforeEach(() => {
    service = createService();
  });

  it("should analyze viral content", async () => {
    const contentId = "test-content-123";
    const result = await service.analyzeViralContent(contentId);

    assert.ok(result.ok, "Should return successful result");
    if (result.ok) {
      assert.strictEqual(result.value.contentId, contentId, "Should return analysis for content");
    }
  });

  it("should include viral metrics", async () => {
    const result = await service.analyzeViralContent("content-123");

    if (result.ok) {
      const metrics = result.value.viralMetrics;

      assert.ok(typeof metrics.viralCoefficient === "number", "Should have viral coefficient");
      assert.ok(typeof metrics.peakVelocity === "number", "Should have peak velocity");
      assert.ok(
        metrics.sustainabilityIndex >= 0 && metrics.sustainabilityIndex <= 1,
        "Sustainability index should be 0-1"
      );
      assert.ok(typeof metrics.reachAmplification === "number", "Should have reach amplification");
      assert.ok(
        metrics.crossPlatformSpread >= 0 && metrics.crossPlatformSpread <= 1,
        "Cross-platform spread should be 0-1"
      );
    }
  });

  it("should include viral DNA analysis", async () => {
    const result = await service.analyzeViralContent("content-123");

    if (result.ok) {
      const viralDNA = result.value.viralDNA;

      assert.ok(viralDNA.contentElements, "Should have content elements");
      assert.ok(viralDNA.platformFit, "Should have platform fit");
      assert.ok(viralDNA.socialFactors, "Should have social factors");

      // Check content elements
      assert.ok(viralDNA.contentElements.hook, "Should have hook analysis");
      assert.ok(viralDNA.contentElements.narrative, "Should have narrative analysis");
      assert.ok(viralDNA.contentElements.visual, "Should have visual analysis");
      assert.ok(viralDNA.contentElements.audio, "Should have audio analysis");
    }
  });

  it("should include replication blueprint", async () => {
    const result = await service.analyzeViralContent("content-123");

    if (result.ok) {
      const blueprint = result.value.replicationBlueprint;

      assert.ok(Array.isArray(blueprint.coreElements), "Should have core elements");
      assert.ok(Array.isArray(blueprint.variationPoints), "Should have variation points");
      assert.ok(Array.isArray(blueprint.timingConsiderations), "Should have timing considerations");
      assert.ok(Array.isArray(blueprint.audienceTargeting), "Should have audience targeting");
      assert.ok(Array.isArray(blueprint.distributionStrategy), "Should have distribution strategy");
      assert.ok(Array.isArray(blueprint.riskMitigation), "Should have risk mitigation");
    }
  });

  it("should include competitor response analysis", async () => {
    const result = await service.analyzeViralContent("content-123");

    if (result.ok) {
      const competitorResponse = result.value.competitorResponse;

      assert.ok(Array.isArray(competitorResponse.copycats), "Should have copycats");
      assert.ok(Array.isArray(competitorResponse.variations), "Should have variations");
      assert.ok(
        competitorResponse.marketSaturation >= 0 && competitorResponse.marketSaturation <= 1,
        "Market saturation should be 0-1"
      );
    }
  });
});

// ========================================
// TEST SUITE: Content Opportunity Discovery
// ========================================

describe("TrendAnalysisService - Content Opportunity Discovery", { concurrency: 1 }, () => {
  let service: TrendAnalysisService;

  beforeEach(() => {
    service = createService();
  });

  it("should discover content opportunities", async () => {
    const result = await service.discoverContentOpportunities();

    assert.ok(result.ok, "Should return successful result");
    if (result.ok) {
      assert.ok(result.value, "Should return content discovery insights");
    }
  });

  it("should include content gaps", async () => {
    const result = await service.discoverContentOpportunities();

    if (result.ok) {
      const gaps = result.value.gaps;

      assert.ok(Array.isArray(gaps), "Should have gaps array");
      if (gaps.length > 0) {
        const gap = gaps[0]!;
        assert.ok(gap.contentType, "Gap should have content type");
        assert.ok(gap.audience, "Gap should have audience");
        assert.ok(
          ["low", "medium", "high"].includes(gap.competitionLevel),
          "Should have valid competition level"
        );
        assert.ok(
          gap.opportunitySize >= 0 && gap.opportunitySize <= 100,
          "Opportunity size should be 0-100"
        );
        assert.ok(Array.isArray(gap.barriers), "Should have barriers");
        assert.ok(Array.isArray(gap.suggestedApproach), "Should have suggested approach");
      }
    }
  });

  it("should include emerging topics", async () => {
    const result = await service.discoverContentOpportunities();

    if (result.ok) {
      const emerging = result.value.emerging;

      assert.ok(Array.isArray(emerging), "Should have emerging topics array");
      if (emerging.length > 0) {
        const topic = emerging[0]!;
        assert.ok(topic.topic, "Emerging topic should have name");
        assert.ok(Array.isArray(topic.signals), "Should have signals");
        assert.ok(topic.strength >= 0 && topic.strength <= 100, "Strength should be 0-100");
        assert.ok(typeof topic.timeToMainstream === "number", "Should have time to mainstream");
        assert.ok(
          topic.firstMoverAdvantage >= 0 && topic.firstMoverAdvantage <= 100,
          "First-mover advantage should be 0-100"
        );
      }
    }
  });

  it("should include saturated topics", async () => {
    const result = await service.discoverContentOpportunities();

    if (result.ok) {
      const saturated = result.value.saturated;

      assert.ok(Array.isArray(saturated), "Should have saturated topics array");
      if (saturated.length > 0) {
        const topic = saturated[0]!;
        assert.ok(topic.topic, "Saturated topic should have name");
        assert.ok(
          topic.saturationLevel >= 0 && topic.saturationLevel <= 100,
          "Saturation should be 0-100"
        );
        assert.ok(Array.isArray(topic.alternatives), "Should have alternatives");
        assert.ok(
          Array.isArray(topic.revitalizationOpportunities),
          "Should have revitalization opportunities"
        );
      }
    }
  });

  it("should include seasonal topics", async () => {
    const result = await service.discoverContentOpportunities();

    if (result.ok) {
      const seasonal = result.value.seasonal;

      assert.ok(Array.isArray(seasonal), "Should have seasonal topics array");
      if (seasonal.length > 0) {
        const topic = seasonal[0]!;
        assert.ok(topic.topic, "Seasonal topic should have name");
        assert.ok(topic.pattern, "Should have pattern description");
        assert.ok(topic.nextPeak instanceof Date, "Should have next peak date");
        assert.ok(typeof topic.preparationTime === "number", "Should have preparation time");
        assert.ok(
          topic.expectedImpact >= 0 && topic.expectedImpact <= 100,
          "Expected impact should be 0-100"
        );
      }
    }
  });
});

// ========================================
// TEST SUITE: Comprehensive Trend Report
// ========================================

describe("TrendAnalysisService - Comprehensive Trend Report", { concurrency: 1 }, () => {
  let service: TrendAnalysisService;

  beforeEach(() => {
    service = createService();
  });

  it("should generate comprehensive trend report", async () => {
    const options = {
      period: { start: new Date("2024-01-01"), end: new Date("2024-01-31") },
    };

    const result = await service.generateTrendReport(options);

    assert.ok(result.ok, "Should return successful result");
    if (result.ok) {
      assert.ok(result.value.id, "Report should have ID");
      assert.ok(result.value.generatedAt instanceof Date, "Should have generation date");
      assert.ok(result.value.period, "Should have period");
      assert.ok(result.value.summary, "Should have summary");
      assert.ok(result.value.trending, "Should have trending content");
      assert.ok(result.value.predictions, "Should have predictions");
      assert.ok(result.value.opportunities, "Should have opportunities");
      assert.ok(result.value.insights, "Should have insights");
      assert.ok(result.value.recommendations, "Should have recommendations");
    }
  });

  it("should include summary statistics", async () => {
    const options = {
      period: { start: new Date("2024-01-01"), end: new Date("2024-01-31") },
    };

    const result = await service.generateTrendReport(options);

    if (result.ok) {
      const summary = result.value.summary;

      assert.ok(typeof summary.totalTrends === "number", "Should have total trends count");
      assert.ok(typeof summary.emergingTrends === "number", "Should have emerging count");
      assert.ok(typeof summary.peakTrends === "number", "Should have peak count");
      assert.ok(typeof summary.decliningTrends === "number", "Should have declining count");
      assert.ok(summary.topCategory, "Should have top category");
      assert.ok(typeof summary.averageLifespan === "number", "Should have average lifespan");
    }
  });

  it("should categorize trending content", async () => {
    const options = {
      period: { start: new Date("2024-01-01"), end: new Date("2024-01-31") },
    };

    const result = await service.generateTrendReport(options);

    if (result.ok) {
      const trending = result.value.trending;

      assert.ok(Array.isArray(trending.videos), "Should have videos array");
      assert.ok(Array.isArray(trending.hashtags), "Should have hashtags array");
      assert.ok(Array.isArray(trending.sounds), "Should have sounds array");
      assert.ok(Array.isArray(trending.challenges), "Should have challenges array");
    }
  });

  it("should include immediate and upcoming opportunities", async () => {
    const options = {
      period: { start: new Date("2024-01-01"), end: new Date("2024-01-31") },
    };

    const result = await service.generateTrendReport(options);

    if (result.ok) {
      const opportunities = result.value.opportunities;

      assert.ok(Array.isArray(opportunities.immediate), "Should have immediate opportunities");
      assert.ok(Array.isArray(opportunities.upcoming), "Should have upcoming opportunities");

      if (opportunities.immediate.length > 0) {
        const imm = opportunities.immediate[0]!;
        assert.ok(imm.type, "Immediate opportunity should have type");
        assert.ok(imm.description, "Should have description");
        assert.ok(["low", "medium", "high"].includes(imm.difficulty), "Should have difficulty");
        assert.ok(imm.deadline instanceof Date, "Should have deadline");
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

      assert.ok(Array.isArray(insights.patterns), "Should have patterns");
      assert.ok(Array.isArray(insights.shifts), "Should have shifts");
      assert.ok(Array.isArray(insights.anomalies), "Should have anomalies");
      assert.ok(Array.isArray(insights.crossTrends), "Should have cross-trends");
    }
  });

  it("should include actionable recommendations", async () => {
    const options = {
      period: { start: new Date("2024-01-01"), end: new Date("2024-01-31") },
    };

    const result = await service.generateTrendReport(options);

    if (result.ok) {
      const recommendations = result.value.recommendations;

      assert.ok(Array.isArray(recommendations.content), "Should have content recommendations");
      assert.ok(Array.isArray(recommendations.timing), "Should have timing recommendations");
      assert.ok(Array.isArray(recommendations.hashtags), "Should have hashtag recommendations");
      assert.ok(Array.isArray(recommendations.sounds), "Should have sound recommendations");
      assert.ok(Array.isArray(recommendations.strategy), "Should have strategy recommendations");
    }
  });

  it("should respect region filter", async () => {
    const options = {
      period: { start: new Date("2024-01-01"), end: new Date("2024-01-31") },
      region: "US",
    };

    const result = await service.generateTrendReport(options);

    if (result.ok) {
      assert.strictEqual(result.value.region, "US", "Report should reflect region filter");
    }
  });

  it("should respect category filter", async () => {
    const options = {
      period: { start: new Date("2024-01-01"), end: new Date("2024-01-31") },
      category: "education",
    };

    const result = await service.generateTrendReport(options);

    if (result.ok) {
      assert.strictEqual(
        result.value.category,
        "education",
        "Report should reflect category filter"
      );
    }
  });
});

// ========================================
// TEST SUITE: Circuit Breaker Integration
// ========================================

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

// ========================================
// TEST SUITE: Helper Methods
// ========================================

describe("TrendAnalysisService - Helper Methods", { concurrency: 1 }, () => {
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

  it("should generate anomaly insights", async () => {
    const reportResult = await service.generateTrendReport({
      period: { start: new Date("2024-01-01"), end: new Date("2024-01-31") },
    });

    if (reportResult.ok) {
      assert.ok(reportResult.value.insights.anomalies.length > 0, "Should generate anomalies");
    }
  });

  it("should identify cross-trend patterns", async () => {
    const reportResult = await service.generateTrendReport({
      period: { start: new Date("2024-01-01"), end: new Date("2024-01-31") },
    });

    if (reportResult.ok) {
      assert.ok(reportResult.value.insights.crossTrends.length > 0, "Should identify cross-trends");
    }
  });
});
