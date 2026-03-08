/**
 * useQueueManager Hook
 *
 * Fetches real BullMQ job data from the admin queue API and exposes
 * queue items, stats, filters, and mutation helpers to the UI.
 *
 * - Jobs + stats are fetched in parallel with 5-second polling via TanStack Query.
 * - Filter and sort logic runs client-side on the fetched data.
 * - Mutations (retry / remove) invalidate both query keys on success.
 */
import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueueItem, QueueStats, QueueFilter } from "./types";

// ---------------------------------------------------------------------------
// Public hook interface
// ---------------------------------------------------------------------------

interface UseQueueManagerProps {
  onQueueUpdate?: (stats: QueueStats) => void;
  onError?: (error: string) => void;
}

// ---------------------------------------------------------------------------
// API shape mirrors BaseRouteHandler.sendSuccess() — { ok: true, value: data }
// ---------------------------------------------------------------------------

interface ApiJob {
  id: string;
  name: string;
  data: Record<string, unknown>;
  progress: number | object;
  attemptsMade: number;
  maxAttempts?: number;
  timestamp: number;
  processedOn?: number;
  finishedOn?: number;
  failedReason?: string;
  delay: number;
}

interface ApiJobsResponse {
  items: ApiJob[];
  total: number;
}

interface ApiStats {
  total: number;
  queued: number;
  processing: number;
  published: number;
  failed: number;
  paused: number;
  successRate: number;
}

// ---------------------------------------------------------------------------
// Data adapter — maps BullMQ job shape → QueueItem consumed by the UI
// ---------------------------------------------------------------------------

function adaptJobToQueueItem(job: ApiJob): QueueItem {
  // BullMQ state is not returned in list responses (requires a separate getState call).
  // We infer status from the presence of finishedOn / failedReason instead.
  let status: QueueItem["status"] = "queued";
  if (job.failedReason) {
    status = "failed";
  } else if (job.finishedOn) {
    status = "published";
  } else if (job.processedOn && !job.finishedOn) {
    status = "processing";
  }

  const jobData = job.data as Record<string, unknown>;

  return {
    id: String(job.id),
    content: {
      text:
        typeof jobData.content === "string"
          ? jobData.content
          : typeof jobData.text === "string"
            ? jobData.text
            : (job.name ?? "Untitled job"),
      ...(typeof jobData.title === "string" && { title: jobData.title }),
    },
    providers: Array.isArray(jobData.providers)
      ? (jobData.providers as string[])
      : typeof jobData.provider === "string"
        ? [jobData.provider]
        : ["unknown"],
    status,
    priority:
      typeof jobData.priority === "string" &&
      ["low", "medium", "high", "urgent"].includes(jobData.priority)
        ? (jobData.priority as QueueItem["priority"])
        : "medium",
    ...(typeof job.progress === "number" && { progress: job.progress }),
    attempts: job.attemptsMade,
    maxAttempts: job.maxAttempts ?? 3,
    createdAt: new Date(job.timestamp),
    updatedAt: new Date(job.processedOn ?? job.timestamp),
    ...(job.finishedOn && { publishedAt: new Date(job.finishedOn) }),
    ...(job.failedReason && { error: job.failedReason }),
  };
}

// ---------------------------------------------------------------------------
// Priority sort order
// ---------------------------------------------------------------------------

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

// ---------------------------------------------------------------------------
// Default stats (shown while loading or when API is unavailable)
// ---------------------------------------------------------------------------

