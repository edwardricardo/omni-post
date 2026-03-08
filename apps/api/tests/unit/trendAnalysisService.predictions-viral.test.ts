/**
 * Unit Tests for TrendAnalysisService - Trend Predictions, Viral Content Analysis,
 * and Anomaly/Cross-Trend Helper Methods
 *
 * Tests prediction metadata, probabilities, signals, risk factors, action items,
 * competitive intelligence, viral metrics, DNA analysis, and report insight generation.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { TrendAnalysisService } from "../../src/trends/trendAnalysisService.js";
import { createService } from "./trendAnalysisService.test-helpers.js";

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

describe("TrendAnalysisService - Helper Methods (Anomaly/Cross-Trend)", { concurrency: 1 }, () => {
  let service: TrendAnalysisService;

  beforeEach(() => {
    service = createService();
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
