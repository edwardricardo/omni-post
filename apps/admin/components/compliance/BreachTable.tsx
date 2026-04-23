/**
 * @file BreachTable.tsx
 * @description Table for managing data breach reports with severity badges,
 *   notification actions, and a dialog for reporting new breaches.
 * @layer infrastructure
 */
"use client";

import { useState, useCallback, useMemo, useId } from "react";
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
  useBreachReports,
  useCreateBreachReport,
  useSendBreachNotification,
  type BreachReport,
  type CreateBreachInput,
} from "@/hooks/api/useCompliance";

const SEVERITY_VARIANT: Record<
  BreachReport["severity"],
  "success" | "warning" | "error" | "neutral"
> = {
  LOW: "neutral",
  MEDIUM: "warning",
  HIGH: "error",
  CRITICAL: "error",
};

const SEVERITY_OPTIONS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

const DATA_TYPE_OPTIONS = [
  "email",
  "password",
  "personal_info",
  "financial",
  "health",
  "location",
  "social_media",
  "authentication",
] as const;

const EMPTY_FORM: CreateBreachInput = {
  title: "",
  description: "",
  severity: "MEDIUM",
  discoveredAt: new Date().toISOString().slice(0, 16),
  affectedUsers: 0,
  dataTypes: [],
};

/**
 * @component BreachTable
 * @description Table for managing data breach reports with severity badges, notification actions,
 *   pagination, and a dialog for reporting new breaches.
 */
