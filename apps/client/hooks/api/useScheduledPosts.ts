/**
 * @file useScheduledPosts.ts
 * @description TanStack Query hooks for managing scheduled posts: fetching the scheduled post list
 * filtered by project/account and cancelling a scheduled post via mutation.
 * @layer infrastructure
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ScheduledPost } from "../../types/scheduling";

interface UseScheduledPostsParams {
  projectId?: string;
  accountId?: string;
  /** Filter by campaign ID */
  campaignId?: string;
  /** Filter by assignee (team member) ID */
  assigneeId?: string;
}

/**
 * @hook useScheduledPosts
 * @description Fetches scheduled posts with optional project, account, campaign, and assignee filters.
 * @param params - Filter options: projectId, accountId, campaignId, assigneeId
 * @returns TanStack Query result with scheduled post array, auto-refreshes every 30s
 */
export function useScheduledPosts({
  projectId,
  accountId,
  campaignId,
  assigneeId,
}: UseScheduledPostsParams) {
  return useQuery({
    queryKey: ["scheduled-posts", projectId, accountId, campaignId, assigneeId],
    queryFn: async (): Promise<ScheduledPost[]> => {
      const params = new URLSearchParams({
        ...(projectId !== undefined && { projectId }),
        ...(accountId !== undefined && { accountId }),
        ...(campaignId !== undefined && { campaignId }),
        ...(assigneeId !== undefined && { assigneeId }),
      });
      const response = await fetch(`/api/backend/admin/posts/scheduled?${params}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch scheduled posts");
      const body = (await response.json()) as {
        ok: boolean;
        data?: { data: ScheduledPost[] };
        error?: string;
      };
      if (!body.ok) throw new Error(body.error ?? "API error");
      return body.data?.data ?? [];
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  });
}

/**
 * @hook useCancelScheduledPost
 * @description Mutation hook for cancelling a scheduled post.
 * @returns TanStack Query mutation that invalidates the scheduled posts list on success
 */
export function useCancelScheduledPost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (postId: string): Promise<void> => {
      const response = await fetch(`/api/backend/admin/posts/${postId}/cancel`, {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        const err = (await response.json().catch(() => ({ error: "Failed to cancel" }))) as {
          error?: string;
        };
        throw new Error(err.error ?? "Failed to cancel post");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduled-posts"] });
    },
  });
}
