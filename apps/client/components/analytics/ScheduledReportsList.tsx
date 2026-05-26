/**
 * @file ScheduledReportsList.tsx
 * @description Table of scheduled reports with generate and delete actions.
 * @layer infrastructure
 */
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import cronstrue from "cronstrue";
import { ConfirmDialog } from "@packages/ui";
import { useLogger, extractErrorInfo } from "@observability/browser-logger";
import { useReports, useDeleteReport, useGenerateReport } from "@/hooks/api/useReports";

interface ScheduledReportsListProps {
  projectId: string;
  onCreateClick: () => void;
}

/**
 * @component ScheduledReportsList
 * @description Table of scheduled analytics reports with generate-now and delete actions,
 * showing cron schedule in human-readable format and last-run date.
 * @param props.onCreateClick - Opens the report creation dialog
 */

type GenerateStatus = "idle" | "success" | "error";

function humanizeCron(cron: string): string {
  try {
    return cronstrue.toString(cron, { use24HourTimeFormat: false });
  } catch {
    return cron;
  }
}

function formatDate(iso: string | null, neverLabel: string): string {
  if (!iso) return neverLabel;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const TABLE_HEADER_KEYS = [
  "headerName",
  "headerSchedule",
  "headerFormat",
  "headerRecipients",
  "headerStatus",
  "headerLastRun",
  "headerActions",
] as const;

export function ScheduledReportsList({ projectId, onCreateClick }: ScheduledReportsListProps) {
  const t = useTranslations("analytics.components");
  const logger = useLogger("client.scheduled-reports");
  const { data: reports, isLoading, error, refetch } = useReports(projectId);
  const deleteReport = useDeleteReport();
  const generateReport = useGenerateReport();
  const [generateStatus, setGenerateStatus] = useState<Record<string, GenerateStatus>>({});
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  function handleDelete(id: string, name: string) {
    setDeleteTarget({ id, name });
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    await deleteReport.mutateAsync(deleteTarget.id).catch((err: unknown) => {
      // TanStack mutation state (deleteReport.isError) surfaces the failure in the UI.
      // Log for observability so persistent failures are still visible in APM.
      logger.debug("Report delete failed (mutation state handles user-facing error)", {
        err: extractErrorInfo(err),
        reportId: deleteTarget.id,
      });
    });
    setDeleteTarget(null);
  }

  async function handleGenerate(id: string) {
    setGenerateStatus((prev) => ({ ...prev, [id]: "idle" }));
    try {
      await generateReport.mutateAsync(id);
      setGenerateStatus((prev) => ({ ...prev, [id]: "success" }));
      setTimeout(
        () =>
          setGenerateStatus((prev) => ({
            ...prev,
            [id]: "idle",
          })),
        3000
      );
    } catch {
      setGenerateStatus((prev) => ({ ...prev, [id]: "error" }));
      setTimeout(
        () =>
          setGenerateStatus((prev) => ({
            ...prev,
            [id]: "idle",
          })),
        3000
      );
    }
  }

  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {TABLE_HEADER_KEYS.map((h) => (
                <th
                  key={h}
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  {t(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {[1, 2, 3].map((i) => (
              <tr key={i}>
                {Array.from({ length: 7 }).map((_, j) => (
                  <td key={j} className="px-6 py-4">
                    <div className="h-4 bg-gray-200 rounded animate-pulse w-24" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-8 text-center" role="alert">
        <p className="text-red-600 mb-4">{t("loadFailed")}</p>
        <button
          onClick={() => void refetch()}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
        >
          {t("retry")}
        </button>
      </div>
    );
  }

  if (!reports || reports.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-12 text-center">
        <p className="text-gray-500 text-lg mb-2">{t("emptyTitle")}</p>
        <p className="text-gray-400 text-sm mb-6">{t("emptyDescription")}</p>
        <button
          onClick={onCreateClick}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium"
        >
          {t("emptyAction")}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table
          className="min-w-full divide-y divide-gray-200"
          role="table"
          aria-label={t("tableAria")}
        >
          <thead className="bg-gray-50">
            <tr>
              {TABLE_HEADER_KEYS.map((h) => (
                <th
                  key={h}
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  {t(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {reports.map((report) => {
              const status: GenerateStatus = generateStatus[report.id] ?? "idle";
              const generateLabel =
                status === "success"
                  ? t("generateQueued")
                  : status === "error"
                    ? t("generateFailed")
                    : t("generateNow");
              const generatePrefix =
                status === "success" ? "\u2713 " : status === "error" ? "\u2717 " : "";

              return (
                <tr key={report.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {report.name}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600 max-w-xs">
                    <span title={report.cronSchedule}>{humanizeCron(report.cronSchedule)}</span>
                    <span className="block text-xs text-gray-400 font-mono mt-0.5">
                      {report.cronSchedule}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                      {report.format}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    {t("recipientCount", { count: report.recipients.length })}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        report.isActive
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {report.isActive ? t("statusActive") : t("statusInactive")}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatDate(report.lastRunAt, t("never"))}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm space-x-2">
                    <button
                      onClick={() => void handleGenerate(report.id)}
                      disabled={generateReport.isPending}
                      className="text-blue-600 hover:text-blue-800 disabled:opacity-50 font-medium"
                      aria-label={t("generateAria", { name: report.name })}
                    >
                      {generatePrefix}
                      {generateLabel}
                    </button>
                    <button
                      onClick={() => void handleDelete(report.id, report.name)}
                      disabled={deleteReport.isPending}
                      className="text-red-600 hover:text-red-800 disabled:opacity-50 font-medium"
                      aria-label={t("deleteAria", { name: report.name })}
                    >
                      {t("delete")}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={t("deleteDialogTitle")}
        description={
          deleteTarget
            ? t("deleteDialogDescription", { name: deleteTarget.name })
            : t("deleteDialogDescriptionFallback")
        }
        confirmLabel={t("delete")}
        variant="danger"
        onConfirm={handleConfirmDelete}
        loading={deleteReport.isPending}
      />
    </div>
  );
}
