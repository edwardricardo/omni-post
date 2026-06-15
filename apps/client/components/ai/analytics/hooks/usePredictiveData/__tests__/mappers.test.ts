/**
 * @file mappers.test.ts
 * @description Unit tests for the predictive-analytics mappers that adapt the real
 *              backend use-case outputs (verified live: /analytics/roi,
 *              /analytics/cross-platform, /ai/predict-timing) into the card prop
 *              shapes. Fixtures mirror the actual API payloads so the cards render
 *              real data once the endpoints are wired.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { mapToROIForecasts } from "../mapROIForecasts.js";
import { mapToCompetitorAnalysis } from "../mapCompetitorAnalysis.js";
import { mapToPerformancePredictions } from "../mapTimingPredictions.js";
import type { ROIApiValue, CrossPlatformApiValue, PredictTimingApiValue } from "../apiTypes.js";

describe("mapToROIForecasts", () => {
  it("maps a real CalculateROIOutput payload into a single ROIForecast", () => {
    const roi: ROIApiValue = {
      totalInvestment: 199,
      totalRevenue: 500,
      roi: 1.5,
      roiPercentage: 150,
      channelBreakdown: [
        { channel: "X", investment: 100, revenue: 250, roi: 1.5, performance: "good" },
      ],
      recommendations: ["Increase X budget"],
    };
    const out = mapToROIForecasts(roi, "30d");
    expect(out).toHaveLength(1);
    expect(out[0]?.expectedROI).toBe(1.5);
    expect(out[0]?.timeframe).toBe("30d");
    // factors come straight from channelBreakdown (one entry here).
    expect(out[0]?.factors.length).toBe(1);
  });

  it("returns an empty factors list when the backend omits channelBreakdown", () => {
    const roi: ROIApiValue = {
      totalInvestment: 199,
      totalRevenue: 0,
      roi: -1,
      roiPercentage: -100,
    };
    const out = mapToROIForecasts(roi, "7d");
    expect(out[0]?.factors).toEqual([]);
  });

  it("returns [] when there is no data", () => {
    expect(mapToROIForecasts(undefined, "30d")).toEqual([]);
  });
});

describe("mapToCompetitorAnalysis", () => {
  it("surfaces the industry-average benchmark from the summary when byProvider is empty", () => {
    const cross: CrossPlatformApiValue = {
      summary: {
        totalPosts: 12,
        totalEngagements: 240,
        avgEngagementRate: 4,
        totalReach: 12000,
      },
      recommendations: ["Post more video"],
    };
    const out = mapToCompetitorAnalysis(cross);
    expect(out).toHaveLength(1);
    expect(out[0]?.competitor).toBe("Industry Average");
    expect(out[0]?.performance.avgEngagement).toBe(4);
    expect(out[0]?.opportunities).toContain("Post more video");
  });

  it("returns [] when there is no data", () => {
    expect(mapToCompetitorAnalysis(undefined)).toEqual([]);
  });
});

describe("mapToPerformancePredictions", () => {
  it("maps real predict-timing slots to one prediction per platform", () => {
    const timing: PredictTimingApiValue[] = [
      {
        optimalSlots: [
          { dayOfWeek: 1, hour: 8, score: 88, audienceReach: 65, competitionLevel: "low" },
        ],
        provider: "X",
        timezone: "UTC",
        recommendations: [],
        activityPatterns: [{ hour: 8, dayOfWeek: 1, activityLevel: 90, audiencePercentage: 12 }],
      },
    ];
    const out = mapToPerformancePredictions(timing, ["twitter"]);
    expect(out).toHaveLength(1);
    expect(out[0]?.platform).toBe("twitter");
    expect(out[0]?.optimalPostingTime.hour).toBe(8);
  });

  it("returns [] when there are no timing results at all", () => {
    expect(mapToPerformancePredictions([], ["twitter", "instagram"])).toEqual([]);
  });

  it("falls back to a zero-confidence stub for a platform whose result has no slots", () => {
    const timing: PredictTimingApiValue[] = [
      {
        optimalSlots: [
          { dayOfWeek: 2, hour: 9, score: 80, audienceReach: 60, competitionLevel: "low" },
        ],
        provider: "X",
        timezone: "UTC",
        recommendations: [],
      },
      { optimalSlots: [], provider: "INSTAGRAM", timezone: "UTC", recommendations: [] },
    ];
    const out = mapToPerformancePredictions(timing, ["twitter", "instagram"]);
    expect(out).toHaveLength(2);
    expect(out[1]?.platform).toBe("instagram");
    expect(out[1]?.expectedEngagement.value).toBe(0); // stub
  });
});
