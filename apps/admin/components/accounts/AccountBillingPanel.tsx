/**
 * @file AccountBillingPanel.tsx
 * @description Displays billing breakdown for an account including plan type badge,
 *              grandfathering status with adjust controls, trial info, provider pricing,
 *              bundle suggestions, and an Edit Plan button.
 * @layer presentation
 */
"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Pencil, Clock, CalendarDays, Monitor } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@packages/ui";
import { useAccountBilling } from "@/hooks/api/useAccountBilling";
import { useAccountSessions, useRevokeAccountSessions } from "@/hooks/api/useAccountSessions";
import { ApiError, getErrorMessage } from "@/lib/parseApiError";
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
  const tb = useTranslations("accounts.billing");
  const tc = useTranslations("common");
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
        const body = await res.text().catch(() => "");
        throw ApiError.fromResponse(res.status, body);
      }
      toast({ title: tb("updated"), description: tb("grandfatheringAdjusted") });
      setAdjustingGrandfathering(false);
      queryClient.invalidateQueries({ queryKey: ["account", "billing", accountId] });
    } catch (e) {
      toast({
        title: tc("error"),
        description: getErrorMessage(e),
        variant: "destructive",
      });
    } finally {
      setSavingGrandfathering(false);
    }
  }, [grandfatherDate, accountId, queryClient, tb, tc]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <LoadingSpinner size="sm" label={tb("loadingBilling")} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-4 text-sm text-[var(--error)]" role="alert">
        {tb("failedBilling")} {getErrorMessage(error)}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="mt-4 space-y-4">
      {/* Plan Type + Grandfathering Badges + Edit Plan */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-[var(--text-primary)]">{tb("title")}</span>
        {data.planType === "custom" && <Badge variant="info">{tb("customPlan")}</Badge>}
        {data.planType === "bundle" && data.bundleInfo && (
          <Badge variant="success">{tb("bundleName", { name: data.bundleInfo.name })}</Badge>
        )}
        {data.planType === "none" && <Badge variant="neutral">{tb("noPlan")}</Badge>}
        {data.isGrandfathered && data.grandfathering && (
          <Badge variant="warning">
            {tb("grandfathered")}
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
          title={editingAccount ? tb("finishEditing") : tb("changePlan")}
        >
          <Pencil className="h-3 w-3" />
          {tb("editPlan")}
        </ActionButton>
      </div>

      {/* Last Login */}
      <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
        <Clock className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
        <span>{tb("lastLogin")}</span>
        <span className="font-medium text-[var(--text-primary)]">
          {lastLoginAt
            ? new Date(lastLoginAt).toLocaleDateString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
              })
            : tc("never")}
        </span>
      </div>

      {/* Trial Info — only when on trial */}
      {data.trial?.isOnTrial && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--accent)] border-opacity-30 bg-[var(--accent-subtle)] p-3">
          <Clock className="h-4 w-4 text-[var(--accent)]" />
          <span className="text-sm text-[var(--text-primary)]">
            {tb("trialRemaining", { days: data.trial.daysRemaining })}
          </span>
          {data.trial.trialEndDate && (
            <span className="ml-auto text-xs text-[var(--text-tertiary)]">
              {tb("trialEnds", { date: new Date(data.trial.trialEndDate).toLocaleDateString() })}
            </span>
          )}
        </div>
      )}

      {/* Grandfathering Detail + Adjust */}
      {data.isGrandfathered && data.grandfathering && (
        <div className="rounded-lg border border-[var(--warning)] border-opacity-30 bg-[var(--warning-subtle)] p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-[var(--text-secondary)]">
              {tb("lockedAt")}{" "}
              <span className="font-semibold text-[var(--text-primary)]">
                ${Number(data.grandfathering.lockedPrice).toFixed(2)}
                {tb("perMonth")}
              </span>{" "}
              ({tb("currentList")}${Number(data.grandfathering.currentListPrice).toFixed(2)}
              {tb("perMonth")} — {tb("saving")}{" "}
              <span className="font-semibold text-[var(--success)]">
                ${Number(data.grandfathering.savingsFromGrandfathering).toFixed(2)}
                {tb("perMonth")}
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
                {tb("adjust")}
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
                {tc("save")}
              </ActionButton>
              <ActionButton
                variant="secondary"
                size="sm"
                onClick={() => setAdjustingGrandfathering(false)}
              >
                {tc("cancel")}
              </ActionButton>
            </div>
          )}
        </div>
      )}

      {/* Provider Breakdown */}
      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
          {tb("providerBreakdown")}
        </h3>
        {data.providers.length === 0 ? (
          <p className="text-sm text-[var(--text-tertiary)]">{tb("noProviders")}</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)]">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-[var(--bg-elevated)]">
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                    {tb("platform")}
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                    {tb("pricePerProvider")}
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
          {tb("calculation")}
        </h3>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <span className="text-[var(--text-secondary)]">{tb("uniqueProviders")}</span>
          <span className="text-right text-[var(--text-primary)]">
            {data.calculation.providerCount}
          </span>

          <span className="text-[var(--text-secondary)]">{tb("basePrice")}</span>
          <span className="text-right font-mono text-[var(--text-primary)]">
            ${Number(data.calculation.basePrice).toFixed(2)}
          </span>

          {data.calculation.savings > 0 && (
            <>
              <span className="text-[var(--text-secondary)]">{tb("volumeSavings")}</span>
              <span className="text-right font-mono text-[var(--success)]">
                -${Number(data.calculation.savings).toFixed(2)}
              </span>
            </>
          )}

          <span className="border-t border-[var(--border-subtle)] pt-1 font-medium text-[var(--text-primary)]">
            {tb("totalMonthly")}
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
            {tb("wouldSave")}{" "}
            <span className="font-semibold text-[var(--success)]">
              ${Number(data.cheaperBundle.savings).toFixed(2)}
              {tb("perMonth")}
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
              {tb("activeSessions", { count: sessions.length })}
            </h3>
            <ActionButton
              variant="danger"
              size="sm"
              onClick={() => {
                revokeSessions.mutate(accountId, {
                  onSuccess: () => {
                    toast({ title: tc("success"), description: tb("sessionsRevoked") });
                  },
                  onError: (err) => {
                    toast({
                      title: tc("error"),
                      description: getErrorMessage(err),
                      variant: "destructive",
                    });
                  },
                });
              }}
              loading={revokeSessions.isPending}
              aria-label={tb("revokeAllLabel")}
            >
              {tb("revokeAll")}
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
                  {session.userAgent ? session.userAgent.slice(0, 40) : tb("unknownDevice")}
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
