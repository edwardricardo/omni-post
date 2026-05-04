/**
 * @file page.tsx
 * @description Main admin dashboard home page displaying key metrics: account counts,
 *   plan distribution, revenue figures, and recent activity via the useDashboardStats hook.
 *   Uses CSS custom-property design tokens and reusable UI components.
 * @layer infrastructure
 */
"use client";

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { isPermissionDenied, getErrorMessage } from "@/lib/parseApiError";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { useDashboardStats } from "@/hooks/api/useDashboardStats";
import { DonutChart, HorizontalBarChart } from "@/components/charts";
import type { DonutChartDatum } from "@/components/charts";
import { useChartColors } from "@/hooks/useChartColors";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { ActionButton } from "@/components/ui/ActionButton";
import { Badge } from "@/components/ui/Badge";
import { SetupBanner } from "@/components/dashboard/SetupBanner";

function DashboardContent() {
  const t = useTranslations("nav");
  const td = useTranslations("pages.dashboard");
  const tc = useTranslations("common");
  const { data: stats, isLoading: loading, error, refetch } = useDashboardStats();
  const colors = useChartColors();

  const subscriptionChartData: DonutChartDatum[] = useMemo(() => {
    const subs = stats?.subscriptions;
    if (!subs) return [];
    const entries: Array<[string, number, string]> = [
      ["Active", subs.ACTIVE ?? 0, colors.success],
      ["Trialing", subs.TRIALING ?? 0, colors.warning],
      ["Grandfathered", subs.GRANDFATHERED ?? 0, colors.accent],
      ["Canceled", subs.CANCELED ?? 0, colors.error],
      ["Past Due", subs.PAST_DUE ?? 0, colors.error],
    ];
    return entries
      .filter(([, value]) => value > 0)
      .map(([name, value, color]) => ({ name, value, color }));
  }, [stats?.subscriptions, colors]);

  const revenueChartData = useMemo(() => {
    const rev = stats?.revenue;
    if (!rev) return [];
    return [
      { name: td("charts.monthlySubscriptions"), value: rev.monthly ?? 0, color: colors.accent },
      { name: td("charts.yearlySubscriptions"), value: rev.yearly ?? 0, color: colors.success },
    ];
  }, [stats?.revenue, colors, td]);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  if (loading && !stats) {
    return (
      <div>
        <PageHeader title={t("dashboard")} />
        <div className="flex justify-center items-center h-64">
          <LoadingSpinner size="lg" label={td("loadingData")} />
        </div>
      </div>
    );
  }

  if (error) {
    if (isPermissionDenied(error)) {
      return (
        <div>
          <PageHeader title={t("dashboard")} />
          <AccessDenied />
        </div>
      );
    }
    return (
      <div>
        <PageHeader title={t("dashboard")} />
        <div
          className="bg-[var(--error-subtle)] border border-[var(--error)] rounded-md p-3"
          role="alert"
        >
          <div className="text-[var(--error)]">{getErrorMessage(error)}</div>
          <ActionButton
            variant="danger"
            size="sm"
            onClick={handleRefresh}
            loading={loading}
            className="mt-2"
            aria-label={td("retryLoading")}
          >
            {tc("retry")}
          </ActionButton>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const totalRevenue = stats.revenue?.total ?? 0;

  return (
    <div>
      <SetupBanner />
      <PageHeader
        title={t("dashboard")}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant={loading ? "warning" : "success"}>
              {loading ? tc("updating") : tc("live")}
            </Badge>
            <ActionButton
              variant="primary"
              size="sm"
              onClick={handleRefresh}
              loading={loading}
              aria-label={td("refreshData")}
            >
              {tc("refresh")}
            </ActionButton>
          </div>
        }
      />

      {/* Stats Cards */}
      <div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4"
        role="region"
        aria-label={td("stats.title")}
      >
        <StatCard
          label={td("stats.totalAccounts")}
          value={stats?.accounts?.total?.toLocaleString() ?? "0"}
        />
        <StatCard
          label={td("stats.activeTrials")}
          value={String(stats?.accounts?.trialsActive ?? 0)}
        />
        <StatCard label={td("stats.totalRevenue")} value={`$${totalRevenue.toLocaleString()}`} />
        <StatCard
          label={td("stats.todayLogins")}
          value={String(stats?.activity?.loginsToday ?? 0)}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Subscription Distribution */}
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
            {td("charts.subscriptionDistribution")}
          </h2>
          <DonutChart
            data={subscriptionChartData}
            height={280}
            emptyMessage={td("charts.subscriptionDistribution")}
          />
        </div>

        {/* Revenue Breakdown */}
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
            {td("charts.revenueBreakdown")}
          </h2>
          <HorizontalBarChart
            data={revenueChartData}
            height={140}
            formatValue={(v) => `$${v.toLocaleString()}`}
          />
          {stats?.revenue?.total !== undefined && (
            <div className="mt-3 pt-3 border-t border-[var(--border-subtle)] flex justify-between">
              <span className="text-sm font-medium text-[var(--text-secondary)]">
                {td("charts.totalMrr")}
              </span>
              <span className="text-sm font-bold text-[var(--text-primary)]">
                ${(stats.revenue.total ?? 0).toLocaleString()}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions */}
      <div
        className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
        role="region"
        aria-labelledby="quick-actions"
      >
        <h2 id="quick-actions" className="text-sm font-semibold text-[var(--text-primary)] mb-4">
          {td("quickActions.title")}
        </h2>
        <nav aria-label={td("quickActions.title")}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                href: "/accounts",
                title: td("quickActions.manageAccounts"),
                desc: td("quickActions.manageAccountsDesc"),
              },
              {
                href: "/subscriptions",
                title: td("quickActions.subscriptions"),
                desc: td("quickActions.subscriptionsDesc"),
              },
              {
                href: "/analytics",
                title: td("quickActions.analytics"),
                desc: td("quickActions.analyticsDesc"),
              },
              {
                href: "/webhooks",
                title: td("quickActions.systemLogs"),
                desc: td("quickActions.systemLogsDesc"),
              },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="p-3 border border-[var(--border-default)] rounded-lg hover:bg-[var(--bg-elevated)] transition-colors focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)]"
                aria-label={item.title}
              >
                <div className="text-sm font-medium text-[var(--text-primary)]">{item.title}</div>
                <div className="text-xs text-[var(--text-tertiary)] mt-1">{item.desc}</div>
              </Link>
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
}

/**
 * @component Dashboard
 * @description Displays the main admin dashboard with key metrics, plan distribution, revenue figures, and recent activity.
 */
export default function Dashboard() {
  return <DashboardContent />;
}
