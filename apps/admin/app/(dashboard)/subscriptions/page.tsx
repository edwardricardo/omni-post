/**
 * @file page.tsx
 * @description Subscription management page listing subscribers, trials, and revenue.
 *   Uses CSS design tokens and reusable UI components.
 * @layer page
 */
"use client";

import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, Download, Search } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "@packages/ui";

import { useSubscriptions } from "@/hooks/api/useSubscriptions";
import { useBillingStats } from "@/hooks/api/useBillingStats";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { UsageMetricsPanel } from "@/components/settings/UsageMetricsPanel";
import { PageHeader } from "@/components/ui/PageHeader";
import { ActionButton } from "@/components/ui/ActionButton";
import { Badge } from "@/components/ui/Badge";
import { Pagination } from "@/components/ui/Pagination";
import { TabNav } from "@/components/ui/TabNav";
import { StatCard } from "@/components/ui/StatCard";

interface SubscriptionAccount {
  id: string;
  email: string;
  name: string;
  plan?: { type: string; name: string; status: string; providers: string[]; pricePerMonth: number };
  billingCycle: string;
  autoRenewal: boolean;
  nextBillingDate: string | null;
  lastBillingDate: string | null;
  createdAt: string;
}

interface TrialAccount {
  id: string;
  email: string;
  name: string;
  plan?: { type: string; name: string; status: string; providers: string[]; pricePerMonth: number };
  trialStartDate: string;
  trialEndDate: string;
  trialDaysRemaining: number;
  autoRenewal: boolean;
  status: string;
}

const TABS = [
  { key: "subscriptions", label: "Active Subscriptions" },
  { key: "trials", label: "Trial Accounts" },
  { key: "billing", label: "Billing Events" },
];

const TRIAL_STATUS_VARIANT: Record<string, "success" | "warning" | "error"> = {
  ACTIVE: "success",
  EXPIRING: "warning",
  EXPIRED: "error",
};

