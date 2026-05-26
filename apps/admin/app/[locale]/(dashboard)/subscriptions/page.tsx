/**
 * @file page.tsx
 * @description Subscription management page listing subscribers, trials, and revenue.
 *   Uses CSS design tokens and reusable UI components.
 * @layer infrastructure
 */
"use client";

import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, PlayCircle, RefreshCw, Search } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  toast,
} from "@packages/ui";

import { ApiError, isPermissionDenied, getErrorMessage } from "@packages/api-errors";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { useSubscriptions } from "@/hooks/api/useSubscriptions";
import { useEndTrial, useConvertTrial, useStartTrial } from "@/hooks/api/useSubscriptionMutations";
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

const TRIAL_STATUS_VARIANT: Record<string, "success" | "warning" | "error"> = {
  ACTIVE: "success",
  EXPIRING: "warning",
  EXPIRED: "error",
};

function SubscriptionsPageContent() {
  const t = useTranslations("nav");
  const ts = useTranslations("subscriptions");
  const tc = useTranslations("common");
  const { data: subscriptionData, isLoading, error, refetch } = useSubscriptions();
  const { data: billingStats } = useBillingStats();
  const queryClient = useQueryClient();
  const endTrialMutation = useEndTrial();
  const convertTrialMutation = useConvertTrial();
  const startTrialMutation = useStartTrial();
  const [renewalProcessing, setRenewalProcessing] = useState(false);
  const [showStartTrial, setShowStartTrial] = useState(false);
  const [startTrialAccountId, setStartTrialAccountId] = useState("");
  const [startTrialDays, setStartTrialDays] = useState<number>(14);

  const handleEndTrial = useCallback(
    (accountId: string) => {
      endTrialMutation.mutate(
        { accountId, reason: "Ended by admin" },
        {
          onSuccess: () => {
            toast({ title: ts("endTrialSuccess") });
            refetch();
          },
          onError: (e) => {
            toast({
              title: ts("endTrialError"),
              description: getErrorMessage(e),
              variant: "destructive",
            });
          },
        }
      );
    },
    [endTrialMutation, ts, refetch]
  );

  const handleStartTrial = useCallback(() => {
    const accountId = startTrialAccountId.trim();
    if (!accountId) {
      toast({
        title: ts("startTrialMissingAccountId"),
        variant: "destructive",
      });
      return;
    }
    if (!Number.isFinite(startTrialDays) || startTrialDays < 1) {
      toast({
        title: ts("startTrialInvalidDays"),
        variant: "destructive",
      });
      return;
    }
    startTrialMutation.mutate(
      { accountId, trialDays: startTrialDays },
      {
        onSuccess: () => {
          toast({ title: ts("startTrialSuccess") });
          setShowStartTrial(false);
          setStartTrialAccountId("");
          setStartTrialDays(14);
          refetch();
          queryClient.invalidateQueries({ queryKey: ["accounts"] });
        },
        onError: (e) => {
          toast({
            title: ts("startTrialError"),
            description: getErrorMessage(e),
            variant: "destructive",
          });
        },
      }
    );
  }, [startTrialAccountId, startTrialDays, startTrialMutation, ts, refetch, queryClient]);

  const handleConvertTrial = useCallback(
    (accountId: string) => {
      convertTrialMutation.mutate(
        { accountId },
        {
          onSuccess: () => {
            toast({ title: ts("convertTrialSuccess") });
            refetch();
          },
          onError: (e) => {
            toast({
              title: ts("convertTrialError"),
              description: getErrorMessage(e),
              variant: "destructive",
            });
          },
        }
      );
    },
    [convertTrialMutation, ts, refetch]
  );

  const handleAutoRenewals = useCallback(async () => {
    setRenewalProcessing(true);
    try {
      const res = await fetch("/api/backend/admin/billing/auto-renewals/process", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const apiErr = ApiError.fromResponse(res.status, body);
        toast({ title: tc("error"), description: getErrorMessage(apiErr), variant: "destructive" });
        return;
      }
      const result = await res.json();
      const data = result.data ?? result;
      const processed = data.processed ?? 0;
      const failed = data.failed ?? 0;
      if (processed > 0) {
        toast({
          title: ts("processAutoRenewals"),
          description:
            failed > 0
              ? ts("autoRenewProcessedWithFailed", { processed, failed })
              : ts("autoRenewProcessed", { processed }),
        });
      } else {
        toast({ title: ts("processAutoRenewals"), description: ts("noEligibleRenewals") });
      }
      refetch();
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["billingStats"] });
    } catch (e) {
      toast({ title: tc("error"), description: getErrorMessage(e), variant: "destructive" });
    } finally {
      setRenewalProcessing(false);
    }
  }, [ts, tc, refetch, queryClient]);

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

  const tabs = useMemo(
    () => [
      {
        key: "subscriptions",
        label: ts("tabs.activeSubscriptions", { count: subscriptions.length }),
      },
      { key: "trials", label: ts("tabs.trialAccounts", { count: trials.length }) },
      { key: "billing", label: ts("tabs.billingEvents") },
    ],
    [ts, subscriptions.length, trials.length]
  );

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const formatDate = useCallback(
    (dateString: string | null) => {
      if (!dateString) return ts("na");
      return new Date(dateString).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    },
    [ts]
  );

  const handleBillingExport = useCallback(async () => {
    try {
      const res = await fetch("/api/backend/admin/billing/export?format=csv", {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const err = ApiError.fromResponse(res.status, body);
        toast({ title: tc("error"), description: getErrorMessage(err), variant: "destructive" });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `billing-export-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({ title: tc("error"), description: getErrorMessage(e), variant: "destructive" });
    }
  }, [tc]);

  if (isLoading) {
    return (
      <div>
        <PageHeader title={t("subscriptions")} />
        <div className="flex justify-center items-center h-64">
          <LoadingSpinner size="lg" label={ts("loadingSubscriptions")} />
        </div>
      </div>
    );
  }

  if (error) {
    if (isPermissionDenied(error)) {
      return (
        <div>
          <PageHeader title={t("subscriptions")} />
          <AccessDenied />
        </div>
      );
    }
    return (
      <div>
        <PageHeader title={t("subscriptions")} />
        <div className="flex justify-center items-center h-64" role="alert">
          <div className="text-sm text-[var(--error)]">
            {tc("error")}: {getErrorMessage(error)}
          </div>
          <ActionButton
            variant="primary"
            size="sm"
            onClick={handleRefresh}
            loading={isLoading}
            className="ml-4"
          >
            {tc("retry")}
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
            <ActionButton variant="primary" size="sm" onClick={() => setShowStartTrial(true)}>
              <PlayCircle className="h-3.5 w-3.5" />
              {ts("startTrial")}
            </ActionButton>
            <ActionButton
              variant="primary"
              size="sm"
              onClick={handleAutoRenewals}
              loading={renewalProcessing}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {ts("processAutoRenewals")}
            </ActionButton>
            <ActionButton variant="secondary" size="sm" onClick={handleRefresh} loading={isLoading}>
              {tc("refresh")}
            </ActionButton>
            <ActionButton variant="secondary" size="sm" onClick={handleBillingExport}>
              <Download className="h-3.5 w-3.5" />
              {tc("export")}
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
        <StatCard
          label={ts("stats.totalRevenue")}
          value={`$${(stats.totalRevenue ?? 0).toLocaleString()}`}
        />
        <StatCard
          label={ts("stats.monthlyRevenue")}
          value={`$${(stats.monthlyRevenue ?? 0).toLocaleString()}`}
        />
        <StatCard
          label={ts("stats.activeSubscriptions")}
          value={String(stats.activeSubscriptions ?? 0)}
        />
        <StatCard label={ts("stats.activeTrials")} value={String(stats.activeTrials ?? 0)} />
        <StatCard label={ts("stats.expiringTrials")} value={String(stats.expiringTrials ?? 0)} />
        <StatCard
          label={ts("stats.conversionRate")}
          value={`${(stats.conversionRate ?? 0).toFixed(1)}%`}
        />
      </div>

      {/* Expiring Trials Alert */}
      {(stats?.expiringTrials ?? 0) > 0 && (
        <div className="flex items-center gap-3 p-3 mb-3 rounded-lg bg-[var(--warning-subtle)] border border-[var(--warning)]/20">
          <AlertTriangle className="h-4 w-4 text-[var(--warning)] shrink-0" />
          <span className="text-sm text-[var(--warning)]">
            {ts("expiringWarning", { count: stats.expiringTrials })}
          </span>
          <button
            className="ml-auto text-xs underline text-[var(--warning)] hover:text-[var(--warning)]/80"
            onClick={() => setActiveTab("trials")}
          >
            {ts("viewTrials")}
          </button>
        </div>
      )}

      {/* Billing MRR */}
      {billingStats && (
        <div
          className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3"
          role="region"
          aria-label="Billing statistics"
        >
          <StatCard
            label={ts("mrrStat")}
            value={`$${(billingStats.monthlyRecurringRevenue ?? 0).toLocaleString()}`}
          />
        </div>
      )}

      {/* Tabs */}
      <TabNav tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

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
                placeholder={ts("searchPlaceholder")}
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] py-1.5 pl-8 pr-3 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
            </div>
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-[var(--border-subtle)]">
                  <thead className="bg-[var(--bg-elevated)]">
                    <tr>
                      {[
                        ts("table.account"),
                        ts("table.plan"),
                        ts("table.billing"),
                        ts("table.revenue"),
                        ts("table.autoRenew"),
                        ts("table.nextBill"),
                        ts("lastBill"),
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
                          <Badge variant="info">{sub.plan?.name ?? ts("noPlan")}</Badge>
                        </td>
                        <td className="px-3 py-2">
                          <span className="text-sm text-[var(--text-primary)] capitalize">
                            {sub.billingCycle}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="text-sm font-medium text-[var(--text-primary)]">
                            {ts("perMonth", {
                              amount: Number(sub.plan?.pricePerMonth ?? 0).toLocaleString(),
                            })}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant={sub.autoRenewal ? "success" : "warning"} size="sm">
                            {sub.autoRenewal ? tc("yes") : tc("no")}
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
                  {ts("noSubscriptions")}
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
                placeholder={ts("searchPlaceholder")}
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] py-1.5 pl-8 pr-3 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
            </div>
            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-[var(--border-subtle)]">
                  <thead className="bg-[var(--bg-elevated)]">
                    <tr>
                      {[
                        ts("table.account"),
                        ts("table.plan"),
                        ts("table.status"),
                        ts("table.daysRemaining"),
                        ts("startDate"),
                        ts("table.endDate"),
                        ts("table.autoRenew"),
                        ts("actions"),
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
                          <Badge variant="info">{trial.plan?.name ?? ts("noPlan")}</Badge>
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
                            {ts("days", { count: trial.trialDaysRemaining })}
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
                            {trial.autoRenewal ? tc("yes") : tc("no")}
                          </Badge>
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <ActionButton
                              variant="danger"
                              size="sm"
                              loading={endTrialMutation.isPending}
                              onClick={() => handleEndTrial(trial.id)}
                            >
                              {ts("endTrial")}
                            </ActionButton>
                            <ActionButton
                              variant="primary"
                              size="sm"
                              loading={convertTrialMutation.isPending}
                              onClick={() => handleConvertTrial(trial.id)}
                            >
                              {ts("convertToPaid")}
                            </ActionButton>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {trials.length === 0 && (
                <div className="text-center py-12 text-[var(--text-secondary)]">
                  {ts("noTrials")}
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
            <div className="text-lg mb-2 text-[var(--text-primary)]">
              {ts("billingEventsTitle")}
            </div>
            <div>{ts("billingEventsDesc")}</div>
          </div>
        )}
      </div>

      <Dialog open={showStartTrial} onOpenChange={setShowStartTrial}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{ts("startTrialTitle")}</DialogTitle>
            <DialogDescription>{ts("startTrialDescription")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <label className="grid gap-1 text-sm">
              <span className="text-[var(--text-secondary)]">{ts("startTrialAccountIdLabel")}</span>
              <input
                type="text"
                value={startTrialAccountId}
                onChange={(e) => setStartTrialAccountId(e.target.value)}
                placeholder="acc-uuid-..."
                className="rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-[var(--text-secondary)]">{ts("startTrialDaysLabel")}</span>
              <input
                type="number"
                min={1}
                max={365}
                value={startTrialDays}
                onChange={(e) => setStartTrialDays(Number.parseInt(e.target.value, 10) || 0)}
                className="rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <ActionButton
              variant="secondary"
              size="sm"
              onClick={() => setShowStartTrial(false)}
              disabled={startTrialMutation.isPending}
            >
              {tc("cancel")}
            </ActionButton>
            <ActionButton
              variant="primary"
              size="sm"
              onClick={handleStartTrial}
              loading={startTrialMutation.isPending}
            >
              {ts("startTrial")}
            </ActionButton>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * @component SubscriptionsPage
 * @description Manages subscriptions with subscriber listings, trial management, revenue metrics, and billing actions.
 */
export default function Page() {
  return <SubscriptionsPageContent />;
}
