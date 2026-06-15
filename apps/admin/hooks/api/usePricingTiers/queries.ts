/**
 * @file queries.ts
 * @description Read-only hooks for pricing tiers, account tiers, and bundles.
 * @layer infrastructure
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchPricingTiers } from "./api.js";

/**
 * @hook usePricingTiers
 * @description Fetches all pricing tiers, account tiers, and bundles.
 * @returns Query result with { data: { providerTiers, accountTiers, bundles }, isLoading, error }
 */
export function usePricingTiers() {
  return useQuery({
    queryKey: ["pricing", "tiers"],
    queryFn: fetchPricingTiers,
    staleTime: 300_000,
  });
}
