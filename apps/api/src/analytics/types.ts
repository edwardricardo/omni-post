import type { ContentType, ProviderType } from "@shared/analytics";

/**
 * Shared types for analytics modules
 */

export interface AnalyticsDataPoint {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
}

export interface HistoricalContext {
  accountPerformance: {
    avgEngagementRate: number;
    avgImpressions: number;
    topPerformingContentTypes: ContentType[];
    bestPostingTimes: Array<{ hour: number; dayOfWeek: number; performance: number }>;
  };
  platformBenchmarks: {
    [K in ProviderType]: {
      avgEngagementRate: number;
      peakHours: number[];
      contentTypeMultipliers: Record<ContentType, number>;
    };
  };
  seasonalFactors: {
    month: number;
    dayOfWeek: number;
    hour: number;
    multiplier: number;
  };
  trendingTopics: Array<{
    topic: string;
    popularity: number;
    expectedLifespan: number;
  }>;
}

export interface PredictionRequest {
  accountId: string;
  projectId?: string;
  contentText: string;
  contentType: ContentType;
  provider: ProviderType;
  scheduledTime?: Date;
  hashtags?: string[];
  mediaCount?: number;
  mediaTypes?: string[];
  targetAudience?: string[];
  includeOptimization?: boolean;
}
