/**
 * Tests for useUniversalAnalytics
 *
 * The hook calls fetch directly to /api/backend/dashboard with projectId and
 * timeRange query params. We mock global.fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import {
  useUniversalAnalytics,
  type AnalyticsDashboardData,
} from "@/hooks/api/useUniversalAnalytics";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const MOCK_DASHBOARD: AnalyticsDashboardData = {
  overview: {
    totalPosts: 42,
    totalEngagement: 1500,
    totalReach: 25000,
    totalImpressions: 25000,
    avgEngagementRate: 6.0,
    topPlatform: "INSTAGRAM",
    growthThisWeek: 0,
    performanceScore: 60,
  },
  platformMetrics: [
    {
      platformId: "ch-1",
      platformName: "INSTAGRAM",
      handle: "@testaccount",
      totalPosts: 20,
      totalEngagement: 800,
      totalReach: 12000,
      totalImpressions: 12000,
      totalClicks: 0,
      followerCount: 0,
      growthRate: 0,
      engagementRate: 6.67,
    },
    {
      platformId: "ch-2",
      platformName: "X",
      handle: "@xaccount",
      totalPosts: 22,
      totalEngagement: 700,
      totalReach: 13000,
      totalImpressions: 13000,
      totalClicks: 0,
      followerCount: 0,
      growthRate: 0,
      engagementRate: 5.38,
    },
  ],
  timeRange: "7d",
  dataPoints: 100,
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

describe("useUniversalAnalytics", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches dashboard data and returns AnalyticsDashboardData on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, value: MOCK_DASHBOARD }),
    });

    const { result } = renderHook(() => useUniversalAnalytics({ projectId: "proj-abc" }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(MOCK_DASHBOARD);
    expect(result.current.data?.overview.totalPosts).toBe(42);
    expect(result.current.data?.platformMetrics).toHaveLength(2);
  });

  it("calls the correct URL with projectId and timeRange params", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, value: MOCK_DASHBOARD }),
    });

    const { result } = renderHook(
      () => useUniversalAnalytics({ projectId: "proj-abc", timeRange: "30d" }),
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("/api/backend/dashboard");
    expect(url).toContain("projectId=proj-abc");
    expect(url).toContain("timeRange=30d");
  });

  it("defaults timeRange to 7d when not specified", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, value: MOCK_DASHBOARD }),
    });

    const { result } = renderHook(() => useUniversalAnalytics({ projectId: "proj-abc" }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("timeRange=7d");
  });

  it("throws when HTTP response is not ok", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const { result } = renderHook(() => useUniversalAnalytics({ projectId: "proj-abc" }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 5000 });
    expect((result.current.error as Error).message).toContain("HTTP 500");
  });

  it("throws when body.ok is false with error message", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: "Project not found" }),
    });

    const { result } = renderHook(() => useUniversalAnalytics({ projectId: "proj-invalid" }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 5000 });
    expect((result.current.error as Error).message).toBe("Project not found");
  });

  it("does not fetch when enabled is false", async () => {
    const { result } = renderHook(
      () => useUniversalAnalytics({ projectId: "proj-abc", enabled: false }),
      { wrapper: createWrapper() }
    );

    // Should remain in idle/loading state but never actually fetch
    expect(result.current.isFetching).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not fetch when projectId is empty", async () => {
    const { result } = renderHook(() => useUniversalAnalytics({ projectId: "" }), {
      wrapper: createWrapper(),
    });

    expect(result.current.isFetching).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("uses [universal-analytics, projectId, timeRange] as the query key", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, value: MOCK_DASHBOARD }),
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(
      () => useUniversalAnalytics({ projectId: "proj-abc", timeRange: "30d" }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(["universal-analytics", "proj-abc", "30d"])).toEqual(
      MOCK_DASHBOARD
    );
  });

  it("returns platform metrics with correct structure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, value: MOCK_DASHBOARD }),
    });

    const { result } = renderHook(() => useUniversalAnalytics({ projectId: "proj-abc" }), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const instagram = result.current.data?.platformMetrics[0];
    expect(instagram?.platformName).toBe("INSTAGRAM");
    expect(instagram?.handle).toBe("@testaccount");
    expect(instagram?.totalEngagement).toBe(800);
    expect(instagram?.engagementRate).toBe(6.67);
  });
});
