/**
 * @file page.tsx
 * @description Analytics dashboard page with high-level business, operational, and growth
 *   metrics. Uses CSS design tokens and reusable UI components.
 * @layer page
 */
"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { isPermissionDenied, getErrorMessage } from "@/lib/parseApiError";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { useAnalytics } from "@/hooks/api/useAnalytics";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { DonutChart, TrendAreaChart } from "@/components/charts";
import type { DonutChartDatum } from "@/components/charts";
import { useChartColors } from "@/hooks/useChartColors";

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

const PROVIDER_COLORS: Record<string, string> = {
  x: "#1DA1F2",
  instagram: "#E4405F",
  facebook: "#1877F2",
  youtube: "#FF0000",
  tiktok: "#000000",
  threads: "#000000",
};

function AnalyticsPageContent() {
  const te = useTranslations("analytics");
  const [timeRange, setTimeRange] = useState<"7d" | "30d" | "90d">("30d");
  const { data: summary, isLoading, error } = useAnalytics(timeRange);
  const colors = useChartColors();

  const handleTimeRangeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setTimeRange(e.target.value as "7d" | "30d" | "90d");
  }, []);

  const subscriptionChartData: DonutChartDatum[] = useMemo(() => {
    const subs = summary?.platformMetrics?.subscriptions;
    if (!subs) return [];
    return Object.entries(subs)
      .filter(([, count]) => Number(count) > 0)
      .map(([status, count]) => ({
        name: status
          .toLowerCase()
          .replace(/_/g, " ")
          .replace(/\b\w/g, (l) => l.toUpperCase()),
        value: Number(count),
        color: colors.subscriptionColors[status] ?? colors.accent,
      }));
  }, [summary?.platformMetrics?.subscriptions, colors]);

  const channelChartData: DonutChartDatum[] = useMemo(() => {
    const channels = summary?.platformMetrics?.channelsByProvider;
    if (!channels) return [];
    return Object.entries(channels)
      .filter(([, count]) => count > 0)
      .map(([provider, count]) => ({
        name: provider.charAt(0).toUpperCase() + provider.slice(1),
        value: count,
        color: PROVIDER_COLORS[provider.toLowerCase()] ?? colors.accent,
      }));
  }, [summary?.platformMetrics?.channelsByProvider, colors]);

  if (isLoading) {
    return (
      <div>
        <PageHeader title={te("title")} />
        <div className="flex justify-center items-center h-64">
          <LoadingSpinner size="lg" label={te("title")} />
        </div>
      </div>
    );
  }

  if (error) {
    if (isPermissionDenied(error)) {
      return (
        <div>
          <PageHeader title={te("title")} />
          <AccessDenied />
        </div>
      );
    }
    return (
      <div>
        <PageHeader title={te("title")} />
        <div
          className="bg-[var(--error-subtle)] border border-[var(--error)] rounded-md p-3"
          role="alert"
        >
          <h3 className="text-[var(--error)] font-medium">{te("errorTitle")}</h3>
          <p className="text-[var(--error)] mt-1 text-sm">{getErrorMessage(error)}</p>
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div>
        <PageHeader title={te("title")} />
        <div className="text-center text-[var(--text-secondary)]">{te("noData")}</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={te("title")}
        description={te("description")}
        actions={
          <select
            value={timeRange}
            onChange={handleTimeRangeChange}
            className="border border-[var(--border-default)] rounded-md px-3 py-1 text-sm bg-[var(--bg-surface)] text-[var(--text-primary)]"
            aria-label="Select time range"
          >
            <option value="7d">{te("timeRange.last7d")}</option>
            <option value="30d">{te("timeRange.last30d")}</option>
            <option value="90d">{te("timeRange.last90d")}</option>
          </select>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard
          label={te("kpi.totalRevenue")}
          value={formatCurrency(summary.businessMetrics.totalRevenue)}
          trend={{
            value: summary.businessMetrics.revenueGrowth,
            isPositive: summary.businessMetrics.revenueGrowth > 0,
          }}
        />
        <StatCard
          label={te("kpi.mrr")}
          value={formatCurrency(summary.businessMetrics.monthlyRecurringRevenue)}
        />
        <StatCard
          label={te("kpi.activeUsers")}
          value={formatNumber(summary.operationalMetrics.activeUsers)}
        />
        <StatCard
          label={te("kpi.systemUptime")}
          value={`${summary.operationalMetrics.systemUptime}%`}
        />
      </div>

      {/* Business Health */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">
            {te("businessHealth.title")}
          </h3>
          <div className="grid grid-cols-2 gap-4">
            {[
              {
                label: te("businessHealth.newCustomers"),
                value: String(summary.growthMetrics.newCustomers),
              },
              {
                label: te("businessHealth.trialConversion"),
                value: `${Number(summary.growthMetrics.trialConversions).toFixed(2)}%`,
              },
              {
                label: te("businessHealth.featureAdoption"),
                value: `${summary.growthMetrics.featureAdoption}%`,
              },
              {
                label: te("businessHealth.csatScore"),
                value: String(summary.growthMetrics.customerSatisfaction),
              },
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
            {te("operational.title")}
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--text-secondary)]">
                {te("operational.securityScore")}
              </span>
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
              <span className="text-sm text-[var(--text-secondary)]">
                {te("operational.errorRate")}
              </span>
              <span className="text-sm font-medium text-[var(--success)]">
                {summary.operationalMetrics.errorRate}%
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--text-secondary)]">
                {te("operational.dataProcessed")}
              </span>
              <span className="text-sm font-medium text-[var(--text-primary)]">
                {formatNumber(summary.operationalMetrics.dataProcessed)}B
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[var(--text-secondary)]">
                {te("operational.supportTickets")}
              </span>
              <span className="text-sm font-medium text-[var(--text-primary)]">
                {te("operational.open", { count: summary.growthMetrics.supportTickets })}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Platform Overview */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-4">
        <StatCard
          label={te("platform.totalAccounts")}
          value={formatNumber(summary.platformMetrics?.totalAccounts ?? 0)}
        />
        <StatCard
          label={te("platform.activeAccounts")}
          value={formatNumber(summary.platformMetrics?.activeAccounts ?? 0)}
        />
        <StatCard
          label={te("platform.activeTrials")}
          value={String(summary.platformMetrics?.trialsActive ?? 0)}
        />
        <StatCard
          label={te("platform.totalProjects")}
          value={formatNumber(summary.platformMetrics?.totalProjects ?? 0)}
        />
        <StatCard
          label={te("platform.totalChannels")}
          value={formatNumber(summary.platformMetrics?.totalChannels ?? 0)}
        />
        <StatCard
          label={te("platform.postsPublished")}
          value={formatNumber(summary.platformMetrics?.postsPublished ?? 0)}
        />
      </div>

      {/* Financial Health */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4">
            {te("financialHealth.title")}
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-3 bg-[var(--bg-elevated)] rounded-md">
              <div className="text-2xl font-bold text-[var(--text-primary)]">
                {formatCurrency(summary.businessMetrics.lifetimeValue)}
              </div>
              <div className="text-sm text-[var(--text-secondary)]">
                {te("financialHealth.customerLtv")}
              </div>
            </div>
            <div className="text-center p-3 bg-[var(--bg-elevated)] rounded-md">
              <div className="text-2xl font-bold text-[var(--text-primary)]">
                {summary.businessMetrics.churnRate}%
              </div>
              <div className="text-sm text-[var(--text-secondary)]">
                {te("financialHealth.churnRate")}
              </div>
            </div>
            <div className="text-center p-3 bg-[var(--bg-elevated)] rounded-md">
              <div className="text-2xl font-bold text-[var(--text-primary)]">
                {summary.businessMetrics.revenueGrowth}%
              </div>
              <div className="text-sm text-[var(--text-secondary)]">
                {te("financialHealth.revenueGrowth")}
              </div>
            </div>
            <div className="text-center p-3 bg-[var(--bg-elevated)] rounded-md">
              <div className="text-2xl font-bold text-[var(--text-primary)]">
                {Number(summary.growthMetrics.trialConversions ?? 0).toFixed(1)}%
              </div>
              <div className="text-sm text-[var(--text-secondary)]">
                {te("financialHealth.trialConversion")}
              </div>
            </div>
          </div>
        </div>

        {/* Subscription Distribution */}
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
            {te("subscriptionDistribution")}
          </h3>
          <DonutChart
            data={subscriptionChartData}
            height={280}
            emptyMessage={te("subscriptionDistribution")}
          />
        </div>
      </div>

      {/* Channel Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
            {te("channels.title")}
          </h3>
          <DonutChart data={channelChartData} height={280} emptyMessage={te("channels.noData")} />
        </div>
      </div>

      {/* Revenue & Growth Trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
            {te("trends.revenueTrend")}
          </h3>
          <TrendAreaChart
            data={(summary?.trends?.revenue ?? []).map((v, i) => ({
              label: `P${i + 1}`,
              value: v,
            }))}
            height={192}
            color={colors.accent}
            formatValue={(v) => `$${v.toLocaleString()}`}
            emptyMessage={te("trends.noData")}
          />
        </div>

        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
            {te("trends.userGrowth")}
          </h3>
          <TrendAreaChart
            data={(summary?.trends?.users ?? []).map((v, i) => ({ label: `P${i + 1}`, value: v }))}
            height={192}
            color={colors.success}
            formatValue={(v) => v.toLocaleString()}
            emptyMessage={te("trends.noData")}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * @component AnalyticsPage
 * @description Displays the analytics dashboard with business, operational, and growth metrics including charts and trends.
 */
export default function Page() {
  return <AnalyticsPageContent />;
}
