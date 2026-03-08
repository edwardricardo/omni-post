/**
 * @file useSubscriptions.ts
 * @description TanStack Query hooks for fetching subscription summaries, plan distributions,
 * and billing data for the admin subscriptions management page.
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/apiClient";

/**
 * Hook to fetch subscription summary data
 */
export function useSubscriptions() {
  return useQuery({
    queryKey: ["subscriptions", "summary"],
    queryFn: async () => {
      const response = await api.admin.getSubscriptionSummary();

      if (!response.ok) {
        throw new Error("Failed to fetch subscriptions");
      }

      return response;
    },
    staleTime: 60000, // 1 minute
  });
}
