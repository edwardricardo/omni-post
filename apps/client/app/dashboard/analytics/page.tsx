/**
 * @file page.tsx
 * @description Customer analytics dashboard showing post performance, engagement metrics,
 * and per-platform breakdown. Fetches data via the useAnalytics hook which routes
 * through the Next.js proxy with customer authentication.
 */
"use client";

import { useState } from "react";
import { useAnalytics } from "@/hooks/api/useAnalytics";
import { useProject } from "@/providers/ProjectProvider";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/EmptyState";
import { BarChart3 } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

/**
 * @component AnalyticsPageContent
 * @description Displays the customer analytics dashboard with post performance charts, engagement metrics, and per-platform breakdown.
 */
function AnalyticsPageContent() {
  const { projectId } = useProject();
  const [timeRange, setTimeRange] = useState<"7d" | "30d" | "90d">("30d");
  const { data, isLoading, error, refetch } = useAnalytics(projectId, timeRange);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Analytics</h1>
          <div className="flex justify-center items-center h-64">
            <LoadingSpinner size="lg" label="Loading analytics data..." />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Analytics</h1>
          <div className="flex justify-center items-center h-64" role="alert" aria-live="assertive">
            <div className="text-lg text-red-600">Error: {error.message}</div>
            <button
              onClick={() => refetch()}
              className="ml-4 px-4 py-2 bg-blue-600 text-white rounded-sm hover:bg-blue-700 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              aria-label="Retry loading analytics"
            >
              Retry
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
            <h1 className="text-3xl font-bold text-gray-900">Analytics</h1>
            <p className="text-gray-600 mt-2">
              Content performance across your connected platforms
            </p>
          </div>
          <div className="flex items-center space-x-4">
            <label htmlFor="time-range-select" className="sr-only">
              Select time range
            </label>
            <select
              id="time-range-select"
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value as "7d" | "30d" | "90d")}
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              aria-label="Select time range for analytics"
            >
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
            </select>
            <button
              onClick={() => refetch()}
              disabled={isLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-sm hover:bg-blue-700 disabled:opacity-50 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              aria-label="Refresh analytics data"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Overview Stats */}
        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8"
          role="region"
          aria-label="Analytics overview statistics"
        >
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="text-sm font-medium text-gray-600">Total Posts</div>
            <div className="text-2xl font-bold text-gray-900">
              {overview.totalPosts.toLocaleString()}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="text-sm font-medium text-gray-600">Total Engagement</div>
            <div className="text-2xl font-bold text-blue-600">
              {overview.totalEngagement.toLocaleString()}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="text-sm font-medium text-gray-600">Total Reach</div>
            <div className="text-2xl font-bold text-green-600">
              {overview.totalReach.toLocaleString()}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="text-sm font-medium text-gray-600">Avg Engagement Rate</div>
            <div className="text-2xl font-bold text-purple-600">
              {overview.avgEngagementRate.toFixed(2)}%
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="text-sm font-medium text-gray-600">Performance Score</div>
            <div className="text-2xl font-bold text-orange-600">
              {overview.performanceScore}/100
            </div>
            <div className="text-xs text-gray-500 mt-1">Top platform: {overview.topPlatform}</div>
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
              Engagement by Platform
            </h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={platformMetrics}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="platformName" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="totalEngagement" fill="#3B82F6" name="Engagement" />
                <Bar dataKey="totalReach" fill="#10B981" name="Reach" />
              </BarChart>
            </ResponsiveContainer>
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
              Platform Breakdown
            </h2>
            <div className="overflow-x-auto">
              <table
                className="min-w-full divide-y divide-gray-200"
                role="table"
                aria-label="Platform performance details"
              >
                <thead>
                  <tr>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Platform
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Posts
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Engagement
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Reach
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      Eng. Rate
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
            title="No analytics data yet"
            description="Connect your social accounts and publish content to start seeing analytics here."
            actionLabel="Create a post"
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
