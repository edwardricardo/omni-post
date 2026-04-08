/**
 * @file page.tsx
 * @description Executive dashboard page with high-level business, operational, and growth
 *   metrics. Uses CSS design tokens and reusable UI components.
 * @layer page
 */
"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";

import { useExecutive } from "@/hooks/api/useExecutive";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatNumber(num: number): string {
  if (num >= 1e12) return (num / 1e12).toFixed(1) + "T";
  if (num >= 1e9) return (num / 1e9).toFixed(1) + "B";
  if (num >= 1e6) return (num / 1e6).toFixed(1) + "M";
  if (num >= 1e3) return (num / 1e3).toFixed(1) + "K";
  return num.toString();
}

function ExecutivePageContent() {
  const t = useTranslations("nav");
  const [timeRange, setTimeRange] = useState<"7d" | "30d" | "90d">("30d");
  const { data: summary, isLoading, error } = useExecutive(timeRange);

  const handleTimeRangeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setTimeRange(e.target.value as "7d" | "30d" | "90d");
  }, []);

  if (isLoading) {
    return (
      <div>
        <PageHeader title={t("executive")} />
        <div className="flex justify-center items-center h-64">
          <LoadingSpinner size="lg" label="Loading executive data..." />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title={t("executive")} />
        <div
          className="bg-[var(--error-subtle)] border border-[var(--error)] rounded-md p-3"
          role="alert"
        >
          <h3 className="text-[var(--error)] font-medium">Error Loading Executive Dashboard</h3>
          <p className="text-[var(--error)] mt-1 text-sm">{error.message}</p>
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div>
        <PageHeader title={t("executive")} />
        <div className="text-center text-[var(--text-secondary)]">No executive data available</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t("executive")}
        description="High-level business metrics and KPIs"
        actions={
          <select
            value={timeRange}
            onChange={handleTimeRangeChange}
            className="border border-[var(--border-default)] rounded-md px-3 py-1 text-sm bg-[var(--bg-surface)] text-[var(--text-primary)]"
            aria-label="Select time range"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard
          label="Total Revenue"
          value={formatCurrency(summary.businessMetrics.totalRevenue)}
          trend={{
            value: summary.businessMetrics.revenueGrowth,
            isPositive: summary.businessMetrics.revenueGrowth > 0,
          }}
        />
        <StatCard
          label="Monthly Recurring Revenue"
          value={formatCurrency(summary.businessMetrics.monthlyRecurringRevenue)}
        />
        <StatCard
          label="Active Users"
          value={formatNumber(summary.operationalMetrics.activeUsers)}
        />
        <StatCard label="System Uptime" value={`${summary.operationalMetrics.systemUptime}%`} />
      </div>

      {/* Business Health */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Business Health</h3>
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: "New Customers", value: String(summary.growthMetrics.newCustomers) },
              {
                label: "Trial Conversion",
                value: `${Number(summary.growthMetrics.trialConversions).toFixed(2)}%`,
              },
              { label: "Feature Adoption", value: `${summary.growthMetrics.featureAdoption}%` },
              { label: "CSAT Score", value: String(summary.growthMetrics.customerSatisfaction) },
            ].map((item) => (
              <div key={item.label} className="text-center p-3 bg-[var(--bg-elevated)] rounded-md">
                <div className="text-2xl font-bold text-[var(--text-primary)]">{item.value}</div>
                <div className="text-sm text-[var(--text-secondary)]">{item.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">
            Operational Excellence
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--text-secondary)]">Security Score</span>
              <div className="flex items-center gap-2">
                <div className="w-24 bg-[var(--bg-elevated)] rounded-full h-2">
                  <div
                    className="bg-[var(--accent)] h-2 rounded-full"
                    style={{ width: `${summary.operationalMetrics.securityScore}%` }}
                  />
                </div>
                <span className="text-sm font-medium text-[var(--text-primary)]">
                  {summary.operationalMetrics.securityScore}%
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--text-secondary)]">Error Rate</span>
              <span className="text-sm font-medium text-[var(--success)]">
                {summary.operationalMetrics.errorRate}%
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--text-secondary)]">Data Processed</span>
              <span className="text-sm font-medium text-[var(--text-primary)]">
                {formatNumber(summary.operationalMetrics.dataProcessed)}B
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--text-secondary)]">Support Tickets</span>
              <span className="text-sm font-medium text-[var(--text-primary)]">
                {summary.growthMetrics.supportTickets} open
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Platform Overview */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-4">
        <StatCard
          label="Total Accounts"
          value={formatNumber(summary.platformMetrics?.totalAccounts ?? 0)}
        />
        <StatCard
          label="Active Accounts"
          value={formatNumber(summary.platformMetrics?.activeAccounts ?? 0)}
        />
        <StatCard
          label="Active Trials"
          value={String(summary.platformMetrics?.trialsActive ?? 0)}
        />
        <StatCard
          label="Total Projects"
          value={formatNumber(summary.platformMetrics?.totalProjects ?? 0)}
        />
        <StatCard
          label="Total Channels"
          value={formatNumber(summary.platformMetrics?.totalChannels ?? 0)}
        />
        <StatCard
          label="Posts Published"
          value={formatNumber(summary.platformMetrics?.postsPublished ?? 0)}
        />
      </div>

      {/* Financial Health */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">
            Financial Health
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-3 bg-[var(--bg-elevated)] rounded-md">
              <div className="text-2xl font-bold text-[var(--text-primary)]">
                {formatCurrency(summary.businessMetrics.lifetimeValue)}
              </div>
              <div className="text-sm text-[var(--text-secondary)]">Customer LTV</div>
            </div>
            <div className="text-center p-3 bg-[var(--bg-elevated)] rounded-md">
              <div className="text-2xl font-bold text-[var(--text-primary)]">
                {summary.businessMetrics.churnRate}%
              </div>
              <div className="text-sm text-[var(--text-secondary)]">Churn Rate</div>
            </div>
            <div className="text-center p-3 bg-[var(--bg-elevated)] rounded-md">
              <div className="text-2xl font-bold text-[var(--text-primary)]">
                {summary.businessMetrics.revenueGrowth}%
              </div>
              <div className="text-sm text-[var(--text-secondary)]">Revenue Growth</div>
            </div>
            <div className="text-center p-3 bg-[var(--bg-elevated)] rounded-md">
              <div className="text-2xl font-bold text-[var(--text-primary)]">
                {summary.growthMetrics.trialConversions.toFixed(1)}%
              </div>
              <div className="text-sm text-[var(--text-secondary)]">Trial Conversion</div>
            </div>
          </div>
        </div>

        {/* Subscription Distribution */}
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">
            Subscription Distribution
          </h3>
          <div className="space-y-3">
            {Object.entries(summary.platformMetrics?.subscriptions ?? {}).map(([status, count]) => {
              const total = Object.values(summary.platformMetrics?.subscriptions ?? {}).reduce(
                (s, v) => s + Number(v),
                0
              );
              const pct = total > 0 ? ((Number(count) / total) * 100).toFixed(1) : "0.0";
              const colorMap: Record<string, string> = {
                ACTIVE: "bg-[var(--success)]",
                TRIALING: "bg-[var(--warning)]",
                GRANDFATHERED: "bg-[var(--accent)]",
                CANCELED: "bg-[var(--error)]",
                PAST_DUE: "bg-[var(--error)]",
              };
              return (
                <div key={status} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-3 h-3 rounded-sm ${colorMap[status] ?? "bg-[var(--text-tertiary)]"}`}
                    />
                    <span className="text-sm text-[var(--text-secondary)] capitalize">
                      {status.toLowerCase().replace("_", " ")}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-medium text-[var(--text-primary)]">
                      {Number(count)}
                    </span>
                    <span className="text-xs text-[var(--text-tertiary)] ml-2">{pct}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Revenue & Growth Trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Revenue Trend</h3>
          <div className="h-48 flex items-end justify-between gap-1">
            {summary.trends.revenue.map((value, index) => (
              <div
                key={index}
                className="flex-1 bg-[var(--accent)] rounded-t opacity-80 hover:opacity-100 transition-opacity"
                style={{
                  height: `${(value / (summary.trends.revenue.length > 0 ? Math.max(...summary.trends.revenue) : 1)) * 100}%`,
                  minHeight: "8px",
                }}
              />
            ))}
          </div>
          <div className="flex justify-between mt-2 text-xs text-[var(--text-tertiary)]">
            {summary.trends.revenue.map((value, index) => (
              <span key={index}>{formatCurrency(value)}</span>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">User Growth</h3>
          <div className="h-48 flex items-end justify-between gap-1">
            {summary.trends.users.map((value, index) => (
              <div
                key={index}
                className="flex-1 bg-[var(--success)] rounded-t opacity-80 hover:opacity-100 transition-opacity"
                style={{
                  height: `${(value / (summary.trends.users.length > 0 ? Math.max(...summary.trends.users) : 1)) * 100}%`,
                  minHeight: "8px",
                }}
              />
            ))}
          </div>
          <div className="flex justify-between mt-2 text-xs text-[var(--text-tertiary)]">
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
