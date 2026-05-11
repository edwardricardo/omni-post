/**
 * @file useSagaStatus.ts
 * @description TanStack Query hook that polls saga status until a terminal
 *              state (COMPLETED, FAILED, COMPENSATED) is reached. The poll
 *              interval is 1s — short enough that draft sagas complete in a
 *              single tick and publish-now sagas feel responsive, while not
 *              overwhelming the API at the current scale. Polling stops
 *              automatically once the saga reaches terminal status; callers
 *              that want to invalidate caches on completion should observe
 *              `data.status` and react to the transition.
 * @layer infrastructure
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import {
  SAGA_TERMINAL_STATUSES,
  type SagaStatus,
  type SagaStatusDetails,
} from "@/lib/api/clients/sagaClient";
import type { ApiResponse } from "@/lib/api/types";

/** 1 s — the cadence trade-off documented in the file header. */
const POLL_INTERVAL_MS = 1000;

const sagaStatusKey = (sagaId: string) => ["sagas", sagaId] as const;

interface UseSagaStatusOptions {
  /** Set to false to suspend polling (e.g. while an unrelated dialog is open). */
  enabled?: boolean;
}

/**
 * @hook useSagaStatus
 * @description Polls `GET /sagas/:sagaId` every 1 s until the saga reaches
 *   COMPLETED, FAILED, or COMPENSATED. Returns the standard TanStack `query`
 *   shape; consumers read `data?.data.status`, `data?.data.progress`, etc.
 *
 *   Pass `null` for `sagaId` to disable the query entirely (useful while no
 *   saga is in flight). The returned `isTerminal` boolean is a convenience
 *   for unmount / redirect logic.
 *
 * @example
 * const { data, isTerminal } = useSagaStatus(activeSagaId);
 * useEffect(() => {
 *   if (isTerminal && data?.data.status === "COMPLETED") router.push("/dashboard/posts");
 * }, [isTerminal, data]);
 */
export function useSagaStatus(sagaId: string | null, options?: UseSagaStatusOptions) {
  const enabled = (options?.enabled ?? true) && sagaId !== null;

  const query = useQuery<ApiResponse<SagaStatusDetails>, Error>({
    queryKey: sagaStatusKey(sagaId ?? "__none__"),
    queryFn: () => {
      if (!sagaId) {
        // queryFn shouldn't run when enabled=false, but the type system
        // can't narrow that — fall back to a never-resolving promise to
        // satisfy the contract without making a network call.
        return new Promise(() => {});
      }
      return apiClient.getSagaStatus(sagaId);
    },
    enabled,
    refetchInterval: (q) => {
      const status = q.state.data?.data?.status;
      if (!status) return POLL_INTERVAL_MS;
      return SAGA_TERMINAL_STATUSES.includes(status) ? false : POLL_INTERVAL_MS;
    },
    refetchIntervalInBackground: false,
  });

  const status: SagaStatus | undefined = query.data?.data?.status;
  const isTerminal = status !== undefined && SAGA_TERMINAL_STATUSES.includes(status);

  return {
    ...query,
    /** `true` once the saga is in a terminal state (COMPLETED | FAILED | COMPENSATED). */
    isTerminal,
    /** Convenience accessor — equivalent to `query.data?.data?.status`. */
    status,
  };
}
