/**
 * @file useCampaigns.ts
 * @description TanStack Query hooks for campaign management.
 * @layer client-hooks
 */

"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CampaignDto {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "COMPLETED" | "ARCHIVED";
  startDate: string | null;
  endDate: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignAnalyticsDto {
  campaignId: string;
  totalPosts: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  totalEngagement: number;
  avgEngagementRate: number;
}

export interface CreateCampaignInput {
  projectId: string;
  name: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  utmSource?: string;
  utmMedium?: string;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchCampaigns(params: {
  projectId: string;
  status?: string;
}): Promise<CampaignDto[]> {
  const searchParams = new URLSearchParams();
  searchParams.set("projectId", params.projectId);
  if (params.status) searchParams.set("status", params.status);

  const res = await fetch(`/api/backend/campaigns?${searchParams.toString()}`, {
    cache: "no-store",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch campaigns");
  const data = (await res.json()) as { ok: boolean; value?: CampaignDto[] };
  return data.ok && data.value ? data.value : [];
}

async function fetchCampaign(campaignId: string): Promise<CampaignDto> {
  const res = await fetch(`/api/backend/campaigns/${campaignId}`, {
    cache: "no-store",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch campaign");
  const data = (await res.json()) as { ok: boolean; value?: CampaignDto };
  if (!data.ok || !data.value) throw new Error("Campaign not found");
  return data.value;
}

async function fetchCampaignAnalytics(campaignId: string): Promise<CampaignAnalyticsDto> {
  const res = await fetch(`/api/backend/campaigns/${campaignId}/analytics`, {
    cache: "no-store",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch campaign analytics");
  const data = (await res.json()) as { ok: boolean; value?: CampaignAnalyticsDto };
  if (!data.ok || !data.value)
    return {
      campaignId,
      totalPosts: 0,
      totalViews: 0,
      totalLikes: 0,
      totalComments: 0,
      totalShares: 0,
      totalEngagement: 0,
      avgEngagementRate: 0,
    };
  return data.value;
}

async function createCampaign(input: CreateCampaignInput): Promise<{ id: string }> {
  const res = await fetch("/api/backend/campaigns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("Failed to create campaign");
  const data = (await res.json()) as { ok: boolean; value?: { id: string } };
  if (!data.ok || !data.value) throw new Error("Create failed");
  return data.value;
}

async function archiveCampaign(campaignId: string): Promise<void> {
  const res = await fetch(`/api/backend/campaigns/${campaignId}/archive`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to archive campaign");
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useCampaigns(params: { projectId: string; status?: string }) {
  return useQuery({
    queryKey: ["campaigns", params],
    queryFn: () => fetchCampaigns(params),
    staleTime: 30_000,
    enabled: !!params.projectId,
  });
}

export function useCampaign(campaignId: string) {
  return useQuery({
    queryKey: ["campaigns", campaignId],
    queryFn: () => fetchCampaign(campaignId),
    staleTime: 30_000,
    enabled: !!campaignId,
  });
}

export function useCampaignAnalytics(campaignId: string) {
  return useQuery({
    queryKey: ["campaigns", campaignId, "analytics"],
    queryFn: () => fetchCampaignAnalytics(campaignId),
    staleTime: 60_000,
    enabled: !!campaignId,
  });
}

export function useCreateCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createCampaign,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
  });
}

export function useArchiveCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: archiveCampaign,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
  });
}
