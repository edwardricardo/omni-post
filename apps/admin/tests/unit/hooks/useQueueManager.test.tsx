/**
 * Tests for useQueueManager
 *
 * The hook makes two parallel fetch calls (jobs + stats) and exposes
 * filtering/sorting logic, plus retry/cancel/delete mutations.
 * We mock global.fetch throughout.
 *
 * @file useQueueManager.test.tsx
 * @description Tests for useQueueManager
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useQueueManager } from "@/components/queue/useQueueManager";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const MOCK_JOBS_RESPONSE = {
  items: [
    {
      id: "job-1",
      name: "publish:x",
      data: { content: "Hello X", provider: "x", priority: "high" },
      progress: 0,
      attemptsMade: 0,
      maxAttempts: 3,
      timestamp: 1740355200000, // 2026-02-24T00:00:00.000Z
      processedOn: undefined,
      finishedOn: undefined,
      failedReason: undefined,
      delay: 0,
    },
    {
      id: "job-2",
      name: "publish:instagram",
      data: { text: "Hello IG", providers: ["instagram"], priority: "medium" },
      progress: 100,
      attemptsMade: 1,
      maxAttempts: 3,
      timestamp: 1740355100000,
      processedOn: 1740355200000,
      finishedOn: 1740355300000,
      failedReason: undefined,
      delay: 0,
    },
    {
      id: "job-3",
      name: "publish:facebook",
      data: { content: "FB post", provider: "facebook" },
      progress: 0,
      attemptsMade: 2,
      maxAttempts: 3,
      timestamp: 1740355000000,
      processedOn: 1740355050000,
      finishedOn: undefined,
      failedReason: "Rate limit exceeded",
      delay: 0,
    },
  ],
  total: 3,
};

const MOCK_STATS_RESPONSE = {
  total: 3,
  queued: 1,
  processing: 0,
  published: 1,
  failed: 1,
  paused: 0,
  successRate: 66.7,
};

function setupSuccessfulFetch() {
  // First call = jobs, second call = stats (Promise.all order)
  mockFetch
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, value: MOCK_JOBS_RESPONSE }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, value: MOCK_STATS_RESPONSE }),
    });
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useQueueManager", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches jobs and stats, maps them into queueItems and stats", async () => {
    setupSuccessfulFetch();

    const { result } = renderHook(() => useQueueManager({}), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.queueItems).toHaveLength(3);
    expect(result.current.stats.total).toBe(3);
    expect(result.current.stats.successRate).toBe(66.7);
  });

  it("infers correct status from job shape", async () => {
    setupSuccessfulFetch();

    const { result } = renderHook(() => useQueueManager({}), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const items = result.current.queueItems;

    // job-1: no finishedOn, no failedReason, no processedOn → queued
    expect(items.find((i) => i.id === "job-1")?.status).toBe("queued");

    // job-2: finishedOn set, no failedReason → published
    expect(items.find((i) => i.id === "job-2")?.status).toBe("published");

    // job-3: failedReason set → failed
    expect(items.find((i) => i.id === "job-3")?.status).toBe("failed");
  });

  it("maps providers from job data (single provider)", async () => {
    setupSuccessfulFetch();

    const { result } = renderHook(() => useQueueManager({}), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // job-1 data.provider = "x" → providers: ["x"]
    const job1 = result.current.queueItems.find((i) => i.id === "job-1");
    expect(job1?.providers).toEqual(["x"]);

    // job-2 data.providers = ["instagram"] → providers: ["instagram"]
    const job2 = result.current.queueItems.find((i) => i.id === "job-2");
    expect(job2?.providers).toEqual(["instagram"]);
  });

  it("maps high priority from job data", async () => {
    setupSuccessfulFetch();

    const { result } = renderHook(() => useQueueManager({}), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const job1 = result.current.queueItems.find((i) => i.id === "job-1");
    expect(job1?.priority).toBe("high");
  });

  it("filters items by status when setFilter is called", async () => {
    setupSuccessfulFetch();

    const { result } = renderHook(() => useQueueManager({}), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.setFilter({ status: ["failed"] });
    });

    expect(result.current.filteredItems).toHaveLength(1);
    expect(result.current.filteredItems[0]?.status).toBe("failed");
  });

  it("filters items by provider", async () => {
    setupSuccessfulFetch();

    const { result } = renderHook(() => useQueueManager({}), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.setFilter({ providers: ["instagram"] });
    });

    expect(result.current.filteredItems).toHaveLength(1);
    expect(result.current.filteredItems[0]?.providers).toContain("instagram");
  });

  it("returns empty stats (EMPTY_STATS) while loading", () => {
    // Never resolves — keeps hook in loading state
    mockFetch.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useQueueManager({}), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.stats.total).toBe(0);
    expect(result.current.stats.successRate).toBe(100);
  });

  it("calls retryItem which POSTs to the retry endpoint", async () => {
    setupSuccessfulFetch();

    const { result } = renderHook(() => useQueueManager({}), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Mock the retry POST
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    // Also mock the subsequent refetch calls triggered by invalidation
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, value: MOCK_JOBS_RESPONSE }),
    });

    await act(async () => {
      await result.current.retryItem("job-3");
    });

    // Find the retry POST call
    const retryCall = mockFetch.mock.calls.find(
      ([url]) => typeof url === "string" && url.includes("job-3/retry")
    );
    expect(retryCall).toBeDefined();
    expect(retryCall?.[1]).toMatchObject({ method: "POST" });
  });

  it("calls deleteItem which POSTs to the remove endpoint", async () => {
    setupSuccessfulFetch();

    const { result } = renderHook(() => useQueueManager({}), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, value: MOCK_JOBS_RESPONSE }),
    });

    await act(async () => {
      await result.current.deleteItem("job-1");
    });

    const removeCall = mockFetch.mock.calls.find(
      ([url]) => typeof url === "string" && url.includes("job-1/remove")
    );
    expect(removeCall).toBeDefined();
    expect(removeCall?.[1]).toMatchObject({ method: "POST" });
  });

  it("invokes onQueueUpdate callback with derived stats", async () => {
    setupSuccessfulFetch();

    const onQueueUpdate = vi.fn();

    const { result } = renderHook(() => useQueueManager({ onQueueUpdate }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(onQueueUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        total: 3,
        failed: 1,
        published: 1,
        successRate: 66.7,
      })
    );
  });
});
