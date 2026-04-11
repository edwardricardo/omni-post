/**
 * @file page.tsx
 * @description Gateway switch management page. Lists switch events with stats,
 *   filtering, detail dialog, and admin actions (extend, force-complete, suspend).
 * @layer page
 */
"use client";

import { useCallback, useMemo, useState } from "react";
import { ArrowRightLeft, Calendar, Clock, RefreshCw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { isPermissionDenied, getErrorMessage } from "@/lib/parseApiError";
import { AccessDenied } from "@/components/shared/AccessDenied";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { TabNav } from "@/components/ui/TabNav";
import { DataTable } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";
import { ActionButton } from "@/components/ui/ActionButton";
import { Pagination } from "@/components/ui/Pagination";
import {
  useGatewaySwitches,
  useGatewaySwitchDetail,
  useExtendSwitchDeadline,
  useForceCompleteSwitch,
  useForceSuspendSwitch,
} from "@/hooks/api/useGatewaySwitches";
import type { GatewaySwitchEvent } from "@/hooks/api/useGatewaySwitches";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type SwitchStatus = GatewaySwitchEvent["status"];

const STATUS_VARIANT: Record<SwitchStatus, "success" | "warning" | "error" | "neutral"> = {
  SCHEDULED: "neutral",
  PENDING_CHECKOUT: "warning",
  COMPLETED: "success",
  CANCELLED: "neutral",
  SUSPENDED: "error",
  EXPIRED: "error",
};

const GATEWAY_COLORS: Record<string, string> = {
  STRIPE: "#635BFF",
  PADDLE: "#05E27B",
};

const TAB_KEYS = ["ALL", "SCHEDULED", "PENDING_CHECKOUT", "COMPLETED", "SUSPENDED", "CANCELLED"];
const EXTEND_OPTIONS = [12, 24, 48, 72];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function addHours(dateStr: string, hours: number): Date {
  const d = new Date(dateStr);
  d.setTime(d.getTime() + hours * 60 * 60 * 1000);
  return d;
}

function canModify(status: SwitchStatus): boolean {
  return status === "SCHEDULED" || status === "PENDING_CHECKOUT";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function GatewayChip({ gateway }: { gateway: string }) {
  const color = GATEWAY_COLORS[gateway] ?? "var(--text-secondary)";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ backgroundColor: `${color}18`, color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {gateway}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Detail Dialog
// ---------------------------------------------------------------------------

interface DetailDialogProps {
  eventId: string;
  t: ReturnType<typeof useTranslations>;
  tc: ReturnType<typeof useTranslations>;
  onClose: () => void;
  onExtend: (id: string) => void;
}

function DetailDialog({ eventId, t, tc, onClose, onExtend }: DetailDialogProps) {
  const { data: evt, isLoading } = useGatewaySwitchDetail(eventId);
  const forceComplete = useForceCompleteSwitch();
  const forceSuspend = useForceSuspendSwitch();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t("detail.title")}
    >
      <div
        className="relative w-full max-w-lg rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-md p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          aria-label={tc("close")}
        >
          <X className="h-4 w-4" />
        </button>

        <h2 className="mb-4 text-base font-semibold text-[var(--text-primary)]">
          {t("detail.title")}
        </h2>

        {isLoading || !evt ? (
          <div className="flex justify-center py-10">
            <LoadingSpinner size="md" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Account info */}
            <div className="rounded-md border border-[var(--border-subtle)] p-3">
              <div className="text-sm font-medium text-[var(--text-primary)]">
                {evt.account.name}
              </div>
              <div className="text-xs text-[var(--text-secondary)]">{evt.account.email}</div>
            </div>

            {/* Gateway transition */}
            <div className="flex items-center gap-2">
              <GatewayChip gateway={evt.fromGateway} />
              <ArrowRightLeft className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
              <GatewayChip gateway={evt.toGateway} />
              <Badge variant={STATUS_VARIANT[evt.status]}>{t(`status.${evt.status}`)}</Badge>
            </div>

            {/* Timeline */}
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                {t("detail.timeline")}
              </h3>
              <div className="space-y-1.5 text-xs">
                <TimelineRow
                  icon={<Calendar className="h-3 w-3" />}
                  label={t("detail.switchRequested")}
                  date={evt.requestedAt}
                />
                <TimelineRow
                  icon={<Clock className="h-3 w-3" />}
                  label={t("detail.periodEnded")}
                  date={evt.scheduledFor}
                />
                {evt.reminderSentAt && (
                  <TimelineRow
                    icon={<Clock className="h-3 w-3" />}
                    label={t("detail.reminderSent")}
                    date={evt.reminderSentAt}
                  />
                )}
                {evt.completedAt && (
                  <TimelineRow
                    icon={<Clock className="h-3 w-3" />}
                    label={t("detail.checkoutCompleted")}
                    date={evt.completedAt}
                  />
                )}
                {evt.suspendedAt && (
                  <TimelineRow
                    icon={<Clock className="h-3 w-3" />}
                    label={t("detail.accountSuspended")}
                    date={evt.suspendedAt}
                  />
                )}
                {evt.cancelledAt && (
                  <TimelineRow
                    icon={<Clock className="h-3 w-3" />}
                    label={t("detail.switchCancelled")}
                    date={evt.cancelledAt}
                  />
                )}
              </div>
            </div>

            {/* Current deadline */}
            {(evt.extendedUntil || evt.scheduledFor) && canModify(evt.status) && (
              <div className="rounded-md border border-[var(--border-subtle)] p-3">
                <div className="text-xs text-[var(--text-secondary)]">
                  {t("detail.currentDeadline")}
                </div>
                <div className="text-sm font-medium text-[var(--text-primary)]">
                  {formatDate(evt.extendedUntil ?? evt.scheduledFor)}
                </div>
              </div>
            )}

            {/* Actions */}
            {canModify(evt.status) && (
              <div className="flex gap-2 border-t border-[var(--border-subtle)] pt-3">
                <ActionButton size="sm" variant="secondary" onClick={() => onExtend(evt.id)}>
                  {t("actions.extend")}
                </ActionButton>
                <ActionButton
                  size="sm"
                  variant="primary"
                  loading={forceComplete.isPending}
                  onClick={() => forceComplete.mutate(evt.id, { onSuccess: onClose })}
                >
                  {t("actions.forceComplete")}
                </ActionButton>
                <ActionButton
                  size="sm"
                  variant="danger"
                  loading={forceSuspend.isPending}
                  onClick={() => forceSuspend.mutate(evt.id, { onSuccess: onClose })}
                >
                  {t("actions.forceSuspend")}
                </ActionButton>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TimelineRow({
  icon,
  label,
  date,
}: {
  icon: React.ReactNode;
  label: string;
  date: string;
}) {
  return (
    <div className="flex items-center gap-2 text-[var(--text-secondary)]">
      <span className="text-[var(--text-tertiary)]">{icon}</span>
      <span>{label}</span>
      <span className="ml-auto font-medium text-[var(--text-primary)]">{formatDate(date)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Extend Dialog
// ---------------------------------------------------------------------------

interface ExtendDialogProps {
  eventId: string;
  currentDeadline: string;
  t: ReturnType<typeof useTranslations>;
  tc: ReturnType<typeof useTranslations>;
  onClose: () => void;
}

function ExtendDialog({ eventId, currentDeadline, t, tc, onClose }: ExtendDialogProps) {
  const [extraHours, setExtraHours] = useState(24);
  const extendMutation = useExtendSwitchDeadline();
  const newDeadline = addHours(currentDeadline, extraHours);

  const handleConfirm = useCallback(() => {
    extendMutation.mutate({ id: eventId, extraHours }, { onSuccess: onClose });
  }, [extendMutation, eventId, extraHours, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t("extendDialog.title")}
    >
      <div
        className="relative w-full max-w-sm rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-md p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          aria-label={tc("close")}
        >
          <X className="h-4 w-4" />
        </button>

        <h2 className="mb-4 text-base font-semibold text-[var(--text-primary)]">
          {t("extendDialog.title")}
        </h2>

        <div className="space-y-3">
          <div>
            <div className="text-xs text-[var(--text-secondary)]">
              {t("extendDialog.currentDeadline")}
            </div>
            <div className="text-sm font-medium text-[var(--text-primary)]">
              {formatDate(currentDeadline)}
            </div>
          </div>

          <div>
            <label
              htmlFor="extra-hours"
              className="mb-1 block text-xs text-[var(--text-secondary)]"
            >
              {t("extendDialog.extraHours")}
            </label>
            <select
              id="extra-hours"
              value={extraHours}
              onChange={(e) => setExtraHours(Number(e.target.value))}
              className="w-full rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            >
              {EXTEND_OPTIONS.map((h) => (
                <option key={h} value={h}>
                  {h}h
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="text-xs text-[var(--text-secondary)]">
              {t("extendDialog.newDeadline")}
            </div>
            <div className="text-sm font-semibold text-[var(--accent)]">
              {newDeadline.toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <ActionButton variant="secondary" size="sm" onClick={onClose}>
              {tc("cancel")}
            </ActionButton>
            <ActionButton
              variant="primary"
              size="sm"
              loading={extendMutation.isPending}
              onClick={handleConfirm}
            >
              {t("extendDialog.confirm")}
            </ActionButton>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function GatewaySwitchesPageContent() {
  const t = useTranslations("gatewaySwitches");
  const tc = useTranslations("common");

  // Filters
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);

  // Dialogs
  const [detailId, setDetailId] = useState<string | null>(null);
  const [extendTarget, setExtendTarget] = useState<{
    id: string;
    deadline: string;
  } | null>(null);

  // Data
  const { data, isLoading, error, refetch } = useGatewaySwitches({
    status: statusFilter,
    page,
    limit: perPage,
  });

  // Mutations (inline actions)
  const forceComplete = useForceCompleteSwitch();
  const forceSuspend = useForceSuspendSwitch();

  const events = useMemo(() => data?.events ?? [], [data?.events]);
  const total = data?.total ?? 0;
  const stats = data?.stats;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  // Tabs
  const tabsFinal = useMemo(
    () => [
      { key: "ALL", label: `${tc("status")} (${total})` },
      ...TAB_KEYS.slice(1).map((key) => ({ key, label: t(`status.${key}`) })),
    ],
    [t, tc, total]
  );

  const handleTabChange = useCallback((key: string) => {
    setStatusFilter(key);
    setPage(1);
  }, []);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const handleRowClick = useCallback((evt: GatewaySwitchEvent) => {
    setDetailId(evt.id);
  }, []);

  const handleExtendOpen = useCallback((evt: GatewaySwitchEvent) => {
    setExtendTarget({
      id: evt.id,
      deadline: evt.extendedUntil ?? evt.scheduledFor,
    });
  }, []);

  const handleCloseDetail = useCallback(() => setDetailId(null), []);
  const handleCloseExtend = useCallback(() => setExtendTarget(null), []);

  const handleExtendFromDetail = useCallback(
    (id: string) => {
      const evt = events.find((e) => e.id === id);
      if (evt) {
        setDetailId(null);
        setExtendTarget({ id, deadline: evt.extendedUntil ?? evt.scheduledFor });
      }
    },
    [events]
  );

  // Table columns
  const columns = useMemo(
    () => [
      {
        key: "account",
        header: t("table.account"),
        render: (evt: GatewaySwitchEvent) => (
          <div>
            <div className="text-sm font-medium text-[var(--text-primary)]">{evt.account.name}</div>
            <div className="text-xs text-[var(--text-tertiary)]">{evt.account.email}</div>
          </div>
        ),
      },
      {
        key: "fromTo",
        header: t("table.fromTo"),
        render: (evt: GatewaySwitchEvent) => (
          <div className="flex items-center gap-1.5">
            <GatewayChip gateway={evt.fromGateway} />
            <ArrowRightLeft className="h-3 w-3 text-[var(--text-tertiary)]" />
            <GatewayChip gateway={evt.toGateway} />
          </div>
        ),
      },
      {
        key: "requestedAt",
        header: t("table.requestedAt"),
        render: (evt: GatewaySwitchEvent) => (
          <span className="text-sm text-[var(--text-secondary)]">
            {formatDate(evt.requestedAt)}
          </span>
        ),
      },
      {
        key: "scheduledFor",
        header: t("table.scheduledFor"),
        render: (evt: GatewaySwitchEvent) => (
          <span className="text-sm text-[var(--text-secondary)]">
            {formatDate(evt.scheduledFor)}
          </span>
        ),
      },
      {
        key: "status",
        header: t("table.status"),
        render: (evt: GatewaySwitchEvent) => (
          <Badge variant={STATUS_VARIANT[evt.status]}>{t(`status.${evt.status}`)}</Badge>
        ),
      },
      {
        key: "actions",
        header: t("table.actions"),
        render: (evt: GatewaySwitchEvent) => (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <ActionButton variant="secondary" size="sm" onClick={() => setDetailId(evt.id)}>
              {t("actions.viewDetail")}
            </ActionButton>
            {canModify(evt.status) && (
              <>
                <ActionButton variant="secondary" size="sm" onClick={() => handleExtendOpen(evt)}>
                  {t("actions.extend")}
                </ActionButton>
                <ActionButton
                  variant="primary"
                  size="sm"
                  loading={forceComplete.isPending}
                  onClick={() => forceComplete.mutate(evt.id)}
                >
                  {t("actions.forceComplete")}
                </ActionButton>
                <ActionButton
                  variant="danger"
                  size="sm"
                  loading={forceSuspend.isPending}
                  onClick={() => forceSuspend.mutate(evt.id)}
                >
                  {t("actions.forceSuspend")}
                </ActionButton>
              </>
            )}
          </div>
        ),
      },
    ],
    [t, forceComplete, forceSuspend, handleExtendOpen]
  );

  // ---------------------------------------------------------------------------
  // Error / loading states
  // ---------------------------------------------------------------------------

  if (error) {
    if (isPermissionDenied(error)) {
      return (
        <div>
          <PageHeader title={t("title")} description={t("description")} />
          <AccessDenied />
        </div>
      );
    }
    return (
      <div>
        <PageHeader title={t("title")} description={t("description")} />
        <div className="flex items-center justify-center gap-4 py-16" role="alert">
          <span className="text-sm text-[var(--error)]">{getErrorMessage(error)}</span>
          <ActionButton variant="primary" size="sm" onClick={handleRefresh}>
            {tc("retry")}
          </ActionButton>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <ActionButton variant="secondary" size="sm" onClick={handleRefresh} loading={isLoading}>
            <RefreshCw className="h-3.5 w-3.5" />
            {tc("refresh")}
          </ActionButton>
        }
      />

      {/* Stats */}
      {stats && (
        <div
          className="mb-3 grid grid-cols-2 gap-4 md:grid-cols-4"
          role="region"
          aria-label="Gateway switch statistics"
        >
          <StatCard label={t("stats.scheduled")} value={stats.scheduled} />
          <StatCard label={t("stats.pendingCheckout")} value={stats.pendingCheckout} />
          <StatCard label={t("stats.suspended")} value={stats.suspended} />
          <StatCard label={t("stats.completed30d")} value={stats.completed30d} />
        </div>
      )}

      {/* Tab filter */}
      <TabNav tabs={tabsFinal} activeTab={statusFilter} onChange={handleTabChange} />

      {/* Table */}
      <div className="mt-4">
        <DataTable
          columns={columns}
          data={events}
          isLoading={isLoading}
          emptyMessage={t("noEvents")}
          rowKey={(evt) => evt.id}
          onRowClick={handleRowClick}
        />
      </div>

      {/* Pagination */}
      <Pagination
        page={page}
        totalPages={totalPages}
        totalItems={total}
        perPage={perPage}
        onPageChange={setPage}
        onPerPageChange={(n) => {
          setPerPage(n);
          setPage(1);
        }}
      />

      {/* Detail dialog */}
      {detailId && (
        <DetailDialog
          eventId={detailId}
          t={t}
          tc={tc}
          onClose={handleCloseDetail}
          onExtend={handleExtendFromDetail}
        />
      )}

      {/* Extend dialog */}
      {extendTarget && (
        <ExtendDialog
          eventId={extendTarget.id}
          currentDeadline={extendTarget.deadline}
          t={t}
          tc={tc}
          onClose={handleCloseExtend}
        />
      )}
    </div>
  );
}

export default function Page() {
  return <GatewaySwitchesPageContent />;
}
