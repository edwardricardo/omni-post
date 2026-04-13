/**
 * @file useUsage.ts
 * @description TanStack Query hook for account usage metrics.
 * @layer client-hooks
 */

"use client";

import { useQuery } from "@tanstack/react-query";

export interface AccountUsageDto {
  postsPublished: number;
  aiCallsMade: number;
  storageGb: number;
  teamMemberCount: number;
  plan: string;
  postsLimit: number;
  channelsLimit: number;
  teamMembersLimit: number;
  storageLimitGb: number;
  channelsCount: number;
  isOnTrial: boolean;
  trialEndDate: string | null;
  nextBillingDate: string | null;
}

async function fetchUsage(accountId: string): Promise<AccountUsageDto> {
  const now = new Date();
  const res = await fetch(
    `/api/backend/usage?accountId=${accountId}&year=${now.getFullYear()}&month=${now.getMonth() + 1}`,
    { cache: "no-store", credentials: "include" }
  );
  if (!res.ok) throw new Error("Failed to fetch usage");
  const data = (await res.json()) as { ok: boolean; value?: AccountUsageDto };
  if (data.ok && data.value) return data.value;
  return {
    postsPublished: 0,
    aiCallsMade: 0,
    storageGb: 0,
    teamMemberCount: 0,
    plan: "none",
    postsLimit: 10,
    channelsLimit: 3,
    teamMembersLimit: 5,
    storageLimitGb: 5,
    channelsCount: 0,
    isOnTrial: true,
    trialEndDate: null,
    nextBillingDate: null,
  };
}

/**
 * @hook useAccountUsage
 * @description Fetches account usage data including plan limits, current usage, and trial status.
 * @param accountId - The account to fetch usage for
 * @returns TanStack Query result with account usage data including limits and counts
 */
export function useAccountUsage(accountId: string) {
  return useQuery({
    queryKey: ["usage", accountId],
    queryFn: () => fetchUsage(accountId),
    staleTime: 60_000,
    enabled: !!accountId,
  });
}
