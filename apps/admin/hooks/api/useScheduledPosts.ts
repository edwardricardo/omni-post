/**
 * @file useScheduledPosts.ts
 * @description TanStack Query hooks for managing scheduled posts: fetching the scheduled post list
 * filtered by project/account and cancelling a scheduled post via mutation.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ScheduledPost } from "../../types/scheduling";

interface UseScheduledPostsParams {
  projectId?: string;
  accountId?: string;
}

export function useScheduledPosts({ projectId, accountId }: UseScheduledPostsParams) {
  return useQuery({
    queryKey: ["scheduled-posts", projectId, accountId],
    queryFn: async (): Promise<ScheduledPost[]> => {
      const params = new URLSearchParams({
        ...(projectId !== undefined && { projectId }),
        ...(accountId !== undefined && { accountId }),
      });
      const response = await fetch(`/api/backend/admin/posts/scheduled?${params}`);
      if (!response.ok) throw new Error("Failed to fetch scheduled posts");
      const data = (await response.json()) as {
        ok: boolean;
        value?: { data: ScheduledPost[] };
        error?: string;
      };
      if (!data.ok) throw new Error(data.error ?? "API error");
      return data.value?.data ?? [];
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  });
}

export function useCancelScheduledPost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (postId: string): Promise<void> => {
      const response = await fetch(`/api/backend/admin/posts/${postId}/cancel`, {
        method: "POST",
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
