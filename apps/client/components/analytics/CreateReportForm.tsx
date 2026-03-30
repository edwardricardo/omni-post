/**
 * @file CreateReportForm.tsx
 * @description Dialog form for creating a new scheduled report.
 * @layer presentation
 */
"use client";

import { useState } from "react";
import { useCreateReport } from "@/hooks/api/useReports";

interface CreateReportFormProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function CreateReportForm({ projectId, isOpen, onClose }: CreateReportFormProps) {
  const [name, setName] = useState("");
  const [cronSchedule, setCronSchedule] = useState("0 9 * * 1");
  const [format, setFormat] = useState<"CSV" | "JSON">("CSV");
  const [recipientsRaw, setRecipientsRaw] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createReport = useCreateReport();

  if (!isOpen) return null;

  function validateEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const recipients = recipientsRaw
      .split(",")
      .map((r) => r.trim())
      .filter((r) => r.length > 0);

    if (!name.trim()) {
      setError("Report name is required");
      return;
    }
    if (!cronSchedule.trim()) {
      setError("Cron schedule is required");
      return;
    }
    if (recipients.length === 0) {
      setError("At least one recipient is required");
      return;
    }
    const invalidEmails = recipients.filter((r) => !validateEmail(r));
    if (invalidEmails.length > 0) {
      setError(`Invalid email(s): ${invalidEmails.join(", ")}`);
      return;
    }

    try {
      await createReport.mutateAsync({
        projectId,
        name: name.trim(),
        cronSchedule: cronSchedule.trim(),
        format,
        recipients,
      });
      setName("");
      setCronSchedule("0 9 * * 1");
      setFormat("CSV");
      setRecipientsRaw("");
      setError(null);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create report");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-report-title"
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 id="create-report-title" className="text-lg font-semibold text-gray-900">
            Create Scheduled Report
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Close dialog"
          >
            &#x2715;
          </button>
        </div>

        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="space-y-4"
        >
          <div>
            <label htmlFor="report-name" className="block text-sm font-medium text-gray-700 mb-1">
              Report Name
            </label>
            <input
              id="report-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Monthly Performance Report"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <div>
            <label htmlFor="report-cron" className="block text-sm font-medium text-gray-700 mb-1">
              Cron Schedule
            </label>
            <input
              id="report-cron"
              type="text"
              value={cronSchedule}
              onChange={(e) => setCronSchedule(e.target.value)}
              placeholder="0 9 * * 1"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              required
            />
            <p className="mt-1 text-xs text-gray-500">
              Example: <span className="font-mono">0 9 * * 1</span> = Every Monday at 9:00 AM
            </p>
          </div>

          <div>
            <label htmlFor="report-format" className="block text-sm font-medium text-gray-700 mb-1">
              Format
            </label>
            <select
              id="report-format"
              value={format}
              onChange={(e) => setFormat(e.target.value as "CSV" | "JSON")}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="CSV">CSV</option>
              <option value="JSON">JSON</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="report-recipients"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Recipients (comma-separated emails)
            </label>
            <textarea
              id="report-recipients"
              value={recipientsRaw}
              onChange={(e) => setRecipientsRaw(e.target.value)}
              placeholder="alice@example.com, bob@example.com"
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          {error !== null && (
            <div
              className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2"
              role="alert"
            >
              {error}
            </div>
          )}

          <div className="flex justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createReport.isPending}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {createReport.isPending ? "Creating..." : "Create Report"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
