/**
 * @file useAnalytics.ts
 * @description TanStack Query hook for fetching cross-platform analytics
 *              dashboard data — aggregated overview metrics plus per-platform
 *              breakdown from real Prisma data via
 *              `GET /api/backend/analytics/dashboard`.
 * @hook useAnalytics
 * @layer infrastructure
 */

import { useQuery } from "@tanstack/react-query";

// ─── Response Types ─────────────────────────────────────────────────────────

/** Aggregated overview metrics returned by the dashboard endpoint. */
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

/** Per-platform metrics returned by the dashboard endpoint. */
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

/** Full dashboard response payload. */
export interface AnalyticsDashboardData {
  overview: AnalyticsDashboardOverview;
  platformMetrics: AnalyticsPlatformMetrics[];
  timeRange: string;
  dataPoints: number;
}

export type TimeRange = "7d" | "30d" | "90d";

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * @hook useAnalytics
 * @description Fetches the cross-platform analytics dashboard. Polls every
 *              30 s for near-realtime UX; entries are kept fresh for 2 min
 *              so navigating between pages doesn't trigger an immediate
 *              refetch. The query stays disabled while `projectId` is empty.
 * @param projectId - Project to scope the dashboard to. Required.
 * @param timeRange - Window for the metrics (default "30d").
 * @returns TanStack Query result with the typed dashboard payload.
 */
export function useAnalytics(projectId: string, timeRange: TimeRange | string = "30d") {
  return useQuery({
    queryKey: ["analytics", "dashboard", projectId, timeRange],
    queryFn: async (): Promise<AnalyticsDashboardData> => {
      const params = new URLSearchParams({ timeRange });
      if (projectId) params.set("projectId", projectId);

      const res = await fetch(`/api/backend/analytics/dashboard?${params.toString()}`, {
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error(`Failed to fetch analytics dashboard (HTTP ${res.status})`);
      }

      const body = (await res.json()) as {
        ok: boolean;
        data?: AnalyticsDashboardData;
        error?: string;
      };

      // BaseRouteHandler.sendSuccess wraps responses as { ok: true, data: { ... } }.
      if (!body.ok || !body.data) {
        throw new Error(body.error ?? "Failed to fetch analytics data");
      }

      return body.data;
    },
    enabled: projectId.length > 0,
    staleTime: 2 * 60 * 1000, // 2 min
    refetchInterval: 30 * 1000, // 30 s near-realtime polling
    retry: 2,
  });
}
