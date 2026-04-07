/**
 * @file page.tsx
 * @description Admin pricing management page with live provider tiers, account tiers,
 *   bundles (CRUD), and MRR dashboard. Delegates to functional tab components.
 * @layer page
 */
"use client";

import { useCallback, useState } from "react";
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
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

const TABS = [
  { key: "providers", label: "Provider Tiers" },
  { key: "accounts", label: "Account Tiers" },
  { key: "bundles", label: "Bundles" },
  { key: "mrr", label: "MRR Dashboard" },
];

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
  const { data, isLoading, error, refetch } = usePricingTiers();
  const [activeTab, setActiveTab] = useState("providers");

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
      toast({ title: "Success", description: "Bundle updated" });
      setEditingBundleId(null);
      setBundleForm(EMPTY_BUNDLE_FORM);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Update failed",
        variant: "destructive",
      });
    }
  }, [editingBundleId, bundleForm, updateBundle]);

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
      toast({ title: "Success", description: "Bundle created" });
      setShowCreateBundle(false);
      setBundleForm(EMPTY_BUNDLE_FORM);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Create failed",
        variant: "destructive",
      });
    }
  }, [bundleForm, createBundle]);

  const handleDeleteBundle = useCallback(async () => {
    if (!deleteBundleTarget) return;
    try {
      await deleteBundle.mutateAsync(deleteBundleTarget);
      toast({ title: "Success", description: "Bundle deleted" });
      setDeleteBundleOpen(false);
      setDeleteBundleTarget("");
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Delete failed",
        variant: "destructive",
      });
    }
  }, [deleteBundleTarget, deleteBundle]);

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
          <LoadingSpinner size="lg" label="Loading pricing tiers..." />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title={t("pricing")} />
        <div className="flex justify-center items-center h-64" role="alert" aria-live="assertive">
          <div className="text-sm text-[var(--error)]">Error: {error.message}</div>
          <ActionButton variant="primary" size="sm" onClick={handleRefresh} className="ml-4">
            Retry
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
        description="Configure provider tiers, account discounts, and bundles. Price changes trigger grandfathering for existing customers."
        actions={
          <ActionButton variant="primary" size="sm" onClick={handleRefresh} loading={isLoading}>
            Refresh
          </ActionButton>
        }
      />

      <TabNav tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />

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
                aria-label="Create new bundle"
              >
                New Bundle
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
                      {bundle.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <p className="text-sm text-[var(--text-secondary)]">{bundle.description}</p>
                  <p className="text-xs text-[var(--text-tertiary)] mt-1">
                    Providers: {bundle.providers.join(", ")}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-mono font-semibold text-[var(--text-primary)]">
                    ${Number(bundle.pricePerAccountMonth).toFixed(2)}/account/mo
                  </span>
                  <div className="flex gap-2">
                    <ActionButton
                      variant="secondary"
                      size="sm"
                      onClick={() => handleEditBundle(bundle)}
                      aria-label={`Edit bundle ${bundle.name}`}
                    >
                      Edit
                    </ActionButton>
                    <ActionButton
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        setDeleteBundleTarget(bundle.id);
                        setDeleteBundleOpen(true);
                      }}
                      aria-label={`Delete bundle ${bundle.name}`}
                    >
                      Delete
                    </ActionButton>
                  </div>
                </div>
              </div>
            ))}

            {bundles.length === 0 && (
              <div className="text-center py-12 text-[var(--text-secondary)]" role="status">
                No bundles configured yet.
              </div>
            )}
          </div>
        )}

        {activeTab === "mrr" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard
              label="Active Bundles"
              value={String(bundles.filter((b) => b.isActive).length)}
            />
            <StatCard label="Bundle Base MRR" value={`$${totalMRR.toFixed(2)}`} />
            <StatCard label="Total Provider Tiers" value={String(providerTiers.length)} />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleteBundleOpen}
        onOpenChange={setDeleteBundleOpen}
        title="Delete Bundle"
        description="This will permanently delete this bundle. Existing subscribers will be grandfathered."
        variant="danger"
        confirmLabel="Delete Bundle"
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
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: BundleFormData;
  onChange: (form: BundleFormData) => void;
  onSave: () => void;
  isEdit: boolean;
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
            {isEdit ? "Edit Bundle" : "New Bundle"}
          </DialogTitle>
          <DialogDescription className="text-sm text-[var(--text-secondary)]">
            {isEdit ? "Update bundle details and providers" : "Create a new provider bundle"}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="bundle-name"
                className="block text-sm font-medium text-[var(--text-secondary)] mb-1"
              >
                Name
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
                Slug
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
                Price / Account / Month
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
                Sort Order
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
              Description
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
              Providers ({providerList.length} selected)
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
            Cancel
          </ActionButton>
          <ActionButton variant="primary" size="sm" onClick={onSave} loading={loading}>
            {isEdit ? "Save Changes" : "Create Bundle"}
          </ActionButton>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Page() {
  return <PricingPageContent />;
}
