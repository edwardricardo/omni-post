/**
 * @file useAnalytics.ts
 * @description TanStack Query hook for fetching analytics summary data by combining
 * three API sources: analytics metrics, dashboard stats, and billing stats.
 * @layer presentation
 */
import { useQuery } from "@tanstack/react-query";

export interface AnalyticsSummary {
  businessMetrics: {
    totalRevenue: number;
    monthlyRecurringRevenue: number;
    revenueGrowth: number;
    customerAcquisitionCost: number;
    lifetimeValue: number;
    churnRate: number;
  };
  operationalMetrics: {
    systemUptime: number;
    apiResponseTime: number;
    errorRate: number;
    activeUsers: number;
    dataProcessed: number;
    securityScore: number;
  };
  growthMetrics: {
    newCustomers: number;
    trialConversions: number;
    featureAdoption: number;
    supportTickets: number;
    customerSatisfaction: number;
  };
  trends: {
    period: string;
    revenue: number[];
    users: number[];
    performance: number[];
  };
  platformMetrics: {
    totalAccounts: number;
    activeAccounts: number;
    trialsActive: number;
    trialsExpiring: number;
    totalProjects: number;
    totalChannels: number;
    channelsByProvider: Record<string, number>;
    totalPosts: number;
    postsPublished: number;
    subscriptions: Record<string, number>;
  };
}

async function fetchJSON(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) return {};
  const json = await res.json();
  return (json.data ?? json) as Record<string, unknown>;
}

function computeDateRange(timeRange: "7d" | "30d" | "90d"): { startDate: string; endDate: string } {
  const endDate = new Date();
  const startDate = new Date();
  const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90;
  startDate.setDate(startDate.getDate() - days);
  return { startDate: startDate.toISOString(), endDate: endDate.toISOString() };
}

/**
 * @hook useAnalytics
 * @description Fetches aggregated analytics summary by combining metrics from analytics,
 *   dashboard stats, and billing stats API sources into a unified AnalyticsSummary.
 * @param timeRange - Time window for analytics data: "7d", "30d", or "90d" (default "30d")
 * @returns Query result with { data: AnalyticsSummary, isLoading, error }
 */
export function useAnalytics(timeRange: "7d" | "30d" | "90d" = "30d") {
  return useQuery({
    queryKey: ["analytics", "summary", timeRange],
    queryFn: async (): Promise<AnalyticsSummary> => {
      const { startDate, endDate } = computeDateRange(timeRange);
      const params = new URLSearchParams({ startDate, endDate });

      // Fetch all 3 sources in parallel
      const [analytics, dashboard, billing] = await Promise.all([
        fetchJSON(`/api/backend/admin/analytics/metrics?${params.toString()}`),
        fetchJSON("/api/backend/admin/dashboard/stats"),
        fetchJSON("/api/backend/admin/billing/stats"),
      ]);

      // Extract nested data
      const exec = analytics as Record<string, unknown>;
      const accounts = (exec.accounts ?? {}) as Record<string, number>;
      const projects = (exec.projects ?? {}) as Record<string, number>;
      const posts = (exec.posts ?? {}) as Record<string, number>;
      const channels = (exec.channels ?? {}) as Record<string, unknown>;
      const engagement = (exec.engagement ?? {}) as Record<string, number>;

      const dashStats = (dashboard.stats ?? dashboard) as Record<string, unknown>;
      const dashAccounts = (dashStats.accounts ?? {}) as Record<string, number>;
      const dashSubs = (dashStats.subscriptions ?? {}) as Record<string, number>;

      const billStats = (billing.stats ?? billing) as Record<string, unknown>;
      const totalRevenue = (billStats.totalRevenue ?? {}) as Record<string, number>;
      const growthMetrics = (billStats.growthMetrics ?? {}) as Record<string, number>;

      // Calculate derived metrics
      const mrr = Number(billStats.totalMRR ?? totalRevenue.monthly ?? 0);
      const totalAccounts = Number(dashAccounts.total ?? accounts.total ?? 0);
      const cancelledThisMonth = Number(growthMetrics.cancelledSubscriptionsThisMonth ?? 0);
      const churnRate = totalAccounts > 0 ? (cancelledThisMonth / totalAccounts) * 100 : 0;
      const ltv = mrr > 0 && churnRate > 0 ? mrr / (churnRate / 100) : mrr * 12;

      return {
        businessMetrics: {
          totalRevenue: Number(totalRevenue.total ?? mrr),
          monthlyRecurringRevenue: mrr,
          revenueGrowth: Number(growthMetrics.monthlyGrowthRate ?? 0),
          customerAcquisitionCost: 0, // No data source yet
          lifetimeValue: Math.round(ltv),
          churnRate: Math.round(churnRate * 10) / 10,
        },
        operationalMetrics: {
          systemUptime: 100, // From health endpoint if available
          apiResponseTime: 0,
          errorRate: Number(posts.successRate ?? 0) > 0 ? 100 - Number(posts.successRate) : 0,
          activeUsers: Number(accounts.active ?? dashAccounts.active ?? 0),
          dataProcessed: Number(posts.total ?? 0),
          securityScore: Number(engagement.engagementRate ?? 0),
        },
        growthMetrics: {
          newCustomers: Number(growthMetrics.newSubscriptionsThisMonth ?? 0),
          trialConversions: Number(accounts.trialRatio ?? 0),
          featureAdoption:
            Number(channels.total ?? 0) > 0 && totalAccounts > 0
              ? Math.round((Number(channels.total) / totalAccounts) * 10) / 10
              : 0,
          supportTickets: 0, // No data source
          customerSatisfaction: 0, // No data source
        },
        trends: {
          period: timeRange,
          revenue: [], // No historical data yet
          users: [],
          performance: [],
        },
        platformMetrics: {
          totalAccounts,
          activeAccounts: Number(dashAccounts.active ?? accounts.active ?? 0),
          trialsActive: Number(dashAccounts.trialsActive ?? 0),
          trialsExpiring: Number(dashAccounts.trialsExpiring ?? 0),
          totalProjects: Number(projects.total ?? dashStats.projects ?? 0),
          totalChannels: Number(channels.total ?? 0),
          channelsByProvider: (channels.byProvider ?? {}) as Record<string, number>,
          totalPosts: Number(posts.total ?? 0),
          postsPublished: Number(posts.published ?? 0),
          subscriptions: dashSubs,
        },
      };
    },
    staleTime: 120000,
  });
}
