/**
 * Unit Tests for TrendAnalysisService - Viral Content Analysis
 * of a single content item
 *
 * Tests that analyzeViralContent succeeds and returns the analysis of
 * the content id it was given.
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
