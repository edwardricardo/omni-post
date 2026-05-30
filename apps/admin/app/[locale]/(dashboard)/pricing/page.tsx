/**
 * @file page.tsx
 * @description Admin pricing management page with live provider tiers, account tiers,
 *   bundles (CRUD), and MRR dashboard. Delegates to functional tab components.
 * @layer infrastructure
 */
"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  toast,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@packages/ui";
import { PROVIDER_NAMES } from "@shared/types";

import { isPermissionDenied, getErrorMessage } from "@packages/api-errors";
import { AccessDenied } from "@/components/shared/AccessDenied";
import {
  usePricingTiers,
  useUpdateBundle,
  useCreateBundle,
  useDeleteBundle,
} from "@/hooks/api/usePricingTiers";
import type { PricingBundle } from "@/hooks/api/usePricingTiers";
import { ProviderTiersTab } from "@/components/pricing/ProviderTiersTab";
import { AccountTiersTab } from "@/components/pricing/AccountTiersTab";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { PageHeader } from "@/components/ui/PageHeader";
import { TabNav } from "@/components/ui/TabNav";
import { ActionButton } from "@/components/ui/ActionButton";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/StatCard";
import { ConfirmDialog } from "@packages/ui";

const EMPTY_BUNDLE_FORM: BundleFormData = {
  name: "",
  slug: "",
  description: "",
  providers: "",
  pricePerAccountMonth: 0,
  sortOrder: 0,
};

interface BundleFormData {
  name: string;
  slug: string;
  description: string;
  providers: string;
  pricePerAccountMonth: number;
  sortOrder: number;
}

