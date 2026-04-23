/**
 * @file useUniversalAnalytics.ts
 * @description TanStack Query hook for fetching cross-platform analytics dashboard data.
 * Calls GET /api/backend/dashboard?projectId=...&timeRange=... which returns aggregated
 * overview metrics plus per-platform breakdown from real Prisma data.
 */
import { useQuery } from "@tanstack/react-query";

// ─── Response Types ─────────────────────────────────────────────────────────

/** Aggregated overview metrics returned by the dashboard endpoint */
export interface AnalyticsDashboardOverview {
  totalPosts: number;
  totalEngagement: number;
  totalReach: number;
  totalImpressions: number;
  avgEngagementRate: number;
  topPlatform: string;
  growthThisWeek: number;
  performanceScore: number;
}

/** Per-platform metrics returned by the dashboard endpoint */
export interface AnalyticsPlatformMetrics {
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

/** Full dashboard response shape (unwrapped from { ok, value }) */
export interface AnalyticsDashboardData {
  overview: AnalyticsDashboardOverview;
  platformMetrics: AnalyticsPlatformMetrics[];
  timeRange: string;
  dataPoints: number;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export type TimeRange = "7d" | "30d" | "90d";

interface UseUniversalAnalyticsOptions {
  projectId: string;
  timeRange?: TimeRange;
  enabled?: boolean;
}

/**
 * @hook useUniversalAnalytics
 * @description Fetches cross-platform analytics dashboard data including aggregated overview
 *              metrics and per-platform breakdown from real Prisma data.
 * @param options - projectId (required), timeRange (default "7d"), enabled flag
 * @returns TanStack Query result with dashboard data, loading, and error states
 */
export function useUniversalAnalytics({
  projectId,
  timeRange = "7d",
  enabled = true,
}: UseUniversalAnalyticsOptions) {
  return useQuery({
    queryKey: ["universal-analytics", projectId, timeRange],
    queryFn: async (): Promise<AnalyticsDashboardData> => {
      const params = new URLSearchParams();
      params.set("projectId", projectId);
      params.set("timeRange", timeRange);

      const res = await fetch(`/api/backend/dashboard?${params.toString()}`, {
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error(`Failed to fetch analytics dashboard (HTTP ${res.status})`);
      }

      const body = await res.json();

      // BaseRouteHandler wraps responses as { ok: true, value: { ... } }
      if (!body.ok) {
        const msg = typeof body.error === "string" ? body.error : "Failed to fetch analytics";
        throw new Error(msg);
      }

      return body.value as AnalyticsDashboardData;
    },
    enabled: enabled && projectId.length > 0,
    staleTime: 2 * 60 * 1000, // 2 minutes — analytics can be slightly stale
    refetchInterval: 30 * 1000, // Refresh every 30 seconds for near-realtime
    retry: 2,
  });
}
