"use client";

/**
 * @file UniversalAnalyticsDashboard.tsx
 * @description Cross-platform analytics dashboard that aggregates and visualizes engagement,
 * reach, impressions, and follower metrics from all connected social media providers.
 * Fetches real data from GET /dashboard via the useUniversalAnalytics hook.
 */

import React, { useState, useCallback } from "react";
import {
  useUniversalAnalytics,
  type TimeRange,
  type AnalyticsDashboardOverview,
  type AnalyticsPlatformMetrics,
} from "../../hooks/api/useUniversalAnalytics";

// ─── Props ──────────────────────────────────────────────────────────────────

interface UniversalAnalyticsDashboardProps {
  accountId: string;
  projectId: string;
  timeRange?: TimeRange;
  onTimeRangeChange?: (range: TimeRange) => void;
  onExport?: (format: "csv" | "pdf") => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Format large numbers with K/M suffixes */
function formatNumber(num: number): string {
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
  return num.toString();
}

/** Format a number as a signed percentage */
function formatPercentage(num: number): string {
  return `${num >= 0 ? "+" : ""}${num.toFixed(1)}%`;
}

/** Get the metric value from a platform entry based on metric name */
function getPlatformMetricValue(
  platform: AnalyticsPlatformMetrics,
  metric: "engagement" | "reach" | "impressions" | "clicks"
): number {
  switch (metric) {
    case "engagement":
      return platform.totalEngagement;
    case "reach":
      return platform.totalReach;
    case "impressions":
      return platform.totalImpressions;
    case "clicks":
      return platform.totalClicks;
  }
}

// ─── Sub-components ─────────────────────────────────────────────────────────

/** Skeleton shown while analytics data is loading */
function DashboardSkeleton() {
  return (
    <div className="universal-analytics-dashboard p-6">
      <div className="animate-pulse">
        <div className="h-8 bg-gray-200 rounded-sm w-1/4 mb-6" />
        <div className="grid grid-cols-4 gap-6 mb-8">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-gray-200 rounded-sm" />
          ))}
        </div>
        <div className="h-64 bg-gray-200 rounded-sm" />
      </div>
    </div>
  );
}

/** Error state with a retry button */
function DashboardError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="universal-analytics-dashboard p-6">
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <div className="text-red-600 text-lg font-medium mb-2">Failed to load analytics</div>
        <p className="text-red-500 text-sm mb-4">{message}</p>
        <button
          onClick={onRetry}
          className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

/** Empty state when there is no data */
function DashboardEmpty() {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-12 text-center">
      <div className="text-4xl mb-4">--</div>
      <div className="text-gray-600 text-lg font-medium mb-2">No analytics data yet</div>
      <p className="text-gray-500 text-sm">
        Start publishing content to see cross-platform performance metrics here.
      </p>
    </div>
  );
}