function PricingPageContent() {
  const t = useTranslations("nav");
  const tp = useTranslations("pricing");
  const tc = useTranslations("common");
  const { data, isLoading, error, refetch } = usePricingTiers();
  const [activeTab, setActiveTab] = useState("providers");

  const tabs = useMemo(
    () => [
      { key: "providers", label: tp("tabs.providerTiers") },
      { key: "accounts", label: tp("tabs.accountTiers") },
      { key: "bundles", label: tp("tabs.bundles") },
      { key: "mrr", label: tp("tabs.mrrDashboard") },
    ],
    [tp]
  );

  // Bundle CRUD state
  const [editingBundleId, setEditingBundleId] = useState<string | null>(null);
  const [bundleForm, setBundleForm] = useState<BundleFormData>(EMPTY_BUNDLE_FORM);
  const [showCreateBundle, setShowCreateBundle] = useState(false);
  const [deleteBundleOpen, setDeleteBundleOpen] = useState(false);
  const [deleteBundleTarget, setDeleteBundleTarget] = useState("");

  const updateBundle = useUpdateBundle();
  const createBundle = useCreateBundle();
  const deleteBundle = useDeleteBundle();

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const handleEditBundle = useCallback((bundle: PricingBundle) => {
    setEditingBundleId(bundle.id);
    setBundleForm({
      name: bundle.name,
      slug: bundle.slug,
      description: bundle.description,
      providers: bundle.providers.join(", "),
      pricePerAccountMonth: Number(bundle.pricePerAccountMonth),
      sortOrder: Number(bundle.sortOrder),
    });
  }, []);

  const handleSaveBundle = useCallback(async () => {
    if (!editingBundleId) return;
    try {
      await updateBundle.mutateAsync({
        id: editingBundleId,
        data: {
          name: bundleForm.name,
          slug: bundleForm.slug,
          description: bundleForm.description,
          providers: bundleForm.providers
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean),
          pricePerAccountMonth: Number(bundleForm.pricePerAccountMonth),
          sortOrder: Number(bundleForm.sortOrder),
        },
      });
      toast({ title: tc("success"), description: tp("toasts.bundleUpdated") });
      setEditingBundleId(null);
      setBundleForm(EMPTY_BUNDLE_FORM);
    } catch (err) {
      toast({
        title: tc("error"),
        description: getErrorMessage(err),
        variant: "destructive",
      });
    }
  }, [editingBundleId, bundleForm, updateBundle, tc, tp]);

  const handleCreateBundle = useCallback(async () => {
    if (!bundleForm.name || !bundleForm.slug) return;
    try {
      await createBundle.mutateAsync({
        name: bundleForm.name,
        slug: bundleForm.slug,
        description: bundleForm.description,
        providers: bundleForm.providers
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean),
        pricePerAccountMonth: Number(bundleForm.pricePerAccountMonth),
        sortOrder: Number(bundleForm.sortOrder),
      });
      toast({ title: tc("success"), description: tp("toasts.bundleCreated") });
      setShowCreateBundle(false);
      setBundleForm(EMPTY_BUNDLE_FORM);
    } catch (err) {
      toast({
        title: tc("error"),
        description: getErrorMessage(err),
        variant: "destructive",
      });
    }
  }, [bundleForm, createBundle, tc, tp]);

  const handleDeleteBundle = useCallback(async () => {
    if (!deleteBundleTarget) return;
    try {
      await deleteBundle.mutateAsync(deleteBundleTarget);
      toast({ title: tc("success"), description: tp("toasts.bundleDeleted") });
      setDeleteBundleOpen(false);
      setDeleteBundleTarget("");
    } catch (err) {
      toast({
        title: tc("error"),
        description: getErrorMessage(err),
        variant: "destructive",
      });
    }
  }, [deleteBundleTarget, deleteBundle, tc, tp]);

  const handleCancelBundleEdit = useCallback(() => {
    setEditingBundleId(null);
    setShowCreateBundle(false);
    setBundleForm(EMPTY_BUNDLE_FORM);
  }, []);

  if (isLoading) {
    return (
      <div>
        <PageHeader title={t("pricing")} />
        <div className="flex justify-center items-center h-64">
          <LoadingSpinner size="lg" label={tp("loading")} />
        </div>
      </div>
    );
  }

  if (error) {
    if (isPermissionDenied(error)) {
      return (
        <div>
          <PageHeader title={t("pricing")} />
          <AccessDenied />
        </div>
      );
    }
    return (
      <div>
        <PageHeader title={t("pricing")} />
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

  const providerTiers = data?.providerTiers ?? [];
  const accountTiers = data?.accountTiers ?? [];
  const bundles = data?.bundles ?? [];

  const totalMRR = bundles
    .filter((b) => b.isActive)
    .reduce((sum, b) => sum + Number(b.pricePerAccountMonth), 0);

  return (
    <div>
      <PageHeader
        title={t("pricing")}
        description={tp("description")}
        actions={
          <ActionButton variant="primary" size="sm" onClick={handleRefresh} loading={isLoading}>
            {tc("refresh")}
          </ActionButton>
        }
      />

      <TabNav tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      <div className="mt-4">
        {activeTab === "providers" && (
          <ProviderTiersTab tiers={providerTiers} isLoading={isLoading} />
        )}

        {activeTab === "accounts" && <AccountTiersTab tiers={accountTiers} isLoading={isLoading} />}

        {activeTab === "bundles" && (
          <div className="space-y-4">
            <div className="flex justify-end">
              <ActionButton
                variant="primary"
                size="sm"
                onClick={() => {
                  setBundleForm(EMPTY_BUNDLE_FORM);
                  setShowCreateBundle(true);
                }}
                aria-label={tp("bundles.newBundle")}
              >
                {tp("bundles.newBundle")}
              </ActionButton>
            </div>

            {/* Bundle Dialog */}
            <BundleFormDialog
              open={showCreateBundle || !!editingBundleId}
              onOpenChange={(open) => {
                if (!open) handleCancelBundleEdit();
              }}
              form={bundleForm}
              onChange={setBundleForm}
              onSave={editingBundleId ? handleSaveBundle : handleCreateBundle}
              isEdit={!!editingBundleId}
              loading={updateBundle.isPending || createBundle.isPending}
            />

            {/* Bundle list */}
            {bundles.map((bundle) => (
              <div
                key={bundle.id}
                className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 flex items-center justify-between"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-[var(--text-primary)]">{bundle.name}</h3>
                    <Badge variant={bundle.isActive ? "success" : "neutral"}>
                      {bundle.isActive ? tp("bundles.active") : tp("bundles.inactive")}
                    </Badge>
                  </div>
                  <p className="text-sm text-[var(--text-secondary)]">{bundle.description}</p>
                  <p className="text-xs text-[var(--text-tertiary)] mt-1">
                    {tp("bundles.providers")}: {bundle.providers.join(", ")}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-mono font-semibold text-[var(--text-primary)]">
                    $
                    {tp("bundles.perAccountMonth", {
                      price: Number(bundle.pricePerAccountMonth).toFixed(2),
                    })}
                  </span>
                  <div className="flex gap-2">
                    <ActionButton
                      variant="secondary"
                      size="sm"
                      onClick={() => handleEditBundle(bundle)}
                      aria-label={`${tc("edit")} ${bundle.name}`}
                    >
                      {tc("edit")}
                    </ActionButton>
                    <ActionButton
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        setDeleteBundleTarget(bundle.id);
                        setDeleteBundleOpen(true);
                      }}
                      aria-label={`${tc("delete")} ${bundle.name}`}
                    >
                      {tc("delete")}
                    </ActionButton>
                  </div>
                </div>
              </div>
            ))}

            {bundles.length === 0 && (
              <div className="text-center py-12 text-[var(--text-secondary)]" role="status">
                {tp("bundles.noBundles")}
              </div>
            )}
          </div>
        )}

        {activeTab === "mrr" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard
              label={tp("mrr.activeBundles")}
              value={String(bundles.filter((b) => b.isActive).length)}
            />
            <StatCard label={tp("mrr.bundleBaseMrr")} value={`$${totalMRR.toFixed(2)}`} />
            <StatCard label={tp("mrr.totalProviderTiers")} value={String(providerTiers.length)} />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleteBundleOpen}
        onOpenChange={setDeleteBundleOpen}
        title={tp("bundles.deleteTitle")}
        description={tp("bundles.deleteDescription")}
        variant="danger"
        confirmLabel={tp("bundles.deleteConfirm")}
        onConfirm={handleDeleteBundle}
        loading={deleteBundle.isPending}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bundle inline form
// ---------------------------------------------------------------------------

const INPUT_CLASS =
  "w-full px-3 py-2 border border-[var(--border-default)] rounded-md bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)] text-sm";

interface BundleFormDialogProps {
  /** Whether the dialog is currently visible. */
  open: boolean;
  /** Fired to toggle dialog visibility, mirroring the Radix Dialog API. */
  onOpenChange: (open: boolean) => void;
  /** Current bundle form draft values. */
  form: BundleFormData;
  /** Fired with the next form values whenever the user edits a field. */
  onChange: (form: BundleFormData) => void;
  /** Fired when the user confirms the save action. */
  onSave: () => void;
  /** When true, treats the dialog as an edit of an existing bundle (vs create). */
  isEdit: boolean;
  /** When true, shows a loading spinner on the save button. */
  loading: boolean;
}

function BundleFormDialog({
  open,
  onOpenChange,
  form,
  onChange,
  onSave,
  isEdit,
  loading,
}: BundleFormDialogProps) {
  const tp = useTranslations("pricing");
  const tc = useTranslations("common");

  const providerList =
    typeof form.providers === "string"
      ? form.providers
          .split(",")
          .map((p) => p.trim().toUpperCase())
          .filter(Boolean)
      : (form.providers as string[]);

  const toggleProvider = (provider: string) => {
    const updated = providerList.includes(provider)
      ? providerList.filter((p) => p !== provider)
      : [...providerList, provider];
    onChange({ ...form, providers: updated.join(",") });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg overflow-hidden bg-[var(--bg-surface)] border-[var(--border-default)] p-0 gap-0 rounded-lg">
        <DialogHeader className="px-6 pt-5 pb-4 border-b border-[var(--border-subtle)]">
          <DialogTitle className="text-base font-semibold text-[var(--text-primary)]">
            {isEdit ? tp("bundles.editBundle") : tp("bundles.newBundle")}
          </DialogTitle>
          <DialogDescription className="text-sm text-[var(--text-secondary)]">
            {isEdit ? tp("bundles.updateDescription") : tp("bundles.createDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="bundle-name"
                className="block text-sm font-medium text-[var(--text-secondary)] mb-1"
              >
                {tp("bundles.name")}
              </label>
              <input
                id="bundle-name"
                type="text"
                value={form.name}
                onChange={(e) => onChange({ ...form, name: e.target.value })}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label
                htmlFor="bundle-slug"
                className="block text-sm font-medium text-[var(--text-secondary)] mb-1"
              >
                {tp("bundles.slug")}
              </label>
              <input
                id="bundle-slug"
                type="text"
                value={form.slug}
                onChange={(e) => onChange({ ...form, slug: e.target.value })}
                className={INPUT_CLASS}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="bundle-price"
                className="block text-sm font-medium text-[var(--text-secondary)] mb-1"
              >
                {tp("bundles.priceLabel")}
              </label>
              <input
                id="bundle-price"
                type="number"
                step="0.01"
                min="0"
                value={form.pricePerAccountMonth}
                onChange={(e) =>
                  onChange({ ...form, pricePerAccountMonth: Number(e.target.value) })
                }
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label
                htmlFor="bundle-order"
                className="block text-sm font-medium text-[var(--text-secondary)] mb-1"
              >
                {tp("bundles.sortOrder")}
              </label>
              <input
                id="bundle-order"
                type="number"
                min="0"
                value={form.sortOrder}
                onChange={(e) => onChange({ ...form, sortOrder: Number(e.target.value) })}
                className={INPUT_CLASS}
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="bundle-desc"
              className="block text-sm font-medium text-[var(--text-secondary)] mb-1"
            >
              {tp("bundles.descriptionLabel")}
            </label>
            <input
              id="bundle-desc"
              type="text"
              value={form.description}
              onChange={(e) => onChange({ ...form, description: e.target.value })}
              className={INPUT_CLASS}
            />
          </div>

          {/* Provider selection */}
          <div>
            <span className="block text-sm font-medium text-[var(--text-secondary)] mb-2">
              {tp("bundles.providersSelected", { count: providerList.length })}
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {PROVIDER_NAMES.map((provider) => {
                const checked = providerList.includes(provider);
                return (
                  <button
                    key={provider}
                    type="button"
                    onClick={() => toggleProvider(provider)}
                    className={[
                      "rounded-md border px-2.5 py-2 text-xs font-medium transition-colors",
                      checked
                        ? "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--text-primary)]"
                        : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]",
                    ].join(" ")}
                  >
                    {provider}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-6 py-4 flex justify-end gap-2">
          <ActionButton variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </ActionButton>
          <ActionButton variant="primary" size="sm" onClick={onSave} loading={loading}>
            {isEdit ? tp("bundles.saveChanges") : tp("bundles.createBundle")}
          </ActionButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * @component PricingPage
 * @description Manages pricing configuration including provider tiers, account tiers, bundles (CRUD), and MRR dashboard.
 */
export default function Page() {
  return <PricingPageContent />;
}
