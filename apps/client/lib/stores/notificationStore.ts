/**
 * @file notificationStore.ts
 * @description Zustand store for notification state. Holds unread count, notification list,
 *              SSE connection status, and actions for marking read. Shared by the notification
 *              bell, inbox unread badge, and any real-time feature.
 * @layer client-state
 */

import { create } from "zustand";

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationState {
  notifications: NotificationItem[];
  unreadCount: number;
  isConnected: boolean;
  lastEventId: string | null;
  // Actions
  setNotifications: (items: NotificationItem[]) => void;
  addNotification: (item: NotificationItem) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  setUnreadCount: (count: number) => void;
  setConnected: (connected: boolean) => void;
  setLastEventId: (id: string) => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  unreadCount: 0,
  isConnected: false,
  lastEventId: null,

  setNotifications: (items) =>
    set({
      notifications: items,
      unreadCount: items.filter((n) => !n.read).length,
    }),

  addNotification: (item) =>
    set((state) => {
      const exists = state.notifications.some((n) => n.id === item.id);
      if (exists) return state;
      return {
        notifications: [item, ...state.notifications],
        unreadCount: item.read ? state.unreadCount : state.unreadCount + 1,
      };
    }),

  markRead: (id) =>
    set((state) => {
      const target = state.notifications.find((n) => n.id === id);
      if (!target || target.read) return state;
      return {
        notifications: state.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
        unreadCount: Math.max(0, state.unreadCount - 1),
      };
    }),

  markAllRead: () =>
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    })),

  setUnreadCount: (count) => set({ unreadCount: count }),

  setConnected: (connected) => set({ isConnected: connected }),

  setLastEventId: (id) => set({ lastEventId: id }),
}));