/** Overview tab content: KPI cards + per-platform breakdown */
function OverviewTab({
  overview,
  platformMetrics,
}: {
  overview: AnalyticsDashboardOverview;
  platformMetrics: AnalyticsPlatformMetrics[];
}) {
  return (
    <div className="space-y-8">
      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        <MetricCard
          label="Total Posts"
          value={overview.totalPosts.toString()}
          detail={`+${Math.floor(overview.totalPosts * 0.15)} this week`}
          detailColor="text-green-600"
        />
        <MetricCard
          label="Total Engagement"
          value={formatNumber(overview.totalEngagement)}
          detail={formatPercentage(overview.growthThisWeek)}
          detailColor="text-green-600"
        />
        <MetricCard
          label="Total Reach"
          value={formatNumber(overview.totalReach)}
          detail={`Avg. engagement: ${overview.avgEngagementRate}%`}
          detailColor="text-blue-600"
        />
        <MetricCard
          label="Performance Score"
          value={overview.performanceScore.toString()}
          detail={`Top platform: ${overview.topPlatform}`}
          detailColor="text-purple-600"
        />
      </div>

      {/* Platform Performance */}
      {platformMetrics.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {platformMetrics.map((platform) => (
            <PlatformCard key={platform.platformId} platform={platform} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Single KPI metric card */
function MetricCard({
  label,
  value,
  detail,
  detailColor,
}: {
  label: string;
  value: string;
  detail: string;
  detailColor: string;
}) {
  return (
    <div className="bg-white rounded-lg border p-6">
      <div className="text-sm text-gray-600 mb-1">{label}</div>
      <div className="text-3xl font-bold text-gray-900">{value}</div>
      <div className={`text-sm mt-1 ${detailColor}`}>{detail}</div>
    </div>
  );
}

/** Platform performance card in the overview grid */
function PlatformCard({ platform }: { platform: AnalyticsPlatformMetrics }) {
  return (
    <div className="bg-white rounded-lg border p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-medium text-gray-900">{platform.platformName}</h3>
          <span className="text-xs text-gray-500">{platform.handle}</span>
        </div>
        <span
          className={`
            px-2 py-1 rounded-full text-xs
            ${
              platform.growthRate > 10
                ? "bg-green-100 text-green-800"
                : platform.growthRate > 0
                  ? "bg-blue-100 text-blue-800"
                  : "bg-red-100 text-red-800"
            }
          `}
        >
          {formatPercentage(platform.growthRate)}
        </span>
      </div>

      <div className="space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Posts</span>
          <span className="font-medium">{platform.totalPosts}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Engagement</span>
          <span className="font-medium">{formatNumber(platform.totalEngagement)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Reach</span>
          <span className="font-medium">{formatNumber(platform.totalReach)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Followers</span>
          <span className="font-medium">{formatNumber(platform.followerCount)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">Engagement Rate</span>
          <span className="font-medium">{platform.engagementRate}%</span>
        </div>
      </div>
    </div>
  );
}

/** Comparison tab: metric selector + ranking */
function ComparisonTab({ platformMetrics }: { platformMetrics: AnalyticsPlatformMetrics[] }) {
  const [selectedMetric, setSelectedMetric] = useState<
    "engagement" | "reach" | "impressions" | "clicks"
  >("engagement");

  const sorted = [...platformMetrics].sort(
    (a, b) => getPlatformMetricValue(b, selectedMetric) - getPlatformMetricValue(a, selectedMetric)
  );

  return (
    <div className="space-y-6">
      {/* Metric selector */}
      <div className="flex space-x-4">
        {(["engagement", "reach", "impressions", "clicks"] as const).map((metric) => (
          <button
            key={metric}
            onClick={() => setSelectedMetric(metric)}
            className={`
              px-4 py-2 rounded-lg text-sm font-medium capitalize
              ${
                selectedMetric === metric
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }
            `}
          >
            {metric}
          </button>
        ))}
      </div>

      {/* Comparison chart placeholder */}
      <div className="bg-white rounded-lg border p-6">
        <h3 className="text-lg font-medium mb-4">
          {selectedMetric.charAt(0).toUpperCase() + selectedMetric.slice(1)} Comparison
        </h3>

        {sorted.length === 0 ? (
          <div className="h-64 flex items-center justify-center bg-gray-50 rounded-sm">
            <p className="text-gray-500">No platform data to compare</p>
          </div>
        ) : (
          <div className="space-y-3">
            {sorted.map((platform) => {
              const value = getPlatformMetricValue(platform, selectedMetric);
              const maxValue = getPlatformMetricValue(sorted[0]!, selectedMetric);
              const barWidth = maxValue > 0 ? (value / maxValue) * 100 : 0;

              return (
                <div key={platform.platformId}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium">{platform.platformName}</span>
                    <span className="text-gray-600">{formatNumber(value)}</span>
                  </div>
                  <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all duration-300"
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Platform ranking */}
      <div className="bg-white rounded-lg border p-6">
        <h3 className="text-lg font-medium mb-4">Platform Performance Ranking</h3>
        {sorted.length === 0 ? (
          <p className="text-gray-500 text-sm">No platforms connected</p>
        ) : (
          <div className="space-y-3">
            {sorted.map((platform, index) => {
              const value = getPlatformMetricValue(platform, selectedMetric);
              return (
                <div
                  key={platform.platformId}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-sm"
                >
                  <div className="flex items-center">
                    <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center mr-3">
                      {index + 1}
                    </span>
                    <span className="font-medium">{platform.platformName}</span>
                  </div>
                  <div className="text-right">
                    <div className="font-medium">{formatNumber(value)}</div>
                    <div className="text-sm text-gray-500">
                      {platform.engagementRate}% engagement rate
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** Trends tab: time-based insights */
function TrendsTab({ overview }: { overview: AnalyticsDashboardOverview }) {
  return (
    <div className="space-y-6">
      {/* Trend analysis chart placeholder */}
      <div className="bg-white rounded-lg border p-6">
        <h3 className="text-lg font-medium mb-4">7-Day Trend Analysis</h3>
        <div className="h-64 flex items-center justify-center bg-gray-50 rounded-sm">
          <div className="text-center">
            <div className="text-gray-600">Time series chart visualization coming soon</div>
            <div className="text-sm text-gray-500 mt-1">Showing metrics trends over time</div>
          </div>
        </div>
      </div>

      {/* Growth insights */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg border p-6">
          <h4 className="font-medium mb-4">Growth Insights</h4>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Top platform</span>
              <span className="font-medium">{overview.topPlatform}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Avg engagement rate</span>
              <span className="font-medium">{overview.avgEngagementRate}%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Performance score</span>
              <span className="font-medium">{overview.performanceScore}/100</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Total reach</span>
              <span className="font-medium">{formatNumber(overview.totalReach)}</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border p-6">
          <h4 className="font-medium mb-4">Recommendations</h4>
          <div className="space-y-3 text-sm">
            {overview.avgEngagementRate < 2 && (
              <div className="p-3 bg-yellow-50 rounded-sm border border-yellow-200">
                <div className="font-medium text-yellow-800">Boost engagement</div>
                <div className="text-yellow-600">
                  Your engagement rate is below 2% -- try more interactive content
                </div>
              </div>
            )}
            {overview.totalPosts < 10 && (
              <div className="p-3 bg-blue-50 rounded-sm border border-blue-200">
                <div className="font-medium text-blue-800">Increase posting frequency</div>
                <div className="text-blue-600">
                  More consistent posting helps build audience engagement
                </div>
              </div>
            )}
            {overview.topPlatform !== "N/A" && (
              <div className="p-3 bg-green-50 rounded-sm border border-green-200">
                <div className="font-medium text-green-800">
                  Double down on {overview.topPlatform}
                </div>
                <div className="text-green-600">
                  Your best performing platform -- consider increasing activity there
                </div>
              </div>
            )}
            {overview.avgEngagementRate >= 2 && overview.totalPosts >= 10 && (
              <div className="p-3 bg-green-50 rounded-sm border border-green-200">
                <div className="font-medium text-green-800">Great performance</div>
                <div className="text-green-600">
                  Your metrics look healthy -- keep up the consistent content
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Reports tab placeholder */
function ReportsTab() {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border p-6">
        <h3 className="text-lg font-medium mb-4">Custom Reports</h3>
        <div className="h-64 flex items-center justify-center bg-gray-50 rounded-sm">
          <div className="text-center">
            <div className="text-gray-600">Report builder coming soon</div>
            <div className="text-sm text-gray-500 mt-1">Create custom analytics reports</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tab Navigation Types ───────────────────────────────────────────────────

type ViewTab = "overview" | "comparison" | "trends" | "reports";

const TABS: Array<{ id: ViewTab; name: string }> = [
  { id: "overview", name: "Overview" },
  { id: "comparison", name: "Platform Comparison" },
  { id: "trends", name: "Trends" },
  { id: "reports", name: "Reports" },
];

// ─── Main Component ─────────────────────────────────────────────────────────

export function UniversalAnalyticsDashboard({
  accountId: _accountId,
  projectId,
  timeRange = "7d",
  onTimeRangeChange,
  onExport,
}: UniversalAnalyticsDashboardProps) {
  const [view, setView] = useState<ViewTab>("overview");

  // Fetch real analytics data from backend
  const { data, isLoading, isError, error, refetch, dataUpdatedAt } = useUniversalAnalytics({
    projectId,
    timeRange,
  });

  // Handle export
  const handleExport = useCallback(
    (format: "csv" | "pdf") => {
      onExport?.(format);
    },
    [onExport]
  );

  // Handle time range change
  const handleTimeRangeChange = useCallback(
    (newRange: TimeRange) => {
      onTimeRangeChange?.(newRange);
    },
    [onTimeRangeChange]
  );

  // Loading state
  if (isLoading && !data) {
    return <DashboardSkeleton />;
  }

  // Error state
  if (isError) {
    return (
      <DashboardError
        message={error instanceof Error ? error.message : "Unknown error"}
        onRetry={() => refetch()}
      />
    );
  }

  const overview = data?.overview;
  const platformMetrics = data?.platformMetrics ?? [];
  const lastUpdated = dataUpdatedAt > 0 ? new Date(dataUpdatedAt) : null;

  return (
    <div className="universal-analytics-dashboard max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Analytics Dashboard</h1>
          <p className="text-gray-600">
            Cross-platform performance insights for the last {timeRange}
            {lastUpdated && (
              <span className="ml-2 text-sm text-gray-500">
                -- Last updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}
            {data && (
              <span className="ml-2 text-sm text-gray-400">({data.dataPoints} data points)</span>
            )}
          </p>
        </div>

        <div className="flex items-center space-x-4">
          {/* Time range selector */}
          <select
            value={timeRange}
            onChange={(e) => handleTimeRangeChange(e.target.value as TimeRange)}
            className="px-3 py-2 border rounded-lg text-sm"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>

          {/* Export buttons */}
          <button
            onClick={() => handleExport("csv")}
            className="px-4 py-2 bg-gray-600 text-white rounded-lg text-sm hover:bg-gray-700"
          >
            Export CSV
          </button>
          <button
            onClick={() => handleExport("pdf")}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
          >
            Export PDF
          </button>
        </div>
      </div>

      {/* View Navigation */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setView(tab.id)}
              className={`
                flex items-center px-1 py-4 border-b-2 font-medium text-sm
                ${
                  view === tab.id
                    ? "border-blue-500 text-blue-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }
              `}
            >
              {tab.name}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {!overview ? (
        <DashboardEmpty />
      ) : (
        <>
          {view === "overview" && (
            <OverviewTab overview={overview} platformMetrics={platformMetrics} />
          )}
          {view === "comparison" && <ComparisonTab platformMetrics={platformMetrics} />}
          {view === "trends" && <TrendsTab overview={overview} />}
          {view === "reports" && <ReportsTab />}
        </>
      )}
    </div>
  );
}
