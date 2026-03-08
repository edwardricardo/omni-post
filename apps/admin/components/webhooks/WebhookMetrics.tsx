"use client";

/**
 * @file WebhookMetrics.tsx
 * @description Webhook performance metrics dashboard displaying success rates, processing times,
 * queue depth, real-time connections, and per-provider breakdown statistics.
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Progress,
  Badge,
} from "@packages/ui";
import { TrendingUp, TrendingDown, Activity, Clock, Zap, AlertTriangle } from "lucide-react";

interface WebhookMetricsProps {
  metrics: {
    totalEvents: number;
    processedEvents: number;
    failedEvents: number;
    successRate: number;
    avgProcessingTime: number;
    queueDepth: number;
    realtimeConnections: number;
    byProvider: Record<
      string,
      {
        total: number;
        success: number;
        failed: number;
        successRate: number;
        avgProcessingTime: number;
      }
    >;
    byEventType: Record<string, number>;
  };
}

export function WebhookMetrics({ metrics }: WebhookMetricsProps) {
  const getPerformanceStatus = (successRate: number) => {
    if (successRate >= 99)
      return { status: "excellent", color: "text-green-600", icon: TrendingUp };
    if (successRate >= 95) return { status: "good", color: "text-green-500", icon: TrendingUp };
    if (successRate >= 90)
      return { status: "warning", color: "text-yellow-500", icon: TrendingDown };
    return { status: "critical", color: "text-red-500", icon: AlertTriangle };
  };

  const performance = getPerformanceStatus(metrics.successRate);
  const StatusIcon = performance.icon;

  const getProcessingTimeStatus = (avgTime: number) => {
    if (avgTime < 100) return "text-green-600";
    if (avgTime < 500) return "text-yellow-600";
    return "text-red-600";
  };

  const topProviders = Object.entries(metrics.byProvider)
    .sort(([, a], [, b]) => b.total - a.total)
    .slice(0, 5);

  const topEventTypes = Object.entries(metrics.byEventType)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Performance Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Activity className="h-5 w-5" />
            <span>Performance Overview</span>
          </CardTitle>
          <CardDescription>Webhook processing health and performance metrics</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Success Rate */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Success Rate</span>
              <div className="flex items-center space-x-2">
                <StatusIcon className={`h-4 w-4 ${performance.color}`} />
                <span className={`font-semibold ${performance.color}`}>
                  {metrics.successRate.toFixed(1)}%
                </span>
              </div>
            </div>
            <Progress value={metrics.successRate} className="h-2" />
            <p className="text-xs text-gray-500">
              {metrics.processedEvents.toLocaleString()} successful out of{" "}
              {metrics.totalEvents.toLocaleString()} total
            </p>
          </div>

          {/* Processing Time */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Avg Processing Time</span>
              <div className="flex items-center space-x-2">
                <Clock className="h-4 w-4 text-gray-400" />
                <span
                  className={`font-semibold ${getProcessingTimeStatus(metrics.avgProcessingTime)}`}
                >
                  {metrics.avgProcessingTime.toFixed(0)}ms
                </span>
              </div>
            </div>
            <div className="text-xs text-gray-500">
              {metrics.avgProcessingTime < 100 && "🟢 Excellent response times"}
              {metrics.avgProcessingTime >= 100 &&
                metrics.avgProcessingTime < 500 &&
                "🟡 Acceptable response times"}
              {metrics.avgProcessingTime >= 500 && "🔴 Slow response times"}
            </div>
          </div>

          {/* Queue Status */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Queue Depth</span>
              <div className="flex items-center space-x-2">
                <Zap className="h-4 w-4 text-gray-400" />
                <span className="font-semibold">{metrics.queueDepth}</span>
              </div>
            </div>
            <p className="text-xs text-gray-500">
              {metrics.queueDepth === 0
                ? "No pending events"
                : `${metrics.queueDepth} events pending`}
            </p>
          </div>

          {/* Real-time Connections */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Active Connections</span>
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="font-semibold">{metrics.realtimeConnections}</span>
              </div>
            </div>
            <p className="text-xs text-gray-500">Real-time dashboard connections</p>
          </div>
        </CardContent>
      </Card>

      {/* Provider Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Provider Performance</CardTitle>
          <CardDescription>Webhook processing by social media platform</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {topProviders.length > 0 ? (
              topProviders.map(([provider, stats]) => (
                <div key={provider} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Badge variant="outline" className="text-xs">
                        {provider}
                      </Badge>
                      <span className="text-sm text-gray-600">
                        {stats.total.toLocaleString()} events
                      </span>
                    </div>
                    <span
                      className={`text-sm font-semibold ${
                        stats.successRate >= 95
                          ? "text-green-600"
                          : stats.successRate >= 90
                            ? "text-yellow-600"
                            : "text-red-600"
                      }`}
                    >
                      {stats.successRate.toFixed(1)}%
                    </span>
                  </div>
                  <Progress value={stats.successRate} className="h-1.5" />
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>{stats.success.toLocaleString()} success</span>
                    <span>{stats.failed.toLocaleString()} failed</span>
                    <span>{stats.avgProcessingTime.toFixed(0)}ms avg</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-gray-500">
                <Activity className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                <p>No webhook events in this time period</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Event Types Distribution */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Event Types Distribution</CardTitle>
          <CardDescription>Most common webhook event types received</CardDescription>
        </CardHeader>
        <CardContent>
          {topEventTypes.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {topEventTypes.map(([eventType, count]) => {
                const percentage = (count / metrics.totalEvents) * 100;
                return (
                  <div key={eventType} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium truncate" title={eventType}>
                        {eventType
                          .replace(/_/g, " ")
                          .toLowerCase()
                          .replace(/\b\w/g, (l) => l.toUpperCase())}
                      </span>
                      <Badge variant="secondary" className="ml-2">
                        {count.toLocaleString()}
                      </Badge>
                    </div>
                    <Progress value={percentage} className="h-1.5" />
                    <p className="text-xs text-gray-500">
                      {percentage.toFixed(1)}% of total events
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <Zap className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p>No event types to display</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Health Status Summary */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>System Health</CardTitle>
          <CardDescription>Overall webhook system status and recommendations</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Overall Health */}
            <div className="text-center space-y-2">
              <div className={`text-3xl font-bold ${performance.color}`}>
                {performance.status.toUpperCase()}
              </div>
              <p className="text-sm text-gray-600">System Status</p>
              <StatusIcon className={`h-8 w-8 mx-auto ${performance.color}`} />
            </div>

            {/* Key Metrics */}
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Reliability</span>
                <span className={`font-semibold ${performance.color}`}>
                  {metrics.successRate >= 99
                    ? "Excellent"
                    : metrics.successRate >= 95
                      ? "Good"
                      : metrics.successRate >= 90
                        ? "Fair"
                        : "Poor"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Performance</span>
                <span
                  className={`font-semibold ${getProcessingTimeStatus(metrics.avgProcessingTime)}`}
                >
                  {metrics.avgProcessingTime < 100
                    ? "Fast"
                    : metrics.avgProcessingTime < 500
                      ? "Moderate"
                      : "Slow"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Load</span>
                <span className="font-semibold">
                  {metrics.queueDepth === 0
                    ? "Light"
                    : metrics.queueDepth < 100
                      ? "Moderate"
                      : "Heavy"}
                </span>
              </div>
            </div>

            {/* Recommendations */}
            <div className="space-y-2">
              <h4 className="font-semibold text-sm">Recommendations</h4>
              <div className="space-y-1 text-xs text-gray-600">
                {metrics.successRate < 95 && <p>• Review failed events in Dead Letter queue</p>}
                {metrics.avgProcessingTime > 500 && (
                  <p>• Optimize webhook processors for faster response</p>
                )}
                {metrics.queueDepth > 100 && <p>• Consider scaling webhook workers</p>}
                {metrics.failedEvents === 0 && metrics.successRate === 100 && (
                  <p>• System operating optimally</p>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
