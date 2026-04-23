/**
 * Tests for usePerformanceInsights
 *
 * The hook calls fetch directly to /api/backend/admin/analytics/overview
 * with an optional projectId param. We mock global.fetch.
 *
 * @file usePerformanceInsights.test.tsx
 * @description Tests for usePerformanceInsights
 * @layer infrastructure
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { usePerformanceInsights } from "@/hooks/api/usePerformanceInsights";
import type { DashboardInsightsData } from "@/hooks/api/usePerformanceInsights";

const mockFetch = vi.fn();
global.fetch = mockFetch;

const MOCK_INSIGHTS: DashboardInsightsData = {
  engagement: {
    totalEngagements: 12000,
    averageEngagementRate: 0.065,
    topEngagingContent: [
      {
        id: "post-1",
        content: "Top performing post",
        platform: "instagram",
        engagementRate: 0.12,
        publishedAt: "2026-02-20T09:00:00.000Z",
      },
    ],
  },
  timeSeries: [
    { date: "2026-02-20", impressions: 5000, engagement: 320, clicks: 80 },
    { date: "2026-02-21", impressions: 6000, engagement: 400, clicks: 100 },
  ],
  topPosts: [{ id: "post-1", content: "Top post", platform: "instagram", score: 98 }],
  mediaPerformance: [
    { type: "image", avgEngagement: 0.09, postCount: 30 },
    { type: "video", avgEngagement: 0.15, postCount: 10 },
  ],
  optimalTiming: [
    { platform: "x", dayOfWeek: 2, hour: 9, engagementMultiplier: 1.4, confidence: 0.88 },
  ],
  hashtagPerformance: [
    { hashtag: "#tech", usage: 50, avgEngagement: 0.08, trending: true, effectiveness: "high" },
  ],
  audienceInsights: [
    {
      platformId: "instagram",
      totalFollowers: 10000,
      growthRate: 0.05,
    },
  ],
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

describe("usePerformanceInsights", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches insights and returns DashboardInsightsData on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, value: MOCK_INSIGHTS }),
    });

    const { result } = renderHook(() => usePerformanceInsights("proj-abc"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(MOCK_INSIGHTS);
    expect(result.current.data?.engagement?.totalEngagements).toBe(12000);
  });

  it("calls the correct URL with projectId param", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, value: MOCK_INSIGHTS }),
    });

    const { result } = renderHook(() => usePerformanceInsights("proj-abc"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toContain("/api/backend/admin/analytics/overview");
    expect(url).toContain("projectId=proj-abc");
  });

  it("accepts { value: { data: ... } } envelope (alternate API shape)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, value: { data: MOCK_INSIGHTS } }),
    });

    const { result } = renderHook(() => usePerformanceInsights("proj-abc"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // The hook unwraps body.value?.data first
    expect(result.current.data?.engagement?.totalEngagements).toBe(12000);
  });

  it("throws when HTTP response is not ok", async () => {
    // The hook specifies retry: 2, so provide a persistent failure to avoid
    // the 1-second default retry delay exhausting the default waitFor timeout.
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const { result } = renderHook(() => usePerformanceInsights("proj-abc"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 5000 });
    expect((result.current.error as Error).message).toContain("HTTP 500");
  });

  it("throws when body.ok is false", async () => {
    // Provide persistent failure for all retry attempts (retry: 2 in hook)
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: false, error: { message: "Forbidden" } }),
    });

    const { result } = renderHook(() => usePerformanceInsights("proj-abc"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 5000 });
    expect((result.current.error as Error).message).toBe("Forbidden");
  });

  it("uses [performance-insights, projectId] as the query key", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, value: MOCK_INSIGHTS }),
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => usePerformanceInsights("proj-abc"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(["performance-insights", "proj-abc"])).toEqual(MOCK_INSIGHTS);
  });
});
