/**
 * @file queries.ts
 * @description TanStack Query read hooks for the notifications domain.
 *              Each consumes a `queryOptions(...)` entry from the
 *              `notificationsQueries` factory — no inline keys, no
 *              duplicated defaults.
 *
 *              Canon: `tanstack-query-v5-migration-patterns-from-raw-fetch`.
 * @layer infrastructure
 */

"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { notificationsQueries } from "../../../lib/api/queries/notificationsQueries.js";
import type {
  NotificationItemDto,
  NotificationPreferenceDto,
} from "../../../lib/api/clients/notificationsClient.js";

/**
 * @hook useNotificationsList
 * @description Fetches the user's recent notification list.
 * @param options - `{ limit?: number; enabled?: boolean }`. `enabled` lets
 *                  callers gate the query (e.g., only fetch while a popover
 *                  is open).
 */
export function useNotificationsList(
  options: {
    limit?: number;
    enabled?: boolean;
  } = {}
): UseQueryResult<NotificationItemDto[], Error> {
  const { limit = 20, enabled = true } = options;
  return useQuery({
    ...notificationsQueries.list(limit),
    enabled,
  });
}

/**
 * @hook useNotificationsUnreadCount
 * @description Fetches the user's unread notification count. Refreshes
 *              every ~30s via the canon staleTime; coordinated with
 *              SSE-driven cache writes via `notificationsQueries.unreadCount()`.
 */
export function useNotificationsUnreadCount(): UseQueryResult<number, Error> {
  return useQuery(notificationsQueries.unreadCount());
}

/**
 * @hook useNotificationPreferences
 * @description Fetches the user's per-type notification preferences.
 */
export function useNotificationPreferences(): UseQueryResult<NotificationPreferenceDto[], Error> {
  return useQuery(notificationsQueries.preferences());
}
