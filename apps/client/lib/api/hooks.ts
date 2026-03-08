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
import {
  Post,
  Project,
  Provider,
  ProviderHealth,
  CreatePostRequest,
  UpdatePostRequest,
  PaginatedResponse,
  ApiResponse,
  ApiError,
} from "./types";

// Query Keys
const queryKeys = {
  projects: ["projects"] as const,
  project: (id: string) => ["projects", id] as const,
  posts: (filters?: any) => ["posts", filters] as const,
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
  params?: {
    projectId?: string;
    page?: number;
    limit?: number;
    status?: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "FAILED";
  },
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
    ApiResponse<{ url: string; metadata?: any }>,
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

// Re-export useProviders from hooks
export { useProviders } from "../hooks/useProviders";
