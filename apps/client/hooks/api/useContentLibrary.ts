/**
 * useContentLibrary Hook
 *
 * Fetches paginated post data from GET /posts via the admin backend proxy.
 * Used by the ContentLibrary component to display a filterable, sortable list
 * of posts across all projects.
 *
 * @module hooks/api/useContentLibrary
 */
import { useQuery } from "@tanstack/react-query";

export interface UseContentLibraryOptions {
  projectId: string;
  page: number;
  limit: number;
  sortBy?: string;
  sortDirection?: "asc" | "desc";
}

export interface PostDTO {
  id: string;
  projectId: string;
  status: string;
  body: string;
  title: string | null;
  tags: string[];
  locale: string;
  createdAt: string;
  updatedAt: string;
  scheduledAt: string | null;
  publishedAt: string | null;
}

export interface ListPostsResponse {
  items: PostDTO[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

/**
 * @hook useContentLibrary
 * @description Fetches paginated post data for the content library with sorting support.
 * @param options - Pagination and sort options: projectId, page, limit, sortBy, sortDirection
 * @returns TanStack Query result with paginated post list response
 */
export function useContentLibrary({
  projectId,
  page,
  limit,
  sortBy,
  sortDirection,
}: UseContentLibraryOptions) {
  return useQuery<ListPostsResponse>({
    queryKey: ["content-library", projectId, page, limit, sortBy, sortDirection],
    queryFn: async () => {
      const params = new URLSearchParams({
        projectId,
        page: String(page),
        limit: String(limit),
      });
      if (sortBy) params.set("sortBy", sortBy);
      if (sortDirection) params.set("sortDirection", sortDirection);

      const res = await fetch(`/api/backend/posts?${params}`);
      if (!res.ok) throw new Error("Failed to fetch content library");
      const data = (await res.json()) as { ok: boolean; value: ListPostsResponse };
      return data.value;
    },
    staleTime: 60_000,
  });
}
