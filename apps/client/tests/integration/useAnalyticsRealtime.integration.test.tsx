/**
 * @file useAnalyticsRealtime.integration.test.tsx
 * @description Tests for the useAnalyticsRealtime SSE hook — same-origin EventSource
 *              URL + credentials, live-status flag, delta-merge into the dashboard
 *              query cache (mirrors the backend aggregation), ignoring the connected
 *              handshake and absolute snapshots, reconnect on error, and cleanup on
 *              unmount. EventSource is stubbed; no real network.
 * @layer infrastructure
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAnalyticsRealtime } from "../../hooks/useAnalyticsRealtime.js";
import type { AnalyticsDashboardData } from "../../hooks/api/useAnalytics.js";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  withCredentials: boolean;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent<string>) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  closed = false;

  constructor(url: string, opts?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = Boolean(opts?.withCredentials);
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  emitOpen(): void {
    this.onopen?.(new Event("open"));
  }

  emitMessage(data: string): void {
    this.onmessage?.({ data } as MessageEvent<string>);
  }

  emitError(): void {
    this.onerror?.(new Event("error"));
  }
}

const KEY = ["analytics", "dashboard", "proj-1", "30d"];

function makeDashboard(): AnalyticsDashboardData {
  return {
    overview: {
      totalPosts: 5,
      totalEngagement: 100,
      totalReach: 1000,
      totalImpressions: 1000,
      avgEngagementRate: 10,
      topPlatform: "X",
      growthThisWeek: 0,
      performanceScore: 100,
    },
    platformMetrics: [
      {
        platformId: "ch-1",
        platformName: "X",
        handle: "@acme",
        totalPosts: 5,
        totalEngagement: 100,
        totalReach: 1000,
        totalImpressions: 1000,
        totalClicks: 0,
        followerCount: 0,
        growthRate: 0,
        engagementRate: 10,
      },
    ],
    timeRange: "30d",
    dataPoints: 5,
  };
}

let queryClient: QueryClient;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("useAnalyticsRealtime", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("connects to the same-origin stream URL with credentials", () => {
    renderHook(() => useAnalyticsRealtime("proj-1", "30d"), { wrapper });
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]?.url).toBe(
      "/api/backend/analytics/stream?projectId=proj-1"
    );
    expect(FakeEventSource.instances[0]?.withCredentials).toBe(true);
  });

  it("is inert while projectId is empty", () => {
    renderHook(() => useAnalyticsRealtime("", "30d"), { wrapper });
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("marks the connection live on open", async () => {
    const { result } = renderHook(() => useAnalyticsRealtime("proj-1", "30d"), { wrapper });
    expect(result.current.isLive).toBe(false);
    act(() => FakeEventSource.instances[0]?.emitOpen());
    await waitFor(() => expect(result.current.isLive).toBe(true));
  });

  it("merges a delta event into the dashboard query cache", () => {
    queryClient.setQueryData(KEY, makeDashboard());
    renderHook(() => useAnalyticsRealtime("proj-1", "30d"), { wrapper });

    act(() =>
      FakeEventSource.instances[0]?.emitMessage(
        JSON.stringify({
          timestamp: "2026-05-23T00:00:00.000Z",
          postId: "post-1",
          provider: "X",
          metrics: { views: 1100, likes: 60, comments: 0, shares: 0, engagementRate: 5 },
          deltaMetrics: { views: 100, likes: 10, comments: 0, shares: 0 },
        })
      )
    );

    const updated = queryClient.getQueryData<AnalyticsDashboardData>(KEY);
    // engagement +10 (10 likes), reach +100 views — mirrors backend aggregation.
    expect(updated?.platformMetrics[0]?.totalEngagement).toBe(110);
    expect(updated?.platformMetrics[0]?.totalReach).toBe(1100);
    expect(updated?.overview.totalEngagement).toBe(110);
    expect(updated?.overview.totalReach).toBe(1100);
  });

  it("ignores the connected handshake and absolute snapshots (no delta)", () => {
    queryClient.setQueryData(KEY, makeDashboard());
    renderHook(() => useAnalyticsRealtime("proj-1", "30d"), { wrapper });

    act(() => {
      FakeEventSource.instances[0]?.emitMessage(JSON.stringify({ type: "connected" }));
      // Snapshot event: has metrics but no deltaMetrics → must NOT mutate the aggregate.
      FakeEventSource.instances[0]?.emitMessage(
        JSON.stringify({
          timestamp: "2026-05-23T00:00:00.000Z",
          postId: "post-1",
          provider: "X",
          metrics: { views: 9999, likes: 9999, comments: 0, shares: 0, engagementRate: 99 },
        })
      );
    });

    const after = queryClient.getQueryData<AnalyticsDashboardData>(KEY);
    expect(after?.platformMetrics[0]?.totalEngagement).toBe(100); // unchanged
    expect(after?.overview.totalReach).toBe(1000); // unchanged
  });

  it("reconnects after an error with a backoff", () => {
    vi.useFakeTimers();
    renderHook(() => useAnalyticsRealtime("proj-1", "30d"), { wrapper });
    expect(FakeEventSource.instances).toHaveLength(1);

    act(() => FakeEventSource.instances[0]?.emitError());
    expect(FakeEventSource.instances[0]?.closed).toBe(true);

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it("closes the connection on unmount", () => {
    const { unmount } = renderHook(() => useAnalyticsRealtime("proj-1", "30d"), { wrapper });
    const es = FakeEventSource.instances[0];
    unmount();
    expect(es?.closed).toBe(true);
  });
});
