/**
 * @file queries.ts
 * @description Read-only hooks for platform settings — overall status and
 *              per-group credential lookup.
 * @layer infrastructure
 */

import { useQuery } from "@tanstack/react-query";
import { fetchGroupSettings, fetchSettingsStatus } from "./api";

/**
 * @hook useSettingsStatus
 * @description Fetches configuration status for all credential groups.
 * @returns Query result with { data: SettingsStatus, isLoading, error }
 */
export function useSettingsStatus() {
  return useQuery({
    queryKey: ["settings", "status"],
    queryFn: fetchSettingsStatus,
    staleTime: 60_000,
  });
}

/**
 * @hook useGroupSettings
 * @description Fetches masked credentials for a specific group.
 * @param group - The credential group name (e.g. "STRIPE")
 * @returns Query result with { data: GroupCredentials, isLoading, error }
 */
export function useGroupSettings(group: string) {
  return useQuery({
    queryKey: ["settings", "group", group],
    queryFn: () => fetchGroupSettings(group),
    enabled: !!group,
    staleTime: 60_000,
  });
}
