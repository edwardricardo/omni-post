/**
 * @file useBillingStats.ts
 * @description React Query hook for fetching aggregated billing statistics
 *   including MRR, total revenue, and active subscriptions.
 * @layer infrastructure
 */

import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@packages/api-errors";

export interface BillingStats {
  totalRevenue: number;
  monthlyRecurringRevenue: number;
  activeSubscriptions: number;
}

/**
 * @hook useBillingStats
 * @description Fetches aggregated billing statistics (total revenue, MRR, active
 *   subscriptions) from the admin billing stats endpoint.
 * @returns Query result with { data: BillingStats, isLoading, error }
 */
export function useBillingStats() {
  return useQuery({
    queryKey: ["billing", "stats"],
    queryFn: async (): Promise<BillingStats> => {
      const res = await fetch("/api/backend/admin/billing/stats", {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
      const json = await res.json();
      if (!json.ok || !json.data) throw new Error("Failed to fetch billing stats");
      const raw = json.data.stats ?? json.data;
      return {
        totalRevenue: raw.totalRevenue?.total ?? raw.totalRevenue ?? 0,
        monthlyRecurringRevenue: raw.totalRevenue?.monthly ?? 0,
        activeSubscriptions: raw.totalSubscriptions ?? 0,
      };
    },
    staleTime: 120_000,
  });
}
