/**
 * Unit Tests for TrendAnalysisService - Content Opportunity Discovery and Comprehensive Reports
 *
 * Tests content gaps, emerging topics, saturated topics, seasonal trends,
 * and full trend report generation with summary statistics, categorization,
 * opportunities, insights, recommendations, and filter support.
 *
 * @file trendAnalysisService.opportunities-report.test.ts
 * @description Tests for TrendAnalysisService - Content Opportunity Discovery
 * @layer infrastructure
 */

import { describe, it, beforeEach, expect } from "vitest";
import { TrendAnalysisService } from "../../src/trends/trendAnalysisService.js";
import { createService } from "./trendAnalysisService.test-helpers.js";

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