export function BreachTable() {
  const t = useTranslations("compliance.breaches");
  const tc = useTranslations("common");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const { data, isLoading } = useBreachReports({ page, limit: perPage });

  const createMutation = useCreateBreachReport();
  const notifyMutation = useSendBreachNotification();

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CreateBreachInput>(EMPTY_FORM);

  const titleId = useId();
  const descriptionId = useId();
  const discoveredAtId = useId();
  const severityId = useId();
  const affectedUsersId = useId();

  const handleCreate = useCallback(async () => {
    if (!form.title.trim() || !form.description.trim()) return;
    try {
      await createMutation.mutateAsync({
        ...form,
        discoveredAt: new Date(form.discoveredAt).toISOString(),
      });
      toast({ title: tc("success"), description: t("breachReported") });
      setCreateOpen(false);
      setForm(EMPTY_FORM);
    } catch {
      toast({ title: tc("error"), variant: "destructive" });
    }
  }, [createMutation, form, t, tc]);

  const handleNotify = useCallback(
    async (id: string) => {
      try {
        await notifyMutation.mutateAsync(id);
        toast({ title: tc("success"), description: t("notificationsSent") });
      } catch {
        toast({ title: tc("error"), variant: "destructive" });
      }
    },
    [notifyMutation, t, tc]
  );

  const toggleDataType = useCallback((dtype: string) => {
    setForm((prev) => ({
      ...prev,
      dataTypes: prev.dataTypes.includes(dtype)
        ? prev.dataTypes.filter((d) => d !== dtype)
        : [...prev.dataTypes, dtype],
    }));
  }, []);

  const columns = useMemo(
    () => [
      {
        key: "createdAt",
        header: tc("date"),
        render: (item: BreachReport) => (
          <span className="text-xs">{new Date(item.createdAt).toLocaleDateString()}</span>
        ),
      },
      { key: "title", header: tc("name") },
      {
        key: "severity",
        header: t("severity"),
        render: (item: BreachReport) => (
          <Badge variant={SEVERITY_VARIANT[item.severity]}>{item.severity}</Badge>
        ),
      },
      {
        key: "affectedUsers",
        header: t("affected"),
        render: (item: BreachReport) => (
          <span className="text-sm">{item.affectedUsers.toLocaleString()}</span>
        ),
      },
      {
        key: "notifications",
        header: t("notifications"),
        render: (item: BreachReport) => (
          <Badge variant={item.notificationsSent ? "success" : "warning"}>
            {item.notificationsSent ? t("sent") : t("notSent")}
          </Badge>
        ),
      },
      {
        key: "status",
        header: tc("status"),
        render: (item: BreachReport) => (
          <Badge variant={item.resolved ? "success" : "error"}>
            {item.resolved ? tc("resolved") : tc("active")}
          </Badge>
        ),
      },
      {
        key: "actions",
        header: "",
        render: (item: BreachReport) => (
          <div className="flex gap-1.5 justify-end">
            {!item.notificationsSent && (
              <ActionButton
                size="sm"
                variant="primary"
                loading={notifyMutation.isPending}
                onClick={() => handleNotify(item.id)}
              >
                {t("sendNotifications")}
              </ActionButton>
            )}
          </div>
        ),
      },
    ],
    [t, tc, notifyMutation.isPending, handleNotify]
  );

  const totalPages = data ? Math.max(1, Math.ceil(data.total / perPage)) : 1;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t("title")}</h3>
        <ActionButton variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
          {t("reportBreach")}
        </ActionButton>
      </div>

      <DataTable
        columns={columns}
        data={data?.reports ?? []}
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

      {/* Create Breach Dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setForm(EMPTY_FORM);
          }
        }}
      >
        <DialogContent className="max-w-lg bg-[var(--bg-surface)] border-[var(--border-default)]">
          <DialogHeader>
            <DialogTitle className="text-[var(--text-primary)]">{t("reportBreach")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {/* Title */}
            <div>
              <label
                htmlFor={titleId}
                className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
              >
                {tc("name")}
              </label>
              <input
                id={titleId}
                type="text"
                value={form.title}
                onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                className="h-8 w-full rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
            </div>
            {/* Description */}
            <div>
              <label
                htmlFor={descriptionId}
                className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
              >
                {tc("description")}
              </label>
              <textarea
                id={descriptionId}
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                rows={3}
                className="w-full rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] resize-none"
              />
            </div>
            {/* Discovered At + Severity */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor={discoveredAtId}
                  className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
                >
                  {t("discoveredAt")}
                </label>
                <input
                  id={discoveredAtId}
                  type="datetime-local"
                  value={form.discoveredAt}
                  onChange={(e) => setForm((prev) => ({ ...prev, discoveredAt: e.target.value }))}
                  className="h-8 w-full rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                />
              </div>
              <div>
                <label
                  htmlFor={severityId}
                  className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
                >
                  {t("severity")}
                </label>
                <select
                  id={severityId}
                  value={form.severity}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      severity: e.target.value as CreateBreachInput["severity"],
                    }))
                  }
                  className="h-8 w-full rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                >
                  {SEVERITY_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {/* Affected Users */}
            <div>
              <label
                htmlFor={affectedUsersId}
                className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
              >
                {t("affected")}
              </label>
              <input
                id={affectedUsersId}
                type="number"
                min={0}
                value={form.affectedUsers}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, affectedUsers: Number(e.target.value) }))
                }
                className="h-8 w-full max-w-[200px] rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] px-2 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
            </div>
            {/* Data Types */}
            <div>
              <span className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                {t("dataTypes")}
              </span>
              <div className="flex flex-wrap gap-2">
                {DATA_TYPE_OPTIONS.map((dtype) => {
                  const selected = form.dataTypes.includes(dtype);
                  return (
                    <button
                      key={dtype}
                      type="button"
                      onClick={() => toggleDataType(dtype)}
                      className={[
                        "px-2 py-1 text-xs rounded-md border transition-colors",
                        selected
                          ? "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)]"
                          : "border-[var(--border-default)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                      ].join(" ")}
                    >
                      {dtype.replace(/_/g, " ")}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <ActionButton
              variant="secondary"
              size="sm"
              onClick={() => {
                setCreateOpen(false);
                setForm(EMPTY_FORM);
              }}
            >
              {tc("cancel")}
            </ActionButton>
            <ActionButton
              variant="primary"
              size="sm"
              loading={createMutation.isPending}
              disabled={!form.title.trim() || !form.description.trim()}
              onClick={handleCreate}
            >
              {t("reportBreach")}
            </ActionButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
