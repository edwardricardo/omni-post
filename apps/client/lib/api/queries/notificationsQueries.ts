/**
 * @file notificationsQueries.ts
 * @description Notifications-domain queryOptions factory. Hierarchy keys
 *              `all() → unreadCount() / preferences() / list(limit)` enable
 *              partial-key invalidation from mutations. Leaf entries wrap
 *              `queryOptions(...)` for type-safe consumption by useQuery,
 *              prefetchQuery, and setQueryData.
 *
 *              Canon: `tanstack-query-v5-migration-patterns-from-raw-fetch`.
 *              Mirrors the `schedulingQueries.ts` POC shape.
 * @layer infrastructure
 */

import { queryOptions } from "@tanstack/react-query";
import {
  fetchNotificationPreferences,
  fetchNotifications,
  fetchUnreadCount,
} from "../clients/notificationsClient";

const DEFAULT_LIST_LIMIT = 20;
const UNREAD_COUNT_STALE_MS = 30_000;
const PREFERENCES_STALE_MS = 60_000;

export const notificationsQueries = {
  /** Top-level key — partial-invalidate every notifications query. */
  all: () => ["notifications"] as const,

  /** List of recent notifications, parametrised by limit. */
  list: (limit: number = DEFAULT_LIST_LIMIT) =>
    queryOptions({
      queryKey: [...notificationsQueries.all(), "list", limit] as const,
      queryFn: () => fetchNotifications(limit),
    }),

  /** Unread count badge — refreshed every ~30s while mounted. */
  unreadCount: () =>
    queryOptions({
      queryKey: [...notificationsQueries.all(), "unread-count"] as const,
      queryFn: fetchUnreadCount,
      staleTime: UNREAD_COUNT_STALE_MS,
    }),

  /** Per-type notification preferences. Stable for the user session. */
  preferences: () =>
    queryOptions({
      queryKey: [...notificationsQueries.all(), "preferences"] as const,
      queryFn: fetchNotificationPreferences,
      staleTime: PREFERENCES_STALE_MS,
    }),
};
