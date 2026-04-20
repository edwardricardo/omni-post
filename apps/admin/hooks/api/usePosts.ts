/**
 * @file usePosts.ts
 * @description TanStack Query hooks for the admin posts list and basic
 *   create/delete mutations. All three delegate to the shared apiClient.
 * @layer hooks
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/apiClient";

/**
 * @hook usePosts
 * @description Fetches a paginated list of posts. Returns an empty array if
 *   the response value is missing, so consumers can render safely.
 */
export function usePosts(limit = 20) {
  return useQuery({
    queryKey: ["posts", "list", limit],
    queryFn: async (): Promise<unknown[]> => {
      const response = await api.listPosts({ limit });
      if (!response.ok) {
        throw new Error("Failed to fetch posts");
      }
      return response.value || [];
    },
  });
}

/**
 * @hook useCreatePost
 * @description Mutation that creates a new post. Invalidates the posts list on success.
 */
export function useCreatePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Record<string, unknown>): Promise<unknown> => {
      const response = (await api.createPost(input)) as { ok: boolean; [key: string]: unknown };
      if (!response.ok) {
        throw new Error("Failed to create post");
      }
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["posts"] });
    },
  });
}

/**
 * @hook useDeletePost
 * @description Mutation that deletes a post by id. Invalidates the posts list on success.
 */
export function useDeletePost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (postId: string): Promise<void> => {
      const response = await api.deletePost(postId);
      if (!response.ok) {
        throw new Error("Failed to delete post");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["posts"] });
    },
  });
}
