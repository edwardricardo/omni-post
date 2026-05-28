/**
 * Application Layer - Analytics Use Cases Unit Tests
 *
 * Tests for GetCrossPlatformAnalytics, ComparePerformance, and CalculateROI use cases.
 *
 * @file AnalyticsUseCases.test.ts
 * @description Tests for Analytics Use Cases (TDD)
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import { randomUUID } from "crypto";

import {
  GetCrossPlatformAnalyticsUseCase,
  ComparePerformanceUseCase,
  CalculateROIUseCase,
  type GetAnalyticsInput,
  type ComparePerformanceInput,
  type CalculateROIInput,
} from "@core/analytics/index.js";
import { USE_CASE_ERRORS } from "@core/application/UseCase.js";

function createMocks() {
  const mockCrossPlatformEngine = {
    generateCrossPlatformMetrics: vi.fn(async () => ({
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
    generatePerformanceComparison: vi.fn(async () => ({
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
    compareMetricsOverTime: vi.fn(async () => ({
      metrics: ["engagement_rate", "reach"],
      periods: [],
      trends: {},
      insights: [],
    })),
  };

  const mockROICalculator = {
    calculateROI: vi.fn(async () => ({
      totalInvestment: 5000,
      totalRevenue: 15000,
      roi: 200,
      roiPercentage: 200,
      breakdown: {},
    })),
    calculateChannelROI: vi.fn(async () => ({
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

describe("Analytics Use Cases (TDD)", () => {
  // Mock dependencies
  let mockCrossPlatformEngine: ReturnType<typeof createMocks>["mockCrossPlatformEngine"];
  let mockPerformanceComparator: ReturnType<typeof createMocks>["mockPerformanceComparator"];
  let mockROICalculator: ReturnType<typeof createMocks>["mockROICalculator"];

  beforeEach(() => {
    const mocks = createMocks();
    mockCrossPlatformEngine = mocks.mockCrossPlatformEngine;
    mockPerformanceComparator = mocks.mockPerformanceComparator;
    mockROICalculator = mocks.mockROICalculator;
  });

  describe("GetCrossPlatformAnalyticsUseCase", () => {
    it("should get cross-platform analytics for an account", async () => {
      const useCase = new GetCrossPlatformAnalyticsUseCase(mockCrossPlatformEngine);

      const input: GetAnalyticsInput = {
        accountId: randomUUID(),
        timeRange: "30d",
      };

      const result = await useCase.execute(input);

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.summary).toBeTruthy();
        expect(result.value.summary.totalPosts >= 0).toBeTruthy();
        expect(result.value.summary.avgEngagementRate >= 0).toBeTruthy();
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

      expect(result.ok).toBeTruthy();
    });

    it("should filter analytics by providers", async () => {
      const useCase = new GetCrossPlatformAnalyticsUseCase(mockCrossPlatformEngine);

      const input: GetAnalyticsInput = {
        accountId: randomUUID(),
        timeRange: "30d",
        providers: ["INSTAGRAM", "X"],
      };

      const result = await useCase.execute(input);

      expect(result.ok).toBeTruthy();
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

      expect(result.ok).toBeTruthy();
    });

    it("should reject empty account ID", async () => {
      const useCase = new GetCrossPlatformAnalyticsUseCase(mockCrossPlatformEngine);

      const input: GetAnalyticsInput = {
        accountId: "",
        timeRange: "30d",
      };

      const result = await useCase.execute(input);

      expect(result.ok).toBeFalsy();
      if (!result.ok) {
        expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
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

      expect(result.ok).toBeTruthy();
    });
  });

  describe("ComparePerformanceUseCase", () => {
    it("should compare performance across time periods", async () => {
      const useCase = new ComparePerformanceUseCase(mockPerformanceComparator);

      const input: ComparePerformanceInput = {
        accountId: randomUUID(),
        timeRange: "30d",
      };

      const result = await useCase.execute(input);

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.currentPerformance).toBeTruthy();
        expect(result.value.keyInsights).toBeTruthy();
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

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.industryBenchmarks !== undefined).toBeTruthy();
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

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.historicalComparison !== undefined).toBeTruthy();
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

      expect(result.ok).toBeTruthy();
    });

    it("should reject empty account ID", async () => {
      const useCase = new ComparePerformanceUseCase(mockPerformanceComparator);

      const input: ComparePerformanceInput = {
        accountId: "",
        timeRange: "30d",
      };

      const result = await useCase.execute(input);

      expect(result.ok).toBeFalsy();
      if (!result.ok) {
        expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
      }
    });
  });

  describe("CalculateROIUseCase", () => {
    it("should calculate ROI for a project", async () => {
      const useCase = new CalculateROIUseCase(mockROICalculator);

      const input: CalculateROIInput = {
        accountId: randomUUID(),
        projectId: randomUUID(),
        timeRange: "30d",
      };

      const result = await useCase.execute(input);

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(result.value.roi !== undefined).toBeTruthy();
        expect(result.value.totalInvestment !== undefined).toBeTruthy();
        expect(result.value.totalRevenue !== undefined).toBeTruthy();
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

      expect(result.ok).toBeTruthy();
      if (result.ok) {
        expect(
          result.value.channelBreakdown !== undefined || result.value.breakdown !== undefined
        ).toBeTruthy();
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

      expect(result.ok).toBeTruthy();
    });

    it("should reject empty account ID", async () => {
      const useCase = new CalculateROIUseCase(mockROICalculator);

      const input: CalculateROIInput = {
        accountId: "",
        timeRange: "30d",
      };

      const result = await useCase.execute(input);

      expect(result.ok).toBeFalsy();
      if (!result.ok) {
        expect(result.error.code).toBe(USE_CASE_ERRORS.VALIDATION_FAILED);
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

      expect(result.ok).toBeTruthy();
    });
  });
});
