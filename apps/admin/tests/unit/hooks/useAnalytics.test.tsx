/**
 * Tests for useAnalytics
 *
 * The hook delegates to api.admin.getAnalyticsOverview() from @/lib/apiClient.
 * We mock the api module to isolate the hook behaviour.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/lib/apiClient", () => ({
  api: {
    admin: {
      getAnalyticsOverview: vi.fn(),
    },
  },
}));

import { useAnalytics } from "@/hooks/api/useAnalytics";
import { api } from "@/lib/apiClient";

const mockGetAnalyticsOverview = vi.mocked(api.admin.getAnalyticsOverview);

const MOCK_ANALYTICS_RESPONSE = {
  ok: true,
  data: {
    overview: { totalPosts: 120, publishedPosts: 95, draftPosts: 25 },
    revenue: { monthly: 5000, yearly: 60000 },
    subscriptions: { basic: 10, pro: 20, enterprise: 5 },
    activity: { activeUsers: 30 },
    geographic: [],
    features: [],
  },
  timestamp: "2026-02-24T00:00:00.000Z",
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe("useAnalytics", () => {
  beforeEach(() => {
    mockGetAnalyticsOverview.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the full response when api returns ok: true", async () => {
    mockGetAnalyticsOverview.mockResolvedValueOnce(MOCK_ANALYTICS_RESPONSE);

    const { result } = renderHook(() => useAnalytics(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // The hook returns response directly (not response.data)
    expect(result.current.data).toEqual(MOCK_ANALYTICS_RESPONSE);
    expect(mockGetAnalyticsOverview).toHaveBeenCalledTimes(1);
  });

  it("throws when api returns ok: false", async () => {
    mockGetAnalyticsOverview.mockResolvedValueOnce({
      ok: false,
      data: null as never,
      timestamp: "",
    });

    const { result } = renderHook(() => useAnalytics(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("Failed to fetch analytics");
  });

  it("propagates rejection when getAnalyticsOverview throws", async () => {
    mockGetAnalyticsOverview.mockRejectedValueOnce(new Error("HTTP 503: service unavailable"));

    const { result } = renderHook(() => useAnalytics(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain("503");
  });

  it("uses the correct query key [analytics, overview]", async () => {
    mockGetAnalyticsOverview.mockResolvedValueOnce(MOCK_ANALYTICS_RESPONSE);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useAnalytics(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cached = queryClient.getQueryData(["analytics", "overview"]);
    expect(cached).toEqual(MOCK_ANALYTICS_RESPONSE);
  });

  it("starts loading before data arrives", () => {
    mockGetAnalyticsOverview.mockReturnValueOnce(new Promise(() => {}));

    const { result } = renderHook(() => useAnalytics(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });
});