const EMPTY_STATS: QueueStats = {
  total: 0,
  queued: 0,
  processing: 0,
  published: 0,
  failed: 0,
  avgProcessingTime: 0,
  successRate: 100,
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useQueueManager({ onQueueUpdate, onError }: UseQueueManagerProps) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<QueueFilter>({});

  // ------------------------------------------------------------------
  // Fetch jobs — all states, first 100 items, auto-polls every 5 s
  // ------------------------------------------------------------------
  const { data: jobsData, isLoading: jobsLoading } = useQuery({
    queryKey: ["queue-jobs"] as const,
    queryFn: async (): Promise<ApiJobsResponse> => {
      const res = await fetch(
        "/api/backend/admin/queue/jobs?types=waiting,active,failed,delayed,completed&start=0&end=99"
      );
      if (!res.ok) {
        throw new Error(`Failed to fetch queue jobs: HTTP ${res.status}`);
      }
      const json = (await res.json()) as { ok: boolean; value: ApiJobsResponse };
      return json.value;
    },
    refetchInterval: 5_000,
    // Treat stale data as acceptable during polling window
    staleTime: 4_000,
  });

  // ------------------------------------------------------------------
  // Fetch stats — auto-polls every 5 s
  // ------------------------------------------------------------------
  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ["queue-stats"] as const,
    queryFn: async (): Promise<ApiStats> => {
      const res = await fetch("/api/backend/admin/queue/stats");
      if (!res.ok) {
        throw new Error(`Failed to fetch queue stats: HTTP ${res.status}`);
      }
      const json = (await res.json()) as { ok: boolean; value: ApiStats };
      return json.value;
    },
    refetchInterval: 5_000,
    staleTime: 4_000,
  });

  // ------------------------------------------------------------------
  // Map raw API jobs → QueueItem[]
  // ------------------------------------------------------------------
  const queueItems: QueueItem[] = useMemo(
    () => (jobsData?.items ?? []).map(adaptJobToQueueItem),
    [jobsData]
  );

  // ------------------------------------------------------------------
  // Derive stats from API response (or fall back to empty)
  // ------------------------------------------------------------------
  const stats: QueueStats = useMemo(() => {
    if (!statsData) return EMPTY_STATS;

    const derived: QueueStats = {
      total: statsData.total,
      queued: statsData.queued,
      processing: statsData.processing,
      published: statsData.published,
      failed: statsData.failed,
      avgProcessingTime: 0, // BullMQ does not expose this directly
      successRate: statsData.successRate,
    };

    onQueueUpdate?.(derived);
    return derived;
  }, [statsData, onQueueUpdate]);

  // ------------------------------------------------------------------
  // Client-side filtering + sorting
  // ------------------------------------------------------------------
  const filteredItems: QueueItem[] = useMemo(() => {
    let filtered = [...queueItems];

    if (filter.status?.length) {
      filtered = filtered.filter((item) => filter.status!.includes(item.status));
    }

    if (filter.priority?.length) {
      filtered = filtered.filter((item) => filter.priority!.includes(item.priority));
    }

    if (filter.providers?.length) {
      filtered = filtered.filter((item) =>
        item.providers.some((provider) => filter.providers!.includes(provider))
      );
    }

    if (filter.dateRange) {
      const { start, end } = filter.dateRange;
      filtered = filtered.filter((item) => item.createdAt >= start && item.createdAt <= end);
    }

    // Sort: highest priority first, then newest first within priority tier
    filtered.sort((a, b) => {
      const priorityDiff = (PRIORITY_ORDER[b.priority] ?? 0) - (PRIORITY_ORDER[a.priority] ?? 0);
      if (priorityDiff !== 0) return priorityDiff;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    return filtered;
  }, [queueItems, filter]);

  // ------------------------------------------------------------------
  // Mutations
  // ------------------------------------------------------------------

  const invalidateQueue = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["queue-jobs"] });
    queryClient.invalidateQueries({ queryKey: ["queue-stats"] });
  }, [queryClient]);

  const retryMutation = useMutation({
    mutationFn: async (jobId: string): Promise<void> => {
      const res = await fetch(`/api/backend/admin/queue/jobs/${jobId}/retry`, {
        method: "POST",
      });
      if (!res.ok) {
        throw new Error(`Failed to retry job: HTTP ${res.status}`);
      }
    },
    onSuccess: invalidateQueue,
    onError: () => onError?.("Failed to retry item"),
  });

  const removeMutation = useMutation({
    mutationFn: async (jobId: string): Promise<void> => {
      const res = await fetch(`/api/backend/admin/queue/jobs/${jobId}/remove`, {
        method: "POST",
      });
      if (!res.ok) {
        throw new Error(`Failed to remove job: HTTP ${res.status}`);
      }
    },
    onSuccess: invalidateQueue,
    onError: () => onError?.("Failed to delete item"),
  });

  const retryItem = useCallback(
    async (itemId: string): Promise<void> => {
      retryMutation.mutate(itemId);
    },
    [retryMutation]
  );

  // cancelItem and deleteItem both call the same remove endpoint —
  // BullMQ does not have a distinct "cancel" concept for queued jobs.
  const cancelItem = useCallback(
    async (itemId: string): Promise<void> => {
      removeMutation.mutate(itemId);
    },
    [removeMutation]
  );

  const deleteItem = useCallback(
    async (itemId: string): Promise<void> => {
      removeMutation.mutate(itemId);
    },
    [removeMutation]
  );

  const isLoading = jobsLoading || statsLoading;

  return {
    queueItems,
    filteredItems,
    stats,
    filter,
    setFilter,
    isLoading,
    retryItem,
    cancelItem,
    deleteItem,
  };
}
