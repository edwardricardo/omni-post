"use client";

/**
 * @file useUsageMetrics.ts
 * @description TanStack Query hook for fetching account usage metrics.
 * @layer presentation
 */

import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/lib/parseApiError";

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
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw ApiError.fromResponse(res.status, body);
  }
  const json = (await res.json()) as { ok: boolean; data?: UsageMetricsDto };
  if (!json.data) throw new Error("No data returned");
  return json.data;
}

/**
 * @hook useUsageMetrics
 * @description Fetches current-month usage metrics for a specific account including
 *   posts published, AI calls, storage usage, and team member count.
 * @param accountId - The account ID to fetch usage metrics for
 * @returns Query result with { data: UsageMetricsDto, isLoading, error }
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
