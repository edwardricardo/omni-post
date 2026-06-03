"use client";

/**
 * @file CSVBulkUpload.tsx
 * @component CSVBulkUpload
 * @description 2-phase bulk-scheduling upload component.
 *
 *   Step 1 (Parse): User uploads a CSV file. The file is sent to
 *   `POST /bulk-scheduling/parse` for server-side structural validation.
 *   The parsed row preview is shown (valid + error rows). No DB write occurs.
 *
 *   Step 2 (Channel Picker + Confirm): User selects target channels. Clicking
 *   Confirm calls `POST /bulk-scheduling/confirm` with the validated rows and
 *   selected channel IDs. The server persists atomically and returns `batchId`.
 *
 *   The legacy `POST /bulk-scheduling/imports` endpoint is NOT called.
 * @layer infrastructure
 */

import { useState, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  parseClientSchedulingCsv,
  generateClientCsvTemplate,
  type ParseSchedulingCsvResult,
  type SchedulingCsvRow,
} from "@/lib/csv/bulkSchedulingCsvParser";
import { useBulkScheduleParse, useBulkScheduleConfirm } from "@/hooks/api/useBulkScheduling";
import { BulkScheduleChannelPicker } from "@/components/scheduling/BulkScheduleChannelPicker";
import { useProjectChannels } from "@/lib/hooks/useProjectChannels";

interface CSVBulkUploadProps {
  projectId: string;
  /** @deprecated timezone is now specified per-row in the CSV (timezone column).
   * Retained for backward compatibility with existing callers; not used internally. */
  timezone?: string;
}

type Step = "idle" | "parsed" | "channel-pick" | "confirming" | "success" | "error";

