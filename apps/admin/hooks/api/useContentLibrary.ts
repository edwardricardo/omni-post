/**
 * @file useContentLibrary.ts
 * @description TanStack Query hook for listing posts in the content library
 *   with pagination and optional sorting. Talks to the /posts endpoint via
 *   the Next.js /api/backend proxy.
 * @layer hooks
 */
import { useQuery } from "@tanstack/react-query";

export interface ContentLibraryPost {
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
  items: ContentLibraryPost[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface UseContentLibraryOptions {
  projectId: string;
  page: number;
  limit: number;
  sortBy?: string;
  sortDirection?: "asc" | "desc";
}

/**
 * @hook useContentLibrary
 * @description Fetches a paginated list of posts for the content library page.
 * @param options - projectId, page, limit, and optional sort controls
 * @returns Query result with { data: ListPostsResponse, isLoading, error }
 */
export function useContentLibrary(options: UseContentLibraryOptions) {
  const { projectId, page, limit, sortBy, sortDirection } = options;

  return useQuery({
    queryKey: ["content-library", projectId, page, limit, sortBy, sortDirection],
    queryFn: async (): Promise<ListPostsResponse> => {
      const params = new URLSearchParams({
        projectId,
        page: String(page),
        limit: String(limit),
      });
      if (sortBy) params.set("sortBy", sortBy);
      if (sortDirection) params.set("sortDirection", sortDirection);

      const res = await fetch(`/api/backend/posts?${params.toString()}`, {
        credentials: "include",
      });

      if (!res.ok) {
        throw new Error("Failed to fetch content library");
      }

      const body = (await res.json()) as { ok: boolean; value?: ListPostsResponse };
      if (!body.ok || !body.value) {
        throw new Error("Failed to fetch content library");
      }
      return body.value;
    },
    staleTime: 30_000,
  });
}
