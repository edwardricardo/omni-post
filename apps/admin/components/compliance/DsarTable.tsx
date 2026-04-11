/**
 * @file DsarTable.tsx
 * @description Table for managing Data Subject Access Requests (DSAR) with status badges,
 *   deadline indicators, and action dialogs for acknowledge, complete, and reject operations.
 * @layer presentation
 */
"use client";

import { useState, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  toast,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@packages/ui";
import { DataTable } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";
import { ActionButton } from "@/components/ui/ActionButton";
import { Pagination } from "@/components/ui/Pagination";
import {
  useDsarRequests,
  useAcknowledgeDsar,
  useCompleteDsar,
  useRejectDsar,
  type DsarRequest,
} from "@/hooks/api/useCompliance";

const STATUS_VARIANT: Record<
  DsarRequest["status"],
  "success" | "warning" | "error" | "info" | "neutral"
> = {
  PENDING: "warning",
  IN_PROGRESS: "info",
  COMPLETED: "success",
  REJECTED: "neutral",
  EXPIRED: "error",
};

function daysUntil(deadline: string): number {
  const diff = new Date(deadline).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function DsarTable() {
  const t = useTranslations("compliance.dsar");
  const tc = useTranslations("common");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const { data, isLoading } = useDsarRequests({
    ...(statusFilter && { status: statusFilter }),
    page,
    limit: perPage,
  });

  const acknowledgeMutation = useAcknowledgeDsar();
  const completeMutation = useCompleteDsar();
  const rejectMutation = useRejectDsar();

  const [completeDialog, setCompleteDialog] = useState<{ open: boolean; id: string }>({
    open: false,
    id: "",
  });
  const [exportUrl, setExportUrl] = useState("");
  const [rejectDialog, setRejectDialog] = useState<{ open: boolean; id: string }>({
    open: false,
    id: "",
  });
  const [rejectReason, setRejectReason] = useState("");

  const handleAcknowledge = useCallback(
    async (id: string) => {
      try {
        await acknowledgeMutation.mutateAsync(id);
        toast({ title: tc("success"), description: t("acknowledge") });
      } catch {
        toast({ title: tc("error"), variant: "destructive" });
      }
    },
    [acknowledgeMutation, t, tc]
  );

  const handleComplete = useCallback(async () => {
    try {
      await completeMutation.mutateAsync({
        id: completeDialog.id,
        ...(exportUrl.trim() && { exportUrl: exportUrl.trim() }),
      });
      toast({ title: tc("success"), description: t("complete") });
      setCompleteDialog({ open: false, id: "" });
      setExportUrl("");
    } catch {
      toast({ title: tc("error"), variant: "destructive" });
    }
  }, [completeMutation, completeDialog.id, exportUrl, t, tc]);

  const handleReject = useCallback(async () => {
    if (!rejectReason.trim()) return;
    try {
      await rejectMutation.mutateAsync({ id: rejectDialog.id, reason: rejectReason.trim() });
      toast({ title: tc("success"), description: t("reject") });
      setRejectDialog({ open: false, id: "" });
      setRejectReason("");
    } catch {
      toast({ title: tc("error"), variant: "destructive" });
    }
  }, [rejectMutation, rejectDialog.id, rejectReason, t, tc]);

  const columns = useMemo(
    () => [
      {
        key: "createdAt",
        header: tc("date"),
        render: (item: DsarRequest) => (
          <span className="text-xs">{new Date(item.createdAt).toLocaleDateString()}</span>
        ),
      },
      { key: "email", header: t("email") },
      { key: "type", header: t("type") },
      { key: "jurisdiction", header: t("jurisdiction") },
      {
        key: "status",
        header: t("status"),
        render: (item: DsarRequest) => (
          <Badge variant={STATUS_VARIANT[item.status]}>{item.status}</Badge>
        ),
      },
      {
        key: "deadline",
        header: t("deadline"),
        render: (item: DsarRequest) => {
          const days = daysUntil(item.deadline);
          const color =
            days < 2
              ? "text-[var(--error)]"
              : days < 7
                ? "text-[var(--warning)]"
                : "text-[var(--text-secondary)]";
          return (
            <span className={`text-xs font-medium ${color}`}>
              {days <= 0 ? t("overdue") : t("daysLeft", { days })}
            </span>
          );
        },
      },
      {
        key: "actions",
        header: "",
        render: (item: DsarRequest) => (
          <div className="flex gap-1.5 justify-end">
            {item.status === "PENDING" && (
              <>
                <ActionButton
                  size="sm"
                  variant="primary"
                  loading={acknowledgeMutation.isPending}
                  onClick={() => handleAcknowledge(item.id)}
                >
                  {t("acknowledge")}
                </ActionButton>
                <ActionButton
                  size="sm"
                  variant="danger"
                  onClick={() => setRejectDialog({ open: true, id: item.id })}
                >
                  {t("reject")}
                </ActionButton>
              </>
            )}
            {item.status === "IN_PROGRESS" && (
              <>
                <ActionButton
                  size="sm"
                  variant="primary"
                  onClick={() => setCompleteDialog({ open: true, id: item.id })}
                >
                  {t("complete")}
                </ActionButton>
                <ActionButton
                  size="sm"
                  variant="danger"
                  onClick={() => setRejectDialog({ open: true, id: item.id })}
                >
                  {t("reject")}
                </ActionButton>
              </>
            )}
          </div>
        ),
      },
    ],
    [t, tc, acknowledgeMutation.isPending, handleAcknowledge]
  );

  const totalPages = data ? Math.max(1, Math.ceil(data.total / perPage)) : 1;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t("title")}</h3>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="h-7 rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
        >
          <option value="">{tc("all")}</option>
          <option value="PENDING">Pending</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="COMPLETED">Completed</option>
          <option value="REJECTED">Rejected</option>
          <option value="EXPIRED">Expired</option>
        </select>
      </div>

      <DataTable
        columns={columns}
        data={data?.requests ?? []}
        isLoading={isLoading}
        rowKey={(item) => item.id}
        emptyMessage={t("title")}
      />

      <Pagination
        page={page}
        totalPages={totalPages}
        totalItems={data?.total ?? 0}
        perPage={perPage}
        onPageChange={setPage}
        onPerPageChange={(n) => {
          setPerPage(n);
          setPage(1);
        }}
      />

      {/* Complete Dialog */}
      <Dialog
        open={completeDialog.open}
        onOpenChange={(open) => {
          if (!open) {
            setCompleteDialog({ open: false, id: "" });
            setExportUrl("");
          }
        }}
      >
        <DialogContent className="max-w-md bg-[var(--bg-surface)] border-[var(--border-default)]">
          <DialogHeader>
            <DialogTitle className="text-[var(--text-primary)]">{t("complete")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              {t("exportUrl")}
            </label>
            <input
              type="url"
              value={exportUrl}
              onChange={(e) => setExportUrl(e.target.value)}
              placeholder="https://..."
              className="h-8 w-full rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            />
          </div>
          <DialogFooter>
            <ActionButton
              variant="secondary"
              size="sm"
              onClick={() => setCompleteDialog({ open: false, id: "" })}
            >
              {tc("cancel")}
            </ActionButton>
            <ActionButton
              variant="primary"
              size="sm"
              loading={completeMutation.isPending}
              onClick={handleComplete}
            >
              {t("complete")}
            </ActionButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog
        open={rejectDialog.open}
        onOpenChange={(open) => {
          if (!open) {
            setRejectDialog({ open: false, id: "" });
            setRejectReason("");
          }
        }}
      >
        <DialogContent className="max-w-md bg-[var(--bg-surface)] border-[var(--border-default)]">
          <DialogHeader>
            <DialogTitle className="text-[var(--text-primary)]">{t("reject")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <label className="block text-xs font-medium text-[var(--text-secondary)]">
              {t("rejectReason")}
            </label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              className="w-full rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] resize-none"
            />
          </div>
          <DialogFooter>
            <ActionButton
              variant="secondary"
              size="sm"
              onClick={() => setRejectDialog({ open: false, id: "" })}
            >
              {tc("cancel")}
            </ActionButton>
            <ActionButton
              variant="danger"
              size="sm"
              loading={rejectMutation.isPending}
              disabled={!rejectReason.trim()}
              onClick={handleReject}
            >
              {t("reject")}
            </ActionButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
