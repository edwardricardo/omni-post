/**
 * @file useWebhooks.ts
 * @description TanStack Query hooks for fetching webhook dashboard metrics, event lists,
 * subscriptions, and dead-letter queue data.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/parseApiError";

interface DashboardMetrics {
  totalEvents: number;
  processedEvents: number;
  failedEvents: number;
  successRate: number;
  avgProcessingTime: number;
  queueDepth: number;
  realtimeConnections: number;
  byProvider: Record<
    string,
    {
      total: number;
      success: number;
      failed: number;
      successRate: number;
      avgProcessingTime: number;
    }
  >;
  byEventType: Record<string, number>;
  timeline: Array<{
    timestamp: string;
    total: number;
    success: number;
    failed: number;
  }>;
}

/**
 * Hook to fetch webhook dashboard metrics
 */
export function useWebhookMetrics(timeRange: string, selectedProvider?: string) {
  return useQuery({
    queryKey: ["webhooks", "metrics", timeRange, selectedProvider],
    queryFn: async () => {
      const params = new URLSearchParams({
        timeRange,
        ...(selectedProvider && selectedProvider !== "all" && { provider: selectedProvider }),
      });

      const response = await fetch(`/api/backend/api/webhooks/dashboard/metrics?${params}`, {
        credentials: "include",
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw ApiError.fromResponse(response.status, body);
      }

      const body = (await response.json()) as { ok: boolean; data: DashboardMetrics };
      if (!body.ok || !body.data) {
        throw new Error("Failed to fetch webhook metrics data");
      }
      return body.data;
    },
    staleTime: 30000, // 30 seconds
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });
}

/**
 * Hook to fetch DLQ lifecycle metrics (unresolved, archived, outbox totals, etc.)
 */
export function useDlqMetrics() {
  return useQuery({
    queryKey: ["dlq", "metrics"],
    queryFn: async () => {
      const res = await fetch("/api/backend/api/webhooks/dashboard/dead-letter/metrics", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch DLQ metrics");
      const json = await res.json();
      return json.data;
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

/**
 * Hook to fetch outbox dead-letter entries with pagination
 */
export function useOutboxDeadLetter(page = 1, limit = 20) {
  return useQuery({
    queryKey: ["outbox", "dead-letter", page, limit],
    queryFn: async () => {
      const res = await fetch(
        `/api/backend/api/admin/outbox/dead-letter?page=${page}&limit=${limit}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch outbox DLQ");
      const json = await res.json();
      return json.data;
    },
    staleTime: 30_000,
  });
}

/**
 * Mutation hook to retry an outbox dead-letter entry
 */
export function useRetryOutboxDlq() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/backend/api/admin/outbox/dead-letter/${id}/retry`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Retry failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["outbox"] });
    },
  });
}

/**
 * Mutation hook to resolve an outbox dead-letter entry
 */
export function useResolveOutboxDlq() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/backend/api/admin/outbox/dead-letter/${id}/resolve`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Resolve failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["outbox"] });
    },
  });
}
