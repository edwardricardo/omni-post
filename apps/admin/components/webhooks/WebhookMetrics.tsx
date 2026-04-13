"use client";

/**
 * @file WebhookMetrics.tsx
 * @description Webhook performance metrics dashboard displaying success rates, processing times,
 * queue depth, real-time connections, and per-provider breakdown statistics.
 */

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/Badge";
import { HorizontalBarChart } from "@/components/charts";
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

/**
 * @component WebhookMetrics
 * @description Webhook performance metrics dashboard displaying success rate, processing times,
 *   queue depth, real-time connection count, and per-provider breakdown statistics.
 * @param props.metrics - Aggregate metrics object including totals, rates, and per-provider data
 */
export function WebhookMetrics({ metrics }: WebhookMetricsProps) {
  const tm = useTranslations("webhooks.metricsPanel");

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
            <span>{tm("performanceOverview")}</span>
          </h3>
          <p className="text-sm text-[var(--text-secondary)]">{tm("performanceDescription")}</p>
        </div>
        <div className="p-4 pt-0 space-y-6">
          {/* Success Rate */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{tm("successRate")}</span>
              <div className="flex items-center space-x-2">
                <StatusIcon className={`h-4 w-4 ${performance.color}`} />
                <span className={`font-semibold ${performance.color}`}>
                  {Number(metrics.successRate).toFixed(1)}%
                </span>
              </div>
            </div>
            <ProgressBar value={metrics.successRate} />
            <p className="text-xs text-[var(--text-secondary)]">
              {tm("successOf", {
                success: Number(metrics.processedEvents).toLocaleString(),
                total: Number(metrics.totalEvents).toLocaleString(),
              })}
            </p>
          </div>

          {/* Processing Time */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{tm("avgProcessingTime")}</span>
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
              {metrics.avgProcessingTime < 100 && tm("excellentResponse")}
              {metrics.avgProcessingTime >= 100 &&
                metrics.avgProcessingTime < 500 &&
                tm("acceptableResponse")}
              {metrics.avgProcessingTime >= 500 && tm("slowResponse")}
            </div>
          </div>

          {/* Queue Status */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{tm("queueDepth")}</span>
              <div className="flex items-center space-x-2">
                <Zap className="h-4 w-4 text-[var(--text-tertiary)]" />
                <span className="font-semibold">{metrics.queueDepth}</span>
              </div>
            </div>
            <p className="text-xs text-[var(--text-secondary)]">
              {metrics.queueDepth === 0
                ? tm("noPending")
                : tm("eventsPending", { count: metrics.queueDepth })}
            </p>
          </div>

          {/* Real-time Connections */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{tm("activeConnections")}</span>
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-[var(--success)] rounded-full animate-pulse"></div>
                <span className="font-semibold">{metrics.realtimeConnections}</span>
              </div>
            </div>
            <p className="text-xs text-[var(--text-secondary)]">{tm("realtimeConnections")}</p>
          </div>
        </div>
      </div>

      {/* Provider Breakdown */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="p-4">
          <h3 className="text-base font-semibold text-[var(--text-primary)]">
            {tm("providerPerformance")}
          </h3>
          <p className="text-sm text-[var(--text-secondary)]">{tm("providerDescription")}</p>
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
                    <span>{tm("success", { count: Number(stats.success).toLocaleString() })}</span>
                    <span>
                      {tm("failedCount", { count: Number(stats.failed).toLocaleString() })}
                    </span>
                    <span>{tm("avgMs", { time: Number(stats.avgProcessingTime).toFixed(0) })}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-[var(--text-secondary)]">
                <Activity className="h-12 w-12 mx-auto mb-4 text-[var(--text-tertiary)]" />
                <p>{tm("noEvents")}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Event Types Distribution */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] lg:col-span-2">
        <div className="p-4">
          <h3 className="text-base font-semibold text-[var(--text-primary)]">
            {tm("eventTypesDistribution")}
          </h3>
          <p className="text-sm text-[var(--text-secondary)]">{tm("eventTypesDescription")}</p>
        </div>
        <div className="p-4 pt-0">
          <HorizontalBarChart
            data={topEventTypes.map(([eventType, count]) => ({
              name: eventType
                .replace(/_/g, " ")
                .toLowerCase()
                .replace(/\b\w/g, (l) => l.toUpperCase()),
              value: count,
            }))}
            height={Math.max(200, topEventTypes.length * 40)}
            formatValue={(v) => v.toLocaleString()}
            emptyMessage={tm("noEventTypes")}
          />
        </div>
      </div>

      {/* Health Status Summary */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] lg:col-span-2">
        <div className="p-4">
          <h3 className="text-base font-semibold text-[var(--text-primary)]">
            {tm("systemHealth")}
          </h3>
          <p className="text-sm text-[var(--text-secondary)]">{tm("systemHealthDescription")}</p>
        </div>
        <div className="p-4 pt-0">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Overall Health */}
            <div className="text-center space-y-2">
              <div className={`text-3xl font-bold ${performance.color}`}>
                {performance.status.toUpperCase()}
              </div>
              <p className="text-sm text-[var(--text-secondary)]">{tm("systemStatus")}</p>
              <StatusIcon className={`h-8 w-8 mx-auto ${performance.color}`} />
            </div>

            {/* Key Metrics */}
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-[var(--text-secondary)]">{tm("reliability")}</span>
                <span className={`font-semibold ${performance.color}`}>
                  {metrics.successRate >= 99
                    ? tm("excellent")
                    : metrics.successRate >= 95
                      ? tm("good")
                      : metrics.successRate >= 90
                        ? tm("fair")
                        : tm("poor")}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-[var(--text-secondary)]">{tm("performance")}</span>
                <span
                  className={`font-semibold ${getProcessingTimeStatus(metrics.avgProcessingTime)}`}
                >
                  {metrics.avgProcessingTime < 100
                    ? tm("fast")
                    : metrics.avgProcessingTime < 500
                      ? tm("moderate")
                      : tm("slow")}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-[var(--text-secondary)]">{tm("load")}</span>
                <span className="font-semibold">
                  {metrics.queueDepth === 0
                    ? tm("light")
                    : metrics.queueDepth < 100
                      ? tm("moderate")
                      : tm("heavy")}
                </span>
              </div>
            </div>

            {/* Recommendations */}
            <div className="space-y-2">
              <h4 className="font-semibold text-sm">{tm("recommendations")}</h4>
              <div className="space-y-1 text-xs text-[var(--text-secondary)]">
                {metrics.successRate < 95 && <p>{tm("reviewDeadLetter")}</p>}
                {metrics.avgProcessingTime > 500 && <p>{tm("optimizeProcessors")}</p>}
                {metrics.queueDepth > 100 && <p>{tm("scaleWorkers")}</p>}
                {metrics.failedEvents === 0 && metrics.successRate === 100 && (
                  <p>{tm("operatingOptimally")}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
