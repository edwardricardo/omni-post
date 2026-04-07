/**
 * @file AccountTiersTab.tsx
 * @description Account tiers table with inline editing, status toggle, and create dialog.
 * @layer presentation
 */
"use client";

import { useState, useCallback } from "react";
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
import { DataTable } from "@/components/ui/DataTable";
import { ActionButton } from "@/components/ui/ActionButton";

import {
  useUpdateAccountTier,
  useCreateAccountTier,
  useToggleTierStatus,
} from "@/hooks/api/usePricingTiers";
import type { AccountTier } from "@/hooks/api/usePricingTiers";

const INPUT_CLASS =
  "w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-1 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]";

interface AccountTiersTabProps {
  tiers: AccountTier[];
  isLoading: boolean;
}

export function AccountTiersTab({ tiers, isLoading }: AccountTiersTabProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string | number | null>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [newMin, setNewMin] = useState(1);
  const [newMax, setNewMax] = useState<number | null>(null);
  const [newMultiplier, setNewMultiplier] = useState(1);

  const mutation = useUpdateAccountTier();
  const createMutation = useCreateAccountTier();
  const toggleMutation = useToggleTierStatus();

  const handleEdit = useCallback((tier: AccountTier) => {
    setEditingId(tier.id);
    setEditForm({
      minAccounts: Number(tier.minAccounts),
      maxAccounts: tier.maxAccounts !== null ? Number(tier.maxAccounts) : null,
      multiplier: Number(tier.multiplier),
    });
  }, []);

  const handleSave = useCallback(
    (id: string) => {
      const data = {
        ...editForm,
        ...(editForm.multiplier !== undefined && { multiplier: Number(editForm.multiplier) }),
        ...(editForm.minAccounts !== undefined && { minAccounts: Number(editForm.minAccounts) }),
        ...(editForm.maxAccounts !== undefined &&
          editForm.maxAccounts !== null && { maxAccounts: Number(editForm.maxAccounts) }),
      };
      mutation.mutate(
        { id, data },
        {
          onSuccess: () => {
            toast({ title: "Updated", description: "Account tier saved" });
            setEditingId(null);
          },
          onError: (err) => {
            toast({
              title: "Error",
              description: err instanceof Error ? err.message : "Failed to save",
              variant: "destructive",
            });
          },
        }
      );
    },
    [editForm, mutation]
  );

  const handleCancel = useCallback(() => {
    setEditingId(null);
  }, []);

  const handleToggleStatus = useCallback(
    (tier: AccountTier) => {
      toggleMutation.mutate(
        { type: "account", id: tier.id, isActive: !tier.isActive },
        {
          onSuccess: () => {
            toast({
              title: "Updated",
              description: `Tier ${tier.isActive ? "deactivated" : "activated"}`,
            });
          },
          onError: (err) => {
            toast({ title: "Error", description: err.message, variant: "destructive" });
          },
        }
      );
    },
    [toggleMutation]
  );

  const handleCreateSubmit = useCallback(() => {
    if (newMultiplier <= 0) {
      toast({
        title: "Validation",
        description: "Multiplier must be greater than 0",
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate(
      { minAccounts: newMin, maxAccounts: newMax, multiplier: newMultiplier },
      {
        onSuccess: () => {
          toast({ title: "Success", description: "Account tier created" });
          setCreateOpen(false);
          setNewMin(1);
          setNewMax(null);
          setNewMultiplier(1);
        },
        onError: (err) => {
          toast({ title: "Error", description: err.message, variant: "destructive" });
        },
      }
    );
  }, [newMin, newMax, newMultiplier, createMutation]);

  const columns = [
    {
      key: "minAccounts",
      header: "Min Accounts",
      render: (t: AccountTier) =>
        editingId === t.id ? (
          <input
            type="number"
            className={INPUT_CLASS}
            value={editForm.minAccounts ?? ""}
            onChange={(e) =>
              setEditForm((prev) => ({ ...prev, minAccounts: Number(e.target.value) }))
            }
          />
        ) : (
          String(t.minAccounts)
        ),
    },
    {
      key: "maxAccounts",
      header: "Max Accounts",
      render: (t: AccountTier) =>
        editingId === t.id ? (
          <input
            type="number"
            className={INPUT_CLASS}
            value={editForm.maxAccounts ?? ""}
            onChange={(e) =>
              setEditForm((prev) => ({
                ...prev,
                maxAccounts: e.target.value === "" ? null : Number(e.target.value),
              }))
            }
          />
        ) : t.maxAccounts !== null ? (
          String(t.maxAccounts)
        ) : (
          "No limit"
        ),
    },
    {
      key: "multiplier",
      header: "Multiplier",
      render: (t: AccountTier) =>
        editingId === t.id ? (
          <input
            type="number"
            step="0.001"
            className={INPUT_CLASS}
            value={editForm.multiplier ?? ""}
            onChange={(e) =>
              setEditForm((prev) => ({ ...prev, multiplier: Number(e.target.value) }))
            }
          />
        ) : (
          <span className="font-mono text-[var(--text-primary)]">
            {Number(t.multiplier).toFixed(3)}
          </span>
        ),
    },
    {
      key: "status",
      header: "Active",
      render: (t: AccountTier) => (
        <button
          type="button"
          role="switch"
          aria-checked={t.isActive}
          onClick={() => handleToggleStatus(t)}
          disabled={toggleMutation.isPending}
          className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:opacity-50"
          style={{ backgroundColor: t.isActive ? "var(--success)" : "var(--border-strong)" }}
          aria-label={`${t.isActive ? "Deactivate" : "Activate"} tier`}
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
      header: "Actions",
      render: (t: AccountTier) =>
        editingId === t.id ? (
          <div className="flex gap-1">
            <ActionButton
              variant="primary"
              size="sm"
              loading={mutation.isPending}
              onClick={() => handleSave(t.id)}
            >
              Save
            </ActionButton>
            <ActionButton variant="secondary" size="sm" onClick={handleCancel}>
              Cancel
            </ActionButton>
          </div>
        ) : (
          <ActionButton variant="secondary" size="sm" onClick={() => handleEdit(t)}>
            Edit
          </ActionButton>
        ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Account Tiers</h3>
        <ActionButton variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          New Tier
        </ActionButton>
      </div>

      <DataTable<AccountTier>
        columns={columns}
        data={tiers}
        isLoading={isLoading}
        rowKey={(t) => t.id}
        emptyMessage="No account tiers configured"
      />

      {/* Create Account Tier Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New Account Tier</DialogTitle>
            <DialogDescription>Define a new pricing tier based on account count.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label
                htmlFor="new-at-min"
                className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
              >
                Min Accounts
              </label>
              <input
                id="new-at-min"
                type="number"
                min={1}
                className={INPUT_CLASS}
                value={newMin}
                onChange={(e) => setNewMin(Number(e.target.value))}
              />
            </div>
            <div>
              <label
                htmlFor="new-at-max"
                className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
              >
                Max Accounts (optional)
              </label>
              <input
                id="new-at-max"
                type="number"
                className={INPUT_CLASS}
                value={newMax ?? ""}
                onChange={(e) => setNewMax(e.target.value === "" ? null : Number(e.target.value))}
              />
            </div>
            <div>
              <label
                htmlFor="new-at-multiplier"
                className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
              >
                Multiplier
              </label>
              <input
                id="new-at-multiplier"
                type="number"
                step="0.001"
                min={0}
                className={INPUT_CLASS}
                value={newMultiplier}
                onChange={(e) => setNewMultiplier(Number(e.target.value))}
              />
            </div>
          </div>
          <DialogFooter>
            <ActionButton variant="secondary" size="sm" onClick={() => setCreateOpen(false)}>
              Cancel
            </ActionButton>
            <ActionButton
              variant="primary"
              size="sm"
              loading={createMutation.isPending}
              onClick={handleCreateSubmit}
            >
              Create Tier
            </ActionButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
