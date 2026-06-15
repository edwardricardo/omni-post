/**
 * @file schedulingQueries.ts
 * @description Scheduling-domain TanStack Query factory. Per canon
 *              `tanstack-query-v5-migration-patterns-from-raw-fetch`,
 *              co-locates `queryKey` + `queryFn` in a single domain-
 *              grouped factory. Hierarchy keys (`all()`, `campaigns()`,
 *              `team()`) are plain arrays for partial-key invalidation;
 *              leaf entries wrap `queryOptions(...)` for type-safe
 *              consumption by `useQuery`, `prefetchQuery`, and
 *              `setQueryData`.
 * @layer infrastructure
 */

import { queryOptions } from "@tanstack/react-query";
import { fetchCampaignsForProject, fetchTeamForProject } from "../clients/schedulingClient.js";

/**
 * Marks a query as opting out of the global "Request failed" toast in the
 * client app's `Providers` shell. The query's error still surfaces in the
 * `useQuery` result and is logged by `createAppQueryClient`'s QueryCache
 * handler — only the destructive toast is suppressed. Used here because the
 * scheduling sidebar's filter dropdowns are non-critical — failing to load
 * campaigns silently degrades to an empty dropdown rather than alarming the
 * user with a toast.
 */
export interface SchedulingQueryMeta extends Record<string, unknown> {
  suppressGlobalErrorToast: true;
}

const SCHEDULING_FALLBACK_META: SchedulingQueryMeta = {
  suppressGlobalErrorToast: true,
};

export const schedulingQueries = {
  /** Top-level key — partial-invalidate all scheduling queries. */
  all: () => ["scheduling"] as const,

  /** Hierarchy key for any campaigns query — used to invalidate them all. */
  campaigns: () => [...schedulingQueries.all(), "campaigns"] as const,

  /**
   * Campaigns for a given project. Used by the scheduling sidebar's campaign
   * filter dropdown. Errors are silenced from the global toast (see
   * `SCHEDULING_FALLBACK_META`); the consumer hook decides whether to log.
   */
  campaignsForProject: (projectId: string) =>
    queryOptions({
      queryKey: [...schedulingQueries.campaigns(), projectId] as const,
      queryFn: () => fetchCampaignsForProject(projectId),
      meta: SCHEDULING_FALLBACK_META,
    }),

  /** Hierarchy key for any team query — used to invalidate them all. */
  team: () => [...schedulingQueries.all(), "team"] as const,

  /**
   * Team members for a given project. Used by the scheduling sidebar's
   * assignee filter dropdown. Same fallback semantics as
   * `campaignsForProject`.
   */
  teamForProject: (projectId: string) =>
    queryOptions({
      queryKey: [...schedulingQueries.team(), projectId] as const,
      queryFn: () => fetchTeamForProject(projectId),
      meta: SCHEDULING_FALLBACK_META,
    }),
};
