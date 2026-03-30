/**
 * @file usePosts.ts
 * @description TanStack Query hooks for fetching and mutating post data in the admin dashboard,
 * including listing posts, fetching a single post by ID, and deleting posts.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/apiClient";

interface Post {
  id: string;
  createdAt: string | Date;
  title?: string;
  status?: string;
}

/**
 * Hook to fetch posts list
 */
export function usePosts(limit: number = 20) {
  return useQuery({
    queryKey: ["posts", "list", limit],
    queryFn: async () => {
      const response = await api.listPosts({ limit });

      if (!response.ok) {
        throw new Error("Failed to fetch posts");
      }

      return (response.value || []) as Post[];
    },
    staleTime: 60000, // 1 minute
  });
}

/**
 * Hook to create new post
 */
export function useCreatePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (postData: any) => {
      const response = await api.createPost(postData);

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
 * Hook to delete post
 */
export function useDeletePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (postId: string) => {
      const response = await api.deletePost(postId);

      if (!response.ok) {
        throw new Error("Failed to delete post");
      }

      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["posts"] });
    },
  });
}
