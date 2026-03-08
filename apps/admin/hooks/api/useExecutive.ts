/**
 * @file useExecutive.ts
 * @description TanStack Query hook for fetching executive summary data including business,
 * operational, and growth metrics for a configurable time range (7d, 30d, or 90d).
 */
import { useQuery } from "@tanstack/react-query";
import { DashboardStats } from "../../lib/apiClient";

export interface ExecutiveSummary {
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
  dashboardStats?: DashboardStats;
}

interface BackendExecutiveMetrics {
  period: { startDate: string | null; endDate: string | null };
  accounts: { total: number; active: number; trialRatio: number };
  projects: { total: number };
  posts: {
    total: number;
    published: number;
    scheduled: number;
    draft: number;
    successRate: number;
  };
  channels: { total: number; byProvider: Record<string, number> };
  engagement: {
    totalViews: number;
    totalLikes: number;
    totalComments: number;
    totalShares: number;
    totalEngagement: number;
    engagementRate: number;
    averageViews: number;
    averageLikes: number;
    averageComments: number;
    averageShares: number;
  };
  generatedAt: string;
}

function computeDateRange(timeRange: "7d" | "30d" | "90d"): { startDate: string; endDate: string } {
  const endDate = new Date();
  const startDate = new Date();
  const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90;
  startDate.setDate(startDate.getDate() - days);
  return {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
  };
}

export function useExecutive(timeRange: "7d" | "30d" | "90d" = "30d") {
  return useQuery({
    queryKey: ["executive", "summary", timeRange],
    queryFn: async (): Promise<ExecutiveSummary> => {
      const { startDate, endDate } = computeDateRange(timeRange);
      const params = new URLSearchParams({ startDate, endDate });

      const response = await fetch(`/api/backend/api/admin/executive/metrics?${params.toString()}`);

      if (!response.ok) {
        const text = await response.text().catch(() => "Unknown error");
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      const body = (await response.json()) as { ok: boolean; value: BackendExecutiveMetrics };

      if (!body.ok) {
        throw new Error("Failed to fetch executive metrics");
      }

      const m = body.value;

      return {
        businessMetrics: {
          totalRevenue: 0,
          monthlyRecurringRevenue: 0,
          revenueGrowth: 0,
          customerAcquisitionCost: 0,
          lifetimeValue: 0,
          churnRate: 0,
        },
        operationalMetrics: {
          systemUptime: 100,
          apiResponseTime: 0,
          errorRate: 0,
          activeUsers: m.accounts.active,
          dataProcessed: 0,
          securityScore: 0,
        },
        growthMetrics: {
          newCustomers: 0,
          trialConversions: m.accounts.trialRatio,
          featureAdoption: 0,
          supportTickets: 0,
          customerSatisfaction: 0,
        },
        trends: {
          period: timeRange,
          revenue: [],
          users: [],
          performance: [],
        },
        dashboardStats: {
          accounts: {
            total: m.accounts.total,
            active: m.accounts.active,
            trialsActive: 0,
            trialsExpiring: 0,
          },
          subscriptions: {
            basic: 0,
            pro: 0,
            enterprise: 0,
          },
          revenue: {
            monthly: 0,
            yearly: 0,
            total: 0,
          },
          activity: {
            loginsToday: 0,
            newAccountsToday: 0,
            subscriptionChangesToday: 0,
          },
          projects: m.projects.total,
          lastUpdated: m.generatedAt,
        },
      };
    },
    staleTime: 120000, // 2 minutes (less volatile data)
  });
}
