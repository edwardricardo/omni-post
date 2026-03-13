/**
 * @file notificationStore.test.ts
 * @description Unit tests for the Zustand notification store.
 *              Tests each action in isolation.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { useNotificationStore } from "../notificationStore";

// Reset store between tests
beforeEach(() => {
  useNotificationStore.setState({
    notifications: [],
    unreadCount: 0,
    isConnected: false,
    lastEventId: null,
  });
});

const makeItem = (overrides: Partial<import("../notificationStore").NotificationItem> = {}) =>
  ({
    id: "notif-001",
    type: "POST_APPROVED",
    title: "Post approved",
    body: "Your post was approved.",
    read: false,
    createdAt: "2026-03-10T10:00:00Z",
    ...overrides,
  }) as import("../notificationStore").NotificationItem;

describe("notificationStore", () => {
  describe("setNotifications", () => {
    it("replaces notification list and recalculates unread count", () => {
      const { setNotifications, notifications, unreadCount } = useNotificationStore.getState();
      setNotifications([
        makeItem({ id: "1", read: false }),
        makeItem({ id: "2", read: true }),
        makeItem({ id: "3", read: false }),
      ]);
      const state = useNotificationStore.getState();
      expect(state.notifications).toHaveLength(3);
      expect(state.unreadCount).toBe(2);
      // suppress unused var lint
      void notifications;
      void unreadCount;
    });

    it("sets unreadCount to 0 when all items are read", () => {
      const { setNotifications } = useNotificationStore.getState();
      setNotifications([makeItem({ id: "1", read: true }), makeItem({ id: "2", read: true })]);
      expect(useNotificationStore.getState().unreadCount).toBe(0);
    });
  });

  describe("addNotification", () => {
    it("prepends new notification and increments unreadCount for unread item", () => {
      const { addNotification } = useNotificationStore.getState();
      addNotification(makeItem({ id: "a" }));
      const state = useNotificationStore.getState();
      expect(state.notifications).toHaveLength(1);
      expect(state.notifications[0]?.id).toBe("a");
      expect(state.unreadCount).toBe(1);
    });

    it("does not increment unreadCount for already-read notification", () => {
      const { addNotification } = useNotificationStore.getState();
      addNotification(makeItem({ id: "b", read: true }));
      expect(useNotificationStore.getState().unreadCount).toBe(0);
    });

    it("ignores duplicate notification (same id)", () => {
      const { addNotification } = useNotificationStore.getState();
      addNotification(makeItem({ id: "dup" }));
      addNotification(makeItem({ id: "dup" }));
      expect(useNotificationStore.getState().notifications).toHaveLength(1);
      expect(useNotificationStore.getState().unreadCount).toBe(1);
    });
  });

  describe("markRead", () => {
    it("sets read: true on matching notification and decrements unreadCount", () => {
      const store = useNotificationStore.getState();
      store.setNotifications([makeItem({ id: "x", read: false })]);
      useNotificationStore.getState().markRead("x");
      const state = useNotificationStore.getState();
      expect(state.notifications[0]?.read).toBe(true);
      expect(state.unreadCount).toBe(0);
    });

    it("is a no-op when notification is already read", () => {
      const store = useNotificationStore.getState();
      store.setNotifications([makeItem({ id: "y", read: true })]);
      useNotificationStore.getState().markRead("y");
      expect(useNotificationStore.getState().unreadCount).toBe(0);
    });

    it("does not affect other notifications", () => {
      const store = useNotificationStore.getState();
      store.setNotifications([
        makeItem({ id: "n1", read: false }),
        makeItem({ id: "n2", read: false }),
      ]);
      useNotificationStore.getState().markRead("n1");
      const state = useNotificationStore.getState();
      expect(state.notifications.find((n) => n.id === "n2")?.read).toBe(false);
      expect(state.unreadCount).toBe(1);
    });
  });

  describe("markAllRead", () => {
    it("sets read: true on all notifications and resets unreadCount to 0", () => {
      const store = useNotificationStore.getState();
      store.setNotifications([
        makeItem({ id: "p", read: false }),
        makeItem({ id: "q", read: false }),
      ]);
      useNotificationStore.getState().markAllRead();
      const state = useNotificationStore.getState();
      expect(state.notifications.every((n) => n.read)).toBe(true);
      expect(state.unreadCount).toBe(0);
    });
  });

  describe("setUnreadCount", () => {
    it("sets unreadCount directly", () => {
      useNotificationStore.getState().setUnreadCount(7);
      expect(useNotificationStore.getState().unreadCount).toBe(7);
    });
  });

  describe("setConnected", () => {
    it("updates isConnected", () => {
      useNotificationStore.getState().setConnected(true);
      expect(useNotificationStore.getState().isConnected).toBe(true);
      useNotificationStore.getState().setConnected(false);
      expect(useNotificationStore.getState().isConnected).toBe(false);
    });
  });

  describe("setLastEventId", () => {
    it("updates lastEventId", () => {
      useNotificationStore.getState().setLastEventId("event-abc");
      expect(useNotificationStore.getState().lastEventId).toBe("event-abc");
    });
  });
});
