/**
 * @file page.tsx
 * @description Audit logs page displaying admin activity records from the backend.
 * Supports client-side filtering by search text, action, result, user, and dates
 * with auto-refresh. Provides CSV export and server-side audit statistics.
 * @layer infrastructure
 */
"use client";

import { useState, useMemo, useCallback } from "react";
import { Pagination } from "@/components/ui/Pagination";
import { useTranslations } from "next-intl";
import { RefreshCw, List, CheckCircle2, Calendar, Users, Search, Download } from "lucide-react";
import { ApiError, isPermissionDenied, getErrorMessage } from "@packages/api-errors";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { useAuditLogs } from "@/hooks/api/useAuditLogs";
import { useAuditStats } from "@/hooks/api/useAuditStats";
import { useAdminUsers } from "@/hooks/api/useAdminUsers";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Badge } from "@/components/ui/Badge";
import { ActionButton } from "@/components/ui/ActionButton";
import { toast } from "@packages/ui";

function LogsPageContent() {
  const tl = useTranslations("logs");
  const tc = useTranslations("common");

  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);

  const [filters, setFilters] = useState({
    search: "",
    action: "all",
    result: "all",
    startDate: "",
    endDate: "",
    userId: "",
  });

  const queryFilters = useMemo(() => {
    const f: { startDate?: string; endDate?: string; userId?: string } = {};
    if (filters.startDate) f.startDate = new Date(filters.startDate).toISOString();
    if (filters.endDate) f.endDate = new Date(filters.endDate).toISOString();
    if (filters.userId) f.userId = filters.userId;
    return Object.keys(f).length > 0 ? f : undefined;
  }, [filters.startDate, filters.endDate, filters.userId]);

  const { data: logs, isLoading, error, refetch } = useAuditLogs(queryFilters);
  const { data: auditStats } = useAuditStats();
  const { data: adminUsers } = useAdminUsers();

  const filteredLogs = useMemo(() => {
    if (!logs) return [];

    return logs.filter((log) => {
      const matchesSearch =
        !filters.search ||
        log.id.toLowerCase().includes(filters.search.toLowerCase()) ||
        log.action.toLowerCase().includes(filters.search.toLowerCase()) ||
        (log.resource ?? "").toLowerCase().includes(filters.search.toLowerCase());

      const matchesAction = filters.action === "all" || log.action === filters.action;

      const matchesResult =
        filters.result === "all" ||
        (filters.result === "success" && log.success) ||
        (filters.result === "failure" && !log.success);

      return matchesSearch && matchesAction && matchesResult;
    });
  }, [logs, filters]);

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / perPage));
  const paginatedLogs = useMemo(
    () => filteredLogs.slice((page - 1) * perPage, page * perPage),
    [filteredLogs, page, perPage]
  );

  const actions = useMemo(() => {
    if (!logs) return [];
    return Array.from(new Set(logs.map((l) => l.action)));
  }, [logs]);

  const handleExport = useCallback(async () => {
    try {
      const params = new URLSearchParams({ format: "csv" });
      if (filters.startDate) params.set("startDate", new Date(filters.startDate).toISOString());
      if (filters.endDate) params.set("endDate", new Date(filters.endDate).toISOString());
      if (filters.userId) params.set("userId", filters.userId);
      const res = await fetch(`/api/backend/admin/audit/export?${params}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        toast({
          title: "Error",
          description: getErrorMessage(ApiError.fromResponse(res.status, body)),
          variant: "destructive",
        });
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-logs-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({ title: "Error", description: getErrorMessage(e), variant: "destructive" });
    }
  }, [filters.startDate, filters.endDate, filters.userId]);

  if (isLoading) {
    return (
      <div className="p-6">
        <PageHeader title={tl("title")} />
        <div className="flex justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] py-12">
          <LoadingSpinner size="lg" label={tl("loadingLogs")} />
        </div>
      </div>
    );
  }

  if (error) {
    if (isPermissionDenied(error)) {
      return (
        <div className="p-6">
          <PageHeader title={tl("title")} />
          <AccessDenied />
        </div>
      );
    }
    return (
      <div className="p-6">
        <PageHeader title={tl("title")} />
        <div
          className="rounded-lg border border-[var(--error)] bg-[var(--error-subtle)] p-6"
          role="alert"
        >
          <h2 className="font-medium text-[var(--error)] mb-2">{tl("errorTitle")}</h2>
          <p className="text-sm text-[var(--error)] mb-4">{getErrorMessage(error)}</p>
          <ActionButton variant="primary" loading={isLoading} onClick={() => refetch()}>
            {tc("retry")}
          </ActionButton>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <PageHeader
        title={tl("title")}
        description={tl("description")}
        actions={
          <div className="flex items-center gap-2">
            <ActionButton variant="secondary" onClick={handleExport}>
              <Download className="h-3.5 w-3.5" />
              {tl("exportCsv")}
            </ActionButton>
            <ActionButton variant="secondary" onClick={() => refetch()} disabled={isLoading}>
              <RefreshCw className="h-3.5 w-3.5" />
              {tc("refresh")}
            </ActionButton>
          </div>
        }
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard
          label={tl("stats.totalEvents")}
          value={auditStats?.totalLogs ?? 0}
          icon={<List className="h-5 w-5" />}
        />
        <StatCard
          label={tl("stats.failedEvents")}
          value={auditStats?.todayLogs ?? 0}
          icon={<Calendar className="h-5 w-5" />}
        />
        <StatCard
          label={tl("stats.uniqueUsers")}
          value={auditStats?.uniqueUsers ?? 0}
          icon={<Users className="h-5 w-5" />}
        />
        <StatCard
          label={tl("stats.successRate")}
          value={`${(auditStats?.successRate ?? 100).toFixed(0)}%`}
          icon={<CheckCircle2 className="h-5 w-5" />}
        />
      </div>

      {/* Filters */}
      <div className="mb-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div>
            <label
              htmlFor="log-search"
              className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]"
            >
              {tc("search")}
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input
                id="log-search"
                type="text"
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                placeholder={tl("searchPlaceholder")}
                className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] py-2 pl-8 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>
          </div>
          <div>
            <label
              htmlFor="action-filter"
              className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]"
            >
              {tl("table.action")}
            </label>
            <select
              id="action-filter"
              value={filters.action}
              onChange={(e) => setFilters({ ...filters, action: e.target.value })}
              className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            >
              <option value="all">{tl("allActions")}</option>
              {actions.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="result-filter"
              className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]"
            >
              {tl("table.result")}
            </label>
            <select
              id="result-filter"
              value={filters.result}
              onChange={(e) => setFilters({ ...filters, result: e.target.value })}
              className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            >
              <option value="all">{tl("allResults")}</option>
              <option value="success">{tl("success")}</option>
              <option value="failure">{tl("failed")}</option>
            </select>
          </div>
          <div>
            <label
              htmlFor="user-filter"
              className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]"
            >
              {tl("table.user")}
            </label>
            <select
              id="user-filter"
              value={filters.userId}
              onChange={(e) => setFilters({ ...filters, userId: e.target.value })}
              className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            >
              <option value="">{tl("table.user")}</option>
              {adminUsers?.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} ({user.role})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="start-date-filter"
              className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]"
            >
              {tl("dateFrom")}
            </label>
            <input
              id="start-date-filter"
              type="datetime-local"
              value={filters.startDate}
              onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
              className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
          <div>
            <label
              htmlFor="end-date-filter"
              className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]"
            >
              {tl("dateTo")}
            </label>
            <input
              id="end-date-filter"
              type="datetime-local"
              value={filters.endDate}
              onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
              className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
        </div>
      </div>

      {/* Logs Table */}
      <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-[var(--border-subtle)]">
            <thead>
              <tr className="bg-[var(--bg-elevated)]">
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]"
                >
                  {tl("table.action")}
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]"
                >
                  {tl("table.resource")}
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]"
                >
                  {tl("table.result")}
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]"
                >
                  {tl("ipAddress")}
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]"
                >
                  {tl("table.timestamp")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {paginatedLogs.map((log) => (
                <tr key={log.id} className="transition-colors hover:bg-[var(--bg-elevated)]">
                  <td className="whitespace-nowrap px-3 py-2 text-sm font-medium text-[var(--text-primary)]">
                    {log.action}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-[var(--text-secondary)]">
                    {log.resource ?? "\u2014"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <Badge variant={log.success ? "success" : "error"}>
                      {log.success ? tl("success") : tl("failed")}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-[var(--text-tertiary)]">
                    {log.ipAddress ?? "\u2014"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-[var(--text-tertiary)]">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredLogs.length === 0 && !isLoading && (
          <div className="py-12 text-center text-sm text-[var(--text-secondary)]">
            {tl("noResults")}
          </div>
        )}
      </div>

      <Pagination
        page={page}
        totalPages={totalPages}
        totalItems={filteredLogs.length}
        perPage={perPage}
        onPageChange={setPage}
        onPerPageChange={(n) => {
          setPerPage(n);
          setPage(1);
        }}
      />
    </div>
  );
}

/**
 * @component LogsPage
 * @description Displays admin audit logs with filtering, search, auto-refresh, statistics, and CSV export.
 */
export default function LogsPage() {
  return <LogsPageContent />;
}
