/**
 * @file useUsage.ts
 * @description TanStack Query hook fetching account usage metrics + plan
 *              context (counters, limits, trial, billing). Consumes the
 *              canonical `usageQueries.forAccount(accountId)` factory
 *              (canon `tanstack-query-v5-migration-patterns-from-raw-fetch`).
 * @hook useAccountUsage
 * @layer infrastructure
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import { usageQueries } from "@/lib/api/queries/usageQueries";

export type { AccountUsageDto } from "@/lib/api/clients/usageClient";

/**
 * @hook useAccountUsage
 * @description Fetches the current-period usage data + plan context. The
 *              query is gated on a non-empty `accountId`; while the auth
 *              context resolves, the hook stays disabled.
 * @param accountId - The account to fetch usage for. Required.
 * @returns TanStack Query result with the AccountUsageDto.
 */
export function useAccountUsage(accountId: string) {
  return useQuery(usageQueries.forAccount(accountId));
}
