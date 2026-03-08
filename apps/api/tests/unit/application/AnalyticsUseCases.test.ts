/**
 * Application Layer - Analytics Use Cases Unit Tests
 *
 * Part of Sprint 11: TDD Implementation
 * Tests for GetCrossPlatformAnalytics, ComparePerformance, and CalculateROI use cases.
 */

import { describe, it, beforeEach } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";

import {
  GetCrossPlatformAnalyticsUseCase,
  ComparePerformanceUseCase,
  CalculateROIUseCase,
  type GetAnalyticsInput,
  type ComparePerformanceInput,
  type CalculateROIInput,
} from "../../../src/application/analytics/index.js";
import { USE_CASE_ERRORS } from "../../../src/application/UseCase.js";

function createMocks(t: TestContext) {
  const mockCrossPlatformEngine = {
    generateCrossPlatformMetrics: t.mock.fn(async () => ({
      summary: {
        totalPosts: 150,
        totalEngagements: 25000,
        avgEngagementRate: 3.5,
        totalReach: 500000,
        topPerformingProvider: "INSTAGRAM",
      },
      byProvider: {},
      contentInsights: {},
      audienceAnalytics: {},
      benchmarking: {},
      trends: {},
      recommendations: [],
    })),
  };

  const mockPerformanceComparator = {
    generatePerformanceComparison: t.mock.fn(async () => ({
      currentPerformance: {
        totalPosts: 50,
        totalEngagements: 8000,
        avgEngagementRate: 4.2,
      },
      industryBenchmarks: [],
      historicalComparison: {},
      keyInsights: [],
      recommendations: [],
    })),
    compareMetricsOverTime: t.mock.fn(async () => ({
      metrics: ["engagement_rate", "reach"],
      periods: [],
      trends: {},
      insights: [],
    })),
  };

  const mockROICalculator = {
    calculateROI: t.mock.fn(async () => ({
      totalInvestment: 5000,
      totalRevenue: 15000,
      roi: 200,
      roiPercentage: 200,
      breakdown: {},
    })),
    calculateChannelROI: t.mock.fn(async () => ({
      channels: [],
      bestPerforming: "INSTAGRAM",
      recommendations: [],
    })),
  };

  return {
    mockCrossPlatformEngine,
    mockPerformanceComparator,
    mockROICalculator,
  };
}

