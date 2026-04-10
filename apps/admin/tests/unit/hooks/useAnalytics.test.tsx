/**
 * Tests for useAnalytics
 *
 * The hook calls fetch directly to /api/backend/api/admin/analytics/metrics
 * with computed date-range params. We mock global.fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { useAnalytics } from "@/hooks/api/useAnalytics";
import type { AnalyticsSummary } from "@/hooks/api/useAnalytics";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const MOCK_BACKEND_METRICS = {
  period: { startDate: "2026-01-25T00:00:00.000Z", endDate: "2026-02-24T00:00:00.000Z" },
  accounts: { total: 100, active: 80, trialRatio: 0.15 },
  projects: { total: 250 },
  posts: { total: 1000, published: 750, scheduled: 100, draft: 150, successRate: 0.95 },
  channels: { total: 320, byProvider: { x: 120, instagram: 100, facebook: 100 } },
  engagement: {
    totalViews: 500000,
    totalLikes: 25000,
    totalComments: 3000,
    totalShares: 8000,
    totalEngagement: 36000,
    engagementRate: 0.072,
    averageViews: 500,
    averageLikes: 25,
    averageComments: 3,
    averageShares: 8,
  },
  generatedAt: "2026-02-24T00:00:00.000Z",
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
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches and maps analytics metrics for default 30d range", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, data: MOCK_BACKEND_METRICS }),
    });

    const { result } = renderHook(() => useAnalytics(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const data = result.current.data as AnalyticsSummary;
    expect(data.operationalMetrics.activeUsers).toBe(80); // mapped from accounts.active
    expect(data.growthMetrics.trialConversions).toBe(0.15); // mapped from accounts.trialRatio
    expect(data.dashboardStats?.accounts.total).toBe(100);
    expect(data.dashboardStats?.accounts.active).toBe(80);
    expect(data.dashboardStats?.projects).toBe(250);
    expect(data.trends.period).toBe("30d");
  });

  it("calls the correct URL with startDate/endDate params", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, data: MOCK_BACKEND_METRICS }),
    });

    const { result } = renderHook(() => useAnalytics("7d"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [calledUrl] = mockFetch.mock.calls[0] as [string];
    expect(calledUrl).toContain("/api/backend/api/admin/analytics/metrics");
    expect(calledUrl).toContain("startDate=");
    expect(calledUrl).toContain("endDate=");
  });

  it("uses the timeRange in the query key", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, data: MOCK_BACKEND_METRICS }),
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useAnalytics("90d"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cached = queryClient.getQueryData(["analytics", "summary", "90d"]);
    expect(cached).toBeDefined();
  });

  it("throws when HTTP response is not ok", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    const { result } = renderHook(() => useAnalytics(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain("HTTP 500");
  });

  it("throws when body.ok is false", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: false, data: null }),
    });

    const { result } = renderHook(() => useAnalytics(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("Failed to fetch analytics metrics");
  });

  it("maps trends.period to the supplied timeRange", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, data: MOCK_BACKEND_METRICS }),
    });

    const { result } = renderHook(() => useAnalytics("7d"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.trends.period).toBe("7d");
  });
});
