/**
 * @file page.tsx
 * @description Accounts management page listing all tenant accounts with plan, trial,
 *   and usage information. Uses CSS design tokens and reusable UI components.
 * @layer page
 */
"use client";

import React, { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "@packages/ui";

import { Eye, EyeOff, Pencil } from "lucide-react";

import { useQueryClient } from "@tanstack/react-query";
import { useAccounts, useUpdateAccount } from "@/hooks/api/useAccounts";
import { AccountBillingPanel } from "@/components/accounts/AccountBillingPanel";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { PageHeader } from "@/components/ui/PageHeader";
import { ActionButton } from "@/components/ui/ActionButton";
import { Badge } from "@/components/ui/Badge";
import type { AccountSummary } from "@/lib/apiClient";

interface AccountFilters {
  search: string;
  sortBy: "createdAt" | "email" | "lastLoginAt";
  sortOrder: "asc" | "desc";
  plan?: string;
  status?: "ACTIVE" | "SUSPENDED" | "TRIAL";
}

function buildFilters(
  base: AccountFilters,
  overrides: Partial<Pick<AccountFilters, "search" | "sortBy" | "sortOrder">>,
  optionals?: { plan?: string; status?: "ACTIVE" | "SUSPENDED" | "TRIAL" }
): AccountFilters {
  const result: AccountFilters = {
    search: overrides.search ?? base.search,
    sortBy: overrides.sortBy ?? base.sortBy,
    sortOrder: overrides.sortOrder ?? base.sortOrder,
  };
  const plan = optionals?.plan ?? base.plan;
  const status = optionals?.status ?? base.status;
  if (plan !== undefined) result.plan = plan;
  if (status !== undefined) result.status = status;
  return result;
}

function AccountsPageContent() {
  const t = useTranslations("nav");
  const queryClient = useQueryClient();
  const { data: accountsData, isLoading, error, refetch } = useAccounts();
  const updateAccount = useUpdateAccount();

  const [filters, setFilters] = useState<AccountFilters>({
    search: "",
    sortBy: "createdAt",
    sortOrder: "desc",
  });
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());
  const [showActions, setShowActions] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", email: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    isActive: true,
    isOnTrial: false,
    trialEndDate: "",
    autoRenewal: false,
  });

  const accounts = useMemo(() => {
    if (!accountsData) return [];
    let filtered = [...accountsData];

    if (filters.search) {
      const q = filters.search.toLowerCase();
      filtered = filtered.filter(
        (a) => a.email.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
      );
    }
    if (filters.plan) {
      filtered = filtered.filter((a) => a.plan.name === filters.plan);
    }
    if (filters.status) {
      filtered = filtered.filter((a) => {
        switch (filters.status) {
          case "ACTIVE":
            return a.isActive && !a.trial.isOnTrial;
          case "SUSPENDED":
            return !a.isActive;
          case "TRIAL":
            return a.trial.isOnTrial;
          default:
            return true;
        }
      });
    }

    filtered.sort((a, b) => {
      let aVal: string | number = "";
      let bVal: string | number = "";
      if (filters.sortBy === "createdAt" || filters.sortBy === "lastLoginAt") {
        aVal = new Date(a[filters.sortBy] ?? "1970-01-01").getTime();
        bVal = new Date(b[filters.sortBy] ?? "1970-01-01").getTime();
      } else {
        aVal = a[filters.sortBy] ?? "";
        bVal = b[filters.sortBy] ?? "";
      }
      if (filters.sortOrder === "desc") return bVal > aVal ? 1 : -1;
      return aVal > bVal ? 1 : -1;
    });

    return filtered;
  }, [accountsData, filters]);

  const handleSelectAccount = useCallback(
    (accountId: string, selected: boolean) => {
      const next = new Set(selectedAccounts);
      if (selected) next.add(accountId);
      else next.delete(accountId);
      setSelectedAccounts(next);
      setShowActions(next.size > 0);
    },
    [selectedAccounts]
  );

  const handleSelectAll = useCallback(
    (selected: boolean) => {
      if (selected) setSelectedAccounts(new Set(accounts.map((a) => a.id)));
      else setSelectedAccounts(new Set());
      setShowActions(selected && accounts.length > 0);
    },
    [accounts]
  );

  const handleBulkAction = useCallback(
    async (action: "suspend" | "activate" | "export") => {
      if (action === "export") {
        exportAccountsToCSV(accounts, selectedAccounts);
        setSelectedAccounts(new Set());
        setShowActions(false);
        return;
      }
      const isActive = action === "activate";
      try {
        const ids = Array.from(selectedAccounts);
        await Promise.all(
          ids.map((id) =>
            fetch(`/api/backend/admin/accounts/${id}/status`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({ isActive }),
            }).then((res) => {
              if (!res.ok) throw new Error(`Failed to ${action} account ${id}`);
            })
          )
        );
        toast({
          title: "Success",
          description: `${ids.length} account(s) ${action}d successfully`,
        });
        await refetch();
      } catch (err) {
        toast({
          title: "Error",
          description: err instanceof Error ? err.message : "Bulk action failed",
          variant: "destructive",
        });
      }
      setSelectedAccounts(new Set());
      setShowActions(false);
    },
    [accounts, selectedAccounts, refetch]
  );

  const handleView = useCallback((accountId: string) => {
    setExpandedId((prev) => (prev === accountId ? null : accountId));
  }, []);

  const handleEdit = useCallback((account: AccountSummary) => {
    const trial = account.trial as
      | { isOnTrial?: boolean; trialEndDate?: string; autoRenewal?: boolean }
      | undefined;
    let trialEnd = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    if (trial?.trialEndDate) {
      trialEnd = trial.trialEndDate.slice(0, 10);
    }
    setEditForm({
      name: account.name,
      isActive: account.isActive,
      isOnTrial: trial?.isOnTrial ?? false,
      trialEndDate: trialEnd,
      autoRenewal: trial?.autoRenewal ?? false,
    });
    setEditingId(account.id);
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingId) return;
    try {
      // 1. Update name + isActive via /status
      await updateAccount.mutateAsync({
        id: editingId,
        data: { name: editForm.name, isActive: editForm.isActive },
      });

      // 2. Update trial + autoRenewal via /settings
      await fetch(`/api/backend/admin/accounts/${editingId}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          isOnTrial: editForm.isOnTrial,
          autoRenewal: editForm.autoRenewal,
          ...(editForm.isOnTrial &&
            editForm.trialEndDate && {
              trialEndDate: new Date(editForm.trialEndDate).toISOString(),
            }),
        }),
      });

      // Refresh all related queries
      await refetch();
      queryClient.invalidateQueries({ queryKey: ["account", "billing", editingId] });
      queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
      toast({ title: "Success", description: "Account updated" });
      setEditingId(null);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Update failed",
        variant: "destructive",
      });
    }
  }, [editingId, editForm, updateAccount, queryClient, refetch]);

  const handleCreateAccount = useCallback(async () => {
    if (!createForm.name || !createForm.email) return;
    try {
      const res = await fetch("/api/backend/admin/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(createForm),
      });
      if (!res.ok) throw new Error("Failed to create account");
      toast({ title: "Success", description: "Account created" });
      setShowCreate(false);
      setCreateForm({ name: "", email: "" });
      await refetch();
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Create failed",
        variant: "destructive",
      });
    }
  }, [createForm, refetch]);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const formatDate = useCallback((dateString: string | null | undefined) => {
    if (!dateString) return "Never";
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }, []);

  if (isLoading) {
    return (
      <div>
        <PageHeader title={t("accounts")} />
        <div className="flex justify-center items-center h-64">
          <LoadingSpinner size="lg" label="Loading accounts..." />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title={t("accounts")} />
        <div className="flex justify-center items-center h-64" role="alert" aria-live="assertive">
          <div className="text-sm text-[var(--error)]">Error: {error.message}</div>
          <ActionButton
            variant="primary"
            size="sm"
            onClick={handleRefresh}
            className="ml-4"
            aria-label="Retry loading accounts"
          >
            Retry
          </ActionButton>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t("accounts")}
        actions={
          <div className="flex gap-2">
            <ActionButton
              variant="primary"
              size="sm"
              onClick={handleRefresh}
              loading={isLoading}
              aria-label="Refresh accounts data"
            >
              Refresh
            </ActionButton>
            <ActionButton
              variant="secondary"
              size="sm"
              onClick={() => setShowCreate(true)}
              aria-label="Create new account"
            >
              Create Account
            </ActionButton>
          </div>
        }
      />

      {/* Create Account Form */}
      {showCreate && (
        <div
          className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 mb-4"
          role="region"
          aria-label="Create new account"
        >
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">New Account</h2>
          <div className="flex items-end gap-4">
            <div>
              <label
                htmlFor="create-name"
                className="block text-sm font-medium text-[var(--text-secondary)] mb-1"
              >
                Name
              </label>
              <input
                id="create-name"
                type="text"
                value={createForm.name}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Account name"
                className="px-3 py-2 border border-[var(--border-default)] rounded-md bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>
            <div>
              <label
                htmlFor="create-email"
                className="block text-sm font-medium text-[var(--text-secondary)] mb-1"
              >
                Email
              </label>
              <input
                id="create-email"
                type="email"
                value={createForm.email}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="email@example.com"
                className="px-3 py-2 border border-[var(--border-default)] rounded-md bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>
            <ActionButton variant="primary" size="sm" onClick={handleCreateAccount}>
              Create
            </ActionButton>
            <ActionButton variant="secondary" size="sm" onClick={() => setShowCreate(false)}>
              Cancel
            </ActionButton>
          </div>
        </div>
      )}

      {/* Bulk Actions */}
      {showActions && (
        <div
          className="bg-[var(--accent-subtle)] border border-[var(--accent)] rounded-lg p-4 mb-4"
          role="region"
          aria-label="Bulk actions"
          aria-live="polite"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--accent)]" role="status">
              {selectedAccounts.size} account{selectedAccounts.size !== 1 ? "s" : ""} selected
            </span>
            <div className="flex gap-2">
              <ActionButton
                variant="primary"
                size="sm"
                onClick={() => handleBulkAction("activate")}
              >
                Activate
              </ActionButton>
              <ActionButton variant="danger" size="sm" onClick={() => handleBulkAction("suspend")}>
                Suspend
              </ActionButton>
              <ActionButton
                variant="secondary"
                size="sm"
                onClick={() => handleBulkAction("export")}
              >
                Export
              </ActionButton>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div
        className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 mb-4"
        role="region"
        aria-labelledby="filters-heading"
      >
        <h2 id="filters-heading" className="sr-only">
          Filter accounts
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label
              htmlFor="search-input"
              className="block text-sm font-medium text-[var(--text-secondary)] mb-2"
            >
              Search
            </label>
            <input
              id="search-input"
              type="text"
              value={filters.search}
              onChange={(e) => setFilters((prev) => buildFilters(prev, { search: e.target.value }))}
              placeholder="Search by email or name..."
              className="w-full px-3 py-2 border border-[var(--border-default)] rounded-md bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)]"
              aria-label="Search accounts by email or name"
            />
          </div>
          <div>
            <label
              htmlFor="status-filter"
              className="block text-sm font-medium text-[var(--text-secondary)] mb-2"
            >
              Status
            </label>
            <select
              id="status-filter"
              value={filters.status ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setFilters((prev) => {
                  const next: AccountFilters = {
                    search: prev.search,
                    sortBy: prev.sortBy,
                    sortOrder: prev.sortOrder,
                  };
                  if (prev.plan !== undefined) next.plan = prev.plan;
                  if (v) next.status = v as "ACTIVE" | "SUSPENDED" | "TRIAL";
                  return next;
                });
              }}
              className="w-full px-3 py-2 border border-[var(--border-default)] rounded-md bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)]"
              aria-label="Filter by account status"
            >
              <option value="">All Statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="TRIAL">On Trial</option>
              <option value="SUSPENDED">Suspended</option>
            </select>
          </div>
          <div>
            <label
              htmlFor="sort-by-select"
              className="block text-sm font-medium text-[var(--text-secondary)] mb-2"
            >
              Sort By
            </label>
            <select
              id="sort-by-select"
              value={`${filters.sortBy}-${filters.sortOrder}`}
              onChange={(e) => {
                const [sb, so] = e.target.value.split("-");
                setFilters((prev) =>
                  buildFilters(prev, {
                    sortBy: sb as AccountFilters["sortBy"],
                    sortOrder: so as AccountFilters["sortOrder"],
                  })
                );
              }}
              className="w-full px-3 py-2 border border-[var(--border-default)] rounded-md bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)]"
              aria-label="Sort accounts"
            >
              <option value="createdAt-desc">Newest First</option>
              <option value="createdAt-asc">Oldest First</option>
              <option value="email-asc">Email A-Z</option>
              <option value="email-desc">Email Z-A</option>
              <option value="lastLoginAt-desc">Last Login</option>
            </select>
          </div>
        </div>
      </div>

      {/* Accounts Table */}
      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden">
        <div className="overflow-x-auto">
          <table
            className="min-w-full divide-y divide-[var(--border-subtle)]"
            aria-label="User accounts"
          >
            <thead className="bg-[var(--bg-elevated)]">
              <tr>
                <th scope="col" className="px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={selectedAccounts.size === accounts.length && accounts.length > 0}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    className="rounded border-[var(--border-default)]"
                    aria-label="Select all accounts"
                  />
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider"
                >
                  Account
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider"
                >
                  Plan
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider"
                >
                  Status
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider"
                >
                  Usage
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider"
                >
                  Last Login
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider"
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {accounts.map((account) => (
                <React.Fragment key={account.id}>
                  <tr className="hover:bg-[var(--bg-elevated)] transition-colors">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedAccounts.has(account.id)}
                        onChange={(e) => handleSelectAccount(account.id, e.target.checked)}
                        className="rounded border-[var(--border-default)]"
                        aria-label={`Select account ${account.email}`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-[var(--text-primary)]">
                        {account.name}
                      </div>
                      <div className="text-sm text-[var(--text-secondary)]">{account.email}</div>
                      <div className="text-xs text-[var(--text-tertiary)]">
                        Created {formatDate(account.createdAt)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="info">{account.plan.name || "None"}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <AccountStatusBadge account={account} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-[var(--text-primary)]">
                        {account.usage.projectsUsed} /{" "}
                        {account.usage.projectsUsed + account.usage.projectsRemaining} projects
                      </div>
                      <div className="w-full bg-[var(--bg-elevated)] rounded-full h-2 mt-1">
                        <div
                          className="bg-[var(--accent)] h-2 rounded-full"
                          style={{ width: `${account.usage.utilizationPercent}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-[var(--text-secondary)]">
                      {formatDate(account.lastLoginAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleView(account.id)}
                          className="p-1.5 rounded-md hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                          aria-expanded={expandedId === account.id}
                          aria-label={expandedId === account.id ? "Hide billing" : "View billing"}
                          title={expandedId === account.id ? "Hide" : "View billing"}
                        >
                          {expandedId === account.id ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          onClick={() => handleEdit(account)}
                          className="p-1.5 rounded-md hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                          aria-label={`Edit ${account.name}`}
                          title="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {editingId === account.id && (
                    <tr key={`${account.id}-edit`}>
                      <td colSpan={7} className="px-4 py-4 bg-[var(--bg-elevated)]">
                        <div className="flex items-end gap-4">
                          <div>
                            <label
                              htmlFor={`edit-name-${account.id}`}
                              className="block text-sm font-medium text-[var(--text-secondary)] mb-1"
                            >
                              Name
                            </label>
                            <input
                              id={`edit-name-${account.id}`}
                              type="text"
                              value={editForm.name}
                              onChange={(e) =>
                                setEditForm((prev) => ({ ...prev, name: e.target.value }))
                              }
                              className="px-3 py-2 border border-[var(--border-default)] rounded-md bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)]"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              id={`edit-active-${account.id}`}
                              type="checkbox"
                              checked={editForm.isActive}
                              onChange={(e) =>
                                setEditForm((prev) => ({ ...prev, isActive: e.target.checked }))
                              }
                              className="rounded border-[var(--border-default)]"
                            />
                            <label
                              htmlFor={`edit-active-${account.id}`}
                              className="text-sm text-[var(--text-secondary)]"
                            >
                              Active
                            </label>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              id={`edit-trial-${account.id}`}
                              type="checkbox"
                              checked={editForm.isOnTrial}
                              onChange={(e) =>
                                setEditForm((prev) => ({ ...prev, isOnTrial: e.target.checked }))
                              }
                              className="rounded border-[var(--border-default)]"
                            />
                            <label
                              htmlFor={`edit-trial-${account.id}`}
                              className="text-sm text-[var(--text-secondary)]"
                            >
                              On Trial
                            </label>
                          </div>
                          {editForm.isOnTrial && (
                            <div>
                              <label
                                htmlFor={`edit-trial-end-${account.id}`}
                                className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
                              >
                                Trial End Date
                              </label>
                              <input
                                id={`edit-trial-end-${account.id}`}
                                type="date"
                                value={editForm.trialEndDate}
                                onChange={(e) =>
                                  setEditForm((prev) => ({ ...prev, trialEndDate: e.target.value }))
                                }
                                className="px-2 py-1 border border-[var(--border-default)] rounded-md bg-[var(--bg-surface)] text-[var(--text-primary)] text-sm"
                              />
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <input
                              id={`edit-autorenewal-${account.id}`}
                              type="checkbox"
                              checked={editForm.autoRenewal}
                              onChange={(e) =>
                                setEditForm((prev) => ({ ...prev, autoRenewal: e.target.checked }))
                              }
                              className="rounded border-[var(--border-default)]"
                            />
                            <label
                              htmlFor={`edit-autorenewal-${account.id}`}
                              className="text-sm text-[var(--text-secondary)]"
                            >
                              Auto-Renewal
                            </label>
                          </div>
                          <ActionButton variant="primary" size="sm" onClick={handleSaveEdit}>
                            Save
                          </ActionButton>
                          <ActionButton
                            variant="secondary"
                            size="sm"
                            onClick={() => setEditingId(null)}
                          >
                            Cancel
                          </ActionButton>
                        </div>
                      </td>
                    </tr>
                  )}
                  {expandedId === account.id && (
                    <tr key={`${account.id}-expanded`}>
                      <td colSpan={7} className="px-4 py-4 bg-[var(--bg-elevated)]">
                        <AccountBillingPanel
                          accountId={account.id}
                          accountName={account.name}
                          {...(account.lastLoginAt !== undefined && {
                            lastLoginAt: account.lastLoginAt,
                          })}
                          editingAccount={editingId === account.id}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {accounts.length === 0 && !isLoading && (
          <div className="text-center py-12 text-[var(--text-secondary)]" role="status">
            No accounts found matching your criteria
          </div>
        )}
      </div>

      {/* Pagination */}
      <nav className="mt-4 flex justify-between items-center" aria-label="Pagination">
        <div className="text-sm text-[var(--text-secondary)]" role="status" aria-live="polite">
          Showing {accounts.length} account{accounts.length !== 1 ? "s" : ""}
        </div>
      </nav>
    </div>
  );
}

function AccountStatusBadge({ account }: { account: AccountSummary }) {
  if (!account.isActive) return <Badge variant="error">Suspended</Badge>;
  if (account.trial.isOnTrial)
    return <Badge variant="warning">Trial ({account.trial.trialDaysRemaining}d)</Badge>;
  return <Badge variant="success">Active</Badge>;
}

function exportAccountsToCSV(accounts: AccountSummary[], selected: Set<string>) {
  const headers = ["ID", "Email", "Name", "Plan", "Status", "Created At", "Last Login"];
  const rows = accounts
    .filter((a) => selected.has(a.id))
    .map((a) => [
      a.id,
      a.email,
      a.name,
      a.plan.name,
      a.isActive ? "Active" : "Suspended",
      a.createdAt,
      a.lastLoginAt ?? "Never",
    ]);
  const csv = [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `accounts-export-${new Date().toISOString().split("T")[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function Page() {
  return <AccountsPageContent />;
}
