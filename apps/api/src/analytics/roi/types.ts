/**
 * @file types.ts
 * @description Shared type definitions for ROI Calculator modules.
 * @layer infrastructure
 */

import type {
  ROICalculation,
  ROIMetric,
  CostBreakdown,
  RevenueBreakdown,
  ROIRecommendation,
  ProviderType,
  ContentType,
  TimeRange,
  TrendDataPoint,
} from "@shared/types/analytics.js";
import type { ProviderName } from "@shared/types";

// Re-export shared types
export type {
  ROICalculation,
  ROIMetric,
  CostBreakdown,
  RevenueBreakdown,
  ROIRecommendation,
  ProviderType,
  ContentType,
  TimeRange,
  TrendDataPoint,
};

export interface ROICalculationOptions {
  accountId: string;
  projectId?: string;
  timeRange: TimeRange;
  startDate?: Date;
  endDate?: Date;
  providers?: ProviderType[];
  includeAdSpend?: boolean;
  includeOrganicValue?: boolean;
  customCostModel?: CostModel;
}

export interface CostModel {
  platformCosts: Record<ProviderType, number>; // Monthly platform costs
  contentCreationCostPerPost: number;
  personnelCostPerHour: number;
  avgTimePerPost: number; // Hours
  toolingCostPerMonth: number;
  advertisingBudget?: number;
}

export interface RevenueModel {
  conversionRate: number; // Percentage of clicks that convert
  averageOrderValue: number;
  customerLifetimeValue: number;
  brandAwarenessValue: number; // Value per impression
  leadGenerationValue: number; // Value per lead
  organicTrafficValue: number; // Value per organic click
}

export interface ConversionTracking {
  accountId: string;
  source: ProviderType;
  contentId: string;
  conversionType: "sale" | "lead" | "signup" | "download" | "subscription";
  value: number;
  timestamp: Date;
  attribution: "first_click" | "last_click" | "linear" | "time_decay";
}

export interface AnalyticsDataPoint {
  postId: string | null;
  channelId: string;
  provider: ProviderName;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  id: string;
  capturedAt: Date;
}

export interface PostDataPoint {
  id: string;
  channels?: Array<{ provider: string }>;
}

export interface ConversionDataPoint {
  source: string;
  content_id: string;
  conversion_type: string;
  value: number;
  timestamp: Date;
}

export interface MonthlyTrends {
  avgMonthlyCosts: number;
  avgMonthlyRevenue: number;
  avgGrowthRate: number;
}

export interface MonthlyForecast {
  month: string;
  projectedCosts: number;
  projectedRevenue: number;
  projectedROI: number;
  confidence: number;
}

export interface ForecastResult {
  monthlyForecasts: MonthlyForecast[];
  totalProjection: {
    totalCosts: number;
    totalRevenue: number;
    totalROI: number;
  };
  keyAssumptions: string[];
}

export interface RecommendationInput {
  totalCost: number;
  totalRevenue: number;
  roi: number;
  roiByProvider: Record<ProviderType, ROIMetric>;
  roiByContentType: Record<ContentType, ROIMetric>;
  costBreakdown: CostBreakdown;
  revenueBreakdown: RevenueBreakdown;
}
