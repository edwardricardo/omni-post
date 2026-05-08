/**
 * @file useWebhooks.test.tsx
 * @description Tests for the useWebhooks hook module — covers query hooks
 *              (metrics, DLQ metrics, subscriptions, projects-for-form, events,
 *              event detail, webhook DLQ list, outbox DLQ list) and mutation
 *              hooks (subscriptions CRUD, DLQ retry single/all, events export,
 *              outbox retry/resolve). Mocks `global.fetch` since the api layer
 *              is a thin wrapper around it.
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  useWebhookMetrics,
  useDlqMetrics,
  useWebhookSubscriptions,
  useProjectsForSubscriptionForm,
  useWebhookEvents,
  useWebhookEventDetail,
  useWebhookDeadLetterEvents,
  useOutboxDeadLetter,
  useCreateWebhookSubscription,
  useUpdateWebhookSubscription,
  useDeleteWebhookSubscription,
  useRetryWebhookDeadLetter,
  useRetryAllWebhookDeadLetter,
  useExportWebhookEvents,
  useRetryOutboxDlq,
  useResolveOutboxDlq,
} from "@/hooks/api/useWebhooks";

const mockFetch = vi.fn();

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    blob: () => Promise.resolve(new Blob([JSON.stringify(body)], { type: "application/json" })),
  } as unknown as Response;
}

function errorResponse(status: number, message = "Error"): Response {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({ error: { message } }),
    text: () => Promise.resolve(JSON.stringify({ error: { message } })),
    blob: () => Promise.resolve(new Blob([])),
  } as unknown as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Query hooks
// ---------------------------------------------------------------------------

describe("useWebhookMetrics", () => {
  it("fetches metrics with timeRange and provider filter", async () => {
    const metrics = {
      totalEvents: 100,
      processedEvents: 95,
      failedEvents: 5,
      successRate: 95,
      avgProcessingTime: 42,
      queueDepth: 0,
      realtimeConnections: 0,
      byProvider: {},
      byEventType: {},
      timeline: [],
    };
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, data: metrics }));

    const { result } = renderHook(() => useWebhookMetrics("24h", "X"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(metrics);
    const calledUrl = mockFetch.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("/api/backend/webhooks/dashboard/metrics");
    expect(calledUrl).toContain("timeRange=24h");
    expect(calledUrl).toContain("provider=X");
  });

  it("omits provider param when 'all' is passed", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: {
          totalEvents: 0,
          processedEvents: 0,
          failedEvents: 0,
          successRate: 0,
          avgProcessingTime: 0,
          queueDepth: 0,
          realtimeConnections: 0,
          byProvider: {},
          byEventType: {},
          timeline: [],
        },
      })
    );

    const { result } = renderHook(() => useWebhookMetrics("1h", "all"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const calledUrl = mockFetch.mock.calls[0]?.[0] as string;
    expect(calledUrl).not.toContain("provider=");
  });

  it("rejects when response payload missing data", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: false }));

    const { result } = renderHook(() => useWebhookMetrics("1h"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("Failed to fetch webhook metrics data");
  });
});

describe("useDlqMetrics", () => {
  it("fetches DLQ metrics", async () => {
    const dlq = {
      unresolvedTotal: 3,
      oldestUnresolvedAt: "2026-04-20T00:00:00.000Z",
      archivedTotal: 12,
      outboxDlqTotal: 1,
    };
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, data: dlq }));

    const { result } = renderHook(() => useDlqMetrics(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(dlq);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/backend/webhooks/dashboard/dead-letter/metrics",
      expect.objectContaining({ credentials: "include" })
    );
  });
});

describe("useWebhookSubscriptions", () => {
  it("returns the array when payload is bare", async () => {
    const subs = [
      {
        id: "sub-1",
        provider: "X",
        webhookUrl: "https://example.com/wh",
        eventTypes: ["POST_PUBLISHED"],
        isActive: true,
        eventsReceived: 0,
        eventsProcessed: 0,
        createdAt: "2026-04-01T00:00:00.000Z",
        stats: { totalEvents: 0, recentEvents: 0, failedEvents: 0, successRate: 100 },
      },
    ];
    mockFetch.mockResolvedValueOnce(jsonResponse(subs));

    const { result } = renderHook(() => useWebhookSubscriptions(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(subs);
  });

  it("unwraps { data: { subscriptions: [...] } } envelope", async () => {
    const subs = [
      {
        id: "sub-2",
        provider: "INSTAGRAM",
        webhookUrl: "https://example.com/wh-ig",
        eventTypes: ["COMMENT_RECEIVED"],
        isActive: false,
        eventsReceived: 5,
        eventsProcessed: 4,
        createdAt: "2026-04-02T00:00:00.000Z",
        stats: { totalEvents: 5, recentEvents: 0, failedEvents: 1, successRate: 80 },
      },
    ];
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, data: { subscriptions: subs } }));

    const { result } = renderHook(() => useWebhookSubscriptions(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(subs);
  });

  it("returns [] for unrecognized payload shapes", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ unexpected: true }));

    const { result } = renderHook(() => useWebhookSubscriptions(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });
});

describe("useProjectsForSubscriptionForm", () => {
  it("returns [] when backend route 404s (PR-15 — known broken)", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(404, "Not found"));

    const { result } = renderHook(() => useProjectsForSubscriptionForm(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("returns [] when fetch rejects (network error)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

    const { result } = renderHook(() => useProjectsForSubscriptionForm(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("returns the array on 200", async () => {
    const projects = [{ id: "p-1", name: "Project One" }];
    mockFetch.mockResolvedValueOnce(jsonResponse(projects));

    const { result } = renderHook(() => useProjectsForSubscriptionForm(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(projects);
  });
});

describe("useWebhookEvents", () => {
  it("forwards filters into the query string", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: { events: [], pagination: { page: 2, limit: 50, total: 0, pages: 0 } },
      })
    );

    const { result } = renderHook(
      () =>
        useWebhookEvents({ page: 2, limit: 50, provider: "X", status: "FAILED", search: "abc" }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = mockFetch.mock.calls[0]?.[0] as string;
    expect(url).toContain("page=2");
    expect(url).toContain("limit=50");
    expect(url).toContain("provider=X");
    expect(url).toContain("status=FAILED");
    expect(url).toContain("search=abc");
  });

  it("returns default pagination when payload omits it", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, data: { events: [] } }));

    const { result } = renderHook(() => useWebhookEvents({ page: 1, limit: 20 }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pagination).toEqual({ page: 1, limit: 20, total: 0, pages: 0 });
  });
});

describe("useWebhookEventDetail", () => {
  it("is disabled when eventId is null", () => {
    const { result } = renderHook(() => useWebhookEventDetail(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fetches the event when eventId provided", async () => {
    const event = {
      id: "evt-1",
      eventId: "ext-evt-1",
      eventType: "POST_PUBLISHED",
      provider: "X",
      status: "PROCESSED",
      verified: true,
      processed: true,
      retryCount: 0,
      receivedAt: "2026-04-20T00:00:00.000Z",
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(event));

    const { result } = renderHook(() => useWebhookEventDetail("evt-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(event);
    expect(mockFetch.mock.calls[0]?.[0]).toBe("/api/backend/webhooks/dashboard/events/evt-1");
  });
});

describe("useWebhookDeadLetterEvents", () => {
  it("fetches DLQ events with filters", async () => {
    const events = [
      {
        id: "dlq-1",
        provider: "X",
        eventType: "POST_PUBLISHED",
        failureReason: "5xx",
        finalError: "Service unavailable",
        retryCount: 5,
        firstFailedAt: "2026-04-15T00:00:00.000Z",
        lastRetryAt: "2026-04-19T00:00:00.000Z",
        payload: {},
        headers: {},
      },
    ];
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        data: { events, pagination: { page: 1, limit: 20, total: 1, pages: 1 } },
      })
    );

    const { result } = renderHook(
      () => useWebhookDeadLetterEvents({ page: 1, limit: 20, provider: "X" }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.events).toEqual(events);
    const url = mockFetch.mock.calls[0]?.[0] as string;
    expect(url).toContain("provider=X");
  });
});

describe("useOutboxDeadLetter", () => {
  it("fetches paginated outbox DLQ entries", async () => {
    const page = {
      items: [
        {
          id: "ob-1",
          createdAt: "2026-04-25T00:00:00.000Z",
          eventType: "PostScheduled",
          aggregateId: "agg-1",
          retryCount: 3,
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    };
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true, data: page }));

    const { result } = renderHook(() => useOutboxDeadLetter(1, 20), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(page);
    expect(mockFetch.mock.calls[0]?.[0]).toBe(
      "/api/backend/admin/outbox/dead-letter?page=1&limit=20"
    );
  });
});

// ---------------------------------------------------------------------------
// Mutation hooks
// ---------------------------------------------------------------------------

describe("useCreateWebhookSubscription", () => {
  it("posts JSON body and resolves on success", async () => {
    const created = {
      id: "sub-new",
      provider: "X",
      webhookUrl: "https://x.com/wh",
      eventTypes: ["POST_PUBLISHED"],
      isActive: true,
      eventsReceived: 0,
      eventsProcessed: 0,
      createdAt: "2026-04-25T00:00:00.000Z",
      stats: { totalEvents: 0, recentEvents: 0, failedEvents: 0, successRate: 100 },
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(created));

    const { result } = renderHook(() => useCreateWebhookSubscription(), {
      wrapper: createWrapper(),
    });

    let returned: unknown;
    await act(async () => {
      returned = await result.current.mutateAsync({
        provider: "X",
        eventTypes: ["POST_PUBLISHED"],
      });
    });

    expect(returned).toEqual(created);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(created);
    expect(mockFetch.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
  });

  it("propagates ApiError on 4xx", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(400, "Invalid input"));

    const { result } = renderHook(() => useCreateWebhookSubscription(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({ provider: "X", eventTypes: [] });
      })
    ).rejects.toThrow();

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("useUpdateWebhookSubscription", () => {
  it("PUTs the patch payload to the right URL", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));

    const { result } = renderHook(() => useUpdateWebhookSubscription(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ id: "sub-1", data: { isActive: false } });
    });

    expect(mockFetch.mock.calls[0]?.[0]).toBe("/api/backend/webhooks/subscriptions/sub-1");
    expect(mockFetch.mock.calls[0]?.[1]).toMatchObject({ method: "PUT" });
  });
});

describe("useDeleteWebhookSubscription", () => {
  it("DELETEs the subscription by id", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));

    const { result } = renderHook(() => useDeleteWebhookSubscription(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync("sub-7");
    });

    expect(mockFetch.mock.calls[0]?.[0]).toBe("/api/backend/webhooks/subscriptions/sub-7");
    expect(mockFetch.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE" });
  });
});

describe("useRetryWebhookDeadLetter", () => {
  it("POSTs to the retry endpoint for a single event", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));

    const { result } = renderHook(() => useRetryWebhookDeadLetter(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync("dlq-42");
    });

    expect(mockFetch.mock.calls[0]?.[0]).toBe(
      "/api/backend/webhooks/dashboard/dead-letter/dlq-42/retry"
    );
    expect(mockFetch.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
  });
});

describe("useRetryAllWebhookDeadLetter", () => {
  it("POSTs to the retry-all endpoint", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));

    const { result } = renderHook(() => useRetryAllWebhookDeadLetter(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(mockFetch.mock.calls[0]?.[0]).toBe(
      "/api/backend/webhooks/dashboard/dead-letter/retry-all"
    );
    expect(mockFetch.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
  });
});

describe("useExportWebhookEvents", () => {
  it("returns a Blob from the export endpoint", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ csv: "id,provider\n1,X" }));

    const { result } = renderHook(() => useExportWebhookEvents(), {
      wrapper: createWrapper(),
    });

    let blob: Blob | undefined;
    await act(async () => {
      blob = await result.current.mutateAsync({ provider: "X", status: "FAILED" });
    });

    expect(blob).toBeInstanceOf(Blob);
    const url = mockFetch.mock.calls[0]?.[0] as string;
    expect(url).toContain("provider=X");
    expect(url).toContain("status=FAILED");
  });

  it("throws ApiError on non-2xx", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(500, "Boom"));

    const { result } = renderHook(() => useExportWebhookEvents(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({});
      })
    ).rejects.toThrow();
  });
});

describe("useRetryOutboxDlq", () => {
  it("POSTs to the outbox retry endpoint", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));

    const { result } = renderHook(() => useRetryOutboxDlq(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync("ob-1");
    });

    expect(mockFetch.mock.calls[0]?.[0]).toBe("/api/backend/admin/outbox/dead-letter/ob-1/retry");
    expect(mockFetch.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
  });

  it("throws when retry response is not ok", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(500));

    const { result } = renderHook(() => useRetryOutboxDlq(), { wrapper: createWrapper() });

    await expect(
      act(async () => {
        await result.current.mutateAsync("ob-1");
      })
    ).rejects.toThrow("Retry failed");
  });
});

describe("useResolveOutboxDlq", () => {
  it("POSTs to the outbox resolve endpoint", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));

    const { result } = renderHook(() => useResolveOutboxDlq(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync("ob-2");
    });

    expect(mockFetch.mock.calls[0]?.[0]).toBe("/api/backend/admin/outbox/dead-letter/ob-2/resolve");
    expect(mockFetch.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
  });

  it("throws when resolve response is not ok", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(500));

    const { result } = renderHook(() => useResolveOutboxDlq(), { wrapper: createWrapper() });

    await expect(
      act(async () => {
        await result.current.mutateAsync("ob-2");
      })
    ).rejects.toThrow("Resolve failed");
  });
});
