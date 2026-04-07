/**
 * @file AccountBillingPanel.tsx
 * @description Displays billing breakdown for an account including plan type badge,
 *              grandfathering status with adjust controls, trial info, provider pricing,
 *              bundle suggestions, and an Edit Plan button.
 * @layer presentation
 */
"use client";

import { useState, useCallback } from "react";
import { Pencil, Clock, CalendarDays, Monitor } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@packages/ui";
import { useAccountBilling } from "@/hooks/api/useAccountBilling";
import { useAccountSessions, useRevokeAccountSessions } from "@/hooks/api/useAccountSessions";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { Badge } from "@/components/ui/Badge";
import { ActionButton } from "@/components/ui/ActionButton";
import { ChangePlanDialog } from "@/components/subscriptions/ChangePlanDialog";

interface AccountBillingPanelProps {
  accountId: string;
  accountName?: string;
  lastLoginAt?: string | null;
  editingAccount?: boolean;
}

export function AccountBillingPanel({
  accountId,
  accountName,
  lastLoginAt,
  editingAccount,
}: AccountBillingPanelProps) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useAccountBilling(accountId);
  const { data: sessions } = useAccountSessions(accountId);
  const revokeSessions = useRevokeAccountSessions();

  const [changePlanOpen, setChangePlanOpen] = useState(false);
  const [adjustingGrandfathering, setAdjustingGrandfathering] = useState(false);
  const [grandfatherDate, setGrandfatherDate] = useState("");
  const [savingGrandfathering, setSavingGrandfathering] = useState(false);

  const handlePlanSuccess = useCallback(() => {
    queryClient.refetchQueries({ queryKey: ["account", "billing", accountId] });
  }, [queryClient, accountId]);

  const handleSaveGrandfathering = useCallback(async () => {
    if (!grandfatherDate) return;
    setSavingGrandfathering(true);
    try {
      const res = await fetch(`/api/backend/admin/accounts/${accountId}/grandfathering`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ effectiveAt: new Date(grandfatherDate).toISOString() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error || "Failed to update");
      }
      toast({ title: "Updated", description: "Grandfathering expiry adjusted" });
      setAdjustingGrandfathering(false);
      queryClient.invalidateQueries({ queryKey: ["account", "billing", accountId] });
    } catch (e) {
      toast({
        title: "Error",
        description: e instanceof Error ? e.message : "Failed",
        variant: "destructive",
      });
    } finally {
      setSavingGrandfathering(false);
    }
  }, [grandfatherDate, accountId, queryClient]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <LoadingSpinner size="sm" label="Loading billing data..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-4 text-sm text-[var(--error)]" role="alert">
        Failed to load billing data: {error.message}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="mt-4 space-y-4">
      {/* Plan Type + Grandfathering Badges + Edit Plan */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-[var(--text-primary)]">Billing</span>
        {data.planType === "custom" && <Badge variant="info">Custom Plan</Badge>}
        {data.planType === "bundle" && data.bundleInfo && (
          <Badge variant="success">Bundle: {data.bundleInfo.name}</Badge>
        )}
        {data.planType === "none" && <Badge variant="neutral">No Active Plan</Badge>}
        {data.isGrandfathered && data.grandfathering && (
          <Badge variant="warning">
            Grandfathered
            {data.grandfathering.expiresAt
              ? ` until ${new Date(data.grandfathering.expiresAt).toLocaleDateString()}`
              : ""}
          </Badge>
        )}
        <ActionButton
          variant="secondary"
          size="sm"
          onClick={() => setChangePlanOpen(true)}
          className="ml-auto"
          disabled={editingAccount}
          title={editingAccount ? "Finish editing the account first" : "Change subscription plan"}
        >
          <Pencil className="h-3 w-3" />
          Edit Plan
        </ActionButton>
      </div>

      {/* Last Login */}
      <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
        <Clock className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
        <span>Last Login:</span>
        <span className="font-medium text-[var(--text-primary)]">
          {lastLoginAt
            ? new Date(lastLoginAt).toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })
            : "Never"}
        </span>
      </div>

      {/* Trial Info — only when on trial */}
      {data.trial?.isOnTrial && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--accent)] border-opacity-30 bg-[var(--accent-subtle)] p-3">
          <Clock className="h-4 w-4 text-[var(--accent)]" />
          <span className="text-sm text-[var(--text-primary)]">
            Trial: {data.trial.daysRemaining} days remaining
          </span>
          {data.trial.trialEndDate && (
            <span className="ml-auto text-xs text-[var(--text-tertiary)]">
              Ends {new Date(data.trial.trialEndDate).toLocaleDateString()}
            </span>
          )}
        </div>
      )}

      {/* Grandfathering Detail + Adjust */}
      {data.isGrandfathered && data.grandfathering && (
        <div className="rounded-lg border border-[var(--warning)] border-opacity-30 bg-[var(--warning-subtle)] p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-[var(--text-secondary)]">
              Locked at{" "}
              <span className="font-semibold text-[var(--text-primary)]">
                ${Number(data.grandfathering.lockedPrice).toFixed(2)}/mo
              </span>{" "}
              (current list: ${Number(data.grandfathering.currentListPrice).toFixed(2)}/mo — saving{" "}
              <span className="font-semibold text-[var(--success)]">
                ${Number(data.grandfathering.savingsFromGrandfathering).toFixed(2)}/mo
              </span>
              )
            </p>
            {!adjustingGrandfathering && (
              <button
                onClick={() => {
                  setGrandfatherDate(data.grandfathering?.expiresAt?.split("T")[0] ?? "");
                  setAdjustingGrandfathering(true);
                }}
                className="ml-2 text-xs text-[var(--accent)] hover:underline"
              >
                <CalendarDays className="mr-1 inline h-3 w-3" />
                Adjust
              </button>
            )}
          </div>
          {adjustingGrandfathering && (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="date"
                value={grandfatherDate}
                onChange={(e) => setGrandfatherDate(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
                className="rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[var(--text-primary)]"
              />
              <ActionButton
                variant="primary"
                size="sm"
                onClick={handleSaveGrandfathering}
                loading={savingGrandfathering}
                disabled={savingGrandfathering || !grandfatherDate}
              >
                Save
              </ActionButton>
              <ActionButton
                variant="secondary"
                size="sm"
                onClick={() => setAdjustingGrandfathering(false)}
              >
                Cancel
              </ActionButton>
            </div>
          )}
        </div>
      )}

      {/* Provider Breakdown */}
      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
          Provider Breakdown
        </h3>
        {data.providers.length === 0 ? (
          <p className="text-sm text-[var(--text-tertiary)]">No providers connected.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)]">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-[var(--bg-elevated)]">
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                    Platform
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                    Price/Provider
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {data.providers.map((p) => (
                  <tr key={p.platform} className="hover:bg-[var(--bg-elevated)]">
                    <td className="px-3 py-2 font-medium text-[var(--text-primary)]">
                      {p.platform}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[var(--text-primary)]">
                      ${Number(p.pricePerProvider).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Calculation Summary */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
          Calculation
        </h3>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <span className="text-[var(--text-secondary)]">Unique providers</span>
          <span className="text-right text-[var(--text-primary)]">
            {data.calculation.providerCount}
          </span>

          <span className="text-[var(--text-secondary)]">Base price/account</span>
          <span className="text-right font-mono text-[var(--text-primary)]">
            ${Number(data.calculation.basePrice).toFixed(2)}
          </span>

          {data.calculation.savings > 0 && (
            <>
              <span className="text-[var(--text-secondary)]">Volume savings</span>
              <span className="text-right font-mono text-[var(--success)]">
                -${Number(data.calculation.savings).toFixed(2)}
              </span>
            </>
          )}

          <span className="border-t border-[var(--border-subtle)] pt-1 font-medium text-[var(--text-primary)]">
            Total monthly
          </span>
          <span className="border-t border-[var(--border-subtle)] pt-1 text-right font-mono font-semibold text-[var(--text-primary)]">
            ${Number(data.calculation.totalMonthly).toFixed(2)}
          </span>
        </div>
      </div>

      {/* Cheaper Bundle Suggestion */}
      {data.cheaperBundle && (
        <div className="rounded-lg border border-[var(--accent)] border-opacity-30 bg-[var(--accent-subtle)] p-3 text-sm">
          <p className="text-[var(--text-secondary)]">
            <span className="font-semibold text-[var(--accent)]">
              {data.cheaperBundle.bundle.name}
            </span>{" "}
            would save{" "}
            <span className="font-semibold text-[var(--success)]">
              ${Number(data.cheaperBundle.savings).toFixed(2)}/mo
            </span>{" "}
            (bundle: ${Number(data.cheaperBundle.bundleTotal).toFixed(2)} vs custom: $
            {Number(data.cheaperBundle.customTotal).toFixed(2)})
          </p>
        </div>
      )}

      {/* Active Sessions */}
      {sessions && sessions.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
              Active Sessions ({sessions.length})
            </h3>
            <ActionButton
              variant="danger"
              size="sm"
              onClick={() => {
                revokeSessions.mutate(accountId, {
                  onSuccess: () => {
                    toast({ title: "Success", description: "All sessions revoked" });
                  },
                  onError: (err) => {
                    toast({
                      title: "Error",
                      description: err instanceof Error ? err.message : "Failed to revoke sessions",
                      variant: "destructive",
                    });
                  },
                });
              }}
              loading={revokeSessions.isPending}
              aria-label="Revoke all sessions"
            >
              Revoke All
            </ActionButton>
          </div>
          <div className="space-y-1">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="flex items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-xs"
              >
                <Monitor className="h-3.5 w-3.5 text-[var(--text-tertiary)]" aria-hidden="true" />
                <span
                  className="text-[var(--text-primary)] truncate max-w-[200px]"
                  title={session.userAgent ?? undefined}
                >
                  {session.userAgent ? session.userAgent.slice(0, 40) : "Unknown device"}
                </span>
                <span className="text-[var(--text-tertiary)]">{session.ipAddress ?? "N/A"}</span>
                <span className="ml-auto text-[var(--text-tertiary)]">
                  {new Date(session.createdAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Change Plan Dialog */}
      <ChangePlanDialog
        accountId={accountId}
        accountName={accountName ?? data.accountName}
        currentProviders={data.providers.map((p) => p.platform)}
        currentPlanType={data.planType}
        currentBundleSlug={data.bundleInfo?.slug ?? null}
        open={changePlanOpen}
        onOpenChange={setChangePlanOpen}
        onSuccess={handlePlanSuccess}
      />
    </div>
  );
}
