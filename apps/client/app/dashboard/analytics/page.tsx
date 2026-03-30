/**
 * @file page.tsx
 * @description Analytics overview page with Recharts-based line and bar charts showing user
 * activity, revenue trends, and subscription breakdown data fetched via the useAnalytics hook.
 */
"use client";

import { useState } from "react";
import { useAnalytics } from "@/hooks/api/useAnalytics";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface _AnalyticsData {
  overview: {
    totalUsers: number;
    activeUsers: number;
    newUsersToday: number;
    churnRate: number;
    averageSessionTime: number;
    conversionRate: number;
  };
  revenue: {
    totalRevenue: number;
    monthlyRecurringRevenue: number;
    averageRevenuePerUser: number;
    revenueGrowth: number;
  };
  subscriptions: {
    basic: number;
    pro: number;
    enterprise: number;
    trials: number;
  };
  activity: {
    dailyActiveUsers: { date: string; count: number }[];
    signups: { date: string; count: number }[];
    revenue: { date: string; amount: number }[];
  };
  geographic: {
    country: string;
    users: number;
    revenue: number;
  }[];
  features: {
    feature: string;
    usage: number;
    adoption: number;
  }[];
}

function AnalyticsPageContent() {
  // Use TanStack Query hook for data fetching
  const { data: response, isLoading, error, refetch } = useAnalytics();
  const [timeRange, setTimeRange] = useState<"7d" | "30d" | "90d" | "1y">("30d");

  // Extract data from query response with safe defaults
  const data = response?.data || null;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const formatPercentage = (value: number, showSign = true) => {
    const sign = showSign && value > 0 ? "+" : "";
    return `${sign}${value.toFixed(1)}%`;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Analytics & Reporting</h1>
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
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Analytics & Reporting</h1>
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

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Analytics & Reporting</h1>
            <p className="text-gray-600 mt-2">
              Comprehensive insights into your platform performance
            </p>
          </div>
          <div className="flex items-center space-x-4">
            <label htmlFor="time-range-select" className="sr-only">
              Select time range
            </label>
            <select
              id="time-range-select"
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value as any)}
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              aria-label="Select time range for analytics"
            >
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="1y">Last year</option>
            </select>
            <button
              onClick={() => refetch()}
              disabled={isLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-sm hover:bg-blue-700 disabled:opacity-50 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              aria-label="Refresh analytics data"
            >
              {isLoading ? "Updating..." : "Refresh"}
            </button>
            <button
              className="px-4 py-2 bg-green-600 text-white rounded-sm hover:bg-green-700 focus:outline-hidden focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
              aria-label="Export analytics report"
            >
              Export Report
            </button>
          </div>
        </div>

        {/* Overview Stats */}
        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-6 mb-8"
          role="region"
          aria-label="Analytics overview statistics"
        >
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="text-sm font-medium text-gray-600">Total Users</div>
            <div className="text-2xl font-bold text-gray-900">
              {data.overview.totalUsers.toLocaleString()}
            </div>
            <div className="text-xs text-green-600 mt-1">+{data.overview.newUsersToday} today</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="text-sm font-medium text-gray-600">Active Users</div>
            <div className="text-2xl font-bold text-blue-600">
              {data.overview.activeUsers.toLocaleString()}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {((data.overview.activeUsers / data.overview.totalUsers) * 100).toFixed(1)}% of total
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="text-sm font-medium text-gray-600">Churn Rate</div>
            <div className="text-2xl font-bold text-red-600">
              {formatPercentage(data.overview.churnRate, false)}
            </div>
            <div className="text-xs text-green-600 mt-1">-0.3% vs last month</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="text-sm font-medium text-gray-600">Avg Session</div>
            <div className="text-2xl font-bold text-purple-600">
              {data.overview.averageSessionTime}m
            </div>
            <div className="text-xs text-green-600 mt-1">+2.1m vs last month</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="text-sm font-medium text-gray-600">Conversion Rate</div>
            <div className="text-2xl font-bold text-green-600">
              {formatPercentage(data.overview.conversionRate, false)}
            </div>
            <div className="text-xs text-green-600 mt-1">+4.2% vs last month</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-6">
            <div className="text-sm font-medium text-gray-600">MRR</div>
            <div className="text-2xl font-bold text-green-600">
              ${data.revenue.monthlyRecurringRevenue.toLocaleString()}
            </div>
            <div className="text-xs text-green-600 mt-1">
              +{formatPercentage(data.revenue.revenueGrowth)} growth
            </div>
          </div>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Daily Active Users Chart */}
          <div
            className="bg-white rounded-lg shadow-sm p-6"
            role="region"
            aria-labelledby="dau-chart"
          >
            <h2 id="dau-chart" className="text-lg font-semibold text-gray-900 mb-4">
              Daily Active Users
            </h2>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={data.activity.dailyActiveUsers.slice(-14)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(date) =>
                    new Date(date).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })
                  }
                />
                <YAxis />
                <Tooltip
                  labelFormatter={(date) =>
                    new Date(date).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  }
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke="#3B82F6"
                  strokeWidth={2}
                  name="Active Users"
                  dot={{ fill: "#3B82F6" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Revenue Chart */}
          <div
            className="bg-white rounded-lg shadow-sm p-6"
            role="region"
            aria-labelledby="revenue-chart"
          >
            <h2 id="revenue-chart" className="text-lg font-semibold text-gray-900 mb-4">
              Daily Revenue
            </h2>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={data.activity.revenue.slice(-14)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(date) =>
                    new Date(date).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })
                  }
                />
                <YAxis tickFormatter={(value) => `$${value}`} />
                <Tooltip
                  labelFormatter={(date) =>
                    new Date(date).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  }
                  formatter={(value) =>
                    typeof value === "number"
                      ? [`$${value.toLocaleString()}`, "Revenue"]
                      : [String(value), "Revenue"]
                  }
                />
                <Legend />
                <Bar dataKey="amount" fill="#10B981" name="Revenue" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Detailed Analytics */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Subscription Distribution */}
          <div
            className="bg-white rounded-lg shadow-sm p-6"
            role="region"
            aria-labelledby="subscription-dist"
          >
            <h2 id="subscription-dist" className="text-lg font-semibold text-gray-900 mb-4">
              Subscription Distribution
            </h2>
            <div className="space-y-4">
              {(Object.entries(data.subscriptions) as [string, number][]).map(([tier, count]) => {
                const total = (Object.values(data.subscriptions) as number[]).reduce(
                  (sum, val) => sum + val,
                  0
                );
                const percentage = (count / total) * 100;
                const colors = {
                  basic: "bg-blue-500",
                  pro: "bg-green-500",
                  enterprise: "bg-purple-500",
                  trials: "bg-orange-500",
                };

                return (
                  <div key={tier}>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm font-medium text-gray-700 capitalize">{tier}</span>
                      <span className="text-sm text-gray-500">
                        {count} ({percentage.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${colors[tier as keyof typeof colors]}`}
                        style={{ width: `${percentage}%` }}
                      ></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Geographic Distribution */}
          <div
            className="bg-white rounded-lg shadow-sm p-6"
            role="region"
            aria-labelledby="geographic-dist"
          >
            <h2 id="geographic-dist" className="text-lg font-semibold text-gray-900 mb-4">
              Geographic Distribution
            </h2>
            <div className="space-y-3">
              {data.geographic.map((item, index) => (
                <div key={index} className="flex justify-between items-center">
                  <div className="flex items-center">
                    <div className="text-sm font-medium text-gray-900">{item.country}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-gray-900">{item.users} users</div>
                    <div className="text-xs text-gray-500">{formatCurrency(item.revenue)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Feature Usage */}
        <div
          className="bg-white rounded-lg shadow-sm p-6"
          role="region"
          aria-labelledby="feature-usage"
        >
          <h2 id="feature-usage" className="text-lg font-semibold text-gray-900 mb-4">
            Feature Usage & Adoption
          </h2>
          <div className="overflow-x-auto">
            <table
              className="min-w-full divide-y divide-gray-200"
              role="table"
              aria-label="Feature usage statistics"
            >
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Feature
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Usage Rate
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    User Adoption
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Trend
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {data.features.map((feature, index) => (
                  <tr key={index}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {feature.feature}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-1">
                          <div className="text-sm text-gray-900">{feature.usage}%</div>
                          <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
                            <div
                              className="bg-blue-600 h-2 rounded-full"
                              style={{ width: `${feature.usage}%` }}
                            ></div>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm text-gray-900">{feature.adoption}%</span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm text-green-600">↗ +2.3%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return <AnalyticsPageContent />;
}
