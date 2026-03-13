/**
 * @file useNotificationStream.test.ts
 * @description Unit tests for the useNotificationStream hook.
 *              Mocks EventSource to verify connection lifecycle, message dispatch,
 *              and reconnection on error.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNotificationStore } from "@/lib/stores/notificationStore";
import { useNotificationStream } from "../useNotificationStream";

// ---------------------------------------------------------------------------
// Mock EventSource
// ---------------------------------------------------------------------------

interface MockEventSourceInstance {
  onopen: (() => void) | null;
  onmessage: ((e: { data: string; lastEventId: string }) => void) | null;
  onerror: (() => void) | null;
  close: () => void;
  readyState: number;
  url: string;
  withCredentials: boolean;
}

let lastInstance: MockEventSourceInstance | null = null;

class MockEventSource implements MockEventSourceInstance {
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string; lastEventId: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  close = vi.fn();

  constructor(
    public url: string,
    options?: { withCredentials?: boolean }
  ) {
    this.withCredentials = options?.withCredentials ?? false;
    lastInstance = this;
  }

  withCredentials: boolean;
}

beforeEach(() => {
  vi.stubGlobal("EventSource", MockEventSource);
  lastInstance = null;

  // Reset store
  useNotificationStore.setState({
    notifications: [],
    unreadCount: 0,
    isConnected: false,
    lastEventId: null,
  });

  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useNotificationStream", () => {
  it("opens EventSource on mount when enabled", () => {
    renderHook(() => useNotificationStream(true));
    expect(lastInstance).not.toBeNull();
    expect(lastInstance?.url).toContain("/notifications/stream");
    expect(lastInstance?.withCredentials).toBe(true);
  });

  it("does not open EventSource when disabled", () => {
    renderHook(() => useNotificationStream(false));
    expect(lastInstance).toBeNull();
  });

  it("sets isConnected to true on onopen", () => {
    renderHook(() => useNotificationStream(true));
    act(() => {
      lastInstance?.onopen?.();
    });
    expect(useNotificationStore.getState().isConnected).toBe(true);
  });

  it("dispatches notification to store on message event", () => {
    renderHook(() => useNotificationStream(true));

    const payload = {
      id: "notif-1",
      type: "POST_APPROVED",
      title: "Approved",
      body: "Your post was approved",
      read: false,
      createdAt: "2026-03-10T10:00:00Z",
    };

    act(() => {
      lastInstance?.onmessage?.({ data: JSON.stringify(payload), lastEventId: "" });
    });

    const state = useNotificationStore.getState();
    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0]?.id).toBe("notif-1");
    expect(state.unreadCount).toBe(1);
  });

  it("ignores heartbeat events", () => {
    renderHook(() => useNotificationStream(true));
    act(() => {
      lastInstance?.onmessage?.({ data: ":heartbeat", lastEventId: "" });
    });
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });

  it("ignores malformed JSON events", () => {
    renderHook(() => useNotificationStream(true));
    act(() => {
      lastInstance?.onmessage?.({ data: "not-json{{{", lastEventId: "" });
    });
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });

  it("sets isConnected to false on error and schedules reconnect", () => {
    renderHook(() => useNotificationStream(true));
    const firstInstance = lastInstance;

    act(() => {
      lastInstance?.onopen?.();
    });
    expect(useNotificationStore.getState().isConnected).toBe(true);

    act(() => {
      lastInstance?.onerror?.();
    });
    expect(useNotificationStore.getState().isConnected).toBe(false);
    expect(firstInstance?.close).toHaveBeenCalled();

    // Advance past reconnect delay — new EventSource should be created
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(lastInstance).not.toBe(firstInstance);
  });

  it("closes EventSource and cancels reconnect on unmount", () => {
    const { unmount } = renderHook(() => useNotificationStream(true));
    const instance = lastInstance;

    unmount();

    expect(instance?.close).toHaveBeenCalled();
    expect(useNotificationStore.getState().isConnected).toBe(false);

    // No reconnect should happen after unmount
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(lastInstance).toBe(instance); // no new instance created
  });

  it("updates lastEventId when event has a lastEventId", () => {
    renderHook(() => useNotificationStream(true));

    const payload = {
      id: "notif-2",
      type: "MENTION",
      title: "Mention",
      body: "You were mentioned",
      read: false,
      createdAt: "2026-03-10T11:00:00Z",
    };

    act(() => {
      lastInstance?.onmessage?.({ data: JSON.stringify(payload), lastEventId: "evt-abc-123" });
    });

    expect(useNotificationStore.getState().lastEventId).toBe("evt-abc-123");
  });
});
