/**
 * Unit Tests for TrendAnalysisService - Trend Predictions, Viral Content Analysis,
 * and Anomaly/Cross-Trend Helper Methods
 *
 * Tests prediction metadata, probabilities, signals, risk factors, action items,
 * competitive intelligence, viral metrics, DNA analysis, and report insight generation.
 *
 * @file trendAnalysisService.predictions-viral.test.ts
 * @description Tests for TrendAnalysisService - Trend Predictions
 * @layer infrastructure
 */

import { describe, it, beforeEach, expect } from "vitest";
import { TrendAnalysisService } from "../../src/trends/trendAnalysisService.js";
import { createService } from "./trendAnalysisService.test-helpers.js";

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

describe("TrendAnalysisService - Helper Methods (Anomaly/Cross-Trend)", () => {
  let service: TrendAnalysisService;

  beforeEach(() => {
    service = createService();
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