function SubscriptionsPageContent() {
  const t = useTranslations("nav");
  const { data: subscriptionData, isLoading, error, refetch } = useSubscriptions();
  const { data: billingStats } = useBillingStats();
  const searchParams = useSearchParams();
  const selectedAccountId = searchParams.get("accountId");
  const [activeTab, setActiveTab] = useState("subscriptions");
  const [subPage, setSubPage] = useState(1);
  const [subPerPage, setSubPerPage] = useState(10);
  const [subSearch, setSubSearch] = useState("");
  const [trialPage, setTrialPage] = useState(1);
  const [trialPerPage, setTrialPerPage] = useState(10);
  const [trialSearch, setTrialSearch] = useState("");

  const allSubscriptions = useMemo(
    () => (subscriptionData?.subscriptions as SubscriptionAccount[]) ?? [],
    [subscriptionData?.subscriptions]
  );
  const subscriptions = useMemo(() => {
    if (!subSearch) return allSubscriptions;
    const q = subSearch.toLowerCase();
    return allSubscriptions.filter(
      (s) => s.name.toLowerCase().includes(q) || s.plan?.name?.toLowerCase().includes(q)
    );
  }, [allSubscriptions, subSearch]);
  const subTotalPages = Math.max(1, Math.ceil(subscriptions.length / subPerPage));
  const paginatedSubs = useMemo(
    () => subscriptions.slice((subPage - 1) * subPerPage, subPage * subPerPage),
    [subscriptions, subPage, subPerPage]
  );

  const allTrials = useMemo(
    () => (subscriptionData?.trials as TrialAccount[]) ?? [],
    [subscriptionData?.trials]
  );
  const trials = useMemo(() => {
    if (!trialSearch) return allTrials;
    const q = trialSearch.toLowerCase();
    return allTrials.filter(
      (t) => t.name.toLowerCase().includes(q) || t.plan?.name?.toLowerCase().includes(q)
    );
  }, [allTrials, trialSearch]);
  const trialTotalPages = Math.max(1, Math.ceil(trials.length / trialPerPage));
  const paginatedTrials = useMemo(
    () => trials.slice((trialPage - 1) * trialPerPage, trialPage * trialPerPage),
    [trials, trialPage, trialPerPage]
  );
  const stats = subscriptionData?.stats ?? {
    totalRevenue: 0,
    monthlyRevenue: 0,
    activeSubscriptions: 0,
    activeTrials: 0,
    expiringTrials: 0,
    conversionRate: 0,
  };

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const formatDate = useCallback((dateString: string | null) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }, []);

  const handleBillingExport = useCallback(async () => {
    try {
      const res = await fetch("/api/backend/admin/billing/export?format=csv", {
        credentials: "include",
      });
      if (!res.ok) {
        toast({ title: "Error", description: "Export failed", variant: "destructive" });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `billing-export-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Error", description: "Export failed", variant: "destructive" });
    }
  }, []);

  if (isLoading) {
    return (
      <div>
        <PageHeader title={t("subscriptions")} />
        <div className="flex justify-center items-center h-64">
          <LoadingSpinner size="lg" label="Loading subscriptions..." />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title={t("subscriptions")} />
        <div className="flex justify-center items-center h-64" role="alert" aria-live="assertive">
          <div className="text-sm text-[var(--error)]">Error: {error.message}</div>
          <ActionButton variant="primary" size="sm" onClick={handleRefresh} className="ml-4">
            Retry
          </ActionButton>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t("subscriptions")}
        actions={
          <div className="flex gap-2">
            <ActionButton variant="primary" size="sm" onClick={handleRefresh} loading={isLoading}>
              Refresh
            </ActionButton>
            <ActionButton variant="secondary" size="sm" onClick={handleBillingExport}>
              <Download className="h-3.5 w-3.5" />
              Export
            </ActionButton>
          </div>
        }
      />

      {/* Usage Metering — only shown when navigated with ?accountId=xxx */}
      {selectedAccountId && (
        <div className="mb-4">
          <UsageMetricsPanel accountId={selectedAccountId} />
        </div>
      )}

      {/* Stats */}
      <div
        className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-3"
        role="region"
        aria-label="Subscription statistics"
      >
        <StatCard label="Total Revenue" value={`$${(stats.totalRevenue ?? 0).toLocaleString()}`} />
        <StatCard
          label="Monthly Revenue"
          value={`$${(stats.monthlyRevenue ?? 0).toLocaleString()}`}
        />
        <StatCard label="Active Subscriptions" value={String(stats.activeSubscriptions ?? 0)} />
        <StatCard label="Active Trials" value={String(stats.activeTrials ?? 0)} />
        <StatCard label="Expiring Trials" value={String(stats.expiringTrials ?? 0)} />
        <StatCard label="Conversion Rate" value={`${(stats.conversionRate ?? 0).toFixed(1)}%`} />
      </div>

      {/* Expiring Trials Alert */}
      {(stats?.expiringTrials ?? 0) > 0 && (
        <div className="flex items-center gap-3 p-3 mb-3 rounded-lg bg-[var(--warning-subtle)] border border-[var(--warning)]/20">
          <AlertTriangle className="h-4 w-4 text-[var(--warning)] shrink-0" />
          <span className="text-sm text-[var(--warning)]">
            {stats.expiringTrials} trial{stats.expiringTrials > 1 ? "s" : ""} expiring in the next 7
            days
          </span>
          <button
            className="ml-auto text-xs underline text-[var(--warning)] hover:text-[var(--warning)]/80"
            onClick={() => setActiveTab("trials")}
          >
            View trials
          </button>
        </div>
      )}

      {/* Billing MRR */}
      {billingStats && (
        <div
          className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3"
          role="region"
          aria-label="Billing statistics"
        >
          <StatCard
            label="MRR"
            value={`$${(billingStats.monthlyRecurringRevenue ?? 0).toLocaleString()}`}
          />
          <StatCard
            label="Grandfathered Revenue"
            value={`$${(billingStats.grandfatheredRevenue ?? 0).toLocaleString()}`}
          />
        </div>
      )}

      {/* Tabs */}
      <TabNav tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

      <div className="mt-4">
        {activeTab === "subscriptions" && (
          <>
            <div className="relative mb-3 max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input
                type="text"
                value={subSearch}
                onChange={(e) => {
                  setSubSearch(e.target.value);
                  setSubPage(1);
                }}
                placeholder="Search by name or plan..."
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] py-1.5 pl-8 pr-3 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
            </div>
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-[var(--border-subtle)]">
                  <thead className="bg-[var(--bg-elevated)]">
                    <tr>
                      {[
                        "Account",
                        "Plan",
                        "Cycle",
                        "Revenue",
                        "Auto-Renew",
                        "Next Bill",
                        "Last Bill",
                      ].map((h) => (
                        <th
                          key={h}
                          className="px-3 py-2 text-left text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {paginatedSubs.map((sub) => (
                      <tr key={sub.id} className="hover:bg-[var(--bg-elevated)] transition-colors">
                        <td className="px-3 py-2">
                          <div className="text-sm font-medium text-[var(--text-primary)]">
                            {sub.name}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant="info">{sub.plan?.name ?? "No Plan"}</Badge>
                        </td>
                        <td className="px-3 py-2">
                          <span className="text-sm text-[var(--text-primary)] capitalize">
                            {sub.billingCycle}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="text-sm font-medium text-[var(--text-primary)]">
                            ${Number(sub.plan?.pricePerMonth ?? 0).toLocaleString()}/mo
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant={sub.autoRenewal ? "success" : "warning"} size="sm">
                            {sub.autoRenewal ? "Yes" : "No"}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-sm text-[var(--text-secondary)]">
                          {formatDate(sub.nextBillingDate)}
                        </td>
                        <td className="px-3 py-2 text-sm text-[var(--text-secondary)]">
                          {formatDate(sub.lastBillingDate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {subscriptions.length === 0 && (
                <div className="text-center py-12 text-[var(--text-secondary)]">
                  No active subscriptions found
                </div>
              )}
            </div>
            <Pagination
              page={subPage}
              totalPages={subTotalPages}
              totalItems={subscriptions.length}
              perPage={subPerPage}
              onPageChange={setSubPage}
              onPerPageChange={(n) => {
                setSubPerPage(n);
                setSubPage(1);
              }}
            />
          </>
        )}

        {activeTab === "trials" && (
          <>
            <div className="relative mb-3 max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input
                type="text"
                value={trialSearch}
                onChange={(e) => {
                  setTrialSearch(e.target.value);
                  setTrialPage(1);
                }}
                placeholder="Search by name or plan..."
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] py-1.5 pl-8 pr-3 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
            </div>
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-[var(--border-subtle)]">
                  <thead className="bg-[var(--bg-elevated)]">
                    <tr>
                      {[
                        "Account",
                        "Plan",
                        "Status",
                        "Days Left",
                        "Start Date",
                        "End Date",
                        "Auto-Renew",
                      ].map((h) => (
                        <th
                          key={h}
                          className="px-3 py-2 text-left text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {paginatedTrials.map((trial) => (
                      <tr
                        key={trial.id}
                        className="hover:bg-[var(--bg-elevated)] transition-colors"
                      >
                        <td className="px-3 py-2">
                          <div className="text-sm font-medium text-[var(--text-primary)]">
                            {trial.name}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant="info">{trial.plan?.name ?? "No Plan"}</Badge>
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant={TRIAL_STATUS_VARIANT[trial.status] ?? "neutral"}>
                            {trial.status}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`text-sm font-medium ${
                              trial.trialDaysRemaining <= 1
                                ? "text-[var(--error)]"
                                : trial.trialDaysRemaining <= 3
                                  ? "text-[var(--warning)]"
                                  : "text-[var(--success)]"
                            }`}
                          >
                            {trial.trialDaysRemaining} days
                          </span>
                        </td>
                        <td className="px-3 py-2 text-sm text-[var(--text-secondary)]">
                          {formatDate(trial.trialStartDate)}
                        </td>
                        <td className="px-3 py-2 text-sm text-[var(--text-secondary)]">
                          {formatDate(trial.trialEndDate)}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant={trial.autoRenewal ? "success" : "neutral"} size="sm">
                            {trial.autoRenewal ? "Yes" : "No"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {trials.length === 0 && (
                <div className="text-center py-12 text-[var(--text-secondary)]">
                  No trial accounts found
                </div>
              )}
            </div>
            <Pagination
              page={trialPage}
              totalPages={trialTotalPages}
              totalItems={trials.length}
              perPage={trialPerPage}
              onPageChange={setTrialPage}
              onPerPageChange={(n) => {
                setTrialPerPage(n);
                setTrialPage(1);
              }}
            />
          </>
        )}

        {activeTab === "billing" && (
          <div className="text-center py-12 text-[var(--text-secondary)] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            <div className="text-lg mb-2 text-[var(--text-primary)]">Billing Events</div>
            <div>
              This section will show recent billing events, payments, and transaction history.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return <SubscriptionsPageContent />;
}
