/**
 * @file useAnalyticsRealtime.ts
 * @description React hook that opens an SSE connection to the analytics metrics
 *              stream and merges per-cycle deltas into the TanStack Query cache
 *              that backs the analytics dashboard. The 30s REST poll
 *              (`useAnalytics`) re-baselines to absolute truth; this hook provides
 *              the in-between liveness by applying deltas, so the numbers tick live
 *              and self-correct every cycle.
 *
 *              Connects through the same-origin Next proxy (`/api/backend/...`),
 *              which streams `text/event-stream` and injects the Bearer token from
 *              the httpOnly `customer-session` cookie.
 * @hook useAnalyticsRealtime
 * @layer infrastructure
 */

"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AnalyticsDashboardData } from "./api/useAnalytics.js";

const RECONNECT_DELAY_MS = 3_000;

/** Per-post metric event pushed by the analytics SSE stream. */
interface AnalyticsMetricEvent {
  timestamp: string;
  postId: string;
  provider: string;
  metrics: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    engagementRate: number;
  };
  deltaMetrics?: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
  };
}

/**
 * Apply a per-cycle delta to the cached dashboard data. Mirrors the backend
 * aggregation (`getDashboard`): a platform's `totalEngagement` is likes+comments
 * +shares and `totalReach`/`totalImpressions` are views; the engagement rate is
 * engagement/views*100. Only the provider matching the event is touched.
 */
function mergeDelta(
  old: AnalyticsDashboardData | undefined,
  event: AnalyticsMetricEvent
): AnalyticsDashboardData | undefined {
  if (!old || !event.deltaMetrics) return old;
  const delta = event.deltaMetrics;
  const engagementDelta = delta.likes + delta.comments + delta.shares;

  const platformMetrics = old.platformMetrics.map((p) => {
    if (p.platformName !== event.provider) return p;
    const totalEngagement = p.totalEngagement + engagementDelta;
    const totalReach = p.totalReach + delta.views;
    const totalImpressions = p.totalImpressions + delta.views;
    const engagementRate =
      totalReach > 0 ? Number(((totalEngagement / totalReach) * 100).toFixed(2)) : p.engagementRate;
    return { ...p, totalEngagement, totalReach, totalImpressions, engagementRate };
  });

  const totalEngagement = old.overview.totalEngagement + engagementDelta;
  const totalReach = old.overview.totalReach + delta.views;
  const totalImpressions = old.overview.totalImpressions + delta.views;
  const avgEngagementRate =
    totalReach > 0
      ? Number(((totalEngagement / totalReach) * 100).toFixed(2))
      : old.overview.avgEngagementRate;

  return {
    ...old,
    platformMetrics,
    overview: { ...old.overview, totalEngagement, totalReach, totalImpressions, avgEngagementRate },
  };
}

/**
 * @hook useAnalyticsRealtime
 * @description Streams live analytics metric deltas for a project and merges them
 *              into the dashboard query cache. Returns connection liveness.
 * @param projectId - Project to stream. The hook is inert while empty.
 * @param timeRange - Must match the `useAnalytics` window so the same cache entry
 *                    is updated. Default "30d".
 * @param enabled - Set false to disable (e.g. when logged out).
 * @returns `{ isLive, lastEventAt }` — connection status and last-event timestamp.
 */
export function useAnalyticsRealtime(
  projectId: string,
  timeRange: string = "30d",
  enabled = true
): { isLive: boolean; lastEventAt: number | null } {
  const queryClient = useQueryClient();
  const [isLive, setIsLive] = useState(false);
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled || !projectId) return;

    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let active = true;

    function connect(): void {
      if (!active) return;

      es = new EventSource(
        `/api/backend/analytics/stream?projectId=${encodeURIComponent(projectId)}`,
        { withCredentials: true }
      );

      es.onopen = () => {
        setIsLive(true);
      };

      es.onmessage = (event: MessageEvent<string>) => {
        if (!event.data || event.data === ":heartbeat") return;

        let parsed: unknown;
        try {
          parsed = JSON.parse(event.data);
        } catch {
          return;
        }

        // Ignore the {"type":"connected"} handshake and any non-metric frame.
        const metricEvent = parsed as AnalyticsMetricEvent;
        if (!metricEvent || !metricEvent.metrics || !metricEvent.postId) return;

        setLastEventAt(Date.now());

        // Only deltas mutate the aggregate; the initial absolute snapshots are
        // already reflected by the 30s REST poll, so applying them would double-count.
        if (!metricEvent.deltaMetrics) return;

        queryClient.setQueryData<AnalyticsDashboardData>(
          ["analytics", "dashboard", projectId, timeRange],
          (old) => mergeDelta(old, metricEvent)
        );
      };

      es.onerror = () => {
        setIsLive(false);
        es?.close();
        es = null;
        if (active) {
          reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };
    }

    connect();

    return () => {
      active = false;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      es?.close();
      setIsLive(false);
    };
  }, [enabled, projectId, timeRange, queryClient]);

  return { isLive, lastEventAt };
}
