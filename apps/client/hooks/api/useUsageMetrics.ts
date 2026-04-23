"use client";

/**
 * @file useUsageMetrics.ts
 * @description TanStack Query hook for fetching account usage metrics.
 * @layer infrastructure
 */

import { useQuery } from "@tanstack/react-query";

export interface UsageMetricsDto {
  accountId: string;
  periodYear: number;
  periodMonth: number;
  postsPublished: number;
  aiCallsMade: number;
  storageGb: number;
  teamMemberCount: number;
}

async function fetchUsageMetrics(
  accountId: string,
  year: number,
  month: number
): Promise<UsageMetricsDto> {
  const res = await fetch(`/api/backend/accounts/${accountId}/usage?year=${year}&month=${month}`);
  if (!res.ok) throw new Error("Failed to fetch usage metrics");
  const json = (await res.json()) as { ok: boolean; data?: UsageMetricsDto };
  if (!json.data) throw new Error("No data returned");
  return json.data;
}

/**
 * @hook useUsageMetrics
 * @description Fetches detailed account usage metrics for the current billing period.
 * @param accountId - The account to fetch usage metrics for
 * @returns TanStack Query result with usage metrics data (posts, AI calls, storage, team count)
 */
export function useUsageMetrics(accountId: string) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  return useQuery({
    queryKey: ["usage-metrics", accountId, year, month],
    queryFn: () => fetchUsageMetrics(accountId, year, month),
    enabled: Boolean(accountId),
    staleTime: 5 * 60 * 1000,
  });
}
