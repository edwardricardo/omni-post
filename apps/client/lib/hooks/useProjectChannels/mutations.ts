/**
 * @file mutations.ts
 * @description Mutation hook for promoting a channel to primary. Applies the
 *              canonical TanStack Query v5 optimistic-update pattern (cancel →
 *              snapshot → setQueryData → onError restore → onSettled invalidate)
 *              with a `mutationKey` so concurrent mutations can coordinate via
 *              `queryClient.isMutating` and avoid mid-flight invalidation flicker
 *              (TkDodo's "Concurrent Optimistic Updates" guidance).
 * @layer infrastructure
 */

import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { setPrimaryChannel } from "./api";
import type { ProjectChannel } from "./types";

const SET_PRIMARY_MUTATION_KEY = ["channels", "set-primary"] as const;

interface SetPrimaryContext {
  /** Snapshots of every project-scoped channel list so we can roll back per-key on error. */
  previous: Array<[QueryKey, ProjectChannel[] | undefined]>;
}

/**
 * @hook useSetPrimaryChannel
 * @description Mutation that marks a channel as primary for its (project, provider)
 *   pair. Optimistically toggles the `isPrimary` flag in any cached project
 *   channel list so the UI updates instantly; rolls back on error; and revalidates
 *   on settle (skipping invalidation when another set-primary mutation is still
 *   in flight to avoid flicker on rapid taps).
 * @returns TanStack mutation object. Call `mutate(channelId)` or `mutateAsync(channelId)`.
 */
export function useSetPrimaryChannel() {
  const qc = useQueryClient();

  return useMutation<ProjectChannel, Error, string, SetPrimaryContext>({
    mutationKey: SET_PRIMARY_MUTATION_KEY,
    mutationFn: setPrimaryChannel,
    onMutate: async (channelId) => {
      // Stop in-flight refetches that could overwrite the optimistic update.
      await qc.cancelQueries({ queryKey: ["channels"] });

      // Snapshot every cached project channel list so onError can restore.
      const entries = qc.getQueriesData<ProjectChannel[]>({ queryKey: ["channels", "project"] });
      const previous: SetPrimaryContext["previous"] = entries.map(([key, value]) => [key, value]);

      // Optimistically rebalance the primary flag inside each affected project list.
      for (const [key, list] of entries) {
        if (!list) continue;
        // Find the target inside this list to know its provider; we only flip
        // siblings sharing the same (projectId, platform) pair.
        const target = list.find((c) => c.id === channelId);
        if (!target) continue;
        const next = list.map((c) => {
          if (c.projectId !== target.projectId || c.platform !== target.platform) return c;
          return { ...c, isPrimary: c.id === channelId };
        });
        qc.setQueryData<ProjectChannel[]>(key, next);
      }

      return { previous };
    },
    onError: (_err, _channelId, context) => {
      if (!context) return;
      for (const [key, value] of context.previous) {
        qc.setQueryData(key, value);
      }
    },
    onSettled: () => {
      // Skip invalidation while another set-primary mutation is still pending —
      // it will run its own onSettled when it resolves and we avoid a refetch
      // flicker mid-flight (TkDodo: concurrent optimistic updates).
      if (qc.isMutating({ mutationKey: SET_PRIMARY_MUTATION_KEY }) > 1) return;
      qc.invalidateQueries({ queryKey: ["channels"] });
    },
  });
}
