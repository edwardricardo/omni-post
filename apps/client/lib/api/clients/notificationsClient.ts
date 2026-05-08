/**
 * @file notificationsClient.ts
 * @description Notifications-domain transport helpers. Mirrors the
 *              `schedulingClient.ts` POC: functional fetchers using the canon
 *              `request<T>` transport which throws `ApiError` on non-OK
 *              responses (consumed by TanStack Query's `error` field
 *              upstream). Default envelope unwrapping returns sane fallbacks
 *              (empty arrays / count = 0) for graceful UX.
 *
 *              Canon: `tanstack-query-v5-migration-patterns-from-raw-fetch`.
 * @layer infrastructure
 */

import { PROXY_BASE, request } from "./request";

export interface NotificationItemDto {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationPreferenceDto {
  type: string;
  enabled: boolean;
}

/**
 * @function fetchNotifications
 * @description Loads recent notifications for the current user. Backend
 *              returns `{ ok, data: { items: NotificationItemDto[] } }`.
 *              Falls back to empty array when the envelope is missing.
 * @param limit - Page size, default 20.
 */
export async function fetchNotifications(limit = 20): Promise<NotificationItemDto[]> {
  const body = await request<{ ok: boolean; data?: { items: NotificationItemDto[] } }>(
    PROXY_BASE,
    `/notifications?limit=${limit}`
  );
  return body.ok && body.data?.items ? body.data.items : [];
}

/**
 * @function fetchUnreadCount
 * @description Loads the unread notification count. Backend returns
 *              `{ ok, data: { count: number } }`.
 */
export async function fetchUnreadCount(): Promise<number> {
  const body = await request<{ ok: boolean; data?: { count: number } }>(
    PROXY_BASE,
    "/notifications/unread-count"
  );
  return body.ok && body.data ? body.data.count : 0;
}

/**
 * @function markAllNotificationsRead
 * @description Marks every notification for the current user as read.
 */
export async function markAllNotificationsRead(): Promise<void> {
  await request(PROXY_BASE, "/notifications/mark-all-read", {
    method: "POST",
  });
}

/**
 * @function markNotificationRead
 * @description Marks a single notification as read.
 */
export async function markNotificationRead(id: string): Promise<void> {
  await request(PROXY_BASE, `/notifications/${encodeURIComponent(id)}/read`, {
    method: "PATCH",
  });
}

/**
 * @function fetchNotificationPreferences
 * @description Loads the per-type notification preferences for the current
 *              user. Backend returns `{ ok, data: NotificationPreferenceDto[] }`.
 *              Falls back to empty array when the envelope is missing.
 */
export async function fetchNotificationPreferences(): Promise<NotificationPreferenceDto[]> {
  const body = await request<{ ok: boolean; data?: NotificationPreferenceDto[] }>(
    PROXY_BASE,
    "/notifications/preferences"
  );
  return body.ok && body.data ? body.data : [];
}

/**
 * @function saveNotificationPreferences
 * @description Persists the user's per-type notification preferences via
 *              `PUT /notifications/preferences`.
 */
export async function saveNotificationPreferences(
  preferences: NotificationPreferenceDto[]
): Promise<void> {
  await request(PROXY_BASE, "/notifications/preferences", {
    method: "PUT",
    body: JSON.stringify({ preferences }),
  });
}
