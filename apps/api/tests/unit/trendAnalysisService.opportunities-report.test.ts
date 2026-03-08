/**
 * Unit Tests for TrendAnalysisService - Content Opportunity Discovery and Comprehensive Reports
 *
 * Tests content gaps, emerging topics, saturated topics, seasonal trends,
 * and full trend report generation with summary statistics, categorization,
 * opportunities, insights, recommendations, and filter support.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { TrendAnalysisService } from "../../src/trends/trendAnalysisService.js";
import { createService } from "./trendAnalysisService.test-helpers.js";

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
