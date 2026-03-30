/**
 * @file useAnalytics.ts
 * @description TanStack Query hooks for fetching analytics overview data including user activity,
 * revenue trends, and subscription breakdown for the admin analytics page.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/apiClient";

/**
 * Hook to fetch analytics overview data
 */
export function useAnalytics() {
  return useQuery({
    queryKey: ["analytics", "overview"],
    queryFn: async () => {
      const response = await api.admin.getAnalyticsOverview();

      if (!response.ok) {
        throw new Error("Failed to fetch analytics");
      }

      return response;
    },
    staleTime: 120000, // 2 minutes (analytics can be slightly stale)
  });
}
