/**
 * @file ScheduledReportsList.tsx
 * @description Table of scheduled reports with generate and delete actions.
 * @layer infrastructure
 */
"use client";

import { useState } from "react";
import cronstrue from "cronstrue";
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

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const TABLE_HEADERS = [
  "Name",
  "Schedule",
  "Format",
  "Recipients",
  "Status",
  "Last Run",
  "Actions",
] as const;

export function ScheduledReportsList({ projectId, onCreateClick }: ScheduledReportsListProps) {
  const { data: reports, isLoading, error, refetch } = useReports(projectId);
  const deleteReport = useDeleteReport();
  const generateReport = useGenerateReport();
  const [generateStatus, setGenerateStatus] = useState<Record<string, GenerateStatus>>({});

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete report "${name}"? This cannot be undone.`)) return;
    await deleteReport.mutateAsync(id).catch(() => {
      /* mutation state handles the error */
    });
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
              {TABLE_HEADERS.map((h) => (
                <th
                  key={h}
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  {h}
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
        <p className="text-red-600 mb-4">Failed to load scheduled reports</p>
        <button
          onClick={() => void refetch()}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!reports || reports.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-12 text-center">
        <p className="text-gray-500 text-lg mb-2">No scheduled reports yet</p>
        <p className="text-gray-400 text-sm mb-6">
          Create your first report to receive automated analytics summaries.
        </p>
        <button
          onClick={onCreateClick}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium"
        >
          Create your first report
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
          aria-label="Scheduled reports"
        >
          <thead className="bg-gray-50">
            <tr>
              {TABLE_HEADERS.map((h) => (
                <th
                  key={h}
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {reports.map((report) => {
              const status: GenerateStatus = generateStatus[report.id] ?? "idle";
              const generateLabel =
                status === "success" ? "Queued" : status === "error" ? "Failed" : "Generate Now";
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
                    {report.recipients.length} recipient
                    {report.recipients.length !== 1 ? "s" : ""}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        report.isActive
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {report.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatDate(report.lastRunAt)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm space-x-2">
                    <button
                      onClick={() => void handleGenerate(report.id)}
                      disabled={generateReport.isPending}
                      className="text-blue-600 hover:text-blue-800 disabled:opacity-50 font-medium"
                      aria-label={`Generate report ${report.name} now`}
                    >
                      {generatePrefix}
                      {generateLabel}
                    </button>
                    <button
                      onClick={() => void handleDelete(report.id, report.name)}
                      disabled={deleteReport.isPending}
                      className="text-red-600 hover:text-red-800 disabled:opacity-50 font-medium"
                      aria-label={`Delete report ${report.name}`}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
