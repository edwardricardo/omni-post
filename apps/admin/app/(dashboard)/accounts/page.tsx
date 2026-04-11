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
import { useCurrentUser } from "@/providers/AuthProvider";

import { Eye, EyeOff, Pencil, KeyRound } from "lucide-react";

import { isPermissionDenied, getErrorMessage } from "@/lib/parseApiError";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { useQueryClient } from "@tanstack/react-query";
import { useAccounts, useUpdateAccount } from "@/hooks/api/useAccounts";
import { useResetAccountPassword } from "@/hooks/api/useResetAccountPassword";
import { AccountBillingPanel } from "@/components/accounts/AccountBillingPanel";
import { AccountEditForm } from "@/components/accounts/AccountEditForm";
import { AccountStatusBadge } from "@/components/accounts/AccountStatusBadge";
import { exportAccountsToCSV } from "@/components/accounts/exportAccountsToCSV";
import { Pagination } from "@/components/ui/Pagination";
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
  const { hasPermission } = useCurrentUser();
  const t = useTranslations("nav");
  const ta = useTranslations("accounts");
  const tc = useTranslations("common");
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
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", email: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    phone: "",
    isActive: true,
    isOnTrial: false,
    trialEndDate: "",
    autoRenewal: false,
  });
  const [resetPasswordId, setResetPasswordId] = useState<string | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const resetAccountPassword = useResetAccountPassword();

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

  const totalPages = Math.max(1, Math.ceil(accounts.length / perPage));
  const paginatedAccounts = useMemo(
    () => accounts.slice((page - 1) * perPage, page * perPage),
    [accounts, page, perPage]
  );

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
      const ids = Array.from(selectedAccounts);
      const endpoint =
        action === "suspend"
          ? "/api/backend/admin/accounts/bulk/suspend"
          : "/api/backend/admin/accounts/bulk/reactivate";
      const body =
        action === "suspend"
          ? JSON.stringify({ accountIds: ids, reason: "Admin bulk action" })
          : JSON.stringify({ accountIds: ids });
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body,
        });
        if (!res.ok) throw new Error(`Bulk ${action} failed`);
        const data = await res.json();
        const result = data.data ?? data;
        toast({
          title: tc("success"),
          description: `${result.successful ?? ids.length} ${action}d, ${result.failed ?? 0} failed`,
        });
        await refetch();
      } catch (err) {
        toast({
          title: tc("error"),
          description: getErrorMessage(err),
          variant: "destructive",
        });
      }
      setSelectedAccounts(new Set());
      setShowActions(false);
    },
    [accounts, selectedAccounts, refetch, tc]
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
      email: account.email,
      phone: account.phone ?? "",
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
      // 1. Update name, email, phone + isActive via /status
      await updateAccount.mutateAsync({
        id: editingId,
        data: {
          name: editForm.name,
          email: editForm.email,
          isActive: editForm.isActive,
          ...(editForm.phone && { phone: editForm.phone }),
        },
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
      toast({ title: tc("success"), description: "Account updated" });
      setEditingId(null);
    } catch (err) {
      toast({
        title: tc("error"),
        description: getErrorMessage(err),
        variant: "destructive",
      });
    }
  }, [editingId, editForm, updateAccount, queryClient, refetch, tc]);

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
      toast({ title: tc("success"), description: "Account created" });
      setShowCreate(false);
      setCreateForm({ name: "", email: "" });
      await refetch();
    } catch (err) {
      toast({
        title: tc("error"),
        description: getErrorMessage(err),
        variant: "destructive",
      });
    }
  }, [createForm, refetch, tc]);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const formatDate = useCallback(
    (dateString: string | null | undefined) => {
      if (!dateString) return tc("never");
      return new Date(dateString).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    },
    [tc]
  );

  if (isLoading) {
    return (
      <div>
        <PageHeader title={t("accounts")} />
        <div className="flex justify-center items-center h-64">
          <LoadingSpinner size="lg" label={ta("loadingAccounts")} />
        </div>
      </div>
    );
  }

  if (error) {
    if (isPermissionDenied(error)) {
      return (
        <div>
          <PageHeader title={t("accounts")} />
          <AccessDenied />
        </div>
      );
    }
    return (
      <div>
        <PageHeader title={t("accounts")} />
        <div className="flex justify-center items-center h-64" role="alert" aria-live="assertive">
          <div className="text-sm text-[var(--error)]">Error: {getErrorMessage(error)}</div>
          <ActionButton
            variant="primary"
            size="sm"
            onClick={handleRefresh}
            loading={isLoading}
            className="ml-4"
            aria-label={ta("retryLoading")}
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
        title={t("accounts")}
        actions={
          <div className="flex gap-2">
            <ActionButton
              variant="primary"
              size="sm"
              onClick={handleRefresh}
              loading={isLoading}
              aria-label={ta("refreshData")}
            >
              {tc("refresh")}
            </ActionButton>
            {hasPermission("user:manage") && (
              <ActionButton
                variant="secondary"
                size="sm"
                onClick={() => setShowCreate(true)}
                aria-label={ta("createAccount")}
              >
                {ta("createAccount")}
              </ActionButton>
            )}
          </div>
        }
      />

      {/* Create Account Form */}
      {showCreate && (
        <div
          className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 mb-4"
          role="region"
          aria-label={ta("createAccount")}
        >
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
            {ta("createAccount")}
          </h2>
          <div className="flex items-end gap-4">
            <div>
              <label
                htmlFor="create-name"
                className="block text-sm font-medium text-[var(--text-secondary)] mb-1"
              >
                {tc("name")}
              </label>
              <input
                id="create-name"
                type="text"
                value={createForm.name}
                onChange={(e) => setCreateForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder={tc("name")}
                className="px-3 py-2 border border-[var(--border-default)] rounded-md bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>
            <div>
              <label
                htmlFor="create-email"
                className="block text-sm font-medium text-[var(--text-secondary)] mb-1"
              >
                {tc("email")}
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
              {tc("create")}
            </ActionButton>
            <ActionButton variant="secondary" size="sm" onClick={() => setShowCreate(false)}>
              {tc("cancel")}
            </ActionButton>
          </div>
        </div>
      )}

      {/* Bulk Actions */}
      {showActions && (
        <div
          className="bg-[var(--accent-subtle)] border border-[var(--accent)] rounded-lg p-4 mb-4"
          role="region"
          aria-label={ta("bulkActions.title")}
          aria-live="polite"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--accent)]" role="status">
              {selectedAccounts.size === 1
                ? ta("bulkActions.selected", { count: selectedAccounts.size })
                : ta("bulkActions.selectedPlural", { count: selectedAccounts.size })}
            </span>
            <div className="flex gap-2">
              {hasPermission("user:manage") && (
                <>
                  <ActionButton
                    variant="primary"
                    size="sm"
                    onClick={() => handleBulkAction("activate")}
                  >
                    {ta("bulkActions.activate")}
                  </ActionButton>
                  <ActionButton
                    variant="danger"
                    size="sm"
                    onClick={() => handleBulkAction("suspend")}
                  >
                    {ta("bulkActions.suspend")}
                  </ActionButton>
                </>
              )}
              <ActionButton
                variant="secondary"
                size="sm"
                onClick={() => handleBulkAction("export")}
              >
                {ta("bulkActions.export")}
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
          {ta("filterAccounts")}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label
              htmlFor="search-input"
              className="block text-sm font-medium text-[var(--text-secondary)] mb-2"
            >
              {tc("search")}
            </label>
            <input
              id="search-input"
              type="text"
              value={filters.search}
              onChange={(e) => {
                setFilters((prev) => buildFilters(prev, { search: e.target.value }));
                setPage(1);
              }}
              placeholder={ta("searchPlaceholder")}
              className="w-full px-3 py-2 border border-[var(--border-default)] rounded-md bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-hidden focus:ring-2 focus:ring-[var(--accent)]"
              aria-label={ta("searchLabel")}
            />
          </div>
          <div>
            <label
              htmlFor="status-filter"
              className="block text-sm font-medium text-[var(--text-secondary)] mb-2"
            >
              {tc("status")}
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
              aria-label={ta("filterByStatus")}
            >
              <option value="">{ta("allStatuses")}</option>
              <option value="ACTIVE">{tc("active")}</option>
              <option value="TRIAL">{ta("onTrial")}</option>
              <option value="SUSPENDED">{ta("badges.suspended")}</option>
            </select>
          </div>
          <div>
            <label
              htmlFor="sort-by-select"
              className="block text-sm font-medium text-[var(--text-secondary)] mb-2"
            >
              {ta("sortBy")}
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
              aria-label={ta("sortAccounts")}
            >
              <option value="createdAt-desc">{ta("newestFirst")}</option>
              <option value="createdAt-asc">{ta("oldestFirst")}</option>
              <option value="email-asc">{ta("emailAZ")}</option>
              <option value="email-desc">{ta("emailZA")}</option>
              <option value="lastLoginAt-desc">{ta("lastLogin")}</option>
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
                <th scope="col" className="px-3 py-2 text-left">
                  <input
                    type="checkbox"
                    checked={selectedAccounts.size === accounts.length && accounts.length > 0}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    className="rounded border-[var(--border-default)]"
                    aria-label={ta("selectAll")}
                  />
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider"
                >
                  {ta("table.account")}
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider"
                >
                  {tc("plan")}
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider"
                >
                  {tc("status")}
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider"
                >
                  {ta("table.usage")}
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider"
                >
                  {ta("table.lastLogin")}
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider"
                >
                  {tc("actions")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {paginatedAccounts.map((account) => (
                <React.Fragment key={account.id}>
                  <tr className="hover:bg-[var(--bg-elevated)] transition-colors">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedAccounts.has(account.id)}
                        onChange={(e) => handleSelectAccount(account.id, e.target.checked)}
                        className="rounded border-[var(--border-default)]"
                        aria-label={`Select account ${account.email}`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-sm font-medium text-[var(--text-primary)]">
                        {account.name}
                      </div>
                      <div className="text-xs text-[var(--text-tertiary)]">
                        {ta("created", { date: formatDate(account.createdAt) })}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="info">{account.plan.name || "None"}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <AccountStatusBadge account={account} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-sm text-[var(--text-primary)]">
                        {ta("projects", {
                          used: account.usage.projectsUsed,
                          total: account.usage.projectsUsed + account.usage.projectsRemaining,
                        })}
                      </div>
                      <div className="w-full bg-[var(--bg-elevated)] rounded-full h-2 mt-1">
                        <div
                          className="bg-[var(--accent)] h-2 rounded-full"
                          style={{ width: `${account.usage.utilizationPercent}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2 text-sm text-[var(--text-secondary)]">
                      {formatDate(account.lastLoginAt)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleView(account.id)}
                          className="p-1.5 rounded-md hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                          aria-expanded={expandedId === account.id}
                          aria-label={ta("actions.viewDetails", { email: account.email })}
                          title={ta("actions.viewDetails", { email: account.email })}
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
                          aria-label={ta("actions.editAccount", { email: account.email })}
                          title={tc("edit")}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setResetPasswordId(account.id)}
                          className="p-1.5 rounded-md hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                          aria-label={ta("resetPassword.title")}
                          title={ta("resetPassword.button")}
                        >
                          <KeyRound className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {editingId === account.id && (
                    <tr key={`${account.id}-edit`}>
                      <td colSpan={7} className="px-4 py-4 bg-[var(--bg-elevated)]">
                        <AccountEditForm
                          accountId={account.id}
                          editForm={editForm}
                          onFormChange={setEditForm}
                          onSave={handleSaveEdit}
                          onCancel={() => setEditingId(null)}
                        />
                      </td>
                    </tr>
                  )}
                  {expandedId === account.id && (
                    <tr key={`${account.id}-expanded`}>
                      <td colSpan={7} className="px-3 py-3 bg-[var(--bg-elevated)]">
                        <div className="mb-3 flex items-center gap-4 text-sm text-[var(--text-secondary)]">
                          <span>
                            <span className="font-medium text-[var(--text-tertiary)]">
                              {ta("detail.email")}
                            </span>{" "}
                            {account.email}
                          </span>
                          {account.phone && (
                            <>
                              <span className="text-[var(--border-default)]">|</span>
                              <span>
                                <span className="font-medium text-[var(--text-tertiary)]">
                                  {ta("detail.phone")}
                                </span>{" "}
                                {account.phone}
                              </span>
                            </>
                          )}
                        </div>
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
            {ta("noResults")}
          </div>
        )}
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        totalItems={accounts.length}
        perPage={perPage}
        onPageChange={setPage}
        onPerPageChange={(n) => {
          setPerPage(n);
          setPage(1);
        }}
      />

      {/* Reset Password Dialog */}
      {resetPasswordId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[var(--bg-surface)] rounded-lg border border-[var(--border-subtle)] p-6 w-full max-w-sm shadow-lg">
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
              {ta("resetPassword.title")}
            </h2>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              {ta("resetPassword.description")}
            </p>
            <input
              type="password"
              value={resetPasswordValue}
              onChange={(e) => setResetPasswordValue(e.target.value)}
              placeholder={ta("resetPassword.placeholder")}
              className="w-full mb-4 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)]"
              minLength={8}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <ActionButton
                variant="secondary"
                size="sm"
                onClick={() => {
                  setResetPasswordId(null);
                  setResetPasswordValue("");
                }}
              >
                {tc("cancel")}
              </ActionButton>
              <ActionButton
                variant="primary"
                size="sm"
                disabled={resetPasswordValue.length < 8}
                loading={resetAccountPassword.isPending}
                onClick={() => {
                  resetAccountPassword.mutate(
                    { accountId: resetPasswordId, newPassword: resetPasswordValue },
                    {
                      onSuccess: () => {
                        setResetPasswordId(null);
                        setResetPasswordValue("");
                      },
                    }
                  );
                }}
              >
                {ta("resetPassword.button")}
              </ActionButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return <AccountsPageContent />;
}
