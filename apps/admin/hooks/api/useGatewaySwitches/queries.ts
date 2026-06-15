/**
 * @file queries.ts
 * @description Read-only hooks for gateway-switch listings and detail.
 * @layer infrastructure
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchGatewaySwitchDetail, fetchGatewaySwitches } from "./api.js";
import type { GatewaySwitchFilters } from "./types.js";

/**
 * @hook useGatewaySwitches
 * @description Fetches paginated gateway switch events with optional status filter.
 * @param filters - Optional pagination and status filter (status, page, limit)
 * @returns Query result with { data: { events, total, page, limit, stats }, isLoading, error }
 */
export function useGatewaySwitches(filters: GatewaySwitchFilters = {}) {
  const { status = "ALL", page = 1, limit = 50 } = filters;

  return useQuery({
    queryKey: ["gateway-switches", status, page, limit],
    queryFn: () => fetchGatewaySwitches({ status, page, limit }),
    staleTime: 60_000,
  });
}

/**
 * @hook useGatewaySwitchDetail
 * @description Fetches a single gateway switch event by ID.
 * @param id - The gateway switch event ID, or null to disable the query
 * @returns Query result with { data: GatewaySwitchEvent, isLoading, error }
 */
export function useGatewaySwitchDetail(id: string | null) {
  return useQuery({
    queryKey: ["gateway-switches", "detail", id],
    queryFn: () => fetchGatewaySwitchDetail(id!),
    enabled: id !== null,
    staleTime: 30_000,
  });
}
