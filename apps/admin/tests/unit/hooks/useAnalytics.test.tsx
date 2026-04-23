/**
 * Tests for useAnalytics.
 *
 * The hook performs 3 parallel fetches (analytics metrics, dashboard stats,
 * billing stats) via an internal fetchJSON helper that silently returns `{}`
 * on non-ok responses (no throw). All tests mock all 3 fetches explicitly.
 *
 * @file useAnalytics.test.tsx
 * @description Tests for useAnalytics
 * @layer infrastructure
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

const MOCK_DASHBOARD_STATS = {
  accounts: { total: 100, active: 80 },
  subscriptions: { active: 50, trialing: 10 },
  projects: 250,
};

const MOCK_BILLING_STATS = {
  totalRevenue: { mrr: 10000, arr: 120000 },
  growthMetrics: { mrrGrowth: 0.1 },
  churnRisk: {},
  statusDistribution: {},
};

/** Mock the 3 parallel fetchJSON calls the hook performs. */
function mockParallelFetches(
  analytics: unknown = MOCK_BACKEND_METRICS,
  dashboard: unknown = MOCK_DASHBOARD_STATS,
  billing: unknown = MOCK_BILLING_STATS
) {
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes("/admin/analytics/metrics")) {
      return { ok: true, json: async () => ({ data: analytics }) };
    }
    if (url.includes("/admin/dashboard/stats")) {
      return { ok: true, json: async () => ({ data: dashboard }) };
    }
    if (url.includes("/admin/billing/stats")) {
      return { ok: true, json: async () => ({ data: billing }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

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
    mockParallelFetches();

    const { result } = renderHook(() => useAnalytics(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const data = result.current.data as AnalyticsSummary;
    expect(data.operationalMetrics.activeUsers).toBe(80);
    expect(data.growthMetrics.trialConversions).toBe(0.15);
    expect(data.platformMetrics.totalAccounts).toBe(100);
    expect(data.platformMetrics.activeAccounts).toBe(80);
    expect(data.platformMetrics.totalProjects).toBe(250);
    expect(data.trends.period).toBe("30d");
  });

  it("calls the correct URLs with startDate/endDate params", async () => {
    mockParallelFetches();

    const { result } = renderHook(() => useAnalytics("7d"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const calls = mockFetch.mock.calls.map((c) => c[0] as string);
    const metricsCall = calls.find((u) => u.includes("/admin/analytics/metrics"));
    expect(metricsCall).toBeDefined();
    expect(metricsCall).toContain("/api/backend/admin/analytics/metrics");
    expect(metricsCall).toContain("startDate=");
    expect(metricsCall).toContain("endDate=");

    expect(calls.some((u) => u.includes("/api/backend/admin/dashboard/stats"))).toBe(true);
    expect(calls.some((u) => u.includes("/api/backend/admin/billing/stats"))).toBe(true);
  });

  it("uses the timeRange in the query key", async () => {
    mockParallelFetches();

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

  it("surfaces the error via TanStack Query when the analytics endpoint fails", async () => {
    // Only the analytics endpoint fails; dashboard + billing still succeed.
    // After the T2-C fix fetchJSON throws on !res.ok, so the query must expose
    // the failure through isError instead of silently returning partial data.
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes("/admin/analytics/metrics")) {
        return {
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          json: async () => ({}),
        };
      }
      if (url.includes("/admin/dashboard/stats")) {
        return { ok: true, json: async () => ({ data: MOCK_DASHBOARD_STATS }) };
      }
      return { ok: true, json: async () => ({ data: MOCK_BILLING_STATS }) };
    });

    const { result } = renderHook(() => useAnalytics(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect((result.current.error as Error).message).toContain("Analytics request failed: 500");
  });

  it("succeeds with empty payload when body.data is absent", async () => {
    mockFetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({}),
    }));

    const { result } = renderHook(() => useAnalytics(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeDefined();
  });

  it("maps trends.period to the supplied timeRange", async () => {
    mockParallelFetches();

    const { result } = renderHook(() => useAnalytics("7d"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.trends.period).toBe("7d");
  });
});
