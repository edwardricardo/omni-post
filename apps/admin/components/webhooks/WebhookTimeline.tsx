"use client";

/**
 * @file WebhookTimeline.tsx
 * @description Real-time webhook event timeline chart that visualizes event throughput, success
 * vs failure rates over time, with optional live-streaming via server-sent events.
 */

import { useState, useEffect, useRef } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
  Button,
} from "@packages/ui";
import { TrendingUp, TrendingDown, Activity, AlertCircle, Play, Pause } from "lucide-react";

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
      eventSourceRef.current = new EventSource("/api/webhooks/dashboard/stream", {
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

  const maxTotal = Math.max(...realtimeData.map((d) => d.total));
  const totalEvents = realtimeData.reduce((sum, d) => sum + d.total, 0);
  const totalSuccess = realtimeData.reduce((sum, d) => sum + d.success, 0);
  const totalFailed = realtimeData.reduce((sum, d) => sum + d.failed, 0);
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
      return <TrendingUp className="h-4 w-4 text-green-600" />;
    } else if (recentAvg < olderAvg * 0.9) {
      return <TrendingDown className="h-4 w-4 text-red-600" />;
    }
    return <Activity className="h-4 w-4 text-gray-600" />;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center space-x-2">
              <span>Webhook Timeline</span>
              {getTrendIcon()}
            </CardTitle>
            <CardDescription>
              Event processing over time ({timeRange})
              {isRealTime && (
                <Badge variant="default" className="ml-2 bg-green-100 text-green-800">
                  Live
                </Badge>
              )}
            </CardDescription>
          </div>

          <div className="flex items-center space-x-4">
            {/* Summary Stats */}
            <div className="text-right">
              <div className="text-sm text-gray-600">Success Rate</div>
              <div
                className={`text-lg font-semibold ${
                  successRate >= 95
                    ? "text-green-600"
                    : successRate >= 90
                      ? "text-yellow-600"
                      : "text-red-600"
                }`}
              >
                {successRate.toFixed(1)}%
              </div>
            </div>

            <Button
              onClick={toggleRealTime}
              variant={isRealTime ? "default" : "outline"}
              size="sm"
              className="flex items-center space-x-2"
            >
              {isRealTime ? (
                <>
                  <Pause className="h-4 w-4" />
                  <span>Pause</span>
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  <span>Live</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Quick Stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{totalEvents.toLocaleString()}</div>
              <div className="text-sm text-gray-600">Total Events</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {totalSuccess.toLocaleString()}
              </div>
              <div className="text-sm text-gray-600">Successful</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">{totalFailed.toLocaleString()}</div>
              <div className="text-sm text-gray-600">Failed</div>
            </div>
          </div>

          {/* Timeline Chart */}
          <div className="h-64 w-full" ref={chartRef}>
            {realtimeData.length > 0 ? (
              <div className="h-full flex items-end space-x-1 overflow-x-auto">
                {realtimeData.map((point, index) => {
                  const totalHeight = maxTotal > 0 ? (point.total / maxTotal) * 200 : 0;
                  const successHeight =
                    point.total > 0 ? (point.success / point.total) * totalHeight : 0;
                  const failedHeight = totalHeight - successHeight;

                  return (
                    <div key={index} className="flex flex-col items-center min-w-[20px] group">
                      {/* Bar */}
                      <div className="relative w-4 flex flex-col justify-end h-48">
                        {point.total > 0 && (
                          <div className="w-full bg-gray-100 rounded-t-sm relative">
                            {/* Failed portion (red) */}
                            {failedHeight > 0 && (
                              <div
                                className="w-full bg-red-500 rounded-t-sm"
                                style={{ height: `${failedHeight}px` }}
                              />
                            )}
                            {/* Success portion (green) */}
                            {successHeight > 0 && (
                              <div
                                className="w-full bg-green-500"
                                style={{
                                  height: `${successHeight}px`,
                                  ...(failedHeight === 0 && {
                                    borderTopLeftRadius: "2px",
                                    borderTopRightRadius: "2px",
                                  }),
                                }}
                              />
                            )}
                          </div>
                        )}
                      </div>

                      {/* Time Label */}
                      <div className="text-xs text-gray-500 mt-1 transform -rotate-45 origin-left">
                        {formatTimeLabel(point.timestamp, index)}
                      </div>

                      {/* Tooltip */}
                      <div className="opacity-0 group-hover:opacity-100 absolute bottom-full mb-2 bg-black text-white text-xs rounded-sm px-2 py-1 z-10 whitespace-nowrap">
                        <div>Total: {point.total}</div>
                        <div>Success: {point.success}</div>
                        <div>Failed: {point.failed}</div>
                        <div>{new Date(point.timestamp).toLocaleString()}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-500">
                <div className="text-center">
                  <AlertCircle className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                  <p>No data available for this time range</p>
                </div>
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="flex items-center justify-center space-x-6 text-sm">
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-green-500 rounded-sm"></div>
              <span>Successful</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-red-500 rounded-sm"></div>
              <span>Failed</span>
            </div>
          </div>

          {/* Real-time Status */}
          {isRealTime && (
            <div className="flex items-center justify-center text-sm text-gray-600">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span>Receiving live updates</span>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
