/**
 * @file mutations.ts
 * @description TanStack Mutation hooks for the notifications domain. Each
 *              mutation invalidates `notificationsQueries.all()` (partial-key)
 *              on success — the entire notifications query family refetches,
 *              which is correct for our cardinality (list + unread-count +
 *              preferences). Optimistic updates are deferred per canon
 *              `tanstack-query-v5-migration-patterns-from-raw-fetch` ("opt-in
 *              per-mutation; not default").
 * @layer infrastructure
 */

"use client";

import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import {
  markAllNotificationsRead,
  markNotificationRead,
  saveNotificationPreferences,
  type NotificationPreferenceDto,
} from "../../../lib/api/clients/notificationsClient.js";
import { notificationsQueries } from "../../../lib/api/queries/notificationsQueries.js";

/**
 * @hook useMarkAllNotificationsRead
 * @description Marks every notification for the current user as read.
 *              Invalidates the entire notifications query family on success.
 */
export function useMarkAllNotificationsRead(): UseMutationResult<void, Error, void, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationsQueries.all() });
    },
  });
}

/**
 * @hook useMarkNotificationRead
 * @description Marks a single notification as read by id. Invalidates the
 *              entire notifications query family on success — covers the
 *              previous bug where only `unread-count` was invalidated and
 *              the list stayed stale.
 */
export function useMarkNotificationRead(): UseMutationResult<void, Error, string, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationsQueries.all() });
    },
  });
}

/**
 * @hook useSaveNotificationPreferences
 * @description Persists the user's per-type notification preferences via PUT.
 *              Invalidates `notificationsQueries.preferences()` on success.
 */
export function useSaveNotificationPreferences(): UseMutationResult<
  void,
  Error,
  NotificationPreferenceDto[],
  unknown
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveNotificationPreferences,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationsQueries.all() });
    },
  });
}
