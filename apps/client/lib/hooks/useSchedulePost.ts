/**
 * @file useSchedulePost.ts
 * @description TanStack Query mutation hook for transitioning a post from DRAFT to
 *              SCHEDULED via `POST /posts/:id/schedule`. Wraps `apiClient.schedulePost`
 *              and applies the canonical TanStack v5 optimistic-update flow on the
 *              cached `["posts", id]` query so the post detail UI flips status
 *              immediately. Errors propagate to the global `MutationCache.onError`
 *              and to per-call `onError` callbacks for toast feedback.
 * @layer infrastructure
 */

"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
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
    mutationFn: ({ postId, scheduledFor, channelIds }) =>
      apiClient.schedulePost(postId, scheduledFor, channelIds),
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
