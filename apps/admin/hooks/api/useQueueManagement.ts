/**
 * @file useQueueManagement.ts
 * @description TanStack Query hooks for queue monitoring: stats, failed jobs, and retry.
 *   Used by the /maintenance page for operational queue management.
 * @layer presentation
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@packages/ui";
import { ApiError, getErrorMessage } from "@/lib/parseApiError";

export interface QueueStats {
  total: number;
  queued: number;
  processing: number;
  published: number;
  failed: number;
  paused: number;
  successRate: number;
  waiting?: number;
  active?: number;
  completed?: number;
  delayed?: number;
}

export interface FailedJob {
  id: string;
  name: string;
  queue?: string;
  data: Record<string, unknown>;
  failedReason: string;
  attemptsMade: number;
  timestamp: number;
  processedOn?: number;
  finishedOn?: number;
}

/**
 * @function useQueueStats
 * @description Fetches queue statistics with auto-refresh every 30 seconds.
 */
export function useQueueStats() {
  return useQuery({
    queryKey: ["queue", "stats"],
    queryFn: async (): Promise<QueueStats> => {
      const res = await fetch("/api/backend/admin/queue/stats", {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
      const json = await res.json();
      return json.data?.stats ?? json.data ?? {};
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

/**
 * @function useFailedJobs
 * @description Fetches failed jobs with auto-refresh every 30 seconds.
 */
export function useFailedJobs() {
  return useQuery({
    queryKey: ["queue", "jobs", "failed"],
    queryFn: async (): Promise<FailedJob[]> => {
      const res = await fetch("/api/backend/admin/queue/jobs?types=failed&start=0&end=50", {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
      const json = await res.json();
      return json.data?.items ?? json.data?.jobs ?? [];
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

/**
 * @function useRetryJob
 * @description Mutation to retry a failed job by ID.
 */
export function useRetryJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) => {
      const res = await fetch(`/api/backend/admin/queue/jobs/${jobId}/retry`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["queue"] });
      toast({ title: "Success", description: "Job queued for retry" });
    },
    onError: (err) => {
      toast({
        title: "Error",
        description: getErrorMessage(err),
        variant: "destructive",
      });
    },
  });
}