export function CSVBulkUpload({ projectId }: CSVBulkUploadProps) {
  const t = useTranslations("scheduling.components");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step tracking
  const [step, setStep] = useState<Step>("idle");
  const [localParseResult, setLocalParseResult] = useState<ParseSchedulingCsvResult | null>(null);
  const [serverParseResult, setServerParseResult] = useState<ParseSchedulingCsvResult | null>(null);
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // API hooks
  const parseMutation = useBulkScheduleParse();
  const confirmMutation = useBulkScheduleConfirm();

  // Channel data
  const { data: channels = [] } = useProjectChannels(projectId);

  // Use the server parse result if available; fall back to client-side parse
  const parseResult = serverParseResult ?? localParseResult;

  const handleDownloadTemplate = useCallback(() => {
    const csv = generateClientCsvTemplate();
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "bulk_scheduling_template.csv";
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  const processFile = useCallback(
    async (file: File) => {
      if (!file.name.endsWith(".csv")) {
        setErrorMessage(t("csvErrorNotCsv"));
        return;
      }

      const text = await file.text();

      // Client-side pre-validation (instant feedback before round-trip)
      const clientResult = parseClientSchedulingCsv(text);
      setLocalParseResult(clientResult);
      setServerParseResult(null);
      setErrorMessage(null);

      // If client-side headers check fails (forbidden column, missing headers),
      // don't send to server — error is already surfaced.
      const hasHeaderError = clientResult.errors.some((e) => e.row === 0);
      if (hasHeaderError) {
        setStep("parsed");
        return;
      }

      // Send to server for authoritative validation
      try {
        const result = await parseMutation.mutateAsync({ projectId, csv: text });
        setServerParseResult(result);
        setStep("parsed");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t("csvScheduleError");
        setErrorMessage(message);
        setStep("error");
      }
    },
    [projectId, parseMutation, t]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void processFile(file);
    },
    [processFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) void processFile(file);
    },
    [processFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const handleProceedToChannels = useCallback(() => {
    setStep("channel-pick");
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!parseResult) return;
    const validRows: SchedulingCsvRow[] = parseResult.validRows;
    if (validRows.length === 0 || selectedChannelIds.length === 0) return;

    setStep("confirming");
    try {
      const result = await confirmMutation.mutateAsync({
        projectId,
        channelIds: selectedChannelIds,
        rows: validRows,
      });
      setBatchId(result.batchId);
      setStep("success");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t("csvScheduleError");
      setErrorMessage(message);
      setStep("error");
    }
  }, [parseResult, projectId, selectedChannelIds, confirmMutation, t]);

  const handleReset = useCallback(() => {
    setStep("idle");
    setLocalParseResult(null);
    setServerParseResult(null);
    setSelectedChannelIds([]);
    setBatchId(null);
    setErrorMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const validRows = parseResult?.validRows ?? [];
  const errorRows = parseResult?.errors ?? [];
  const totalRows = parseResult?.totalDataRows ?? 0;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-base font-medium text-gray-900">{t("csvTitle")}</h4>
          <p className="text-sm text-gray-500 mt-0.5">{t("csvSubtitle")}</p>
        </div>
        <button
          onClick={handleDownloadTemplate}
          className="text-sm text-blue-600 hover:text-blue-800 font-medium underline focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
        >
          {t("csvDownloadTemplate")}
        </button>
      </div>

      {/* Step 1: Drop zone */}
      {step === "idle" && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label={t("csvUploadAria")}
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
            {t.rich("csvDropzonePrompt", {
              click: (chunks) => <span className="font-medium text-blue-600">{chunks}</span>,
            })}
          </p>
          <p className="text-xs text-gray-400 mt-1">{t("csvFilesOnly")}</p>
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

      {/* Step 1 loading */}
      {parseMutation.isPending && (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span className="animate-spin inline-block">&#8635;</span>
          Validating CSV...
        </div>
      )}

      {/* Step 1: Parse preview */}
      {step === "parsed" && parseResult !== null && (
        <div className="space-y-3">
          {/* Summary */}
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-gray-700">
              <strong>{totalRows}</strong> row{totalRows !== 1 ? "s" : ""} parsed
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-green-100 text-green-800">
              {t("csvValidCount", { count: validRows.length })}
            </span>
            {errorRows.length > 0 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-red-100 text-red-800">
                {t("csvInvalidCount", { count: errorRows.length })}
              </span>
            )}
          </div>

          {/* Row-level errors */}
          {errorRows.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-md border border-red-100 bg-red-50 p-3 text-xs space-y-1">
              {errorRows.map((err, i) => (
                <div key={i} className="text-red-700">
                  {err.row === 0 ? "Header" : `Row ${err.row}`}
                  {err.field !== undefined && ` [${err.field}]`}: {err.message}
                </div>
              ))}
            </div>
          )}

          {/* Preview table (valid rows only) */}
          {validRows.length > 0 && (
            <div className="overflow-x-auto max-h-48 border rounded-lg">
              <table
                className="min-w-full divide-y divide-gray-200 text-xs"
                role="table"
                aria-label={t("csvPreviewAria")}
              >
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase tracking-wider">
                      Row
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase tracking-wider">
                      Scheduled For
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase tracking-wider">
                      Content
                    </th>
                    <th className="px-3 py-2 text-left font-medium text-gray-500 uppercase tracking-wider">
                      Media
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {validRows.slice(0, 50).map((row) => (
                    <tr key={row.row}>
                      <td className="px-3 py-2 text-gray-500">{row.row}</td>
                      <td className="px-3 py-2 text-gray-900">{row.scheduledFor}</td>
                      <td className="px-3 py-2 text-gray-700 max-w-xs truncate">{row.content}</td>
                      <td className="px-3 py-2 text-gray-500">
                        {row.media.length > 0 ? `${row.media.length} file(s)` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3">
            {validRows.length > 0 && (
              <button
                onClick={handleProceedToChannels}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Next: Select channels ({validRows.length} row{validRows.length !== 1 ? "s" : ""})
              </button>
            )}
            <button
              onClick={handleReset}
              className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400"
            >
              {t("csvClear")}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Channel picker */}
      {(step === "channel-pick" || step === "confirming") && (
        <div className="space-y-4">
          {/* Back link */}
          <button
            onClick={() => setStep("parsed")}
            disabled={step === "confirming"}
            className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50 focus:outline-none"
          >
            &#8592; Back to preview
          </button>

          <BulkScheduleChannelPicker
            channels={channels}
            selectedChannelIds={selectedChannelIds}
            onChange={setSelectedChannelIds}
            onConfirm={() => void handleConfirm()}
            isConfirming={step === "confirming"}
          />
        </div>
      )}

      {/* Success state */}
      {step === "success" && batchId !== null && (
        <div
          className="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-lg"
          role="status"
        >
          <p className="text-sm text-green-800 font-medium">
            &#10003; Batch scheduled successfully! Batch ID: {batchId}
          </p>
          <button
            onClick={handleReset}
            className="text-sm text-green-700 underline hover:text-green-900 focus:outline-none focus:ring-2 focus:ring-green-500 rounded"
          >
            {t("csvUploadAnother")}
          </button>
        </div>
      )}

      {/* Error state */}
      {step === "error" && errorMessage !== null && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg" role="alert">
          <p className="text-sm text-red-700">{errorMessage}</p>
          <button
            onClick={handleReset}
            className="mt-2 text-sm text-red-600 underline hover:text-red-800 focus:outline-none"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
