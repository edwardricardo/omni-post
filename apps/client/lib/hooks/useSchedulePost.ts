/**
 * @file useSchedulePost.ts
 * @description TanStack Query mutation hook for transitioning a post from DRAFT
 *              to SCHEDULED via the post-publishing saga (mode="schedule" with
 *              the existing postId). Applies the canonical TanStack v5
 *              optimistic-update flow on the cached `["posts", id]` query so
 *              the post detail UI flips status immediately. The mutation
 *              awaits the saga's terminal state and resolves with the result.
 * @layer infrastructure
 */

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { runSagaAndAwaitTerminal } from "@/lib/api/clients/sagaClient";
import type { ApiResponse, Post } from "@/lib/api/types";

const SCHEDULE_POST_MUTATION_KEY = ["posts", "schedule"] as const;

/**
 * Input passed to `useSchedulePost.mutate(...)`.
 *
 * @property postId - UUID of the draft post to transition to SCHEDULED.
 * @property scheduledFor - ISO-8601 timestamp; backend rejects times less than
 *   five minutes in the future or more than one year ahead.
 * @property channelIds - At least one channel UUID must be supplied. Empty
 *   arrays are rejected by the backend with `VALIDATION_FAILED`.
 */
export interface SchedulePostInput {
  postId: string;
  scheduledFor: string;
  channelIds: string[];
}

interface SchedulePostContext {
  previousPost?: Post;
}

/**
 * @hook useSchedulePost
 * @description Mutation that schedules a post for future publication. The
 *   post detail cache is optimistically updated to `status: "SCHEDULED"` so the
 *   UI reflects the transition before the network round-trip completes; the
 *   snapshot is restored if the mutation fails. On settle, the post detail and
 *   the global posts list are invalidated so the server is the source of truth.
 *
 *   Concurrent schedule mutations on the same post are protected from
 *   invalidation flicker via `isMutating({ mutationKey })` (TkDodo pattern).
 *
 * @example
 * const schedule = useSchedulePost();
 * schedule.mutate({ postId, scheduledFor, channelIds }, {
 *   onSuccess: () => toast({ title: "Post scheduled" }),
 *   onError: (err) => toast({ title: "Failed to schedule", description: err.message }),
 * });
 */
export function useSchedulePost() {
  const qc = useQueryClient();

  return useMutation<ApiResponse<unknown>, Error, SchedulePostInput, SchedulePostContext>({
    mutationKey: SCHEDULE_POST_MUTATION_KEY,
    // Saga validates ownership + DRAFT status, queues publish jobs at
    // scheduledAt, then completes — no Wait step in schedule mode. projectId
    // is fetched from the post because SchedulePostInput only carries postId.
    mutationFn: async ({ postId, scheduledFor, channelIds }) => {
      const postLookup = await apiClient.getPost(postId);
      if (!postLookup.ok || !postLookup.data) {
        throw new Error("Post not found");
      }
      const projectId = postLookup.data.projectId;

      const result = await runSagaAndAwaitTerminal(
        {
          start: (input) => apiClient.startPostPublishingSaga(input),
          getStatus: (sagaId) => apiClient.getSagaStatus(sagaId),
        },
        {
          mode: "schedule",
          projectId,
          postId,
          channelIds,
          scheduledAt: scheduledFor,
        }
      );
      return {
        ok: true,
        data: { sagaId: result.sagaId, postId: result.postId },
      } as ApiResponse<unknown>;
    },
    onMutate: async ({ postId, scheduledFor }) => {
      await qc.cancelQueries({ queryKey: ["posts", postId] });
      const previousPost = qc.getQueryData<Post>(["posts", postId]);
      if (previousPost) {
        qc.setQueryData<Post>(["posts", postId], {
          ...previousPost,
          status: "SCHEDULED",
          scheduledAt: scheduledFor,
        });
      }
      return previousPost ? { previousPost } : {};
    },
    onError: (_err, { postId }, context) => {
      if (context?.previousPost) {
        qc.setQueryData(["posts", postId], context.previousPost);
      }
    },
    onSettled: (_data, _err, { postId }) => {
      // If another schedule mutation for the same post is still in flight, let
      // it own the final invalidation — avoids mid-flight refetch flicker.
      if (qc.isMutating({ mutationKey: SCHEDULE_POST_MUTATION_KEY }) > 1) return;
      qc.invalidateQueries({ queryKey: ["posts", postId] });
      qc.invalidateQueries({ queryKey: ["posts", "list"] });
    },
  });
}
