/**
 * @file useAuditStats.ts
 * @description TanStack Query hook for fetching audit log statistics.
 *   Used by the /logs page to display summary stat cards.
 * @layer infrastructure
 */

import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/lib/parseApiError";

export interface AuditStats {
  totalLogs: number;
  todayLogs: number;
  uniqueUsers: number;
  failureRate: number;
  successRate: number;
}

/**
 * @hook useAuditStats
 * @description Fetches audit log statistics (total, today, unique users, failure rate)
 *   from the admin audit stats endpoint. Used by the /logs page stat cards.
 * @returns Query result with { data: AuditStats, isLoading, error }
 */
export function useAuditStats() {
  return useQuery({
    queryKey: ["audit", "stats"],
    queryFn: async (): Promise<AuditStats> => {
      const res = await fetch("/api/backend/admin/audit/stats", {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
      const json = await res.json();
      const stats = json.data?.stats ?? json.data ?? {};
      return {
        totalLogs: stats.totalLogs ?? stats.total ?? 0,
        todayLogs: stats.todayLogs ?? stats.today ?? 0,
        uniqueUsers: stats.uniqueUsers ?? 0,
        failureRate: stats.failureRate ?? 0,
        successRate: stats.successRate ?? 100,
      };
    },
    staleTime: 60_000,
  });
}
