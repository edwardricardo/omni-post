/**
 * @file NotificationBell.tsx
 * @description Notification bell icon with unread badge, popover dropdown listing recent
 *              notifications, and "Mark all read" action. Integrates with the Zustand
 *              notification store and TanStack Query for server state.
 * @layer infrastructure
 */

"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import * as Popover from "@radix-ui/react-popover";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import { Bell } from "lucide-react";
import { useNotificationStore } from "@/lib/stores/notificationStore";
import type { NotificationItem as NotificationItemType } from "@/lib/stores/notificationStore";
import { useNotificationStream } from "@/hooks/useNotificationStream";
import { NotificationItem } from "./NotificationItem.js";
import { Link } from "@/i18n/navigation";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationsList,
  useNotificationsUnreadCount,
} from "@/hooks/api/useNotificationsApi";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * @component NotificationBell
 * @description Notification bell icon with unread count badge and a Radix popover
 *              dropdown listing recent notifications. Integrates SSE streaming via
 *              Zustand store and TanStack Query for server state, with mark-all-read
 *              and individual mark-read actions.
 */
export function NotificationBell() {
  const t = useTranslations("notifications");
  const [open, setOpen] = useState(false);

  // Start SSE stream (once, at layout level)
  useNotificationStream(true);

  const setNotifications = useNotificationStore((s) => s.setNotifications);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const setUnreadCount = useNotificationStore((s) => s.setUnreadCount);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const storeNotifications = useNotificationStore((s) => s.notifications);

  // Server state: initial notification list loaded when popover opens.
  // Canon: `tanstack-query-v5-migration-patterns-from-raw-fetch` — consumes
  // the queryOptions factory (no inline keys).
  const {
    data: serverNotifications,
    isLoading,
    isError,
    refetch,
  } = useNotificationsList({ enabled: open });

  // Sync server notifications into the Zustand store when data arrives.
  // The store is the merge point for both the fetched list and the
  // real-time additions pushed by `useNotificationStream` over SSE.
  useEffect(() => {
    if (serverNotifications) {
      setNotifications(serverNotifications);
    }
  }, [serverNotifications, setNotifications]);

  // Sync unread count on mount
  const { data: serverUnreadCount } = useNotificationsUnreadCount();

  useEffect(() => {
    if (serverUnreadCount !== undefined) {
      setUnreadCount(serverUnreadCount);
    }
  }, [serverUnreadCount, setUnreadCount]);

  const markAllReadMutation = useMarkAllNotificationsRead();
  const markReadMutation = useMarkNotificationRead();

  const handleMarkAllRead = () => {
    markAllReadMutation.mutate(undefined, {
      onSuccess: () => {
        markAllRead();
      },
    });
  };

  const handleMarkRead = (id: string) => {
    markRead(id);
    markReadMutation.mutate(id);
  };

  // Prefer store (includes SSE additions) over raw server data
  const displayNotifications =
    storeNotifications.length > 0 ? storeNotifications : (serverNotifications ?? []);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          aria-label={
            unreadCount > 0 ? t("bellAriaLabelUnread", { count: unreadCount }) : t("bellAriaLabel")
          }
          className="relative rounded-full p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          <Bell className="h-5 w-5" aria-hidden="true" />
          {unreadCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-[360px] max-w-[calc(100vw-1rem)] rounded-xl bg-white shadow-lg ring-1 ring-black/5 focus:outline-none"
          aria-label={t("title")}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900">{t("title")}</h2>
            <button
              onClick={handleMarkAllRead}
              disabled={unreadCount === 0 || markAllReadMutation.isPending}
              className="text-xs text-blue-600 hover:text-blue-700 disabled:text-gray-400 disabled:cursor-not-allowed"
            >
              {t("markAllRead")}
            </button>
          </div>

          {/* Content */}
          <ScrollArea.Root>
            <ScrollArea.Viewport className="max-h-[400px]">
              {isLoading && (
                <div className="divide-y divide-gray-50">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex items-start gap-3 px-4 py-3 animate-pulse">
                      <div className="mt-1.5 h-2 w-2 rounded-full bg-gray-200 shrink-0" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-3 w-3/4 rounded bg-gray-200" />
                        <div className="h-3 w-full rounded bg-gray-100" />
                        <div className="h-2.5 w-1/3 rounded bg-gray-100" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {isError && (
                <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                  <p className="text-sm text-gray-500">{t("loadError")}</p>
                  <button
                    onClick={() => void refetch()}
                    className="text-xs text-blue-600 hover:text-blue-700"
                  >
                    {t("retry")}
                  </button>
                </div>
              )}

              {!isLoading && !isError && displayNotifications.length === 0 && (
                <div className="px-4 py-8 text-center">
                  <Bell className="mx-auto h-8 w-8 text-gray-300" aria-hidden="true" />
                  <p className="mt-2 text-sm text-gray-500">{t("empty")}</p>
                </div>
              )}

              {!isLoading && !isError && displayNotifications.length > 0 && (
                <div className="divide-y divide-gray-50">
                  {displayNotifications.map((n: NotificationItemType) => (
                    <NotificationItem
                      key={n.id}
                      notification={n}
                      onRead={(id) => {
                        handleMarkRead(id);
                        setOpen(false);
                      }}
                    />
                  ))}
                </div>
              )}
            </ScrollArea.Viewport>
            <ScrollArea.Scrollbar
              orientation="vertical"
              className="flex w-1.5 touch-none select-none rounded-full bg-gray-100 p-px"
            >
              <ScrollArea.Thumb className="relative flex-1 rounded-full bg-gray-300" />
            </ScrollArea.Scrollbar>
          </ScrollArea.Root>

          {/* Footer */}
          <div className="border-t border-gray-100 px-4 py-2 text-center">
            <Link
              href="/dashboard/settings/notifications"
              className="text-xs text-gray-500 hover:text-gray-700"
              onClick={() => setOpen(false)}
            >
              {t("preferencesLink")}
            </Link>
          </div>

          <Popover.Arrow className="fill-white" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
