/**
 * @file queries.ts
 * @description Read-only TanStack hooks for project-scoped channels. Hierarchical
 *              query keys (`["channels", "project", projectId]`) so a single
 *              `invalidateQueries({ queryKey: ["channels"] })` reaches every
 *              project-scoped consumer (TkDodo pattern).
 * @layer infrastructure
 */

import { useQuery } from "@tanstack/react-query";
import { fetchProjectChannels } from "./api.js";

/**
 * @hook useProjectChannels
 * @description Lists channels for a project. Disabled when `projectId` is
 *   undefined so the hook can be safely called from contexts where the project
 *   is still loading. Returns the canonical backend shape — see `types.ts`.
 * @param projectId - Project UUID, or undefined to keep the query idle.
 * @returns Query result with `{ data: ProjectChannel[], isPending, isFetching, isError, error, refetch }`.
 */
export function useProjectChannels(projectId: string | undefined) {
  return useQuery({
    queryKey: ["channels", "project", projectId],
    queryFn: () => fetchProjectChannels(projectId!),
    enabled: !!projectId,
    staleTime: 60_000,
  });
}
