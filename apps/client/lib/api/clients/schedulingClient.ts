/**
 * @file schedulingClient.ts
 * @description Scheduling-domain transport helpers. Fetches campaign and team
 *              filter options for the scheduling dashboard. Uses the canon
 *              `request<T>` helper, which routes through the Next.js proxy and
 *              throws `ApiError` on non-OK responses (consumed by TanStack
 *              Query's `error` field upstream).
 * @layer infrastructure
 */

import { request, PROXY_BASE } from "./request";

/**
 * Filter-dropdown campaign option for the scheduling sidebar. Backend returns
 * the canonical `{ ok, data: T[] }` envelope (BaseRouteHandler.sendSuccess);
 * this client unwraps to the array.
 */
export interface SchedulingCampaignOption {
  id: string;
  name: string;
}

/**
 * Filter-dropdown team-member option for the scheduling sidebar. Backend
 * wraps members inside `{ ok, data: { members: T[] } }`.
 */
export interface SchedulingTeamMemberOption {
  id: string;
  name: string;
}

/**
 * @function fetchCampaignsForProject
 * @description Loads the campaigns visible to the user for a given project.
 *              Returns an empty array when the envelope is missing data
 *              (treats absence as "no campaigns" — UX-wise the dropdown
 *              renders empty rather than erroring). Throws `ApiError` on
 *              non-OK HTTP responses, surfaced to the consumer hook via
 *              TanStack `error`.
 * @param projectId - Project identifier
 * @returns Array of campaign options (possibly empty)
 */
export async function fetchCampaignsForProject(
  projectId: string
): Promise<SchedulingCampaignOption[]> {
  const res = await request<{ ok: boolean; data?: SchedulingCampaignOption[] }>(
    PROXY_BASE,
    `/campaigns?projectId=${encodeURIComponent(projectId)}`
  );
  return res.ok && res.data ? res.data : [];
}

/**
 * @function fetchTeamForProject
 * @description Loads the team members assigned to a project. Backend wraps
 *              the array in `{ data: { members } }`; this helper unwraps to a
 *              flat array, returning `[]` when the inner shape is absent.
 * @param projectId - Project identifier
 * @returns Array of team-member options (possibly empty)
 */
export async function fetchTeamForProject(
  projectId: string
): Promise<SchedulingTeamMemberOption[]> {
  const res = await request<{ ok: boolean; data?: { members?: SchedulingTeamMemberOption[] } }>(
    PROXY_BASE,
    `/team?projectId=${encodeURIComponent(projectId)}`
  );
  return res.ok && res.data?.members ? res.data.members : [];
}
