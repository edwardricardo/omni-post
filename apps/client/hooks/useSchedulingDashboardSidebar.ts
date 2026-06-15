/**
 * @file useSchedulingDashboardSidebar.ts
 * @description TanStack Query hook for the scheduling dashboard sidebar's
 *              filter-dropdown data. Composes two queries (campaigns + team)
 *              from the `schedulingQueries` factory. Returns the raw
 *              `useQuery` results so the consumer can read `data`, `error`,
 *              and `isLoading` independently — graceful degradation (empty
 *              dropdowns + warn log) is handled by the consumer component.
 *
 *              POC of the canon
 *              `tanstack-query-v5-migration-patterns-from-raw-fetch` — first
 *              hook adopting the queryOptions factory pattern in the client
 *              app.
 * @layer infrastructure
 */

"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { schedulingQueries } from "../lib/api/queries/schedulingQueries";
import type {
  SchedulingCampaignOption,
  SchedulingTeamMemberOption,
} from "../lib/api/clients/schedulingClient";

export interface UseSchedulingDashboardSidebarResult {
  campaigns: UseQueryResult<SchedulingCampaignOption[], Error>;
  team: UseQueryResult<SchedulingTeamMemberOption[], Error>;
}

/**
 * @hook useSchedulingDashboardSidebar
 * @description Loads campaigns and team members for the scheduling sidebar's
 *              filter dropdowns. Both queries are gated by `enabled` on
 *              `projectId` — they do not run when no project is selected,
 *              avoiding empty-string keys polluting the cache.
 * @param projectId - Selected project; queries pause when undefined.
 */
export function useSchedulingDashboardSidebar(
  projectId: string | undefined
): UseSchedulingDashboardSidebarResult {
  const enabled = !!projectId;
  const campaigns = useQuery({
    ...schedulingQueries.campaignsForProject(projectId ?? ""),
    enabled,
  });
  const team = useQuery({
    ...schedulingQueries.teamForProject(projectId ?? ""),
    enabled,
  });
  return { campaigns, team };
}
