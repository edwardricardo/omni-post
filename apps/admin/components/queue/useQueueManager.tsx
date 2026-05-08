/**
 * @file useQueueManager.tsx
 * @description Admin queue dashboard hook. Fetches BullMQ jobs + stats via the
 *   /api/backend/queue proxy, maps raw jobs into UI QueueItem shape, exposes
 *   local filter state, and provides retry/cancel/delete mutations.
 * @layer infrastructure
 */
"use client";

import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

export type QueueItemStatus =
  | "queued"
  | "processing"
  | "published"
  | "failed"
  | "cancelled"
  | "paused";

export interface QueueItem {
  id: string;
  status: QueueItemStatus;
  providers: string[];
  priority: string;
  content: string;
  createdAt: number;
  processedAt?: number;
  finishedAt?: number;
  failedReason?: string;
  progress: number;
  attemptsMade: number;
  maxAttempts: number;
}

export interface QueueStats {
  total: number;
  queued: number;
  processing: number;
  published: number;
  failed: number;
  paused: number;
  successRate: number;
}

const EMPTY_STATS: QueueStats = {
  total: 0,
  queued: 0,
  processing: 0,
  published: 0,
  failed: 0,
  paused: 0,
  successRate: 100,
};

interface QueueFilter {
  status?: QueueItemStatus[];
  providers?: string[];
}

interface RawJob {
  id: string;
  name: string;
  data: {
    content?: string;
    text?: string;
    provider?: string;
    providers?: string[];
    priority?: string;
  };
  progress: number;
  attemptsMade: number;
  maxAttempts: number;
  timestamp: number;
  processedOn?: number;
  finishedOn?: number;
  failedReason?: string;
  delay: number;
}

interface UseQueueManagerOptions {
  onQueueUpdate?: (stats: QueueStats) => void;
}

function inferStatus(job: RawJob): QueueItemStatus {
  if (job.failedReason) return "failed";
  if (job.finishedOn) return "published";
  if (job.processedOn) return "processing";
  return "queued";
}

function mapProviders(data: RawJob["data"]): string[] {
  if (Array.isArray(data.providers)) return data.providers;
  if (data.provider) return [data.provider];
  return [];
}

function mapJob(job: RawJob): QueueItem {
  return {
    id: job.id,
    status: inferStatus(job),
    providers: mapProviders(job.data),
    priority: job.data.priority ?? "medium",
    content: job.data.content ?? job.data.text ?? "",
    createdAt: job.timestamp,
    ...(job.processedOn !== undefined && { processedAt: job.processedOn }),
    ...(job.finishedOn !== undefined && { finishedAt: job.finishedOn }),
    ...(job.failedReason !== undefined && { failedReason: job.failedReason }),
    progress: job.progress,
    attemptsMade: job.attemptsMade,
    maxAttempts: job.maxAttempts,
  };
}

/**
 * @hook useQueueManager
 * @description Fetches queue jobs + stats, maps them to UI items, and provides
 *   filter state plus retry/cancel/delete mutations.
 */
export function useQueueManager(options: UseQueueManagerOptions) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<QueueFilter>({});

  const queueQuery = useQuery({
    queryKey: ["queue", "combined"],
    queryFn: async (): Promise<{ items: RawJob[]; stats: QueueStats }> => {
      const [jobsRes, statsRes] = await Promise.all([
        fetch("/api/backend/queue/jobs", { credentials: "include" }),
        fetch("/api/backend/queue/stats", { credentials: "include" }),
      ]);
      if (!jobsRes.ok) throw new Error("Failed to fetch queue jobs");
      const jobsBody = (await jobsRes.json()) as {
        ok: boolean;
        value?: { items: RawJob[]; total: number };
      };
      if (!jobsBody.ok || !jobsBody.value) throw new Error("Failed to fetch queue jobs");

      let queueStats: QueueStats = EMPTY_STATS;
      if (statsRes.ok) {
        const statsBody = (await statsRes.json()) as { ok: boolean; value?: QueueStats };
        if (statsBody.ok && statsBody.value) {
          queueStats = statsBody.value;
        }
      }
      return { items: jobsBody.value.items, stats: queueStats };
    },
  });

  const stats: QueueStats = queueQuery.data?.stats ?? EMPTY_STATS;

  const queueItems = useMemo<QueueItem[]>(() => {
    return (queueQuery.data?.items ?? []).map(mapJob);
  }, [queueQuery.data]);

  const filteredItems = useMemo<QueueItem[]>(() => {
    return queueItems.filter((item) => {
      if (filter.status && filter.status.length > 0 && !filter.status.includes(item.status)) {
        return false;
      }
      if (filter.providers && filter.providers.length > 0) {
        const hasMatch = item.providers.some((p) => filter.providers!.includes(p));
        if (!hasMatch) return false;
      }
      return true;
    });
  }, [queueItems, filter]);

  const onQueueUpdate = options.onQueueUpdate;
  const loadedStats = queueQuery.data?.stats;
  useEffect(() => {
    if (onQueueUpdate && loadedStats) {
      onQueueUpdate(loadedStats);
    }
  }, [onQueueUpdate, loadedStats]);

  const retryMutation = useMutation({
    mutationFn: async (jobId: string): Promise<void> => {
      const res = await fetch(`/api/backend/queue/jobs/${jobId}/retry`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to retry job");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["queue"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (jobId: string): Promise<void> => {
      const res = await fetch(`/api/backend/queue/jobs/${jobId}/remove`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete job");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["queue"] });
    },
  });

  return {
    queueItems,
    filteredItems,
    stats,
    isLoading: queueQuery.isLoading,
    filter,
    setFilter,
    retryItem: (jobId: string) => retryMutation.mutateAsync(jobId),
    deleteItem: (jobId: string) => deleteMutation.mutateAsync(jobId),
  };
}
