/**
 * Unit Tests for TrendAnalysisService - Viral Content Analysis
 * of a single content item
 *
 * Tests that analyzeViralContent succeeds and returns the analysis of
 * the content id it was given, and that generateTrendPredictions returns
 * an empty list while no prediction provider is connected.
 *
 * @file trendAnalysisService.predictions-viral.test.ts
 * @description Tests for TrendAnalysisService - Viral Content Analysis
 * @layer infrastructure
 */

import { describe, it, beforeEach, expect } from "vitest";
import { TrendAnalysisService } from "../../src/trends/trendAnalysisService.js";
import { createService } from "./trendAnalysisService.test-helpers.js";

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
});

describe("TrendAnalysisService - Trend Predictions", () => {
  let service: TrendAnalysisService;

  beforeEach(() => {
    service = createService();
  });

  it("returns an empty list of predictions while no prediction provider is connected", async () => {
    const result = await service.generateTrendPredictions({ timeHorizon: "short" });

    expect(result).toEqual({ ok: true, value: [] });
  });
});