describe("Analytics Use Cases (TDD)", { concurrency: 1 }, () => {
  // Mock dependencies
  let mockCrossPlatformEngine: ReturnType<typeof createMocks>["mockCrossPlatformEngine"];
  let mockPerformanceComparator: ReturnType<typeof createMocks>["mockPerformanceComparator"];
  let mockROICalculator: ReturnType<typeof createMocks>["mockROICalculator"];

  beforeEach((t) => {
    const mocks = createMocks(t);
    mockCrossPlatformEngine = mocks.mockCrossPlatformEngine;
    mockPerformanceComparator = mocks.mockPerformanceComparator;
    mockROICalculator = mocks.mockROICalculator;
  });

  describe("GetCrossPlatformAnalyticsUseCase", { concurrency: 1 }, () => {
    it("should get cross-platform analytics for an account", async () => {
      const useCase = new GetCrossPlatformAnalyticsUseCase(mockCrossPlatformEngine);

      const input: GetAnalyticsInput = {
        accountId: randomUUID(),
        timeRange: "30d",
      };

      const result = await useCase.execute(input);

      assert.ok(result.ok, "Should successfully get analytics");
      if (result.ok) {
        assert.ok(result.value.summary, "Should have summary");
        assert.ok(result.value.summary.totalPosts >= 0, "Should have total posts");
        assert.ok(result.value.summary.avgEngagementRate >= 0, "Should have engagement rate");
      }
    });

    it("should filter analytics by project", async () => {
      const useCase = new GetCrossPlatformAnalyticsUseCase(mockCrossPlatformEngine);

      const input: GetAnalyticsInput = {
        accountId: randomUUID(),
        projectId: randomUUID(),
        timeRange: "7d",
      };

      const result = await useCase.execute(input);

      assert.ok(result.ok);
    });

    it("should filter analytics by providers", async () => {
      const useCase = new GetCrossPlatformAnalyticsUseCase(mockCrossPlatformEngine);

      const input: GetAnalyticsInput = {
        accountId: randomUUID(),
        timeRange: "30d",
        providers: ["INSTAGRAM", "X"],
      };

      const result = await useCase.execute(input);

      assert.ok(result.ok);
    });

    it("should support custom date range", async () => {
      const useCase = new GetCrossPlatformAnalyticsUseCase(mockCrossPlatformEngine);

      const input: GetAnalyticsInput = {
        accountId: randomUUID(),
        timeRange: "custom",
        startDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
        endDate: new Date().toISOString(),
      };

      const result = await useCase.execute(input);

      assert.ok(result.ok);
    });

    it("should reject empty account ID", async () => {
      const useCase = new GetCrossPlatformAnalyticsUseCase(mockCrossPlatformEngine);

      const input: GetAnalyticsInput = {
        accountId: "",
        timeRange: "30d",
      };

      const result = await useCase.execute(input);

      assert.ok(!result.ok);
      if (!result.ok) {
        assert.equal(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
      }
    });

    it("should include competitive analysis when requested", async () => {
      const useCase = new GetCrossPlatformAnalyticsUseCase(mockCrossPlatformEngine);

      const input: GetAnalyticsInput = {
        accountId: randomUUID(),
        timeRange: "30d",
        includeCompetitive: true,
      };

      const result = await useCase.execute(input);

      assert.ok(result.ok);
    });
  });

  describe("ComparePerformanceUseCase", { concurrency: 1 }, () => {
    it("should compare performance across time periods", async () => {
      const useCase = new ComparePerformanceUseCase(mockPerformanceComparator);

      const input: ComparePerformanceInput = {
        accountId: randomUUID(),
        timeRange: "30d",
      };

      const result = await useCase.execute(input);

      assert.ok(result.ok, "Should successfully compare performance");
      if (result.ok) {
        assert.ok(result.value.currentPerformance, "Should have current performance");
        assert.ok(result.value.keyInsights, "Should have key insights");
      }
    });

    it("should include industry benchmarks when requested", async () => {
      const useCase = new ComparePerformanceUseCase(mockPerformanceComparator);

      const input: ComparePerformanceInput = {
        accountId: randomUUID(),
        timeRange: "30d",
        includeIndustryBenchmarks: true,
      };

      const result = await useCase.execute(input);

      assert.ok(result.ok);
      if (result.ok) {
        assert.ok(result.value.industryBenchmarks !== undefined);
      }
    });

    it("should include historical comparison when requested", async () => {
      const useCase = new ComparePerformanceUseCase(mockPerformanceComparator);

      const input: ComparePerformanceInput = {
        accountId: randomUUID(),
        timeRange: "30d",
        includeHistoricalComparison: true,
      };

      const result = await useCase.execute(input);

      assert.ok(result.ok);
      if (result.ok) {
        assert.ok(result.value.historicalComparison !== undefined);
      }
    });

    it("should compare specific metrics over time", async () => {
      const useCase = new ComparePerformanceUseCase(mockPerformanceComparator);

      const input: ComparePerformanceInput = {
        accountId: randomUUID(),
        timeRange: "30d",
        metrics: ["engagement_rate", "reach", "views"],
        comparePeriods: ["7d", "30d", "90d"],
      };

      const result = await useCase.execute(input);

      assert.ok(result.ok);
    });

    it("should reject empty account ID", async () => {
      const useCase = new ComparePerformanceUseCase(mockPerformanceComparator);

      const input: ComparePerformanceInput = {
        accountId: "",
        timeRange: "30d",
      };

      const result = await useCase.execute(input);

      assert.ok(!result.ok);
      if (!result.ok) {
        assert.equal(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
      }
    });
  });

  describe("CalculateROIUseCase", { concurrency: 1 }, () => {
    it("should calculate ROI for a project", async () => {
      const useCase = new CalculateROIUseCase(mockROICalculator);

      const input: CalculateROIInput = {
        accountId: randomUUID(),
        projectId: randomUUID(),
        timeRange: "30d",
      };

      const result = await useCase.execute(input);

      assert.ok(result.ok, "Should successfully calculate ROI");
      if (result.ok) {
        assert.ok(result.value.roi !== undefined, "Should have ROI value");
        assert.ok(result.value.totalInvestment !== undefined, "Should have total investment");
        assert.ok(result.value.totalRevenue !== undefined, "Should have total revenue");
      }
    });

    it("should calculate ROI by channel", async () => {
      const useCase = new CalculateROIUseCase(mockROICalculator);

      const input: CalculateROIInput = {
        accountId: randomUUID(),
        timeRange: "30d",
        byChannel: true,
      };

      const result = await useCase.execute(input);

      assert.ok(result.ok);
      if (result.ok) {
        assert.ok(
          result.value.channelBreakdown !== undefined || result.value.breakdown !== undefined
        );
      }
    });

    it("should include investment details", async () => {
      const useCase = new CalculateROIUseCase(mockROICalculator);

      const input: CalculateROIInput = {
        accountId: randomUUID(),
        timeRange: "30d",
        investmentDetails: {
          adSpend: 3000,
          contentCreation: 1500,
          tools: 500,
        },
      };

      const result = await useCase.execute(input);

      assert.ok(result.ok);
    });

    it("should reject empty account ID", async () => {
      const useCase = new CalculateROIUseCase(mockROICalculator);

      const input: CalculateROIInput = {
        accountId: "",
        timeRange: "30d",
      };

      const result = await useCase.execute(input);

      assert.ok(!result.ok);
      if (!result.ok) {
        assert.equal(result.error.code, USE_CASE_ERRORS.VALIDATION_FAILED);
      }
    });

    it("should calculate ROI for specific providers", async () => {
      const useCase = new CalculateROIUseCase(mockROICalculator);

      const input: CalculateROIInput = {
        accountId: randomUUID(),
        timeRange: "30d",
        providers: ["INSTAGRAM", "FACEBOOK"],
      };

      const result = await useCase.execute(input);

      assert.ok(result.ok);
    });
  });
});
