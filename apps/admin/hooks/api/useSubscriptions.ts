/**
 * @file useSubscriptions.ts
 * @description TanStack Query hooks for fetching subscription summaries, plan distributions,
 * and billing data for the admin subscriptions management page.
 * @layer infrastructure
 */
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/apiClient.js";

/**
 * @hook useSubscriptions
 * @description Fetches subscription summary data including plan distributions and billing
 *   information for the admin subscriptions management page.
 * @returns Query result with { data: SubscriptionSummary, isLoading, error }
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
