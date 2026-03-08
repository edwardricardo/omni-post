/**
 * @file useWebhooks.ts
 * @description TanStack Query hooks for fetching webhook dashboard metrics, event lists,
 * subscriptions, and dead-letter queue data.
 */
import { useQuery } from "@tanstack/react-query";

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

      const response = await fetch(`/api/webhooks/dashboard/metrics?${params}`, {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Failed to fetch webhook metrics");
      }

      return (await response.json()) as DashboardMetrics;
    },
    staleTime: 30000, // 30 seconds
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });
}
