"use client";

/**
 * @file WebhookTimeline.tsx
 * @description Real-time webhook event timeline chart that visualizes event throughput, success
 * vs failure rates over time, with optional live-streaming via server-sent events.
 */

import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/Badge";
import { ActionButton } from "@/components/ui/ActionButton";
import { StackedBarChart } from "@/components/charts";
import { useChartColors } from "@/hooks/useChartColors";
import { TrendingUp, TrendingDown, Activity, Play, Pause } from "lucide-react";

interface TimelineDataPoint {
  timestamp: string;
  total: number;
  success: number;
  failed: number;
}

interface WebhookTimelineProps {
  data: TimelineDataPoint[];
  timeRange: string;
}

export function WebhookTimeline({ data, timeRange }: WebhookTimelineProps) {
  const tt = useTranslations("webhooks.timeline");
  const tc = useTranslations("common");
  const [isRealTime, setIsRealTime] = useState(false);
  const [realtimeData, setRealtimeData] = useState<TimelineDataPoint[]>(data);
  const eventSourceRef = useRef<EventSource | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  // Update local data when props change
  useEffect(() => {
    setRealtimeData(data);
  }, [data]);

  // Real-time updates
  useEffect(() => {
    if (isRealTime) {
      // Connect to Server-Sent Events for real-time updates
      eventSourceRef.current = new EventSource("/api/backend/api/webhooks/dashboard/stream", {
        withCredentials: true,
      });

      eventSourceRef.current.onmessage = (event) => {
        try {
          const eventData = JSON.parse(event.data);

          if (eventData.type === "webhook_event") {
            // Update the timeline with new data point
            setRealtimeData((prev) => {
              const now = new Date().toISOString();
              const lastPoint = prev[prev.length - 1];

              // If the last point is from the current minute, update it
              if (
                lastPoint &&
                new Date(lastPoint.timestamp).getMinutes() === new Date().getMinutes()
              ) {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  ...lastPoint,
                  total: lastPoint.total + 1,
                  success: eventData.success ? lastPoint.success + 1 : lastPoint.success,
                  failed: eventData.success ? lastPoint.failed : lastPoint.failed + 1,
                };
                return updated;
              } else {
                // Add new data point
                const newPoint: TimelineDataPoint = {
                  timestamp: now,
                  total: 1,
                  success: eventData.success ? 1 : 0,
                  failed: eventData.success ? 0 : 1,
                };

                // Keep only last 24 points
                return [...prev.slice(-23), newPoint];
              }
            });
          }
        } catch {
          // Malformed SSE event — skip
        }
      };

      eventSourceRef.current.onerror = () => {
        setIsRealTime(false);
      };

      return () => {
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
        }
      };
    } else {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    }
  }, [isRealTime]);

  const toggleRealTime = () => {
    setIsRealTime(!isRealTime);
  };

  const colors = useChartColors();

  const totalEvents = realtimeData.reduce((sum, d) => sum + Number(d.total), 0);
  const totalSuccess = realtimeData.reduce((sum, d) => sum + Number(d.success), 0);
  const totalFailed = realtimeData.reduce((sum, d) => sum + Number(d.failed), 0);
  const successRate = totalEvents > 0 ? (totalSuccess / totalEvents) * 100 : 0;

  const formatTimeLabel = (timestamp: string, index: number) => {
    const date = new Date(timestamp);

    if (timeRange === "1h" || timeRange === "6h") {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } else if (timeRange === "24h") {
      return index % 4 === 0
        ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : "";
    } else {
      return index % 6 === 0 ? date.toLocaleDateString([], { month: "short", day: "numeric" }) : "";
    }
  };

  const getTrendIcon = () => {
    if (realtimeData.length < 2) return null;

    const recent = realtimeData.slice(-5);
    const older = realtimeData.slice(-10, -5);

    const recentAvg = recent.reduce((sum, d) => sum + d.total, 0) / recent.length;
    const olderAvg = older.reduce((sum, d) => sum + d.total, 0) / older.length;

    if (recentAvg > olderAvg * 1.1) {
      return <TrendingUp className="h-4 w-4 text-[var(--success)]" />;
    } else if (recentAvg < olderAvg * 0.9) {
      return <TrendingDown className="h-4 w-4 text-[var(--error)]" />;
    }
    return <Activity className="h-4 w-4 text-[var(--text-secondary)]" />;
  };

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="flex items-center space-x-2 text-base font-semibold text-[var(--text-primary)]">
              <span>{tt("title")}</span>
              {getTrendIcon()}
            </h3>
            <p className="text-sm text-[var(--text-secondary)]">
              {tt("description", { range: timeRange })}
              {isRealTime && (
                <Badge variant="success" size="sm">
                  Live
                </Badge>
              )}
            </p>
          </div>

          <div className="flex items-center space-x-4">
            {/* Summary Stats */}
            <div className="text-right">
              <div className="text-sm text-[var(--text-secondary)]">{tt("successRate")}</div>
              <div
                className={`text-lg font-semibold ${
                  successRate >= 95
                    ? "text-[var(--success)]"
                    : successRate >= 90
                      ? "text-[var(--warning)]"
                      : "text-[var(--error)]"
                }`}
              >
                {successRate.toFixed(1)}%
              </div>
            </div>

            <ActionButton
              onClick={toggleRealTime}
              variant={isRealTime ? "primary" : "secondary"}
              size="sm"
            >
              {isRealTime ? (
                <>
                  <Pause className="h-4 w-4" />
                  <span>{tt("pause")}</span>
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  <span>{tc("live")}</span>
                </>
              )}
            </ActionButton>
          </div>
        </div>
      </div>
      <div className="p-4 pt-0">
        <div className="space-y-4">
          {/* Quick Stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-[var(--accent)]">
                {totalEvents.toLocaleString()}
              </div>
              <div className="text-sm text-[var(--text-secondary)]">{tt("totalEvents")}</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-[var(--success)]">
                {totalSuccess.toLocaleString()}
              </div>
              <div className="text-sm text-[var(--text-secondary)]">{tt("successful")}</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-[var(--error)]">
                {totalFailed.toLocaleString()}
              </div>
              <div className="text-sm text-[var(--text-secondary)]">{tt("failed")}</div>
            </div>
          </div>

          {/* Timeline Chart */}
          <div ref={chartRef}>
            <StackedBarChart
              data={realtimeData.map((point) => ({
                label: formatTimeLabel(point.timestamp, 0),
                success: point.success,
                failed: point.failed,
              }))}
              series={[
                { key: "success", color: colors.success, name: tt("legendSuccessful") },
                { key: "failed", color: colors.error, name: tt("legendFailed") },
              ]}
              height={256}
              emptyMessage={tt("noData")}
            />
          </div>

          {/* Real-time Status */}
          {isRealTime && (
            <div className="flex items-center justify-center text-sm text-[var(--text-secondary)]">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-[var(--success)] rounded-full animate-pulse"></div>
                <span>{tt("receivingLive")}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
