/**
 * @file shortsTypes.ts
 * @description Type definitions, constants, and the shared circuit breaker instance used by
 *              YouTubeShortsService for uploads, optimization, trends, and channel listing.
 * @layer infrastructure
 */

import client from "prom-client";
import { createExternalApiCircuitBreaker } from "@adapters/external-apis";

export interface ShortsUploadRequest {
  title: string;
  description: string;
  videoUrl: string;
  privacy: "public" | "private" | "unlisted";
  tags?: string[];
  categoryId?: string;
  thumbnailUrl?: string;
  endScreen?: {
    enabled: boolean;
    duration: number; // seconds from end
    elements?: Array<{
      type: "video" | "subscribe" | "channel";
      videoId?: string;
      channelId?: string;
    }>;
  };
  optimization?: {
    audienceRetention: boolean;
    clickThroughOptimization: boolean;
    engagementOptimization: boolean;
  };
}

export interface ShortsResponse {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  channelId: string;
  thumbnailUrl?: string;
  duration: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  isShort: boolean;
  shortsMetrics?: {
    impressions: number;
    clickThroughRate: number;
    averageViewPercentage: number;
    subscribersFromShort: number;
    shareCount: number;
  };
}

export interface ShortsOptimizationSuggestions {
  title: {
    score: number;
    suggestions: string[];
    trendingKeywords: string[];
  };
  description: {
    score: number;
    suggestions: string[];
    hashtagRecommendations: string[];
  };
  content: {
    score: number;
    suggestions: string[];
    durationOptimization: {
      recommended: number;
      reasoning: string;
    };
  };
  timing: {
    optimalPostTimes: string[];
    competitionAnalysis: {
      lowCompetition: string[];
      highCompetition: string[];
    };
  };
  engagement: {
    callToActionSuggestions: string[];
    hookStrategies: string[];
    retentionTips: string[];
  };
}

export interface ShortsAnalytics {
  videoId: string;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  impressions: number;
  clickThroughRate: number;
  averageViewPercentage: number;
  audienceRetention: Array<{
    timestamp: number;
    retentionPercentage: number;
  }>;
  demographics: {
    ageGroups: Record<string, number>;
    genders: Record<string, number>;
    countries: Record<string, number>;
  };
  trafficSources: Record<string, number>;
  subscribersGained: number;
  watchTimeFromShorts: number;
  nextVideoClickRate: number;
}

export interface ShortsTrend {
  hashtag: string;
  popularity: number;
  growth: number;
  category: string;
  relatedTags: string[];
  averageViews: number;
  competitionLevel: "low" | "medium" | "high";
  recommendedFor: string[];
}

export const registry = new client.Registry();
export const circuitBreaker = createExternalApiCircuitBreaker(registry, process.env.REDIS_URL);
