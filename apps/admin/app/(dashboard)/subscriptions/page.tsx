/**
 * @file page.tsx
 * @description Subscription management page listing subscribers, trials, and revenue.
 *   Uses CSS design tokens and reusable UI components.
 * @layer page
 */
"use client";

import { useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "@packages/ui";

import { useQueryClient } from "@tanstack/react-query";
import { useSubscriptions } from "@/hooks/api/useSubscriptions";
import { useEndTrial, useConvertTrial } from "@/hooks/api/useSubscriptionMutations";
import { useBillingStats } from "@/hooks/api/useBillingStats";
import { ChangePlanDialog } from "@/components/subscriptions/ChangePlanDialog";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { UsageMetricsPanel } from "@/components/settings/UsageMetricsPanel";
import { PageHeader } from "@/components/ui/PageHeader";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ActionButton } from "@/components/ui/ActionButton";
import { Badge } from "@/components/ui/Badge";
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
  const queryClient = useQueryClient();
  const { data: subscriptionData, isLoading, error, refetch } = useSubscriptions();
  const { data: billingStats } = useBillingStats();
  const searchParams = useSearchParams();
  const selectedAccountId = searchParams.get("accountId");
  const [activeTab, setActiveTab] = useState("subscriptions");

  // Trial mutation hooks
  const convertTrial = useConvertTrial();
  const endTrial = useEndTrial();

  // Dialog state
  const [changePlanOpen, setChangePlanOpen] = useState(false);
  const [changePlanAccountId, setChangePlanAccountId] = useState("");
  const [changePlanName, setChangePlanName] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState("");
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertTarget, setConvertTarget] = useState("");
  const [endTrialOpen, setEndTrialOpen] = useState(false);
  const [endTrialTarget, setEndTrialTarget] = useState("");

  const subscriptions = (subscriptionData?.subscriptions as SubscriptionAccount[]) ?? [];
  const trials = (subscriptionData?.trials as TrialAccount[]) ?? [];
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
  }, [refetch, queryClient]);

  const formatDate = useCallback((dateString: string | null) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }, []);

  const handleCancel = useCallback(async () => {
    try {
      const res = await fetch(`/api/backend/admin/billing/accounts/${cancelTarget}/subscription`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ cancelAtPeriodEnd: true }),
      });
      if (!res.ok) throw new Error("Failed to cancel subscription");
      toast({ title: "Success", description: "Subscription cancelled" });
      setCancelOpen(false);
      await refetch();
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to cancel",
        variant: "destructive",
      });
    }
  }, [cancelTarget, refetch]);

  const handleConvert = useCallback(async () => {
    try {
      await convertTrial.mutateAsync({ accountId: convertTarget });
      toast({ title: "Success", description: "Trial converted to paid subscription" });
      setConvertOpen(false);
      await refetch();
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Conversion failed",
        variant: "destructive",
      });
    }
  }, [convertTarget, convertTrial, refetch]);

  const handleEndTrial = useCallback(async () => {
    try {
      await endTrial.mutateAsync(endTrialTarget);
      toast({ title: "Success", description: "Trial ended" });
      setEndTrialOpen(false);
      await refetch();
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to end trial",
        variant: "destructive",
      });
    }
  }, [endTrialTarget, endTrial, refetch]);

  const handleAutoRenewals = useCallback(async () => {
    try {
      const res = await fetch("/api/backend/admin/billing/auto-renewals/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Failed to process renewals");
      const result = await res.json();
      const data = result.data ?? result;
      const processed = data.processed ?? 0;
      const failed = data.failed ?? 0;
      toast({
        title: "Auto-Renewals Processed",
        description:
          processed > 0
            ? `${processed} account${processed !== 1 ? "s" : ""} converted to paid${failed > 0 ? `, ${failed} failed` : ""}`
            : "No accounts eligible for auto-renewal",
      });
      await refetch();
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Processing failed",
        variant: "destructive",
      });
    }
  }, [refetch]);

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
            <ActionButton
              variant="secondary"
              size="sm"
              onClick={handleAutoRenewals}
              aria-label="Process automatic renewals"
            >
              Process Auto-Renewals
            </ActionButton>
          </div>
        }
      />

      {/* Usage Metering */}
      {selectedAccountId ? (
        <div className="mb-4">
          <UsageMetricsPanel accountId={selectedAccountId} />
        </div>
      ) : (
        <div className="mb-4 bg-[var(--bg-elevated)] border border-dashed border-[var(--border-default)] rounded-lg p-4 text-sm text-[var(--text-secondary)] text-center">
          Select an account to view usage metrics.
        </div>
      )}

      {/* Stats */}
      <div
        className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-4"
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

      {/* Billing MRR */}
      {billingStats && (
        <div
          className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4"
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
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-[var(--border-subtle)]">
                <thead className="bg-[var(--bg-elevated)]">
                  <tr>
                    {["Account", "Plan", "Billing", "Revenue", "Next Bill", "Actions"].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {subscriptions.map((sub) => (
                    <tr key={sub.id} className="hover:bg-[var(--bg-elevated)] transition-colors">
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-[var(--text-primary)]">
                          {sub.name}
                        </div>
                        <div className="text-sm text-[var(--text-secondary)]">{sub.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="info">{sub.plan?.name ?? "No Plan"}</Badge>
                        <span className="text-xs text-[var(--text-tertiary)] ml-1">
                          ({sub.billingCycle})
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={sub.autoRenewal ? "success" : "warning"}>
                          {sub.autoRenewal ? "Auto-Renew" : "Manual"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-[var(--text-primary)]">
                          ${sub.plan?.pricePerMonth ?? 0}/mo
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--text-secondary)]">
                        {formatDate(sub.nextBillingDate)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <ActionButton
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setChangePlanAccountId(sub.id);
                              setChangePlanName(sub.name);
                              setChangePlanOpen(true);
                            }}
                            aria-label={`Change plan for ${sub.email}`}
                          >
                            Change Plan
                          </ActionButton>
                          <ActionButton
                            variant="danger"
                            size="sm"
                            onClick={() => {
                              setCancelTarget(sub.id);
                              setCancelOpen(true);
                            }}
                            aria-label={`Cancel subscription for ${sub.email}`}
                          >
                            Cancel
                          </ActionButton>
                        </div>
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
        )}

        {activeTab === "trials" && (
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
                      "End Date",
                      "Auto-Renew",
                      "Actions",
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {trials.map((trial) => (
                    <tr key={trial.id} className="hover:bg-[var(--bg-elevated)] transition-colors">
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-[var(--text-primary)]">
                          {trial.name}
                        </div>
                        <div className="text-sm text-[var(--text-secondary)]">{trial.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="info">{trial.plan?.name ?? "No Plan"}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={TRIAL_STATUS_VARIANT[trial.status] ?? "neutral"}>
                          {trial.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
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
                      <td className="px-4 py-3 text-sm text-[var(--text-secondary)]">
                        {formatDate(trial.trialEndDate)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={trial.autoRenewal ? "success" : "neutral"}>
                          {trial.autoRenewal ? "Yes" : "No"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {trial.status === "ACTIVE" || trial.status === "EXPIRING" ? (
                          <div className="flex gap-2">
                            <ActionButton
                              variant="primary"
                              size="sm"
                              onClick={() => {
                                setConvertTarget(trial.id);
                                setConvertOpen(true);
                              }}
                              loading={convertTrial.isPending && convertTarget === trial.id}
                              aria-label={`Convert trial for ${trial.email}`}
                            >
                              Convert
                            </ActionButton>
                            <ActionButton
                              variant="danger"
                              size="sm"
                              onClick={() => {
                                setEndTrialTarget(trial.id);
                                setEndTrialOpen(true);
                              }}
                              loading={endTrial.isPending && endTrialTarget === trial.id}
                              aria-label={`End trial for ${trial.email}`}
                            >
                              End Trial
                            </ActionButton>
                          </div>
                        ) : (
                          <span className="text-[var(--text-tertiary)] text-sm">Expired</span>
                        )}
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

      {/* Dialogs */}
      <ChangePlanDialog
        accountId={changePlanAccountId}
        accountName={changePlanName}
        open={changePlanOpen}
        onOpenChange={setChangePlanOpen}
        onSuccess={() => refetch()}
      />
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel Subscription"
        description="This will cancel the subscription at the end of the current billing period. The account will retain access until then."
        variant="danger"
        confirmLabel="Cancel Subscription"
        onConfirm={handleCancel}
      />
      <ConfirmDialog
        open={convertOpen}
        onOpenChange={setConvertOpen}
        title="Convert Trial"
        description="This will convert the trial to a paid subscription immediately."
        confirmLabel="Convert to Paid"
        onConfirm={handleConvert}
      />
      <ConfirmDialog
        open={endTrialOpen}
        onOpenChange={setEndTrialOpen}
        title="End Trial"
        description="This will end the trial immediately. The account will lose access to trial features."
        variant="danger"
        confirmLabel="End Trial"
        onConfirm={handleEndTrial}
      />
    </div>
  );
}

export default function Page() {
  return <SubscriptionsPageContent />;
}
