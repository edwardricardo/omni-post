/**
 * @file queries.ts
 * @description Read-only hooks for campaigns — list, single, analytics.
 * @layer infrastructure
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchCampaign, fetchCampaignAnalytics, fetchCampaigns } from "./api";

/**
 * @hook useCampaigns
 * @description Fetches campaigns for a project with optional status filter.
 * @param params - Filter options: projectId (required), status (optional)
 * @returns TanStack Query result with campaign array
 */
export function useCampaigns(params: { projectId: string; status?: string }) {
  return useQuery({
    queryKey: ["campaigns", params],
    queryFn: () => fetchCampaigns(params),
    staleTime: 30_000,
    enabled: !!params.projectId,
  });
}

/**
 * @hook useCampaign
 * @description Fetches a single campaign by ID.
 * @param campaignId - The campaign to fetch
 * @returns TanStack Query result with campaign data
 */
export function useCampaign(campaignId: string) {
  return useQuery({
    queryKey: ["campaigns", campaignId],
    queryFn: () => fetchCampaign(campaignId),
    staleTime: 30_000,
    enabled: !!campaignId,
  });
}

/**
 * @hook useCampaignAnalytics
 * @description Fetches analytics data for a specific campaign.
 * @param campaignId - The campaign to fetch analytics for
 * @returns TanStack Query result with campaign analytics data
 */
export function useCampaignAnalytics(campaignId: string) {
  return useQuery({
    queryKey: ["campaigns", campaignId, "analytics"],
    queryFn: () => fetchCampaignAnalytics(campaignId),
    staleTime: 60_000,
    enabled: !!campaignId,
  });
}
