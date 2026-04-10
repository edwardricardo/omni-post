/**
 * @file ProviderTiersTab.tsx
 * @description Provider tiers table with inline editing, status toggle, and create dialog.
 * @layer presentation
 */
"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import {
  toast,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@packages/ui";
import { getErrorMessage } from "@/lib/parseApiError";
import { DataTable } from "@/components/ui/DataTable";
import { ActionButton } from "@/components/ui/ActionButton";

import {
  useUpdateProviderTier,
  useCreateProviderTier,
  useToggleTierStatus,
} from "@/hooks/api/usePricingTiers";
import type { ProviderTier } from "@/hooks/api/usePricingTiers";

const INPUT_CLASS =
  "w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-1 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]";

interface ProviderTiersTabProps {
  tiers: ProviderTier[];
  isLoading: boolean;
}

export function ProviderTiersTab({ tiers, isLoading }: ProviderTiersTabProps) {
  const tp = useTranslations("pricing");
  const tc = useTranslations("common");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string | number | null>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [newMin, setNewMin] = useState(1);
  const [newMax, setNewMax] = useState<number | null>(null);
  const [newPrice, setNewPrice] = useState(0);

  const mutation = useUpdateProviderTier();
  const createMutation = useCreateProviderTier();
  const toggleMutation = useToggleTierStatus();

  const handleEdit = useCallback((tier: ProviderTier) => {
    setEditingId(tier.id);
    setEditForm({
      minProviders: Number(tier.minProviders),
      maxProviders: tier.maxProviders !== null ? Number(tier.maxProviders) : null,
      pricePerProviderMonth: Number(tier.pricePerProviderMonth),
    });
  }, []);

  const handleSave = useCallback(
    (id: string) => {
      const data = {
        ...editForm,
        ...(editForm.pricePerProviderMonth !== undefined && {
          pricePerProviderMonth: Number(editForm.pricePerProviderMonth),
        }),
        ...(editForm.minProviders !== undefined && { minProviders: Number(editForm.minProviders) }),
        ...(editForm.maxProviders !== undefined &&
          editForm.maxProviders !== null && { maxProviders: Number(editForm.maxProviders) }),
      };
      mutation.mutate(
        { id, data },
        {
          onSuccess: () => {
            toast({ title: tc("success"), description: tp("toasts.tierUpdated") });
            setEditingId(null);
          },
          onError: (err) => {
            toast({
              title: tc("error"),
              description: getErrorMessage(err),
              variant: "destructive",
            });
          },
        }
      );
    },
    [editForm, mutation, tc, tp]
  );

  const handleCancel = useCallback(() => {
    setEditingId(null);
  }, []);

  const handleToggleStatus = useCallback(
    (tier: ProviderTier) => {
      toggleMutation.mutate(
        { type: "provider", id: tier.id, isActive: !tier.isActive },
        {
          onSuccess: () => {
            toast({
              title: tc("success"),
              description: tier.isActive
                ? tp("toasts.tierDeactivated")
                : tp("toasts.tierActivated"),
            });
          },
          onError: (err) => {
            toast({
              title: tc("error"),
              description: getErrorMessage(err),
              variant: "destructive",
            });
          },
        }
      );
    },
    [toggleMutation, tc, tp]
  );

  const handleCreateSubmit = useCallback(() => {
    if (newPrice <= 0) {
      toast({
        title: tp("toasts.validationError"),
        description: tp("priceMustBePositive"),
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate(
      { minProviders: newMin, maxProviders: newMax, pricePerProviderMonth: newPrice },
      {
        onSuccess: () => {
          toast({ title: tc("success"), description: tp("toasts.tierCreated") });
          setCreateOpen(false);
          setNewMin(1);
          setNewMax(null);
          setNewPrice(0);
        },
        onError: (err) => {
          toast({ title: tc("error"), description: getErrorMessage(err), variant: "destructive" });
        },
      }
    );
  }, [newMin, newMax, newPrice, createMutation, tc, tp]);

  const columns = [
    {
      key: "minProviders",
      header: tp("providerTiers.minProviders"),
      render: (t: ProviderTier) =>
        editingId === t.id ? (
          <input
            type="number"
            className={INPUT_CLASS}
            value={editForm.minProviders ?? ""}
            onChange={(e) =>
              setEditForm((prev) => ({ ...prev, minProviders: Number(e.target.value) }))
            }
          />
        ) : (
          String(t.minProviders)
        ),
    },
    {
      key: "maxProviders",
      header: tp("providerTiers.maxProviders"),
      render: (t: ProviderTier) =>
        editingId === t.id ? (
          <input
            type="number"
            className={INPUT_CLASS}
            value={editForm.maxProviders ?? ""}
            onChange={(e) =>
              setEditForm((prev) => ({
                ...prev,
                maxProviders: e.target.value === "" ? null : Number(e.target.value),
              }))
            }
          />
        ) : t.maxProviders !== null ? (
          String(t.maxProviders)
        ) : (
          tp("accountTiers.noLimit")
        ),
    },
    {
      key: "price",
      header: tp("providerTiers.pricePerMonth"),
      render: (t: ProviderTier) =>
        editingId === t.id ? (
          <input
            type="number"
            step="0.01"
            className={INPUT_CLASS}
            value={editForm.pricePerProviderMonth ?? ""}
            onChange={(e) =>
              setEditForm((prev) => ({
                ...prev,
                pricePerProviderMonth: Number(e.target.value),
              }))
            }
          />
        ) : (
          <span className="font-mono text-[var(--text-primary)]">
            ${Number(t.pricePerProviderMonth).toFixed(2)}
          </span>
        ),
    },
    {
      key: "status",
      header: tc("active"),
      render: (t: ProviderTier) => (
        <button
          type="button"
          role="switch"
          aria-checked={t.isActive}
          onClick={() => handleToggleStatus(t)}
          disabled={toggleMutation.isPending}
          className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50"
          style={{ backgroundColor: t.isActive ? "var(--success)" : "var(--border-strong)" }}
          aria-label={t.isActive ? tp("deactivateTier") : tp("activateTier")}
        >
          <span
            className="pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform"
            style={{ transform: t.isActive ? "translateX(16px)" : "translateX(2px)" }}
          />
        </button>
      ),
    },
    {
      key: "actions",
      header: tc("actions"),
      render: (t: ProviderTier) =>
        editingId === t.id ? (
          <div className="flex gap-1">
            <ActionButton
              variant="primary"
              size="sm"
              loading={mutation.isPending}
              onClick={() => handleSave(t.id)}
            >
              {tc("save")}
            </ActionButton>
            <ActionButton variant="secondary" size="sm" onClick={handleCancel}>
              {tc("cancel")}
            </ActionButton>
          </div>
        ) : (
          <ActionButton variant="secondary" size="sm" onClick={() => handleEdit(t)}>
            {tc("edit")}
          </ActionButton>
        ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          {tp("providerTiers.title")}
        </h3>
        <ActionButton variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          {tp("newTier")}
        </ActionButton>
      </div>

      <DataTable<ProviderTier>
        columns={columns}
        data={tiers}
        isLoading={isLoading}
        rowKey={(t) => t.id}
        emptyMessage={tp("noProviderTiers")}
      />

      {/* Create Provider Tier Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{tp("newProviderTier")}</DialogTitle>
            <DialogDescription>{tp("newProviderTierDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label
                htmlFor="new-pt-min"
                className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
              >
                {tp("providerTiers.minProviders")}
              </label>
              <input
                id="new-pt-min"
                type="number"
                min={1}
                className={INPUT_CLASS}
                value={newMin}
                onChange={(e) => setNewMin(Number(e.target.value))}
              />
            </div>
            <div>
              <label
                htmlFor="new-pt-max"
                className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
              >
                {tp("providerTiers.maxProviders")} {tp("maxOptional")}
              </label>
              <input
                id="new-pt-max"
                type="number"
                className={INPUT_CLASS}
                value={newMax ?? ""}
                onChange={(e) => setNewMax(e.target.value === "" ? null : Number(e.target.value))}
              />
            </div>
            <div>
              <label
                htmlFor="new-pt-price"
                className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
              >
                {tp("pricePerProviderMonth")}
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-[var(--text-tertiary)]">
                  $
                </span>
                <input
                  id="new-pt-price"
                  type="number"
                  step="0.01"
                  min={0}
                  className={`${INPUT_CLASS} pl-5`}
                  value={newPrice}
                  onChange={(e) => setNewPrice(Number(e.target.value))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <ActionButton variant="secondary" size="sm" onClick={() => setCreateOpen(false)}>
              {tc("cancel")}
            </ActionButton>
            <ActionButton
              variant="primary"
              size="sm"
              loading={createMutation.isPending}
              onClick={handleCreateSubmit}
            >
              {tp("createTier")}
            </ActionButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
