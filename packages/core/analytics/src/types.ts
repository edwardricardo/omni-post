/**
 * @file types.ts
 * @description Type definitions for analytics use cases including TimeRange, ProviderType, and input/output DTOs for cross-platform analytics, performance comparison, and ROI calculation.
 * @layer application
 */

import type { ProviderName } from "@shared/types";

// ============ Common Types ============

export type TimeRange = "7d" | "30d" | "90d" | "1y" | "custom";
// Canonical: aliased to ProviderName (11 platforms, Prisma-aligned) so this
// application DTO type no longer diverges from the shared/domain model.
export type ProviderType = ProviderName;
export type ContentType = "text" | "image" | "video" | "carousel" | "story" | "reel";
export type MetricType =
  "engagement_rate" | "reach" | "views" | "click_through_rate" | "follower_growth" | "roi";

// ============ GetCrossPlatformAnalytics Types ============

export interface GetAnalyticsInput {
  accountId: string;
  projectId?: string;
  timeRange: TimeRange;
  startDate?: string;
  endDate?: string;
  providers?: ProviderType[];
  includeCompetitive?: boolean;
}

export interface AnalyticsSummary {
  totalPosts: number;
  totalEngagements: number;
  avgEngagementRate: number;
  totalReach: number;
  topPerformingProvider?: ProviderType;
}

export interface GetAnalyticsOutput {
  summary: AnalyticsSummary;
  byProvider?: Record<string, unknown>;
  contentInsights?: Record<string, unknown>;
  audienceAnalytics?: Record<string, unknown>;
  benchmarking?: Record<string, unknown>;
  trends?: Record<string, unknown>;
  recommendations?: string[];
  generatedAt: Date;
}

// ============ ComparePerformance Types ============

export interface ComparePerformanceInput {
  accountId: string;
  projectId?: string;
  timeRange: TimeRange;
  startDate?: string;
  endDate?: string;
  providers?: ProviderType[];
  includeIndustryBenchmarks?: boolean;
  includeHistoricalComparison?: boolean;
  includeCompetitorData?: boolean;
  metrics?: MetricType[];
  comparePeriods?: TimeRange[];
}

export interface PerformanceSnapshot {
  totalPosts: number;
  totalEngagements: number;
  avgEngagementRate: number;
  totalReach?: number;
  clickThroughRate?: number;
  followerGrowth?: number;
  roi?: number;
}

export interface ComparePerformanceOutput {
  currentPerformance: PerformanceSnapshot;
  industryBenchmarks?: unknown[];
  competitorComparisons?: unknown[];
  historicalComparison?: Record<string, unknown>;
  providerComparison?: Record<string, unknown>;
  contentTypeComparison?: Record<string, unknown>;
  keyInsights: string[];
  recommendations: string[];
  metricsComparison?: Record<string, unknown>;
}

// ============ PredictEngagement Types ============

export interface PredictEngagementInput {
  accountId: string;
  projectId?: string;
  content: string;
  contentType: ContentType;
  provider: ProviderType;
  scheduledAt?: string;
  hashtags?: string[];
  mediaCount?: number;
  mediaTypes?: string[];
  targetAudience?: string[];
  includeOptimization?: boolean;
  predictOptimalTiming?: boolean;
}

export interface OptimalTimeSlot {
  dayOfWeek: number;
  hour: number;
  score: number;
}

export interface TimingPrediction {
  optimalSlots: OptimalTimeSlot[];
  recommendations: string[];
}

export interface PredictEngagementOutput {
  predictedEngagementRate: number;
  predictedLikes: number;
  predictedComments: number;
  predictedShares: number;
  predictedReach?: number;
  confidence: number;
  factors?: Array<{
    name: string;
    impact: number;
    description: string;
  }>;
  recommendations?: string[];
  optimalTiming?: TimingPrediction;
}

// ============ CalculateROI Types ============

export interface InvestmentDetails {
  adSpend?: number;
  contentCreation?: number;
  tools?: number;
  labor?: number;
  other?: number;
}

export interface CalculateROIInput {
  accountId: string;
  projectId?: string;
  timeRange: TimeRange;
  startDate?: string;
  endDate?: string;
  providers?: ProviderType[];
  byChannel?: boolean;
  investmentDetails?: InvestmentDetails;
}

export interface ROIBreakdown {
  category: string;
  investment: number;
  revenue: number;
  roi: number;
}

export interface ChannelROI {
  channel: ProviderType;
  investment: number;
  revenue: number;
  roi: number;
  performance: "excellent" | "good" | "average" | "poor";
}

export interface CalculateROIOutput {
  totalInvestment: number;
  totalRevenue: number;
  roi: number;
  roiPercentage: number;
  breakdown?: Record<string, unknown>;
  channelBreakdown?: ChannelROI[];
  bestPerformingChannel?: ProviderType;
  recommendations?: string[];
}
