/**
 * usePerformanceInsights hook
 *
 * Fetches performance analytics data for a given project from the admin
 * dashboard endpoint. Returns TanStack Query state including the raw API
 * value, loading, and error state.
 *
 * @module hooks/api/usePerformanceInsights
 */

import { useQuery } from "@tanstack/react-query";

/**
 * Raw shape returned by GET /api/backend/admin/analytics/overview
 * (wrapped in the standard { ok: true, value: ... } envelope by the proxy).
 */
export interface DashboardInsightsData {
  engagement?: {
    totalEngagements?: number;
    averageEngagementRate?: number;
    topEngagingContent?: Array<{
      id?: string;
      content?: string;
      platform?: string;
      engagementRate?: number;
      publishedAt?: string;
      score?: number;
      metrics?: {
        engagement?: number;
        reach?: number;
        impressions?: number;
        clicks?: number;
        engagementRate?: number;
      };
      factors?: {
        timeOfDay?: number;
        dayOfWeek?: number;
        contentLength?: number;
        hasMedia?: boolean;
        hashtags?: string[];
        mentions?: string[];
      };
    }>;
  };
  timeSeries?: Array<{
    date?: string;
    impressions?: number;
    engagement?: number;
    clicks?: number;
  }>;
  topPosts?: Array<{
    id?: string;
    content?: string;
    platform?: string;
    score?: number;
    publishedAt?: string;
    metrics?: {
      engagement?: number;
      reach?: number;
      impressions?: number;
      clicks?: number;
      engagementRate?: number;
    };
    factors?: {
      timeOfDay?: number;
      dayOfWeek?: number;
      contentLength?: number;
      hasMedia?: boolean;
      hashtags?: string[];
      mentions?: string[];
    };
  }>;
  mediaPerformance?: Array<{
    type?: string;
    avgEngagement?: number;
    postCount?: number;
  }>;
  optimalTiming?: Array<{
    platform?: string;
    dayOfWeek?: number;
    hour?: number;
    engagementMultiplier?: number;
    confidence?: number;
    audience?: {
      demographic?: string;
      timezone?: string;
      activeHours?: number[];
    };
  }>;
  hashtagPerformance?: Array<{
    hashtag?: string;
    usage?: number;
    avgEngagement?: number;
    trending?: boolean;
    platforms?: string[];
    relatedTags?: string[];
    effectiveness?: "high" | "medium" | "low";
  }>;
  audienceInsights?: Array<{
    platformId?: string;
    totalFollowers?: number;
    growthRate?: number;
    demographics?: {
      ageGroups?: Record<string, number>;
      genders?: Record<string, number>;
      locations?: Record<string, number>;
      interests?: string[];
    };
    engagement?: {
      avgRate?: number;
      peakTimes?: string[];
      contentPreferences?: string[];
    };
    recommendations?: string[];
  }>;
}

/**
 * Fetches performance insights for the given project.
 * Stale time: 5 minutes — analytics data can tolerate slight staleness.
 */
export function usePerformanceInsights(projectId: string) {
  return useQuery({
    queryKey: ["performance-insights", projectId],
    queryFn: async (): Promise<DashboardInsightsData> => {
      const params = new URLSearchParams();
      if (projectId) params.set("projectId", projectId);

      const res = await fetch(`/api/backend/admin/analytics/overview?${params.toString()}`);

      if (!res.ok) {
        throw new Error(`Failed to fetch performance insights (HTTP ${res.status})`);
      }

      const body = await res.json();

      // BaseRouteHandler returns { ok: true, value: data }
      if (!body.ok) {
        throw new Error(body.error?.message ?? "Failed to fetch performance insights");
      }

      // The analytics overview wraps data under { data: ... }
      // Accept both shapes to stay resilient across API changes.
      return (body.value?.data ?? body.value ?? {}) as DashboardInsightsData;
    },
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });
}
