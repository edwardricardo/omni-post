/**
 * @file usageQueries.ts
 * @description Usage-domain TanStack Query factory. Per canon
 *              `tanstack-query-v5-migration-patterns-from-raw-fetch`,
 *              co-locates `queryKey` + `queryFn` for partial-key
 *              invalidation. Account usage data has only one query today
 *              (the dashboard usage page); the factory still scaffolds
 *              the `all() → forAccount(id)` hierarchy so future queries
 *              (e.g., per-period historical) slot in without rewriting
 *              consumers.
 * @layer infrastructure
 */

import { queryOptions } from "@tanstack/react-query";
import { fetchAccountUsage } from "../clients/usageClient.js";

export const usageQueries = {
  /** Top-level key — partial-invalidate every usage query. */
  all: () => ["usage"] as const,

  /**
   * Current-period usage + plan context for an account. Stale-time of
   * 60 s mirrors the prior inline-key hook; gcTime defaults to the global
   * 5 min set by `createAppQueryClient`.
   */
  forAccount: (accountId: string) =>
    queryOptions({
      queryKey: [...usageQueries.all(), "account", accountId] as const,
      queryFn: () => fetchAccountUsage(accountId),
      staleTime: 60_000,
      enabled: Boolean(accountId),
    }),
};
