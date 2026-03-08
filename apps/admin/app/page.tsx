"use client";

import { useEffect, useState, useCallback } from "react";
import { api, type DashboardStats } from "../lib/apiClient";

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboardStats = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await api.admin.getDashboardStats();
      if (response.ok) {
        setStats(response.stats);
      } else {
        throw new Error("API response not ok");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to fetch dashboard stats";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardStats();
    const interval = setInterval(fetchDashboardStats, 30000);
    return () => clearInterval(interval);
  }, [fetchDashboardStats]);

  if (loading && !stats) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Admin Dashboard</h1>
          <div className="flex justify-center items-center h-64">
            <div className="text-lg text-gray-600">Loading dashboard...</div>
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
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <div className="text-red-800">{error}</div>
            <button
              onClick={fetchDashboardStats}
              className="mt-2 px-4 py-2 bg-red-600 text-white rounded-sm hover:bg-red-700"
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
            >
              <span
                className={`w-2 h-2 rounded-full mr-2 ${loading ? "bg-yellow-400" : "bg-green-400"}`}
              ></span>
              {loading ? "Updating..." : "Live"}
            </span>
            <button
              onClick={fetchDashboardStats}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-sm hover:bg-blue-700 disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {/* Total Accounts */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-600">Total Accounts</p>
                <p className="text-3xl font-bold text-gray-900">
                  {stats?.accounts.total.toLocaleString()}
                </p>
                <p className="text-sm text-gray-500">{stats?.accounts.active} active</p>
              </div>
              <div className="flex-shrink-0">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                  <span className="text-blue-600 text-2xl">👥</span>
                </div>
              </div>
            </div>
          </div>

          {/* Active Trials */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-600">Active Trials</p>
                <p className="text-3xl font-bold text-gray-900">{stats?.accounts.trialsActive}</p>
                <p className="text-sm text-orange-600">
                  {stats?.accounts.trialsExpiring} expiring soon
                </p>
              </div>
              <div className="flex-shrink-0">
                <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
                  <span className="text-orange-600 text-2xl">⏰</span>
                </div>
              </div>
            </div>
          </div>

          {/* Revenue */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-600">Total Revenue</p>
                <p className="text-3xl font-bold text-gray-900">
                  ${stats?.revenue.total.toLocaleString()}
                </p>
                <p className="text-sm text-green-600">
                  MRR: ${stats?.revenue.monthly.toLocaleString()}
                </p>
              </div>
              <div className="flex-shrink-0">
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                  <span className="text-green-600 text-2xl">💰</span>
                </div>
              </div>
            </div>
          </div>

          {/* Today's Activity */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="flex items-center">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-600">Today's Logins</p>
                <p className="text-3xl font-bold text-gray-900">{stats?.activity.loginsToday}</p>
                <p className="text-sm text-gray-500">
                  {stats?.activity.newAccountsToday} new accounts
                </p>
              </div>
              <div className="flex-shrink-0">
                <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                  <span className="text-purple-600 text-2xl">📊</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Subscription Distribution */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Subscription Distribution</h3>
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
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Revenue Breakdown</h3>
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
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <a
              href="/accounts"
              className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <div className="text-sm font-medium text-gray-900">Manage Accounts</div>
              <div className="text-xs text-gray-500 mt-1">View and edit user accounts</div>
            </a>
            <a
              href="/subscriptions"
              className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <div className="text-sm font-medium text-gray-900">Subscriptions</div>
              <div className="text-xs text-gray-500 mt-1">Manage billing and trials</div>
            </a>
            <a
              href="/analytics"
              className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <div className="text-sm font-medium text-gray-900">Analytics</div>
              <div className="text-xs text-gray-500 mt-1">View detailed reports</div>
            </a>
            <a
              href="/logs"
              className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <div className="text-sm font-medium text-gray-900">System Logs</div>
              <div className="text-xs text-gray-500 mt-1">Monitor system activity</div>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
