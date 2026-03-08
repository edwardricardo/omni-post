/**
 * @file page.tsx
 * @description Executive dashboard page presenting high-level business, operational, and growth
 * metrics fetched via the useExecutive hook with a configurable time-range selector.
 */
"use client";

import { useState } from "react";
import { useExecutive } from "@/hooks/api/useExecutive";

function ExecutivePageContent() {
  const [timeRange, setTimeRange] = useState<"7d" | "30d" | "90d">("30d");
  const { data: summary, isLoading, error } = useExecutive(timeRange);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatNumber = (num: number) => {
    if (num >= 1e12) return (num / 1e12).toFixed(1) + "T";
    if (num >= 1e9) return (num / 1e9).toFixed(1) + "B";
    if (num >= 1e6) return (num / 1e6).toFixed(1) + "M";
    if (num >= 1e3) return (num / 1e3).toFixed(1) + "K";
    return num.toString();
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded-sm mb-6"></div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-32 bg-gray-200 rounded-sm"></div>
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="h-64 bg-gray-200 rounded-sm"></div>
            <div className="h-64 bg-gray-200 rounded-sm"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <h3 className="text-red-800 font-medium">Error Loading Executive Dashboard</h3>
          <p className="text-red-600 mt-1">{error.message}</p>
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="p-6">
        <div className="text-center text-gray-500">No executive data available</div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Executive Dashboard</h1>
          <p className="text-gray-600">High-level business metrics and KPIs</p>
        </div>
        <div className="flex items-center space-x-2">
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value as any)}
            className="border border-gray-300 rounded-sm px-3 py-1 text-sm"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>
        </div>
      </div>

      {/* Key Performance Indicators */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Revenue</p>
              <p className="text-2xl font-bold text-gray-900">
                {formatCurrency(summary.businessMetrics.totalRevenue)}
              </p>
              <p className="text-sm text-green-600">
                +{summary.businessMetrics.revenueGrowth}% vs last period
              </p>
            </div>
            <div className="p-3 bg-green-100 rounded-full">
              <svg
                className="w-6 h-6 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1"
                />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Monthly Recurring Revenue</p>
              <p className="text-2xl font-bold text-gray-900">
                {formatCurrency(summary.businessMetrics.monthlyRecurringRevenue)}
              </p>
              <p className="text-sm text-blue-600">
                LTV:CAC{" "}
                {(
                  summary.businessMetrics.lifetimeValue /
                  summary.businessMetrics.customerAcquisitionCost
                ).toFixed(1)}
              </p>
            </div>
            <div className="p-3 bg-blue-100 rounded-full">
              <svg
                className="w-6 h-6 text-blue-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Active Users</p>
              <p className="text-2xl font-bold text-gray-900">
                {formatNumber(summary.operationalMetrics.activeUsers)}
              </p>
              <p className="text-sm text-purple-600">Churn: {summary.businessMetrics.churnRate}%</p>
            </div>
            <div className="p-3 bg-purple-100 rounded-full">
              <svg
                className="w-6 h-6 text-purple-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z"
                />
              </svg>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">System Uptime</p>
              <p className="text-2xl font-bold text-gray-900">
                {summary.operationalMetrics.systemUptime}%
              </p>
              <p className="text-sm text-emerald-600">
                Response: {summary.operationalMetrics.apiResponseTime}ms avg
              </p>
            </div>
            <div className="p-3 bg-emerald-100 rounded-full">
              <svg
                className="w-6 h-6 text-emerald-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Business Health Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Business Health</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-4 bg-gray-50 rounded-sm">
              <div className="text-2xl font-bold text-gray-900">
                {summary.growthMetrics.newCustomers}
              </div>
              <div className="text-sm text-gray-600">New Customers</div>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-sm">
              <div className="text-2xl font-bold text-gray-900">
                {summary.growthMetrics.trialConversions}%
              </div>
              <div className="text-sm text-gray-600">Trial Conversion</div>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-sm">
              <div className="text-2xl font-bold text-gray-900">
                {summary.growthMetrics.featureAdoption}%
              </div>
              <div className="text-sm text-gray-600">Feature Adoption</div>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-sm">
              <div className="text-2xl font-bold text-gray-900">
                {summary.growthMetrics.customerSatisfaction}
              </div>
              <div className="text-sm text-gray-600">CSAT Score</div>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Operational Excellence</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Security Score</span>
              <div className="flex items-center space-x-2">
                <div className="w-24 bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full"
                    style={{ width: `${summary.operationalMetrics.securityScore}%` }}
                  ></div>
                </div>
                <span className="text-sm font-medium">
                  {summary.operationalMetrics.securityScore}%
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Error Rate</span>
              <span className="text-sm font-medium text-green-600">
                {summary.operationalMetrics.errorRate}%
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Data Processed</span>
              <span className="text-sm font-medium">
                {formatNumber(summary.operationalMetrics.dataProcessed)}B
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Support Tickets</span>
              <span className="text-sm font-medium">
                {summary.growthMetrics.supportTickets} open
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Revenue and Growth Trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Revenue Trend</h3>
          <div className="h-48 flex items-end justify-between space-x-2">
            {summary.trends.revenue.map((value, index) => (
              <div
                key={index}
                className="flex-1 bg-blue-100 rounded-t"
                style={{
                  height: `${(value / Math.max(...summary.trends.revenue)) * 100}%`,
                  minHeight: "8px",
                }}
              >
                <div className="bg-blue-500 rounded-t h-full"></div>
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-2 text-xs text-gray-500">
            {summary.trends.revenue.map((value, index) => (
              <span key={index}>{formatCurrency(value)}</span>
            ))}
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-sm border">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">User Growth</h3>
          <div className="h-48 flex items-end justify-between space-x-2">
            {summary.trends.users.map((value, index) => (
              <div
                key={index}
                className="flex-1 bg-purple-100 rounded-t"
                style={{
                  height: `${(value / Math.max(...summary.trends.users)) * 100}%`,
                  minHeight: "8px",
                }}
              >
                <div className="bg-purple-500 rounded-t h-full"></div>
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-2 text-xs text-gray-500">
            {summary.trends.users.map((value, index) => (
              <span key={index}>{formatNumber(value)}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return <ExecutivePageContent />;
}
