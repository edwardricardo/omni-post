/**
 * @file page.tsx
 * @description Accounts management page listing all tenant accounts with subscription, trial,
 * and usage information. Supports filtering by search, subscription tier, and status.
 */
"use client";

import { useMemo, useState } from "react";
import { useAccounts } from "@/hooks/api/useAccounts";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

interface Account {
  id: string;
  email: string;
  name: string;
  subscription: "BASIC" | "PRO" | "ENTERPRISE";
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  trial: {
    isOnTrial: boolean;
    trialDaysRemaining: number;
    trialExpired: boolean;
  };
  usage: {
    projectsUsed: number;
    projectsRemaining: number;
    utilizationPercent: number;
  };
}

interface AccountFilters {
  search: string;
  subscription?: "BASIC" | "PRO" | "ENTERPRISE";
  status?: "ACTIVE" | "SUSPENDED" | "TRIAL";
  sortBy: "createdAt" | "email" | "lastLoginAt";
  sortOrder: "asc" | "desc";
}

function AccountsPageContent() {
  // Use TanStack Query hook for data fetching
  const { data: accountsData, isLoading, error, refetch } = useAccounts();

  const [filters, setFilters] = useState<AccountFilters>({
    search: "",
    sortBy: "createdAt",
    sortOrder: "desc",
  });
  const [selectedAccounts, setSelectedAccounts] = useState<Set<string>>(new Set());
  const [showActions, setShowActions] = useState(false);

  // Apply client-side filtering and sorting using useMemo
  const accounts = useMemo(() => {
    if (!accountsData) return [];

    let filteredAccounts = [...accountsData];

    // Apply search filter
    if (filters.search) {
      const searchTerm = filters.search.toLowerCase();
      filteredAccounts = filteredAccounts.filter(
        (account) =>
          account.email.toLowerCase().includes(searchTerm) ||
          account.name.toLowerCase().includes(searchTerm)
      );
    }

    // Apply subscription filter
    if (filters.subscription) {
      filteredAccounts = filteredAccounts.filter(
        (account) => account.subscription === filters.subscription
      );
    }

    // Apply status filter
    if (filters.status) {
      filteredAccounts = filteredAccounts.filter((account) => {
        switch (filters.status) {
          case "ACTIVE":
            return account.isActive && !account.trial.isOnTrial;
          case "SUSPENDED":
            return !account.isActive;
          case "TRIAL":
            return account.trial.isOnTrial;
          default:
            return true;
        }
      });
    }

    // Apply sorting
    filteredAccounts.sort((a, b) => {
      let aValue: any = a[filters.sortBy];
      let bValue: any = b[filters.sortBy];

      if (filters.sortBy === "createdAt" || filters.sortBy === "lastLoginAt") {
        aValue = new Date(aValue || 0).getTime();
        bValue = new Date(bValue || 0).getTime();
      }

      if (filters.sortOrder === "desc") {
        return bValue > aValue ? 1 : -1;
      } else {
        return aValue > bValue ? 1 : -1;
      }
    });

    return filteredAccounts;
  }, [accountsData, filters]);

  const handleSelectAccount = (accountId: string, selected: boolean) => {
    const newSelected = new Set(selectedAccounts);
    if (selected) {
      newSelected.add(accountId);
    } else {
      newSelected.delete(accountId);
    }
    setSelectedAccounts(newSelected);
    setShowActions(newSelected.size > 0);
  };

  const handleSelectAll = (selected: boolean) => {
    if (selected) {
      setSelectedAccounts(new Set(accounts.map((a) => a.id)));
    } else {
      setSelectedAccounts(new Set());
    }
    setShowActions(selected && accounts.length > 0);
  };

  const handleBulkAction = async (action: "suspend" | "activate" | "export") => {
    if (action === "export") {
      exportAccountsToCSV();
      setSelectedAccounts(new Set());
      setShowActions(false);
      return;
    }

    // Bulk activate/suspend API call not yet integrated
    setSelectedAccounts(new Set());
    setShowActions(false);
    // Refresh data using TanStack Query refetch
    await refetch();
  };

  const exportAccountsToCSV = () => {
    const csvHeaders = [
      "ID",
      "Email",
      "Name",
      "Subscription",
      "Status",
      "Created At",
      "Last Login",
      "On Trial",
      "Trial Days Remaining",
      "Projects Used",
      "Projects Remaining",
      "Utilization %",
    ];

    const csvData = accounts
      .filter((account) => selectedAccounts.has(account.id))
      .map((account) => [
        account.id,
        account.email,
        account.name,
        account.subscription,
        account.isActive ? "Active" : "Suspended",
        account.createdAt,
        account.lastLoginAt || "Never",
        account.trial.isOnTrial ? "Yes" : "No",
        account.trial.trialDaysRemaining,
        account.usage.projectsUsed,
        account.usage.projectsRemaining,
        account.usage.utilizationPercent,
      ]);

    const csvContent = [csvHeaders, ...csvData]
      .map((row) => row.map((cell) => `"${cell}"`).join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `accounts-export-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "Never";
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const getStatusBadge = (account: Account) => {
    if (!account.isActive) {
      return (
        <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded-full">
          Suspended
        </span>
      );
    }
    if (account.trial.isOnTrial) {
      return (
        <span className="px-2 py-1 text-xs font-medium bg-orange-100 text-orange-800 rounded-full">
          Trial ({account.trial.trialDaysRemaining}d)
        </span>
      );
    }
    return (
      <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
        Active
      </span>
    );
  };

  const getSubscriptionBadge = (subscription: string) => {
    const colors = {
      BASIC: "bg-blue-100 text-blue-800",
      PRO: "bg-green-100 text-green-800",
      ENTERPRISE: "bg-purple-100 text-purple-800",
    };
    return (
      <span
        className={`px-2 py-1 text-xs font-medium rounded-full ${colors[subscription as keyof typeof colors]}`}
      >
        {subscription}
      </span>
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Account Management</h1>
          <div className="flex justify-center items-center h-64">
            <LoadingSpinner size="lg" label="Loading accounts..." />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">Account Management</h1>
          <div className="flex justify-center items-center h-64" role="alert" aria-live="assertive">
            <div className="text-lg text-red-600">Error: {error.message}</div>
            <button
              onClick={() => refetch()}
              className="ml-4 px-4 py-2 bg-blue-600 text-white rounded-sm hover:bg-blue-700 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              aria-label="Retry loading accounts"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Account Management</h1>
          <div className="flex space-x-4">
            <button
              onClick={() => refetch()}
              disabled={isLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-sm hover:bg-blue-700 disabled:opacity-50 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              aria-label="Refresh accounts data"
            >
              Refresh
            </button>
            <button
              className="px-4 py-2 bg-green-600 text-white rounded-sm hover:bg-green-700 focus:outline-hidden focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
              aria-label="Create new account"
            >
              Create Account
            </button>
          </div>
        </div>

        {/* Bulk Actions Bar */}
        {showActions && (
          <div
            className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6"
            role="region"
            aria-label="Bulk actions"
            aria-live="polite"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-blue-700" role="status">
                {selectedAccounts.size} account{selectedAccounts.size !== 1 ? "s" : ""} selected
              </span>
              <div className="flex space-x-2">
                <button
                  onClick={() => handleBulkAction("activate")}
                  className="px-3 py-1 bg-green-600 text-white text-sm rounded-sm hover:bg-green-700 focus:outline-hidden focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
                  aria-label={`Activate ${selectedAccounts.size} selected accounts`}
                >
                  Activate
                </button>
                <button
                  onClick={() => handleBulkAction("suspend")}
                  className="px-3 py-1 bg-red-600 text-white text-sm rounded-sm hover:bg-red-700 focus:outline-hidden focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                  aria-label={`Suspend ${selectedAccounts.size} selected accounts`}
                >
                  Suspend
                </button>
                <button
                  onClick={() => handleBulkAction("export")}
                  className="px-3 py-1 bg-gray-600 text-white text-sm rounded-sm hover:bg-gray-700 focus:outline-hidden focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
                  aria-label={`Export ${selectedAccounts.size} selected accounts to CSV`}
                >
                  Export
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div
          className="bg-white rounded-lg shadow-sm p-6 mb-6"
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
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Search
              </label>
              <input
                id="search-input"
                type="text"
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                placeholder="Search by email or name..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                aria-label="Search accounts by email or name"
              />
            </div>
            <div>
              <label
                htmlFor="subscription-filter"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Subscription
              </label>
              <select
                id="subscription-filter"
                value={filters.subscription || ""}
                onChange={(e) => {
                  const value = e.target.value as any;
                  setFilters({ ...filters, ...(value && { subscription: value }) });
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                aria-label="Filter by subscription type"
              >
                <option value="">All Subscriptions</option>
                <option value="BASIC">Basic</option>
                <option value="PRO">Pro</option>
                <option value="ENTERPRISE">Enterprise</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="status-filter"
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Status
              </label>
              <select
                id="status-filter"
                value={filters.status || ""}
                onChange={(e) => {
                  const value = e.target.value as any;
                  setFilters({ ...filters, ...(value && { status: value }) });
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-hidden focus:ring-2 focus:ring-blue-500"
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
                className="block text-sm font-medium text-gray-700 mb-2"
              >
                Sort By
              </label>
              <select
                id="sort-by-select"
                value={`${filters.sortBy}-${filters.sortOrder}`}
                onChange={(e) => {
                  const [sortBy, sortOrder] = e.target.value.split("-");
                  setFilters({ ...filters, sortBy: sortBy as any, sortOrder: sortOrder as any });
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-hidden focus:ring-2 focus:ring-blue-500"
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
        <div
          className="bg-white rounded-lg shadow-sm overflow-hidden"
          role="region"
          aria-labelledby="accounts-table-heading"
        >
          <h2 id="accounts-table-heading" className="sr-only">
            Accounts table
          </h2>
          <div className="overflow-x-auto">
            <table
              className="min-w-full divide-y divide-gray-200"
              role="table"
              aria-label="User accounts"
            >
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={selectedAccounts.size === accounts.length && accounts.length > 0}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      aria-label="Select all accounts"
                    />
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Account
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Subscription
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Status
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Usage
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Last Login
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {accounts.map((account) => (
                  <tr key={account.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <input
                        type="checkbox"
                        checked={selectedAccounts.has(account.id)}
                        onChange={(e) => handleSelectAccount(account.id, e.target.checked)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        aria-label={`Select account ${account.email}`}
                      />
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center">
                        <div>
                          <div className="text-sm font-medium text-gray-900">{account.name}</div>
                          <div className="text-sm text-gray-500">{account.email}</div>
                          <div className="text-xs text-gray-400">
                            Created {formatDate(account.createdAt)}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">{getSubscriptionBadge(account.subscription)}</td>
                    <td className="px-6 py-4">{getStatusBadge(account)}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center">
                        <div className="flex-1">
                          <div className="text-sm text-gray-900">
                            {account.usage.projectsUsed} /{" "}
                            {account.usage.projectsUsed + account.usage.projectsRemaining} projects
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
                            <div
                              className="bg-blue-600 h-2 rounded-full"
                              style={{ width: `${account.usage.utilizationPercent}%` }}
                            ></div>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {formatDate(account.lastLoginAt)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex space-x-2">
                        <button
                          className="text-blue-600 hover:text-blue-900 text-sm focus:outline-hidden focus:underline"
                          aria-label={`View details for ${account.email}`}
                        >
                          View
                        </button>
                        <button
                          className="text-green-600 hover:text-green-900 text-sm focus:outline-hidden focus:underline"
                          aria-label={`Edit ${account.email}`}
                        >
                          Edit
                        </button>
                        {account.isActive ? (
                          <button
                            className="text-red-600 hover:text-red-900 text-sm focus:outline-hidden focus:underline"
                            aria-label={`Suspend ${account.email}`}
                          >
                            Suspend
                          </button>
                        ) : (
                          <button
                            className="text-green-600 hover:text-green-900 text-sm focus:outline-hidden focus:underline"
                            aria-label={`Activate ${account.email}`}
                          >
                            Activate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {accounts.length === 0 && !isLoading && (
            <div className="text-center py-12" role="status">
              <div className="text-gray-500">No accounts found matching your criteria</div>
            </div>
          )}
        </div>

        {/* Pagination would go here */}
        <nav className="mt-6 flex justify-between items-center" aria-label="Pagination">
          <div className="text-sm text-gray-700" role="status" aria-live="polite">
            Showing {accounts.length} account{accounts.length !== 1 ? "s" : ""}
          </div>
          <div className="flex space-x-2">
            <button
              disabled
              className="px-3 py-2 bg-gray-300 text-gray-500 rounded-sm disabled:opacity-50 focus:outline-hidden focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
              aria-label="Go to previous page"
              aria-disabled="true"
            >
              Previous
            </button>
            <button
              disabled
              className="px-3 py-2 bg-gray-300 text-gray-500 rounded-sm disabled:opacity-50 focus:outline-hidden focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
              aria-label="Go to next page"
              aria-disabled="true"
            >
              Next
            </button>
          </div>
        </nav>
      </div>
    </div>
  );
}

export default function Page() {
  return <AccountsPageContent />;
}
