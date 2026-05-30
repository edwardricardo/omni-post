/**
 * @file playlistTypes.ts
 * @description Type definitions, interfaces, and shared constants for the YouTube playlist manager.
 * Provides the data contracts used by YouTubePlaylistManager and its consumers.
 * @layer infrastructure
 */

import client from "prom-client";
import { createExternalApiCircuitBreaker } from "@adapters/external-apis";

export interface PlaylistCreateRequest {
  title: string;
  description: string;
  privacy: "public" | "private" | "unlisted";
  tags?: string[];
  defaultLanguage?: string;
  localizations?: Record<string, { title: string; description: string }>;
}

export interface PlaylistUpdateRequest {
  title?: string;
  description?: string;
  privacy?: "public" | "private" | "unlisted";
  tags?: string[];
}

export interface Playlist {
  id: string;
  title: string;
  description: string;
  privacy: "public" | "private" | "unlisted";
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  thumbnailUrl?: string;
  itemCount: number;
  tags?: string[];
  defaultLanguage?: string;
  localizations?: Record<string, { title: string; description: string }>;
  etag: string;
}

export interface PlaylistItem {
  id: string;
  videoId: string;
  title: string;
  description: string;
  channelTitle: string;
  publishedAt: string;
  position: number;
  thumbnailUrl?: string;
  duration?: string;
  privacy: "public" | "private" | "unlisted";
  note?: string;
  startAt?: number; // seconds
  endAt?: number; // seconds
}

export interface PlaylistAnalytics {
  playlistId: string;
  title: string;
  totalViews: number;
  totalWatchTime: number;
  averageViewsPerVideo: number;
  completionRate: number; // Percentage of viewers who watch entire playlist
  dropOffPoints: Array<{
    position: number;
    videoId: string;
    title: string;
    dropOffPercentage: number;
  }>;
  topPerformingVideos: Array<{
    position: number;
    videoId: string;
    title: string;
    views: number;
    watchTime: number;
    retentionRate: number;
  }>;
  viewerFlow: Array<{
    fromPosition: number;
    toPosition: number;
    viewerCount: number;
    percentage: number;
  }>;
  demographics: {
    ageGroups: Record<string, number>;
    genders: Record<string, number>;
    countries: Record<string, number>;
  };
}

export interface PlaylistOptimization {
  currentScore: number;
  suggestions: Array<{
    type: "title" | "description" | "order" | "content" | "thumbnail";
    priority: "high" | "medium" | "low";
    suggestion: string;
    expectedImpact: string;
  }>;
  orderOptimization: {
    recommendedOrder: Array<{
      currentPosition: number;
      recommendedPosition: number;
      videoId: string;
      title: string;
      reasoning: string;
    }>;
    estimatedImprovementPercent: number;
  };
  contentGaps: Array<{
    position: number;
    suggestedTopic: string;
    reasoning: string;
    keywords: string[];
  }>;
}

export const registry = new client.Registry();
export const circuitBreaker = createExternalApiCircuitBreaker(registry, process.env.REDIS_URL);
