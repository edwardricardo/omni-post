/**
 * @file api.ts
 * @description Internal fetch helpers for the campaigns endpoints.
 * @layer infrastructure
 */

import type { CampaignAnalyticsDto, CampaignDto, CreateCampaignInput } from "./types.js";

export async function fetchCampaigns(params: {
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
  const body = (await res.json()) as { ok: boolean; data?: CampaignDto[] };
  return body.ok && body.data ? body.data : [];
}

export async function fetchCampaign(campaignId: string): Promise<CampaignDto> {
  const res = await fetch(`/api/backend/campaigns/${campaignId}`, {
    cache: "no-store",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch campaign");
  const body = (await res.json()) as { ok: boolean; data?: CampaignDto };
  if (!body.ok || !body.data) throw new Error("Campaign not found");
  return body.data;
}

export async function fetchCampaignAnalytics(campaignId: string): Promise<CampaignAnalyticsDto> {
  const res = await fetch(`/api/backend/campaigns/${campaignId}/analytics`, {
    cache: "no-store",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch campaign analytics");
  const body = (await res.json()) as { ok: boolean; data?: CampaignAnalyticsDto };
  if (!body.ok || !body.data) {
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
  }
  return body.data;
}

export async function createCampaign(input: CreateCampaignInput): Promise<{ id: string }> {
  const res = await fetch("/api/backend/campaigns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error("Failed to create campaign");
  const body = (await res.json()) as { ok: boolean; data?: { id: string } };
  if (!body.ok || !body.data) throw new Error("Create failed");
  return body.data;
}

export async function archiveCampaign(campaignId: string): Promise<void> {
  const res = await fetch(`/api/backend/campaigns/${campaignId}/archive`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to archive campaign");
}
