/**
 * @file useUniversalAnalytics.ts
 * @description TanStack Query hook for the unified analytics dashboard. Fetches
 *   aggregated engagement, reach, and per-platform metrics for a given project
 *   and time range (default 7d).
 * @layer infrastructure
 */
import { useQuery } from "@tanstack/react-query";

interface AnalyticsOverview {
  totalPosts: number;
  totalEngagement: number;
  totalReach: number;
  totalImpressions: number;
  avgEngagementRate: number;
  topPlatform: string;
  growthThisWeek: number;
  performanceScore: number;
}

interface PlatformMetrics {
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
  overview: AnalyticsOverview;
  platformMetrics: PlatformMetrics[];
  timeRange: string;
  dataPoints: number;
}

interface UniversalAnalyticsParams {
  projectId: string;
  timeRange?: string;
  enabled?: boolean;
}

/**
 * @hook useUniversalAnalytics
 * @description Fetches the unified analytics dashboard data for a project.
 *   Disabled when projectId is empty or `enabled` is false.
 */
export function useUniversalAnalytics(params: UniversalAnalyticsParams) {
  const { projectId, timeRange = "7d", enabled = true } = params;

  return useQuery({
    queryKey: ["universal-analytics", projectId, timeRange],
    enabled: enabled && Boolean(projectId),
    queryFn: async (): Promise<AnalyticsDashboardData> => {
      const qs = new URLSearchParams({ projectId, timeRange });
      const res = await fetch(`/api/backend/dashboard?${qs.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const body = (await res.json()) as {
        ok: boolean;
        value?: AnalyticsDashboardData;
        error?: string;
      };
      if (!body.ok) {
        throw new Error(body.error ?? "Failed to fetch analytics");
      }
      if (!body.value) {
        throw new Error("Failed to fetch analytics");
      }
      return body.value;
    },
  });
}
