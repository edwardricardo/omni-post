"use client";

/**
 * @file WebhookMetrics.tsx
 * @description Webhook performance metrics dashboard displaying success rates, processing times,
 * queue depth, real-time connections, and per-provider breakdown statistics.
 */

import { Badge } from "@/components/ui/Badge";
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
      return { status: "excellent", color: "text-[var(--success)]", icon: TrendingUp };
    if (successRate >= 95)
      return { status: "good", color: "text-[var(--success)]", icon: TrendingUp };
    if (successRate >= 90)
      return { status: "warning", color: "text-[var(--warning)]", icon: TrendingDown };
    return { status: "critical", color: "text-[var(--error)]", icon: AlertTriangle };
  };

  const performance = getPerformanceStatus(metrics.successRate);
  const StatusIcon = performance.icon;

  const getProcessingTimeStatus = (avgTime: number) => {
    if (avgTime < 100) return "text-[var(--success)]";
    if (avgTime < 500) return "text-[var(--warning)]";
    return "text-[var(--error)]";
  };

  const topProviders = Object.entries(metrics.byProvider)
    .sort(([, a], [, b]) => b.total - a.total)
    .slice(0, 5);

  const topEventTypes = Object.entries(metrics.byEventType)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8);

  const ProgressBar = ({ value, height = "h-2" }: { value: number; height?: string }) => (
    <div className={`w-full ${height} rounded-full bg-[var(--bg-elevated)] overflow-hidden`}>
      <div
        className="h-full rounded-full bg-[var(--accent)] transition-all"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Performance Overview */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="p-4">
          <h3 className="flex items-center space-x-2 text-base font-semibold text-[var(--text-primary)]">
            <Activity className="h-5 w-5" />
            <span>Performance Overview</span>
          </h3>
          <p className="text-sm text-[var(--text-secondary)]">
            Webhook processing health and performance metrics
          </p>
        </div>
        <div className="p-4 pt-0 space-y-6">
          {/* Success Rate */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Success Rate</span>
              <div className="flex items-center space-x-2">
                <StatusIcon className={`h-4 w-4 ${performance.color}`} />
                <span className={`font-semibold ${performance.color}`}>
                  {Number(metrics.successRate).toFixed(1)}%
                </span>
              </div>
            </div>
            <ProgressBar value={metrics.successRate} />
            <p className="text-xs text-[var(--text-secondary)]">
              {Number(metrics.processedEvents).toLocaleString()} successful out of{" "}
              {Number(metrics.totalEvents).toLocaleString()} total
            </p>
          </div>

          {/* Processing Time */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Avg Processing Time</span>
              <div className="flex items-center space-x-2">
                <Clock className="h-4 w-4 text-[var(--text-tertiary)]" />
                <span
                  className={`font-semibold ${getProcessingTimeStatus(metrics.avgProcessingTime)}`}
                >
                  {Number(metrics.avgProcessingTime).toFixed(0)}ms
                </span>
              </div>
            </div>
            <div className="text-xs text-[var(--text-secondary)]">
              {metrics.avgProcessingTime < 100 && "Excellent response times"}
              {metrics.avgProcessingTime >= 100 &&
                metrics.avgProcessingTime < 500 &&
                "Acceptable response times"}
              {metrics.avgProcessingTime >= 500 && "Slow response times"}
            </div>
          </div>

          {/* Queue Status */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Queue Depth</span>
              <div className="flex items-center space-x-2">
                <Zap className="h-4 w-4 text-[var(--text-tertiary)]" />
                <span className="font-semibold">{metrics.queueDepth}</span>
              </div>
            </div>
            <p className="text-xs text-[var(--text-secondary)]">
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
                <div className="w-2 h-2 bg-[var(--success)] rounded-full animate-pulse"></div>
                <span className="font-semibold">{metrics.realtimeConnections}</span>
              </div>
            </div>
            <p className="text-xs text-[var(--text-secondary)]">Real-time dashboard connections</p>
          </div>
        </div>
      </div>

      {/* Provider Breakdown */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="p-4">
          <h3 className="text-base font-semibold text-[var(--text-primary)]">
            Provider Performance
          </h3>
          <p className="text-sm text-[var(--text-secondary)]">
            Webhook processing by social media platform
          </p>
        </div>
        <div className="p-4 pt-0">
          <div className="space-y-4">
            {topProviders.length > 0 ? (
              topProviders.map(([provider, stats]) => (
                <div key={provider} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Badge variant="neutral" size="sm">
                        {provider}
                      </Badge>
                      <span className="text-sm text-[var(--text-secondary)]">
                        {Number(stats.total).toLocaleString()} events
                      </span>
                    </div>
                    <span
                      className={`text-sm font-semibold ${
                        stats.successRate >= 95
                          ? "text-[var(--success)]"
                          : stats.successRate >= 90
                            ? "text-[var(--warning)]"
                            : "text-[var(--error)]"
                      }`}
                    >
                      {Number(stats.successRate).toFixed(1)}%
                    </span>
                  </div>
                  <ProgressBar value={stats.successRate} height="h-1.5" />
                  <div className="flex justify-between text-xs text-[var(--text-secondary)]">
                    <span>{Number(stats.success).toLocaleString()} success</span>
                    <span>{Number(stats.failed).toLocaleString()} failed</span>
                    <span>{Number(stats.avgProcessingTime).toFixed(0)}ms avg</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-[var(--text-secondary)]">
                <Activity className="h-12 w-12 mx-auto mb-4 text-[var(--text-tertiary)]" />
                <p>No webhook events in this time period</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Event Types Distribution */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] lg:col-span-2">
        <div className="p-4">
          <h3 className="text-base font-semibold text-[var(--text-primary)]">
            Event Types Distribution
          </h3>
          <p className="text-sm text-[var(--text-secondary)]">
            Most common webhook event types received
          </p>
        </div>
        <div className="p-4 pt-0">
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
                      <Badge variant="neutral" size="sm">
                        {Number(count).toLocaleString()}
                      </Badge>
                    </div>
                    <ProgressBar value={percentage} height="h-1.5" />
                    <p className="text-xs text-[var(--text-secondary)]">
                      {percentage.toFixed(1)}% of total events
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-[var(--text-secondary)]">
              <Zap className="h-12 w-12 mx-auto mb-4 text-[var(--text-tertiary)]" />
              <p>No event types to display</p>
            </div>
          )}
        </div>
      </div>

      {/* Health Status Summary */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] lg:col-span-2">
        <div className="p-4">
          <h3 className="text-base font-semibold text-[var(--text-primary)]">System Health</h3>
          <p className="text-sm text-[var(--text-secondary)]">
            Overall webhook system status and recommendations
          </p>
        </div>
        <div className="p-4 pt-0">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Overall Health */}
            <div className="text-center space-y-2">
              <div className={`text-3xl font-bold ${performance.color}`}>
                {performance.status.toUpperCase()}
              </div>
              <p className="text-sm text-[var(--text-secondary)]">System Status</p>
              <StatusIcon className={`h-8 w-8 mx-auto ${performance.color}`} />
            </div>

            {/* Key Metrics */}
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-[var(--text-secondary)]">Reliability</span>
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
                <span className="text-sm text-[var(--text-secondary)]">Performance</span>
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
                <span className="text-sm text-[var(--text-secondary)]">Load</span>
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
              <div className="space-y-1 text-xs text-[var(--text-secondary)]">
                {metrics.successRate < 95 && <p>Review failed events in Dead Letter queue</p>}
                {metrics.avgProcessingTime > 500 && (
                  <p>Optimize webhook processors for faster response</p>
                )}
                {metrics.queueDepth > 100 && <p>Consider scaling webhook workers</p>}
                {metrics.failedEvents === 0 && metrics.successRate === 100 && (
                  <p>System operating optimally</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
