/**
 * @file queries.ts
 * @description Read-only hooks for billing — gateway status, available
 *              plans, and invoice history.
 * @layer infrastructure
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchGatewayStatus, fetchInvoices } from "./api";
import type { BillingPlan } from "./types";

/**
 * @hook useGatewayStatus
 * @description Fetches the current billing gateway provider and any pending switch.
 * @returns TanStack Query result with gateway status data
 */
export function useGatewayStatus() {
  return useQuery({
    queryKey: ["gateway-status"],
    queryFn: fetchGatewayStatus,
    staleTime: 60_000,
  });
}

/**
 * @hook useAvailablePlans
 * @description Fetches active billing plans (public, no auth required).
 * @returns TanStack Query result with available billing plan array
 */
export function useAvailablePlans() {
  return useQuery({
    queryKey: ["billing", "plans"],
    queryFn: async (): Promise<BillingPlan[]> => {
      const res = await fetch("/api/backend/billing/plans", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) throw new Error("Failed to fetch plans");
      const json = (await res.json()) as {
        ok: boolean;
        data?: { plans: BillingPlan[] };
      };
      return json.data?.plans ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * @hook useMyInvoices
 * @description Fetches paginated invoice history for the current account.
 * @param page - Page number (1-based)
 * @param limit - Items per page
 * @returns Query result with invoices array, total, page, limit
 */
export function useMyInvoices(page = 1, limit = 10) {
  return useQuery({
    queryKey: ["billing", "invoices", page, limit],
    queryFn: () => fetchInvoices(page, limit),
    staleTime: 60_000,
  });
}
