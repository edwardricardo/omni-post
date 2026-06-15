/**
 * @file useDashboardStats.ts
 * @description TanStack Query hook for fetching admin dashboard statistics including account counts,
 * subscription distribution, revenue figures, and recent publish activity.
 * @layer infrastructure
 */
import { useQuery } from "@tanstack/react-query";
import { api, type DashboardStats } from "../../lib/apiClient.js";

/**
 * @hook useDashboardStats
 * @description Fetches admin dashboard statistics including account counts, subscription
 *   distribution, revenue figures, and recent publish activity. Auto-refreshes every minute.
 * @returns Query result with { data: DashboardStats, isLoading, error }
 */
export function useDashboardStats() {
  return useQuery({
    queryKey: ["dashboard", "stats"],
    queryFn: async (): Promise<DashboardStats> => {
      const response = await api.admin.getDashboardStats();

      if (!response.ok) {
        throw new Error("Failed to fetch dashboard stats");
      }

      return response.stats;
    },
    refetchInterval: 60000, // Refresh every 1 minute
    staleTime: 30000, // Consider data stale after 30 seconds
    retry: 2, // Retry failed requests twice
  });
}
