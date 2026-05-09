"use client";

/**
 * @file hooks.ts
 * @description TanStack Query hooks for every API endpoint, providing type-safe data fetching, mutations, cache invalidation, and query keys for posts, projects, providers, channels, analytics, publishing, and AI features.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  UseQueryOptions,
  UseMutationOptions,
} from "@tanstack/react-query";
import { apiClient } from "./client";
import type {
  ListPostsParams,
  ArchiveBatchResponse,
  DuplicateBatchResponse,
  HardDeleteBatchResponse,
} from "./clients/postsClient";
import {
  Post,
  Project,
  Provider,
  ProviderHealth,
  CreatePostRequest,
  UpdatePostRequest,
  PaginatedResponse,
  ApiResponse,
} from "./types";
import { ApiError } from "@packages/api-errors";

// Query Keys
const queryKeys = {
  projects: ["projects"] as const,
  project: (id: string) => ["projects", id] as const,
  posts: (filters?: ListPostsParams) => ["posts", filters] as const,
  post: (id: string) => ["posts", id] as const,
  providers: ["providers"] as const,
  allProvidersHealth: ["providers", "health"] as const,
} as const;

// Project Hooks
export function useProjects(options?: UseQueryOptions<PaginatedResponse<Project>, ApiError>) {
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: () => apiClient.getProjects(),
    ...options,
  });
}

// Post Hooks
export function usePost(id: string, options?: UseQueryOptions<ApiResponse<Post>, ApiError>) {
  return useQuery({
    queryKey: queryKeys.post(id),
    queryFn: () => apiClient.getPost(id),
    enabled: !!id,
    ...options,
  });
}

export function useCreatePost(
  options?: UseMutationOptions<ApiResponse<Post>, ApiError, CreatePostRequest>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => apiClient.createPost(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.posts() });
      if (variables.projectId) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.posts({ projectId: variables.projectId }),
        });
      }
    },
    ...options,
  });
}

export function useUpdatePost(
  options?: UseMutationOptions<ApiResponse<Post>, ApiError, { id: string; data: UpdatePostRequest }>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => apiClient.updatePost(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.post(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.posts() });
    },
    ...options,
  });
}

export function useDeletePost(options?: UseMutationOptions<ApiResponse<void>, ApiError, string>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => apiClient.deletePost(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.posts() });
      queryClient.removeQueries({ queryKey: queryKeys.post(id) });
    },
    ...options,
  });
}

// Posts List Hook
export function usePosts(
  params?: ListPostsParams,
  options?: UseQueryOptions<PaginatedResponse<Post>, ApiError>
) {
  return useQuery({
    queryKey: queryKeys.posts(params),
    queryFn: () => apiClient.getPosts(params),
    ...options,
  });
}

// Provider Hooks
export function useApiProviders(
  options?: UseQueryOptions<{ ok: boolean; providers: Provider[]; total: number }, ApiError>
) {
  return useQuery({
    queryKey: queryKeys.providers,
    queryFn: () => apiClient.getProviders(),
    ...options,
  });
}

export function useAllProvidersHealth(
  options?: UseQueryOptions<
    {
      ok: boolean;
      providers: ProviderHealth[];
      summary: {
        total: number;
        healthy: number;
        degraded: number;
        unhealthy: number;
        avgLatency: number;
      };
    },
    ApiError
  >
) {
  return useQuery({
    queryKey: queryKeys.allProvidersHealth,
    queryFn: () => apiClient.getAllProvidersHealth(),
    ...options,
  });
}

// File Upload Hook
export function useUploadFile(
  options?: UseMutationOptions<
    ApiResponse<{ url: string; metadata?: unknown }>,
    ApiError,
    {
      file: File;
      type?: "image" | "video" | "document";
    }
  >
) {
  return useMutation({
    mutationFn: ({ file, type = "image" }) => apiClient.uploadFile(file, type),
    ...options,
  });
}

/**
 * @hook useArchivePostsBatch
 * @description Bulk-archive mutation. Invalidates the posts list cache on
 *              success so the archived rows disappear from the default view.
 */
export function useArchivePostsBatch(
  options?: UseMutationOptions<ArchiveBatchResponse, ApiError, string[]>
) {
  const queryClient = useQueryClient();
  return useMutation<ArchiveBatchResponse, ApiError, string[]>({
    mutationFn: async (postIds) => {
      const res = await apiClient.archivePostsBatch(postIds);
      return res.data ?? { archived: 0, invalidIds: [] };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.posts() });
    },
    ...options,
  });
}

/**
 * @hook useHardDeletePostsBatch
 * @description Bulk hard-delete mutation. Irreversible — caller is expected
 *              to confirm with the user before invoking.
 */
export function useHardDeletePostsBatch(
  options?: UseMutationOptions<HardDeleteBatchResponse, ApiError, string[]>
) {
  const queryClient = useQueryClient();
  return useMutation<HardDeleteBatchResponse, ApiError, string[]>({
    mutationFn: async (postIds) => {
      const res = await apiClient.hardDeletePostsBatch(postIds);
      return res.data ?? { deleted: 0, invalidIds: [] };
    },
    onSuccess: (_data, postIds) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.posts() });
      for (const id of postIds) {
        queryClient.removeQueries({ queryKey: queryKeys.post(id) });
      }
    },
    ...options,
  });
}

/**
 * @hook useDuplicatePostsBatch
 * @description Bulk-duplicate mutation. Each source becomes a fresh DRAFT.
 */
export function useDuplicatePostsBatch(
  options?: UseMutationOptions<DuplicateBatchResponse, ApiError, string[]>
) {
  const queryClient = useQueryClient();
  return useMutation<DuplicateBatchResponse, ApiError, string[]>({
    mutationFn: async (postIds) => {
      const res = await apiClient.duplicatePostsBatch(postIds);
      return res.data ?? { duplicates: [], invalidIds: [], notFoundIds: [] };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.posts() });
    },
    ...options,
  });
}
