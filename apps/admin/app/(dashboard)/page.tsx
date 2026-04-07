/**
 * @file page.tsx
 * @description Main admin dashboard home page displaying key metrics: account counts,
 *   plan distribution, revenue figures, and recent activity via the useDashboardStats hook.
 *   Uses CSS custom-property design tokens and reusable UI components.
 * @layer page
 */
"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";

import { useDashboardStats } from "@/hooks/api/useDashboardStats";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { ActionButton } from "@/components/ui/ActionButton";
import { Badge } from "@/components/ui/Badge";

function DashboardContent() {
  const t = useTranslations("nav");
  const { data: stats, isLoading: loading, error, refetch } = useDashboardStats();

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  if (loading && !stats) {
    return (
      <div>
        <PageHeader title={t("dashboard")} />
        <div className="flex justify-center items-center h-64">
          <LoadingSpinner size="lg" label="Loading dashboard data..." />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title={t("dashboard")} />
        <div
          className="bg-[var(--error-subtle)] border border-[var(--error)] rounded-md p-4"
          role="alert"
          aria-live="assertive"
        >
          <div className="text-[var(--error)]">
            {error instanceof Error ? error.message : String(error)}
          </div>
          <ActionButton
            variant="danger"
            size="sm"
            onClick={handleRefresh}
            className="mt-2"
            aria-label="Retry loading dashboard"
          >
            Retry
          </ActionButton>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const monthlyRevenue = stats.revenue?.monthly ?? 0;
  const yearlyRevenue = stats.revenue?.yearly ?? 0;
  const totalRevenue = stats.revenue?.total ?? 0;

  return (
    <div>
      <PageHeader
        title={t("dashboard")}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant={loading ? "warning" : "success"}>
              {loading ? "Updating..." : "Live"}
            </Badge>
            <ActionButton
              variant="primary"
              size="sm"
              onClick={handleRefresh}
              loading={loading}
              aria-label="Refresh dashboard data"
            >
              Refresh
            </ActionButton>
          </div>
        }
      />

      {/* Stats Cards */}
      <div
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4"
        role="region"
        aria-label="Dashboard statistics"
      >
        <StatCard label="Total Accounts" value={stats?.accounts?.total?.toLocaleString() ?? "0"} />
        <StatCard label="Active Trials" value={String(stats?.accounts?.trialsActive ?? 0)} />
        <StatCard label="Total Revenue" value={`$${totalRevenue.toLocaleString()}`} />
        <StatCard label="Today's Logins" value={String(stats?.activity?.loginsToday ?? 0)} />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Subscription Distribution */}
        <div
          className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
          role="region"
          aria-labelledby="chart-plans"
        >
          <h2 id="chart-plans" className="text-lg font-semibold text-[var(--text-primary)] mb-4">
            Subscription Distribution
          </h2>
          <div className="space-y-4">
            {(["ACTIVE", "TRIALING", "GRANDFATHERED", "CANCELED", "PAST_DUE"] as const).map(
              (status) => {
                const count = stats?.subscriptions?.[status] ?? 0;
                const total = Object.values(stats?.subscriptions ?? {}).reduce(
                  (sum, v) => sum + (v ?? 0),
                  0
                );
                const pct = total > 0 ? ((count / total) * 100).toFixed(1) : "0.0";
                const colorMap: Record<string, string> = {
                  ACTIVE: "bg-[var(--success)]",
                  TRIALING: "bg-[var(--warning)]",
                  GRANDFATHERED: "bg-[var(--accent)]",
                  CANCELED: "bg-[var(--error)]",
                  PAST_DUE: "bg-[var(--error)]",
                };
                return (
                  <div key={status} className="flex justify-between items-center">
                    <div className="flex items-center">
                      <div
                        className={`w-3 h-3 ${colorMap[status] ?? "bg-[var(--text-tertiary)]"} rounded-sm mr-2`}
                      />
                      <span className="text-sm text-[var(--text-secondary)] capitalize">
                        {status.toLowerCase().replace("_", " ")}
                      </span>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-[var(--text-primary)]">
                        {count}
                      </div>
                      <div className="text-xs text-[var(--text-tertiary)]">{pct}%</div>
                    </div>
                  </div>
                );
              }
            )}
          </div>
        </div>

        {/* Revenue Breakdown */}
        <div
          className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
          role="region"
          aria-labelledby="chart-revenue"
        >
          <h2 id="chart-revenue" className="text-lg font-semibold text-[var(--text-primary)] mb-4">
            Revenue Breakdown
          </h2>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-sm text-[var(--text-secondary)]">Monthly Subscriptions</span>
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                ${monthlyRevenue.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-[var(--text-secondary)]">Yearly Subscriptions</span>
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                ${yearlyRevenue.toLocaleString()}
              </span>
            </div>
            <div className="border-t border-[var(--border-subtle)] pt-2">
              <div className="flex justify-between items-center">
                <span className="text-base font-medium text-[var(--text-primary)]">Total MRR</span>
                <span className="text-base font-bold text-[var(--success)]">
                  ${totalRevenue.toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div
        className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
        role="region"
        aria-labelledby="quick-actions"
      >
        <h2 id="quick-actions" className="text-lg font-semibold text-[var(--text-primary)] mb-4">
          Quick Actions
        </h2>
        <nav aria-label="Quick action links">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { href: "/accounts", title: "Manage Accounts", desc: "View and edit user accounts" },
              { href: "/subscriptions", title: "Subscriptions", desc: "Manage billing and trials" },
              { href: "/executive", title: "Analytics", desc: "View detailed reports" },
              { href: "/webhooks", title: "System Logs", desc: "Monitor system activity" },
            ].map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="p-4 border border-[var(--border-default)] rounded-lg hover:bg-[var(--bg-elevated)] transition-colors focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)]"
                aria-label={link.title}
              >
                <div className="text-sm font-medium text-[var(--text-primary)]">{link.title}</div>
                <div className="text-xs text-[var(--text-tertiary)] mt-1">{link.desc}</div>
              </a>
            ))}
          </div>
        </nav>
      </div>
    </div>
  );
}

export default function Dashboard() {
  return <DashboardContent />;
}
