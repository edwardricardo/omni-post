/**
 * @file queries.ts
 * @description Read-only TanStack hooks for compliance — overview, GDPR
 *              settings, security settings, score (auto-refresh), DSAR list,
 *              and breach reports list.
 * @layer infrastructure
 */

import { useQuery } from "@tanstack/react-query";
import {
  fetchBreachReports,
  fetchComplianceOverview,
  fetchComplianceScore,
  fetchDsarRequests,
  fetchGdprSettings,
  fetchSecuritySettings,
} from "./api.js";
import type { BreachFilters, DsarFilters } from "./types.js";

/**
 * Deterministic, value-stable serialization of a flat primitive filter object
 * so an inline-object argument does not create a new query key reference on
 * every render.
 */
function serializeFilters(filters: object): string {
  const entries = Object.entries(filters) as Array<[string, string | number | boolean | undefined]>;
  return JSON.stringify(
    entries
      .sort(([a], [b]) => a.localeCompare(b))
      .reduce<Record<string, string | number | boolean>>((acc, [key, value]) => {
        if (value !== undefined) acc[key] = value;
        return acc;
      }, {})
  );
}

/**
 * @hook useCompliance
 * @description Fetches compliance overview data combining metrics and audit logs
 *   into a unified ComplianceData structure with compliance scores and audit events.
 * @returns Query result with { data: ComplianceData, isLoading, error }
 */
export function useCompliance() {
  return useQuery({
    queryKey: ["compliance", "overview"],
    queryFn: fetchComplianceOverview,
    staleTime: 60_000,
  });
}

/**
 * @hook useGdprSettings
 * @description Fetches GDPR configuration settings including privacy URLs, DPO contact,
 *   data retention policies, and DSAR response deadlines.
 * @returns Query result with { data: GdprSettings, isLoading, error }
 */
export function useGdprSettings() {
  return useQuery({
    queryKey: ["compliance", "gdpr-settings"],
    queryFn: fetchGdprSettings,
    staleTime: 60_000,
  });
}

/**
 * @hook useSecuritySettings
 * @description Fetches security configuration settings including 2FA requirements,
 *   session timeouts, password policies, and IP allowlist rules.
 * @returns Query result with { data: SecuritySettings, isLoading, error }
 */
export function useSecuritySettings() {
  return useQuery({
    queryKey: ["compliance", "security-settings"],
    queryFn: fetchSecuritySettings,
    staleTime: 60_000,
  });
}

/**
 * @hook useComplianceScore
 * @description Fetches the overall compliance score with individual check results.
 *   Auto-refreshes every 60 seconds.
 * @returns Query result with { data: ComplianceScoreData, isLoading, error }
 */
export function useComplianceScore() {
  return useQuery({
    queryKey: ["compliance", "score"],
    queryFn: fetchComplianceScore,
    refetchInterval: 60_000,
  });
}

/**
 * @hook useDsarRequests
 * @description Fetches paginated DSAR (Data Subject Access Request) entries with optional
 *   status and type filters.
 * @param filters - Pagination and filter options (status, type, page, limit)
 * @returns Query result with { data: DsarResponse, isLoading, error }
 */
export function useDsarRequests(filters: DsarFilters) {
  return useQuery({
    queryKey: ["compliance", "dsar", serializeFilters(filters)],
    queryFn: () => fetchDsarRequests(filters),
    staleTime: 30_000,
  });
}

/**
 * @hook useBreachReports
 * @description Fetches paginated breach reports with optional resolved-status filter.
 * @param filters - Pagination and filter options (resolved, page, limit)
 * @returns Query result with { data: BreachResponse, isLoading, error }
 */
export function useBreachReports(filters: BreachFilters) {
  return useQuery({
    queryKey: ["compliance", "breaches", serializeFilters(filters)],
    queryFn: () => fetchBreachReports(filters),
    staleTime: 30_000,
  });
}
