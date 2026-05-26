/**
 * @file page.tsx
 * @description Customer analytics dashboard showing post performance, engagement metrics,
 * and per-platform breakdown. Fetches data via the useAnalytics hook which routes
 * through the Next.js proxy with customer authentication.
 */
"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useAnalytics } from "@/hooks/api/useAnalytics";
import { useAnalyticsRealtime } from "@/hooks/useAnalyticsRealtime";
import { useProject } from "@/providers/ProjectProvider";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/EmptyState";
import { BarChart3 } from "lucide-react";

const PlatformMetricsChart = dynamic(
  () => import("./PlatformMetricsChart").then((m) => m.PlatformMetricsChart),
  { ssr: false }
);

/**
 * @component AnalyticsPageContent
 * @description Displays the customer analytics dashboard with post performance charts, engagement metrics, and per-platform breakdown.
 */
function AnalyticsPageContent() {
  const t = useTranslations("analytics");
  const { projectId } = useProject();
  const [timeRange, setTimeRange] = useState<"7d" | "30d" | "90d">("30d");
  const { data, isLoading, error, refetch } = useAnalytics(projectId, timeRange);
  // Live metric deltas merge into the same query cache; isLive drives the badge.
  const { isLive } = useAnalyticsRealtime(projectId, timeRange);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">{t("title")}</h1>
          <div className="flex justify-center items-center h-64">
            <LoadingSpinner size="lg" label={t("loading")} />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    // Never leak raw error.message to end users in production — could expose
    // backend internals. Show generic message; dev mode keeps the real text
    // for debugging.
    const isDev = process.env.NODE_ENV === "development";
    const displayMessage = isDev ? error.message || t("loadError") : t("loadErrorRetry");
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">{t("title")}</h1>
          <div className="flex justify-center items-center h-64" role="alert">
            <div className="text-lg text-red-600">{displayMessage}</div>
            <button
              onClick={() => refetch()}
              className="ml-4 px-4 py-2 bg-blue-600 text-white rounded-sm hover:bg-blue-700 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              aria-label={t("retryAria")}
            >
              {t("retry")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { overview, platformMetrics } = data;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold text-gray-900">{t("title")}</h1>
              {isLive && (
                <span
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700"
                  role="status"
                  aria-live="polite"
                >
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                  </span>
                  {t("live")}
                </span>
              )}
            </div>
            <p className="text-gray-600 mt-2">{t("subtitle")}</p>
          </div>
          <div className="flex items-center space-x-4">
            <label htmlFor="time-range-select" className="sr-only">
              {t("selectTimeRange")}
            </label>
            <select
              id="time-range-select"
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value as "7d" | "30d" | "90d")}
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              aria-label={t("selectTimeRangeAria")}
            >
              <option value="7d">{t("last7Days")}</option>
              <option value="30d">{t("last30Days")}</option>
              <option value="90d">{t("last90Days")}</option>
            </select>
            <button
              onClick={() => refetch()}
              disabled={isLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-sm hover:bg-blue-700 disabled:opacity-50 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              aria-label={t("refreshAria")}
            >
              {t("refresh")}
            </button>
          </div>
        </div>

        {/* Overview Stats */}
        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8"
          role="region"
          aria-label={t("overviewAria")}
        >
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="text-sm font-medium text-gray-600">{t("totalPosts")}</div>
            <div className="text-2xl font-bold text-gray-900">
              {overview.totalPosts.toLocaleString()}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="text-sm font-medium text-gray-600">{t("totalEngagement")}</div>
            <div className="text-2xl font-bold text-blue-600">
              {overview.totalEngagement.toLocaleString()}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="text-sm font-medium text-gray-600">{t("totalReach")}</div>
            <div className="text-2xl font-bold text-green-600">
              {overview.totalReach.toLocaleString()}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="text-sm font-medium text-gray-600">{t("avgEngagementRate")}</div>
            <div className="text-2xl font-bold text-purple-600">
              {overview.avgEngagementRate.toFixed(2)}%
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="text-sm font-medium text-gray-600">{t("performanceScore")}</div>
            <div className="text-2xl font-bold text-orange-600">
              {overview.performanceScore}/100
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {t("topPlatform", { platform: overview.topPlatform })}
            </div>
          </div>
        </div>

        {/* Platform Metrics Chart */}
        {platformMetrics.length > 0 && (
          <div
            className="bg-white rounded-lg shadow-sm p-6 mb-8"
            role="region"
            aria-labelledby="platform-chart"
          >
            <h2 id="platform-chart" className="text-lg font-semibold text-gray-900 mb-4">
              {t("engagementByPlatform")}
            </h2>
            <PlatformMetricsChart data={platformMetrics} />
          </div>
        )}

        {/* Platform Details Table */}
        {platformMetrics.length > 0 && (
          <div
            className="bg-white rounded-lg shadow-sm p-6"
            role="region"
            aria-labelledby="platform-details"
          >
            <h2 id="platform-details" className="text-lg font-semibold text-gray-900 mb-4">
              {t("platformBreakdown")}
            </h2>
            <div className="overflow-x-auto">
              <table
                className="min-w-full divide-y divide-gray-200"
                role="table"
                aria-label={t("platformDetailsAria")}
              >
                <thead>
                  <tr>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      {t("colPlatform")}
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      {t("colPosts")}
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      {t("colEngagement")}
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      {t("colReach")}
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      {t("colEngRate")}
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {platformMetrics.map((platform) => (
                    <tr key={platform.platformId}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {platform.platformName}
                        </div>
                        {platform.handle && (
                          <div className="text-xs text-gray-500">{platform.handle}</div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {platform.totalPosts.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {platform.totalEngagement.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {platform.totalReach.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm font-medium text-blue-600">
                          {platform.engagementRate.toFixed(2)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {platformMetrics.length === 0 && (
          <EmptyState
            icon={BarChart3}
            title={t("emptyTitle")}
            description={t("emptyDescription")}
            actionLabel={t("emptyAction")}
            actionHref="/dashboard/posts/new"
          />
        )}
      </div>
    </div>
  );
}

/**
 * @component Page
 * @description Renders the customer analytics dashboard with post performance, engagement metrics, and platform breakdown.
 */
export default function Page() {
  return <AnalyticsPageContent />;
}
