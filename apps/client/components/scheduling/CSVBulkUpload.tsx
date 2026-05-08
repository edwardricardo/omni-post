"use client";

/**
 * @file CSVBulkUpload.tsx
 * @component CSVBulkUpload
 * @description CSV upload zone for bulk scheduling. Parses CSV, shows per-row validation,
 *              and submits valid rows via useBulkCreateSchedules.
 * @layer infrastructure
 */

import { useState, useRef, useCallback } from "react";
import {
  parseSchedulingCsv,
  generateCsvTemplate,
  type ValidatedCsvRow,
} from "@/lib/csv/schedulingCsvParser";
import { useBulkCreateSchedules } from "@/hooks/api/useMultiPlatformScheduling";

interface CSVBulkUploadProps {
  projectId: string;
  timezone?: string;
}

type UploadState = "idle" | "parsed" | "submitting" | "success" | "error";

export function CSVBulkUpload({ projectId, timezone = "UTC" }: CSVBulkUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ValidatedCsvRow[]>([]);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [submitResult, setSubmitResult] = useState<{ scheduled: number; total: number } | null>(
    null
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const bulkCreate = useBulkCreateSchedules();

  const validRows = rows.filter((r) => r.isValid);
  const invalidRows = rows.filter((r) => !r.isValid);

  const handleDownloadTemplate = useCallback(() => {
    const csv = generateCsvTemplate();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "scheduling_template.csv";
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  const processFile = useCallback((file: File) => {
    if (!file.name.endsWith(".csv")) {
      setSubmitError("Please upload a .csv file");
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result;
      if (typeof text !== "string") return;
      const parsed = parseSchedulingCsv(text);
      setRows(parsed);
      setUploadState(parsed.length > 0 ? "parsed" : "idle");
      setSubmitResult(null);
      setSubmitError(null);
    };
    reader.readAsText(file);
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleSubmit = async () => {
    if (validRows.length === 0) return;

    setUploadState("submitting");
    setSubmitError(null);

    // Group valid rows by their date/time into slots
    const slots = validRows
      .filter(
        (r) =>
          r.dayOfWeek !== undefined && r.hour !== undefined && r.normalizedPlatform !== undefined
      )
      .map((r) => ({
        dayOfWeek: r.dayOfWeek as number,
        hour: r.hour as number,
        minute: r.minute ?? 0,
        providers: [r.normalizedPlatform as string],
      }));

    try {
      await bulkCreate.mutateAsync({
        projectId,
        slots,
        timezone,
        isActive: true,
      });

      setUploadState("success");
      setSubmitResult({ scheduled: validRows.length, total: rows.length });
    } catch (err: unknown) {
      setUploadState("error");
      setSubmitError(err instanceof Error ? err.message : "Failed to schedule posts");
    }
  };

  const handleReset = useCallback(() => {
    setRows([]);
    setUploadState("idle");
    setSubmitResult(null);
    setSubmitError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-base font-medium text-gray-900">CSV Bulk Upload</h4>
          <p className="text-sm text-gray-500 mt-0.5">
            Upload a CSV file to schedule multiple posts at once.
          </p>
        </div>
        <button
          onClick={handleDownloadTemplate}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
        >
          Download Template
        </button>
      </div>

      {/* Drop zone */}
      {uploadState === "idle" && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="Upload CSV file"
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
          }}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
            isDragging
              ? "border-blue-400 bg-blue-50"
              : "border-gray-300 hover:border-gray-400 bg-gray-50"
          }`}
        >
          <div className="text-gray-400 text-3xl mb-2" aria-hidden="true">
            &#8679;
          </div>
          <p className="text-sm text-gray-600">
            <span className="font-medium text-blue-600">Click to upload</span> or drag and drop
          </p>
          <p className="text-xs text-gray-400 mt-1">CSV files only</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="hidden"
            aria-hidden="true"
          />
        </div>
      )}

      {/* Parsed preview */}
      {uploadState === "parsed" && rows.length > 0 && (
        <div className="space-y-3">
          {/* Summary */}
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-700">
              <strong>{rows.length}</strong> rows parsed:
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-green-100 text-green-800">
              {validRows.length} valid
            </span>
            {invalidRows.length > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-red-100 text-red-800">
                {invalidRows.length} invalid
              </span>
            )}
          </div>

          {/* Preview table */}
          <div className="overflow-x-auto max-h-64 border rounded-lg">
            <table
              className="min-w-full divide-y divide-gray-200 text-xs"
              role="table"
              aria-label="CSV preview"
            >
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase tracking-wider">
                    Row
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase tracking-wider">
                    Time
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase tracking-wider">
                    Platform
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase tracking-wider">
                    Copy
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase tracking-wider">
                    Error
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {rows.map((row) => (
                  <tr key={row.rowIndex} className={row.isValid ? "bg-white" : "bg-red-50"}>
                    <td className="px-3 py-2 text-gray-500">{row.rowIndex}</td>
                    <td className="px-3 py-2">
                      {row.isValid ? (
                        <span className="text-green-600 font-medium">&#10003; Valid</span>
                      ) : (
                        <span className="text-red-600 font-medium">&#10007; Invalid</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-900">{row.raw.date}</td>
                    <td className="px-3 py-2 text-gray-900">{row.raw.time}</td>
                    <td className="px-3 py-2 text-gray-900">{row.raw.platform}</td>
                    <td className="px-3 py-2 text-gray-700 max-w-xs truncate">{row.raw.copy}</td>
                    <td className="px-3 py-2 text-red-600">{row.error ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => void handleSubmit()}
              disabled={validRows.length === 0 || bulkCreate.isPending}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {bulkCreate.isPending
                ? "Scheduling..."
                : `Schedule ${validRows.length} Valid Row${validRows.length !== 1 ? "s" : ""}`}
            </button>
            <button
              onClick={handleReset}
              className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Success state */}
      {uploadState === "success" && submitResult !== null && (
        <div
          className="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-lg"
          role="status"
        >
          <p className="text-sm text-green-800 font-medium">
            &#10003; {submitResult.scheduled} of {submitResult.total} rows scheduled successfully
          </p>
          <button
            onClick={handleReset}
            className="text-sm text-green-700 underline hover:text-green-900 focus:outline-none focus:ring-2 focus:ring-green-500 rounded"
          >
            Upload another file
          </button>
        </div>
      )}

      {/* Error state */}
      {submitError !== null && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg" role="alert">
          <p className="text-sm text-red-700">{submitError}</p>
        </div>
      )}
    </div>
  );
}
