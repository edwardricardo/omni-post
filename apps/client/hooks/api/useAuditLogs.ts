/**
 * @file useAuditLogs.ts
 * @description TanStack Query hook for fetching audit logs with filtering and auto-refresh.
 * Used by the /logs dashboard page to display system events and user activities.
 */
import { useQuery } from "@tanstack/react-query";
import { api, type AuditLog, type AuditLogFilters } from "../../lib/apiClient";

/**
 * Hook to fetch audit logs using TanStack Query.
 * Automatically refetches every 30 seconds to keep data fresh.
 *
 * @param filters - Optional query filters (userId, action, resource, dates, pagination)
 * @returns Standard TanStack Query result with `data` as AuditLog[]
 */
export function useAuditLogs(filters?: AuditLogFilters) {
  return useQuery({
    queryKey: ["audit", "logs", filters],
    queryFn: async (): Promise<AuditLog[]> => {
      const response = await api.audit.getLogs(filters);

      if (!response.ok) {
        throw new Error("Failed to fetch audit logs");
      }

      return response.data.logs;
    },
    staleTime: 30_000, // 30 seconds — logs should be relatively fresh
    refetchInterval: 30_000, // Auto-refresh every 30 seconds
    retry: 2,
  });
}
