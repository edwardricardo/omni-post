/**
 * @file ChangePlanDialog.tsx
 * @description Dialog for changing an account's subscription plan. Two modes:
 *   Custom (individual provider checkboxes with live pricing) and
 *   Bundle (pre-configured plan cards). Matches admin design system tokens.
 * @layer presentation
 */

"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  toast,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@packages/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Package, Layers } from "lucide-react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Badge } from "@/components/ui/Badge";

// ---------------------------------------------------------------------------
// Constants & Types
// ---------------------------------------------------------------------------

import { PROVIDER_NAMES, type PlanType } from "@shared/types";
import { ApiError, getErrorMessage } from "@/lib/parseApiError";

const ALL_PROVIDERS = PROVIDER_NAMES.map((id) => ({ id, label: id }));

interface PricingTier {
  minProviders: number;
  maxProviders: number | null;
  pricePerProviderMonth: number;
  isActive: boolean;
}

interface BundleOption {
  id: string;
  name: string;
  slug: string;
  description: string;
  providers: string[];
  pricePerAccountMonth: number;
  isActive: boolean;
}

interface TiersData {
  providerTiers: PricingTier[];
  bundles: BundleOption[];
}

interface ChangePlanDialogProps {
  accountId: string;
  accountName: string;
  currentProviders?: string[];
  currentPlanType?: PlanType;
  currentBundleSlug?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

// ---------------------------------------------------------------------------
// Price calculation
// ---------------------------------------------------------------------------

function estimateCustomPrice(count: number, tiers: PricingTier[]): number {
  const active = tiers.filter((t) => t.isActive).sort((a, b) => a.minProviders - b.minProviders);
  for (const tier of active) {
    const max = tier.maxProviders ?? Infinity;
    if (count >= tier.minProviders && count <= max) {
      return count * Number(tier.pricePerProviderMonth);
    }
  }
  const last = active[active.length - 1];
  return last ? count * Number(last.pricePerProviderMonth) : 0;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * @component ChangePlanDialog
 * @description Dialog for changing an account's subscription plan. Supports Custom mode
 *   (individual provider checkboxes with live pricing) and Bundle mode (pre-configured plan cards).
 * @param props.accountId - The account whose plan is being changed
 * @param props.accountName - Display name shown in the dialog header
 * @param props.currentProviders - Currently active provider IDs for pre-selection
 * @param props.onSuccess - Callback invoked after a successful plan change
 */
export function ChangePlanDialog({
  accountId,
  accountName,
  currentProviders,
  currentPlanType,
  currentBundleSlug,
  open,
  onOpenChange,
  onSuccess,
}: ChangePlanDialogProps) {
  const tcp = useTranslations("changePlan");
  const tc = useTranslations("common");
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"custom" | "bundle">("custom");
  const [selectedProviders, setSelectedProviders] = useState<string[]>([]);
  const [selectedBundleId, setSelectedBundleId] = useState<string | null>(null);
  const [tiersData, setTiersData] = useState<TiersData | null>(null);
  const [loadingTiers, setLoadingTiers] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Fetch tiers + reset on open
  useEffect(() => {
    if (!open) return;
    // Set tab and providers based on current plan type
    setSelectedProviders(currentPlanType === "bundle" ? [] : (currentProviders ?? []));
    setTab(currentPlanType === "bundle" ? "bundle" : "custom");

    // Pre-select current bundle (from cached tiers or after fetch)
    if (currentBundleSlug && tiersData) {
      const match = tiersData.bundles.find((b) => b.slug === currentBundleSlug);
      setSelectedBundleId(match?.id ?? null);
    } else {
      setSelectedBundleId(null);
    }

    if (!tiersData) {
      setLoadingTiers(true);
      fetch("/api/backend/admin/pricing/tiers", { credentials: "include" })
        .then((r) => r.json())
        .then((json: { ok?: boolean; data?: TiersData }) => {
          if (json.ok && json.data) {
            const activeBundles = (json.data.bundles ?? []).filter((b) => b.isActive);
            setTiersData({
              providerTiers: json.data.providerTiers ?? [],
              bundles: activeBundles,
            });
            // Pre-select bundle after first fetch
            if (currentBundleSlug) {
              const match = activeBundles.find((b) => b.slug === currentBundleSlug);
              if (match) setSelectedBundleId(match.id);
            }
          }
        })
        .catch(() =>
          toast({ title: tc("error"), description: tcp("failedLoad"), variant: "destructive" })
        )
        .finally(() => setLoadingTiers(false));
    }
  }, [open, currentProviders, currentPlanType, currentBundleSlug, tiersData, tc, tcp]);

  const toggleProvider = useCallback((id: string) => {
    setSelectedProviders((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  }, []);

  // Price calculations
  const customPrice = useMemo(
    () => (tiersData ? estimateCustomPrice(selectedProviders.length, tiersData.providerTiers) : 0),
    [selectedProviders.length, tiersData]
  );

  const perProvider = useMemo(
    () => (selectedProviders.length > 0 ? customPrice / selectedProviders.length : 0),
    [customPrice, selectedProviders.length]
  );

  const selectedBundle = useMemo(
    () => (selectedBundleId ? tiersData?.bundles.find((b) => b.id === selectedBundleId) : null),
    [selectedBundleId, tiersData]
  );

  const displayPrice =
    tab === "custom"
      ? customPrice
      : selectedBundle
        ? Number(selectedBundle.pricePerAccountMonth)
        : 0;
  const isValid =
    (tab === "custom" && selectedProviders.length > 0) || (tab === "bundle" && !!selectedBundleId);

  // Submit
  const handleApply = useCallback(async () => {
    if (!isValid) return;
    setIsSubmitting(true);
    try {
      const body =
        tab === "custom"
          ? { providers: selectedProviders, bundleId: null }
          : { bundleId: selectedBundleId };

      const res = await fetch(`/api/backend/admin/billing/accounts/${accountId}/subscription`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const apiErr = ApiError.fromResponse(res.status, body);
        toast({
          title: tc("error"),
          description: getErrorMessage(apiErr),
          variant: "destructive",
        });
        return;
      }

      toast({
        title: tcp("planUpdated"),
        description:
          tab === "custom"
            ? tcp("customApplied", { count: selectedProviders.length })
            : tcp("bundleApplied", { name: selectedBundle?.name ?? "Bundle" }),
      });
      await queryClient.refetchQueries({ queryKey: ["account", "billing", accountId] });
      queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["accounts", "summary"] });
      onOpenChange(false);
      onSuccess();
    } catch (e) {
      toast({
        title: tc("error"),
        description: getErrorMessage(e),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [
    isValid,
    tab,
    selectedProviders,
    selectedBundleId,
    selectedBundle,
    accountId,
    onOpenChange,
    onSuccess,
    queryClient,
    tc,
    tcp,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg overflow-hidden bg-[var(--bg-surface)] border-[var(--border-default)] p-0 gap-0 rounded-lg">
        {/* ── Header ── */}
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-[var(--border-subtle)]">
          <DialogTitle className="text-base font-semibold text-[var(--text-primary)]">
            {tcp("title")}
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm text-[var(--text-secondary)]">
            {accountName}
          </DialogDescription>
        </DialogHeader>

        {/* ── Tabs ── */}
        <div className="flex border-b border-[var(--border-subtle)]">
          <button
            type="button"
            onClick={() => setTab("custom")}
            className={[
              "flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]",
              tab === "custom"
                ? "border-b-2 border-[var(--accent)] text-[var(--accent)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]",
            ].join(" ")}
          >
            <Layers className="h-4 w-4" />
            {tcp("customTab")}
          </button>
          <button
            type="button"
            onClick={() => setTab("bundle")}
            className={[
              "flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]",
              tab === "bundle"
                ? "border-b-2 border-[var(--accent)] text-[var(--accent)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]",
            ].join(" ")}
          >
            <Package className="h-4 w-4" />
            {tcp("bundleTab")}
          </button>
        </div>

        {/* ── Content ── */}
        <div className="px-6 py-5 max-h-[55vh] overflow-y-auto">
          {loadingTiers ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }, (_, i) => (
                <div
                  key={`skel-${String(i)}`}
                  className="h-12 animate-pulse rounded-lg bg-[var(--bg-elevated)]"
                />
              ))}
            </div>
          ) : tab === "custom" ? (
            /* ── Custom tab ── */
            <div>
              <div className="flex items-baseline justify-between mb-4">
                <p className="text-sm text-[var(--text-secondary)]">{tcp("selectPlatforms")}</p>
                <span className="text-xs font-medium text-[var(--text-tertiary)]">
                  {selectedProviders.length} / {ALL_PROVIDERS.length}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {ALL_PROVIDERS.map(({ id, label }) => {
                  const checked = selectedProviders.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => toggleProvider(id)}
                      className={[
                        "relative flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all",
                        checked
                          ? "border-[var(--accent)] bg-[var(--accent-subtle)] ring-1 ring-[var(--accent)]"
                          : "border-[var(--border-default)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]",
                      ].join(" ")}
                    >
                      {/* Checkbox indicator */}
                      <span
                        className={[
                          "flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-sm border transition-colors",
                          checked
                            ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                            : "border-[var(--border-strong)] bg-[var(--bg-elevated)]",
                        ].join(" ")}
                      >
                        {checked && <Check className="h-3 w-3" />}
                      </span>

                      <div className="min-w-0">
                        <span
                          className={[
                            "block text-sm font-medium truncate",
                            checked ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]",
                          ].join(" ")}
                        >
                          {label}
                        </span>
                        {perProvider > 0 && checked && (
                          <span className="block text-[10px] font-mono text-[var(--accent)]">
                            ${perProvider.toFixed(2)}/mo
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            /* ── Bundle tab ── */
            <div>
              <p className="text-sm text-[var(--text-secondary)] mb-4">{tcp("chooseBundle")}</p>

              {!tiersData || tiersData.bundles.length === 0 ? (
                <div className="py-10 text-center">
                  <Package className="mx-auto h-8 w-8 text-[var(--text-tertiary)]" />
                  <p className="mt-2 text-sm text-[var(--text-tertiary)]">
                    {tcp("noActiveBundles")}
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {tiersData.bundles.map((bundle) => {
                    const selected = selectedBundleId === bundle.id;
                    return (
                      <button
                        key={bundle.id}
                        type="button"
                        onClick={() => setSelectedBundleId(bundle.id)}
                        className={[
                          "relative w-full rounded-lg border p-4 text-left transition-all",
                          selected
                            ? "border-[var(--accent)] bg-[var(--accent-subtle)] ring-1 ring-[var(--accent)]"
                            : "border-[var(--border-default)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-elevated)]",
                        ].join(" ")}
                      >
                        {/* Selected check */}
                        {selected && (
                          <span className="absolute top-3 right-3 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent)] text-white">
                            <Check className="h-3 w-3" />
                          </span>
                        )}

                        <div className="flex items-start justify-between gap-4 pr-6">
                          <div>
                            <p className="text-sm font-semibold text-[var(--text-primary)]">
                              {bundle.name}
                            </p>
                            {bundle.description && (
                              <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
                                {bundle.description}
                              </p>
                            )}
                            <div className="mt-2 flex flex-wrap gap-1">
                              {bundle.providers.map((p) => (
                                <Badge key={p} variant="neutral" size="sm">
                                  {p}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <span className="text-lg font-bold font-mono text-[var(--text-primary)]">
                              ${Number(bundle.pricePerAccountMonth).toFixed(0)}
                            </span>
                            <span className="block text-[10px] text-[var(--text-tertiary)]">
                              {tcp("perAccountMo")}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer: Price preview + Actions ── */}
        <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-6 py-4">
          <div className="flex items-center justify-between">
            {/* Price */}
            <div>
              {isValid ? (
                <>
                  <span className="text-xl font-bold font-mono text-[var(--text-primary)]">
                    ${displayPrice.toFixed(2)}
                  </span>
                  <span className="ml-1 text-sm text-[var(--text-tertiary)]">
                    {tcp("perMonth")}
                  </span>
                  {tab === "custom" && selectedProviders.length > 0 && (
                    <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                      {selectedProviders.length}{" "}
                      {selectedProviders.length !== 1 ? tcp("providersPlural") : tcp("providers")}{" "}
                      &times; ${perProvider.toFixed(2)}
                    </p>
                  )}
                  {tab === "bundle" && selectedBundle && (
                    <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                      {selectedBundle.name} &middot; {selectedBundle.providers.length}{" "}
                      {tcp("providersIncluded")}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-[var(--text-tertiary)]">{tcp("selectPlanPrompt")}</p>
              )}
            </div>

            {/* Buttons */}
            <div className="flex items-center gap-2">
              <ActionButton variant="secondary" size="md" onClick={() => onOpenChange(false)}>
                {tc("cancel")}
              </ActionButton>
              <ActionButton
                variant="primary"
                size="md"
                loading={isSubmitting}
                disabled={!isValid}
                onClick={handleApply}
              >
                {tcp("savePlan")}
              </ActionButton>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
