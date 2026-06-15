/**
 * @file types.ts
 * @description Type-safe interfaces for cross-platform analytics data structures.
 * @layer infrastructure
 */

import type { DomainAnalytics, ProviderName } from "@shared/types";
import type { TimeRange, ProviderType, ContentType } from "@shared/types/analytics.js";

// Re-export for convenience
export type { DomainAnalytics, ProviderName };
export type { TimeRange, ProviderType, ContentType };

/**
 * Post data structure from Prisma query
 */
export interface PostDataItem {
  id: string;
  createdAt?: Date;
  channels?: Array<{ provider: string }>;
  contents?: Array<{ content?: string; title?: string; tags?: string[] }>;
  media?: Array<{ type: string }>;
}

/**
 * Channel data structure from Prisma query
 */
export interface ChannelDataItem {
  id: string;
  provider: ProviderName;
  name: string;
}

/**
 * Competitor data structure for competitive analysis
 */
export interface CompetitorDataItem {
  id: string;
  name: string;
  followers: number;
  avgEngagementRate: number;
  postFrequency: number;
}

/**
 * Options for generating cross-platform analytics
 */
export interface CrossPlatformAnalyticsOptions {
  accountId: string;
  projectId?: string;
  timeRange: TimeRange;
  startDate?: Date;
  endDate?: Date;
  providers?: ProviderType[];
  includeCompetitive?: boolean;
  includeML?: boolean;
}

/**
 * Normalized analytics data with number fields (null converted to 0)
 */
export interface NormalizedAnalytics {
  id: string;
  postId: string | null;
  provider: ProviderName;
  capturedAt: Date;
  views: number;
  likes: number;
  comments: number;
  shares: number;
}

/**
 * Daily aggregated data
 */
export interface DailyAggregatedData {
  date: Date;
  engagements: number;
  impressions: number;
  reach: number;
  analytics: NormalizedAnalytics[];
}
