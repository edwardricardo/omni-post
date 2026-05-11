/**
 * @file usePerformanceInsights.ts
 * @description TanStack Query hook for the dashboard performance insights view.
 *   Fetches engagement, time series, top posts, media performance, optimal
 *   timing, hashtags, and audience insights for a project.
 * @layer infrastructure
 */
import { useQuery } from "@tanstack/react-query";

interface TopEngagingPost {
  id: string;
  content: string;
  platform: string;
  engagementRate: number;
  publishedAt: string;
}

interface EngagementSummary {
  totalEngagements: number;
  averageEngagementRate: number;
  topEngagingContent: TopEngagingPost[];
}

interface TimeSeriesPoint {
  date: string;
  impressions: number;
  engagement: number;
  clicks: number;
}

interface TopPost {
  id: string;
  content: string;
  platform: string;
  score: number;
}

interface MediaPerformance {
  type: string;
  avgEngagement: number;
  postCount: number;
}

interface OptimalTiming {
  platform: string;
  dayOfWeek: number;
  hour: number;
  engagementMultiplier: number;
  confidence: number;
}

interface HashtagPerformance {
  hashtag: string;
  usage: number;
  avgEngagement: number;
  trending: boolean;
  effectiveness: "low" | "medium" | "high";
}

interface AudienceInsight {
  platformId: string;
  totalFollowers: number;
  growthRate: number;
}

export interface DashboardInsightsData {
  engagement?: EngagementSummary;
  timeSeries: TimeSeriesPoint[];
  topPosts: TopPost[];
  mediaPerformance: MediaPerformance[];
  optimalTiming: OptimalTiming[];
  hashtagPerformance: HashtagPerformance[];
  audienceInsights: AudienceInsight[];
}

/**
 * @hook usePerformanceInsights
 * @description Fetches the dashboard performance insights for a given project.
 * @param projectId - Project to fetch insights for
 */
export function usePerformanceInsights(projectId: string) {
  return useQuery({
    queryKey: ["performance-insights", projectId],
    queryFn: async (): Promise<DashboardInsightsData> => {
      const res = await fetch(`/api/backend/admin/analytics/overview?projectId=${projectId}`, {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const body = (await res.json()) as {
        ok: boolean;
        value?: DashboardInsightsData | { data: DashboardInsightsData };
        error?: { message?: string } | string;
      };
      if (!body.ok) {
        const message =
          typeof body.error === "string"
            ? body.error
            : (body.error?.message ?? "Failed to fetch insights");
        throw new Error(message);
      }
      const value = body.value as DashboardInsightsData | { data: DashboardInsightsData };
      if (value && typeof value === "object" && "data" in value) {
        return (value as { data: DashboardInsightsData }).data;
      }
      return value as DashboardInsightsData;
    },
    retry: 2,
  });
}
