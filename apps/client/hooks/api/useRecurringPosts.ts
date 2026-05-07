/**
 * @file useRecurringPosts.ts
 * @description TanStack Query hooks for managing recurring posts: list, deactivate.
 * @layer infrastructure/frontend
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface RecurringPost {
  id: string;
  name: string;
  cronExpression: string;
  timezone: string;
  channels: string[];
  contentVariation: "EXACT" | "ROTATED" | "AI_GENERATED";
  isActive: boolean;
  nextScheduledAt?: string;
  occurrenceCount: number;
  maxOccurrences?: number;
  endDate?: string;
  createdAt: string;
}

interface UseRecurringPostsParams {
  projectId: string | undefined;
}

/**
 * @hook useRecurringPosts
 * @description Fetches recurring posts for a project.
 * @param params - projectId to fetch recurring posts for
 * @returns TanStack Query result with recurring post array
 */
export function useRecurringPosts({ projectId }: UseRecurringPostsParams) {
  return useQuery({
    queryKey: ["recurring-posts", projectId],
    queryFn: async (): Promise<RecurringPost[]> => {
      const params = new URLSearchParams({
        ...(projectId !== undefined && { projectId }),
      });
      const response = await fetch(`/api/backend/recurring-posts?${params}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch recurring posts");
      const body = (await response.json()) as {
        ok: boolean;
        data?: RecurringPost[];
        error?: string;
      };
      if (!body.ok) throw new Error(body.error ?? "API error");
      return body.data ?? [];
    },
    enabled: !!projectId,
  });
}

/**
 * @hook useDeactivateRecurringPost
 * @description Mutation hook for deactivating a recurring post schedule.
 * @returns TanStack Query mutation that invalidates the recurring posts list on success
 */
export function useDeactivateRecurringPost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const response = await fetch(`/api/backend/recurring-posts/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        const err = (await response.json().catch(() => ({ error: "Failed to deactivate" }))) as {
          error?: string;
        };
        throw new Error(err.error ?? "Failed to deactivate recurring post");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recurring-posts"] });
    },
  });
}

export interface RecurringPostInput {
  projectId: string;
  name: string;
  cronExpression: string;
  timezone: string;
  channels: string[];
  contentVariation: RecurringPost["contentVariation"];
  maxOccurrences?: number;
  endDate?: string;
}

async function parseApiError(response: Response, fallback: string): Promise<string> {
  const err = (await response.json().catch(() => ({ error: fallback }))) as {
    error?: string;
  };
  return err.error ?? fallback;
}

/**
 * @hook useCreateRecurringPost
 * @description Mutation hook for creating a new recurring post schedule.
 * @returns TanStack Query mutation that invalidates the recurring posts list on success
 */
export function useCreateRecurringPost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: RecurringPostInput): Promise<RecurringPost> => {
      const response = await fetch("/api/backend/recurring-posts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed to create recurring post"));
      }
      const body = (await response.json()) as {
        ok: boolean;
        data?: RecurringPost;
        error?: string;
      };
      if (!body.ok || !body.data) throw new Error(body.error ?? "API error");
      return body.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["recurring-posts"] });
    },
  });
}

/**
 * @hook useUpdateRecurringPost
 * @description Mutation hook for updating an existing recurring post schedule.
 * @returns TanStack Query mutation that invalidates the recurring posts list on success
 */
export function useUpdateRecurringPost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string;
      input: RecurringPostInput;
    }): Promise<RecurringPost> => {
      const response = await fetch(`/api/backend/recurring-posts/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(await parseApiError(response, "Failed to update recurring post"));
      }
      const body = (await response.json()) as {
        ok: boolean;
        data?: RecurringPost;
        error?: string;
      };
      if (!body.ok || !body.data) throw new Error(body.error ?? "API error");
      return body.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["recurring-posts"] });
    },
  });
}
