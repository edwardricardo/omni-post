/**
 * @file useAccountBilling.ts
 * @description TanStack Query hook for fetching account billing breakdown from the admin API.
 * @layer infrastructure
 */
import { useQuery } from "@tanstack/react-query";
import type { PlanType } from "@shared/types";
import { ApiError } from "@/lib/parseApiError";

export interface BillingData {
  accountId: string;
  accountName: string;
  planType: PlanType;
  bundleInfo: { name: string; slug: string } | null;
  isGrandfathered: boolean;
  grandfathering: {
    lockedPrice: number;
    currentListPrice: number;
    savingsFromGrandfathering: number;
    expiresAt: string | null;
  } | null;
  providers: Array<{ platform: string; pricePerProvider: number }>;
  calculation: {
    providerCount: number;
    accountCount: number;
    basePrice: number;
    totalMonthly: number;
    listPrice: number;
    savings: number;
  };
  cheaperBundle: {
    bundle: { name: string; slug: string };
    bundleTotal: number;
    customTotal: number;
    savings: number;
  } | null;
  trial?: {
    isOnTrial: boolean;
    trialEndDate: string;
    daysRemaining: number;
  };
}

/**
 * @hook useAccountBilling
 * @description Fetches billing breakdown for a specific account including plan details,
 *   grandfathering status, provider costs, and cheaper bundle suggestions.
 * @param accountId - The account ID to fetch billing data for, or null to disable the query
 * @returns Query result with { data: BillingData, isLoading, error }
 */
export function useAccountBilling(accountId: string | null) {
  return useQuery({
    queryKey: ["account", "billing", accountId],
    queryFn: async (): Promise<BillingData> => {
      const res = await fetch(`/api/backend/admin/accounts/${accountId}/billing`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
      const json = await res.json();
      if (!json.ok || !json.data) throw new Error("Failed to fetch billing");
      return json.data;
    },
    enabled: !!accountId,
    staleTime: 120_000,
  });
}
