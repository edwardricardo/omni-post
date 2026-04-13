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
      const response = await fetch(`/api/backend/recurring-posts?${params}`);
      if (!response.ok) throw new Error("Failed to fetch recurring posts");
      const data = (await response.json()) as {
        ok: boolean;
        value?: RecurringPost[];
        error?: string;
      };
      if (!data.ok) throw new Error(data.error ?? "API error");
      return data.value ?? [];
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
