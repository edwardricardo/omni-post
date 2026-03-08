/**
 * @file page.tsx
 * @description Main admin dashboard home page displaying key metrics: account counts, subscription
 * distribution, revenue figures, and recent publish activity via the useDashboardStats hook.
 */
"use client";

import { useDashboardStats } from "@/hooks/api/useDashboardStats";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

function DashboardContent() {
  const { data: stats, isLoading: loading, error, refetch } = useDashboardStats();

  if (loading && !stats) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Admin Dashboard</h1>
          <div className="flex justify-center items-center h-64">
            <LoadingSpinner size="lg" label="Loading dashboard data..." />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Admin Dashboard</h1>
          <div
            className="bg-red-50 border border-red-200 rounded-md p-4"
            role="alert"
            aria-live="assertive"
          >
            <div className="text-red-800">
              {error instanceof Error ? error.message : String(error)}
            </div>
            <button
              onClick={() => refetch()}
              className="mt-2 px-4 py-2 bg-red-600 text-white rounded-sm hover:bg-red-700 focus:outline-hidden focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
              aria-label="Retry loading dashboard"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
          <div className="flex items-center space-x-4">
            <span
              className={`inline-flex items-center px-3 py-1 rounded-full text-sm ${loading ? "bg-yellow-100 text-yellow-800" : "bg-green-100 text-green-800"}`}
              role="status"
              aria-live="polite"
              aria-label={loading ? "Dashboard updating" : "Dashboard live"}
            >
              <span
                className={`w-2 h-2 rounded-full mr-2 ${loading ? "bg-yellow-400" : "bg-green-400"}`}
                aria-hidden="true"
              ></span>
              {loading ? "Updating..." : "Live"}
            </span>
            <button
              onClick={() => refetch()}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-sm hover:bg-blue-700 disabled:opacity-50 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              aria-label="Refresh dashboard data"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Stats Cards */}
        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8"
          role="region"
          aria-label="Dashboard statistics"
        >
          {/* Total Accounts */}
          <div
            className="bg-white rounded-lg shadow-sm p-6"
            role="article"
            aria-labelledby="stat-accounts"
          >
            <div className="flex items-center">
              <div className="flex-1">
                <p id="stat-accounts" className="text-sm font-medium text-gray-600">
                  Total Accounts
                </p>
                <p className="text-3xl font-bold text-gray-900" aria-live="polite">
                  {stats?.accounts.total.toLocaleString()}
                </p>
                <p className="text-sm text-gray-500" aria-live="polite">
                  {stats?.accounts.active} active
                </p>
              </div>
              <div className="flex-shrink-0">
                <div
                  className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center"
                  aria-hidden="true"
                >
                  <span className="text-blue-600 text-2xl">👥</span>
                </div>
              </div>
            </div>
          </div>

          {/* Active Trials */}
          <div
            className="bg-white rounded-lg shadow-sm p-6"
            role="article"
            aria-labelledby="stat-trials"
          >
            <div className="flex items-center">
              <div className="flex-1">
                <p id="stat-trials" className="text-sm font-medium text-gray-600">
                  Active Trials
                </p>
                <p className="text-3xl font-bold text-gray-900" aria-live="polite">
                  {stats?.accounts.trialsActive}
                </p>
                <p className="text-sm text-orange-600" aria-live="polite">
                  {stats?.accounts.trialsExpiring} expiring soon
                </p>
              </div>
              <div className="flex-shrink-0">
                <div
                  className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center"
                  aria-hidden="true"
                >
                  <span className="text-orange-600 text-2xl">⏰</span>
                </div>
              </div>
            </div>
          </div>

          {/* Revenue */}
          <div
            className="bg-white rounded-lg shadow-sm p-6"
            role="article"
            aria-labelledby="stat-revenue"
          >
            <div className="flex items-center">
              <div className="flex-1">
                <p id="stat-revenue" className="text-sm font-medium text-gray-600">
                  Total Revenue
                </p>
                <p className="text-3xl font-bold text-gray-900" aria-live="polite">
                  ${stats?.revenue.total.toLocaleString()}
                </p>
                <p className="text-sm text-green-600" aria-live="polite">
                  MRR: ${stats?.revenue.monthly.toLocaleString()}
                </p>
              </div>
              <div className="flex-shrink-0">
                <div
                  className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center"
                  aria-hidden="true"
                >
                  <span className="text-green-600 text-2xl">💰</span>
                </div>
              </div>
            </div>
          </div>

          {/* Today's Activity */}
          <div
            className="bg-white rounded-lg shadow-sm p-6"
            role="article"
            aria-labelledby="stat-activity"
          >
            <div className="flex items-center">
              <div className="flex-1">
                <p id="stat-activity" className="text-sm font-medium text-gray-600">
                  Today's Logins
                </p>
                <p className="text-3xl font-bold text-gray-900" aria-live="polite">
                  {stats?.activity.loginsToday}
                </p>
                <p className="text-sm text-gray-500" aria-live="polite">
                  {stats?.activity.newAccountsToday} new accounts
                </p>
              </div>
              <div className="flex-shrink-0">
                <div
                  className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center"
                  aria-hidden="true"
                >
                  <span className="text-purple-600 text-2xl">📊</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Subscription Distribution */}
          <div
            className="bg-white rounded-lg shadow-sm p-6"
            role="region"
            aria-labelledby="chart-subscriptions"
          >
            <h2 id="chart-subscriptions" className="text-lg font-semibold text-gray-900 mb-4">
              Subscription Distribution
            </h2>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <div className="flex items-center">
                  <div className="w-3 h-3 bg-blue-500 rounded-sm mr-2"></div>
                  <span className="text-sm text-gray-700">Basic</span>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-gray-900">
                    {stats?.subscriptions.basic}
                  </div>
                  <div className="text-xs text-gray-500">
                    {stats &&
                      (
                        (stats.subscriptions.basic /
                          (stats.subscriptions.basic +
                            stats.subscriptions.pro +
                            stats.subscriptions.enterprise)) *
                        100
                      ).toFixed(1)}
                    %
                  </div>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center">
                  <div className="w-3 h-3 bg-green-500 rounded-sm mr-2"></div>
                  <span className="text-sm text-gray-700">Pro</span>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-gray-900">
                    {stats?.subscriptions.pro}
                  </div>
                  <div className="text-xs text-gray-500">
                    {stats &&
                      (
                        (stats.subscriptions.pro /
                          (stats.subscriptions.basic +
                            stats.subscriptions.pro +
                            stats.subscriptions.enterprise)) *
                        100
                      ).toFixed(1)}
                    %
                  </div>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center">
                  <div className="w-3 h-3 bg-purple-500 rounded-sm mr-2"></div>
                  <span className="text-sm text-gray-700">Enterprise</span>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-gray-900">
                    {stats?.subscriptions.enterprise}
                  </div>
                  <div className="text-xs text-gray-500">
                    {stats &&
                      (
                        (stats.subscriptions.enterprise /
                          (stats.subscriptions.basic +
                            stats.subscriptions.pro +
                            stats.subscriptions.enterprise)) *
                        100
                      ).toFixed(1)}
                    %
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Revenue Breakdown */}
          <div
            className="bg-white rounded-lg shadow-sm p-6"
            role="region"
            aria-labelledby="chart-revenue"
          >
            <h2 id="chart-revenue" className="text-lg font-semibold text-gray-900 mb-4">
              Revenue Breakdown
            </h2>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-700">Monthly Subscriptions</span>
                <span className="text-sm font-semibold text-gray-900">
                  ${stats?.revenue.monthly.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-700">Yearly Subscriptions</span>
                <span className="text-sm font-semibold text-gray-900">
                  ${stats?.revenue.yearly.toLocaleString()}
                </span>
              </div>
              <div className="border-t pt-2">
                <div className="flex justify-between items-center">
                  <span className="text-base font-medium text-gray-900">Total MRR</span>
                  <span className="text-base font-bold text-green-600">
                    ${stats?.revenue.total.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div
          className="bg-white rounded-lg shadow-sm p-6"
          role="region"
          aria-labelledby="quick-actions"
        >
          <h2 id="quick-actions" className="text-lg font-semibold text-gray-900 mb-4">
            Quick Actions
          </h2>
          <nav aria-label="Quick action links">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <a
                href="/accounts"
                className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                aria-label="Manage user accounts"
              >
                <div className="text-sm font-medium text-gray-900">Manage Accounts</div>
                <div className="text-xs text-gray-500 mt-1">View and edit user accounts</div>
              </a>
              <a
                href="/subscriptions"
                className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                aria-label="Manage subscriptions and billing"
              >
                <div className="text-sm font-medium text-gray-900">Subscriptions</div>
                <div className="text-xs text-gray-500 mt-1">Manage billing and trials</div>
              </a>
              <a
                href="/analytics"
                className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                aria-label="View analytics and detailed reports"
              >
                <div className="text-sm font-medium text-gray-900">Analytics</div>
                <div className="text-xs text-gray-500 mt-1">View detailed reports</div>
              </a>
              <a
                href="/logs"
                className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                aria-label="Monitor system logs and activity"
              >
                <div className="text-sm font-medium text-gray-900">System Logs</div>
                <div className="text-xs text-gray-500 mt-1">Monitor system activity</div>
              </a>
            </div>
          </nav>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  return <DashboardContent />;
}
