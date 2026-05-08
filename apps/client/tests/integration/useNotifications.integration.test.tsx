/**
 * @file useNotifications.integration.test.tsx
 * @description Integration tests for the PR-51.client.B notifications hooks
 *              (`useNotificationsApi/{queries,mutations}`). Verifies the
 *              canon pattern wiring: queryOptions factory consumed by
 *              useQuery, partial-key hierarchy invalidation from mutations,
 *              query gating via `enabled`, and envelope shape matches the
 *              backend's `{ ok, data }` (post Phase A audit).
 *
 *              Canon: `msw-v2-setup-for-vitest-tests-with-tanstack-query`
 *              (per-test-file lifecycle, NOT global setupFiles).
 * @layer infrastructure
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationPreferences,
  useNotificationsList,
  useNotificationsUnreadCount,
  useSaveNotificationPreferences,
} from "../../hooks/api/useNotificationsApi";
import { notificationsQueries } from "../../lib/api/queries/notificationsQueries";
import { server } from "../mocks/server";

const PROXY = "/api/backend";

// MSW lifecycle scoped to THIS file (per canon — NOT global setupFiles).
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function createWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
}

describe("useNotificationsApi — queries", () => {
  it("useNotificationsList returns the items array from the default handler", async () => {
    const { result } = renderHook(() => useNotificationsList(), {
      wrapper: createWrapper(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([
      {
        id: "n1",
        type: "APPROVAL_REQUESTED",
        title: "Default notification",
        body: "Default body",
        read: false,
        createdAt: "2026-05-07T00:00:00.000Z",
      },
    ]);
  });

  it("useNotificationsList does NOT fetch when enabled=false", async () => {
    let fetchCount = 0;
    server.use(
      http.get(`${PROXY}/notifications`, () => {
        fetchCount += 1;
        return HttpResponse.json({ ok: true, data: { items: [] } });
      })
    );

    const { result } = renderHook(() => useNotificationsList({ enabled: false }), {
      wrapper: createWrapper(makeClient()),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchCount).toBe(0);
  });

  it("useNotificationsUnreadCount returns the count value", async () => {
    const { result } = renderHook(() => useNotificationsUnreadCount(), {
      wrapper: createWrapper(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(1);
  });

  it("useNotificationPreferences returns the preferences array", async () => {
    const { result } = renderHook(() => useNotificationPreferences(), {
      wrapper: createWrapper(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { type: "APPROVAL_REQUESTED", enabled: true },
      { type: "POST_APPROVED", enabled: true },
      { type: "MENTION", enabled: false },
    ]);
  });

  it("falls back to empty array when envelope.data is missing (graceful degradation)", async () => {
    server.use(
      http.get(`${PROXY}/notifications/preferences`, () => HttpResponse.json({ ok: true }))
    );

    const { result } = renderHook(() => useNotificationPreferences(), {
      wrapper: createWrapper(makeClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("surfaces error when the request returns !ok", async () => {
    server.use(
      http.get(`${PROXY}/notifications/unread-count`, () =>
        HttpResponse.json({ ok: false, error: "boom", message: "boom" }, { status: 500 })
      )
    );

    const { result } = renderHook(() => useNotificationsUnreadCount(), {
      wrapper: createWrapper(makeClient()),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

describe("useNotificationsApi — mutations", () => {
  it("useMarkAllNotificationsRead invalidates notificationsQueries.all() on success", async () => {
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useMarkAllNotificationsRead(), {
      wrapper: createWrapper(client),
    });

    result.current.mutate();
    await waitFor(() => expect(result.current.status).toBe("success"));

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: notificationsQueries.all(),
    });
  });

  it("useMarkNotificationRead invalidates notificationsQueries.all() on success", async () => {
    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useMarkNotificationRead(), {
      wrapper: createWrapper(client),
    });

    result.current.mutate("n1");
    await waitFor(() => expect(result.current.status).toBe("success"));

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: notificationsQueries.all(),
    });
  });

  it("useSaveNotificationPreferences sends PUT body and invalidates on success", async () => {
    let receivedBody: unknown = null;
    server.use(
      http.put(`${PROXY}/notifications/preferences`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({ ok: true, data: [] });
      })
    );

    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useSaveNotificationPreferences(), {
      wrapper: createWrapper(client),
    });

    result.current.mutate([
      { type: "APPROVAL_REQUESTED", enabled: false },
      { type: "MENTION", enabled: true },
    ]);

    await waitFor(() => expect(result.current.status).toBe("success"));

    expect(receivedBody).toEqual({
      preferences: [
        { type: "APPROVAL_REQUESTED", enabled: false },
        { type: "MENTION", enabled: true },
      ],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: notificationsQueries.all(),
    });
  });

  it("does not invalidate cache when mark-read mutation fails", async () => {
    server.use(
      http.patch(`${PROXY}/notifications/:id/read`, () =>
        HttpResponse.json({ ok: false, error: "not found", message: "not found" }, { status: 404 })
      )
    );

    const client = makeClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useMarkNotificationRead(), {
      wrapper: createWrapper(client),
    });

    result.current.mutate("missing-id");
    await waitFor(() => expect(result.current.status).toBe("error"));

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe("notificationsQueries factory shape", () => {
  it("hierarchy keys are arrays for partial invalidation", () => {
    expect(notificationsQueries.all()).toEqual(["notifications"]);
    expect(notificationsQueries.list().queryKey).toEqual(["notifications", "list", 20]);
    expect(notificationsQueries.list(50).queryKey).toEqual(["notifications", "list", 50]);
    expect(notificationsQueries.unreadCount().queryKey).toEqual(["notifications", "unread-count"]);
    expect(notificationsQueries.preferences().queryKey).toEqual(["notifications", "preferences"]);
  });
});
