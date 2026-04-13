/**
 * @file useAnalytics.ts
 * @description TanStack Query hook for fetching customer analytics dashboard data
 * including post performance, engagement metrics, and per-platform breakdown.
 */
import { useQuery } from "@tanstack/react-query";

interface PlatformMetric {
  platformId: string;
  platformName: string;
  handle: string;
  totalPosts: number;
  totalEngagement: number;
  totalReach: number;
  totalImpressions: number;
  totalClicks: number;
  followerCount: number;
  growthRate: number;
  engagementRate: number;
}

export interface AnalyticsDashboardData {
  overview: {
    totalPosts: number;
    totalEngagement: number;
    totalReach: number;
    totalImpressions: number;
    avgEngagementRate: number;
    topPlatform: string;
    growthThisWeek: number;
    performanceScore: number;
  };
  platformMetrics: PlatformMetric[];
  timeRange: string;
  dataPoints: number;
}

interface AnalyticsResponse {
  ok: boolean;
  data?: AnalyticsDashboardData;
}

/**
 * @hook useAnalytics
 * @description Fetches customer analytics dashboard data including post performance,
 *              engagement metrics, and per-platform breakdown by time range.
 * @param projectId - The project to fetch analytics for
 * @param timeRange - Time range filter (default "30d")
 * @returns TanStack Query result with analytics dashboard data
 */
export function useAnalytics(projectId: string, timeRange: string = "30d") {
  return useQuery({
    queryKey: ["analytics", "dashboard", projectId, timeRange],
    queryFn: async (): Promise<AnalyticsDashboardData> => {
      const params = new URLSearchParams({ timeRange });
      if (projectId) params.set("projectId", projectId);

      const res = await fetch(`/api/backend/analytics/dashboard?${params}`, {
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error(`Failed to fetch analytics: HTTP ${res.status}`);
      }

      const json: AnalyticsResponse = await res.json();

      if (!json.ok || !json.data) {
        throw new Error("Failed to fetch analytics data");
      }

      return json.data;
    },
    enabled: !!projectId,
    staleTime: 120_000,
    retry: 2,
  });
}
