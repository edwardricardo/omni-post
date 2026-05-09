/**
 * @file useStartPostPublishingSaga.ts
 * @description TanStack Query mutation hook that kicks off the customer
 *              post-publishing saga endpoint. Supersedes the legacy triplet
 *              of `useCreatePost`, `useSchedulePost`, and direct
 *              `apiClient.publishPost` calls — the body's `mode` discriminator
 *              selects which saga steps actually run end-to-end.
 *
 *              The mutation resolves as soon as the saga is registered and
 *              its first execution tick is scheduled (fire-and-forget on the
 *              backend); callers pair this with `useSagaStatus` to observe
 *              progress until a terminal state. Posts and post-list caches
 *              are invalidated on terminal observation, not at mutation
 *              completion, since the saga may still be writing state when
 *              this resolves.
 * @layer infrastructure
 */

"use client";

import { useMutation } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import type {
  StartPostPublishingSagaInput,
  StartPostPublishingSagaResponse,
} from "@/lib/api/clients/sagaClient";
import type { ApiResponse } from "@/lib/api/types";

const START_POST_PUBLISHING_SAGA_MUTATION_KEY = ["sagas", "post-publishing", "start"] as const;

/**
 * @hook useStartPostPublishingSaga
 * @description Mutation that starts a post-publishing saga in one of three
 *   modes (`draft`, `schedule`, `publish-now`). Returns the new saga's id
 *   so callers can subsequently poll status via `useSagaStatus(sagaId)`.
 *
 * @example
 * const startSaga = useStartPostPublishingSaga();
 * startSaga.mutate(
 *   { mode: "publish-now", projectId, locale: "en", body: text, channelIds },
 *   { onSuccess: (res) => setActiveSagaId(res.data.sagaId) }
 * );
 */
export function useStartPostPublishingSaga() {
  return useMutation<
    ApiResponse<StartPostPublishingSagaResponse>,
    Error,
    StartPostPublishingSagaInput
  >({
    mutationKey: START_POST_PUBLISHING_SAGA_MUTATION_KEY,
    mutationFn: (input) => apiClient.startPostPublishingSaga(input),
  });
}
