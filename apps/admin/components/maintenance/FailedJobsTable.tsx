/**
 * @file FailedJobsTable.tsx
 * @description Table displaying failed BullMQ jobs with retry capability.
 *   Each row shows queue, job ID, error reason, timestamp, attempts, and a retry action.
 * @layer infrastructure
 */
"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, RotateCw } from "lucide-react";
import { useCurrentUser } from "@/providers/AuthProvider";

import { ActionButton } from "@/components/ui/ActionButton";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@packages/ui";
import type { FailedJob } from "@/hooks/api/useQueueManagement";

interface FailedJobsTableProps {
  jobs: FailedJob[];
  onRetry: (jobId: string) => void;
  isRetrying: boolean;
}

/**
 * @component FailedJobsTable
 * @description Renders a data table of failed BullMQ jobs with per-row retry action and confirmation dialog.
 * @param props.jobs - Array of failed job records to display
 * @param props.onRetry - Callback invoked with the job ID when a retry is confirmed
 * @param props.isRetrying - Whether a retry operation is currently in progress
 */
export function FailedJobsTable({ jobs, onRetry, isRetrying }: FailedJobsTableProps) {
  const tf = useTranslations("maintenance.failedJobsTable");
  const { hasPermission } = useCurrentUser();
  const [confirmJobId, setConfirmJobId] = useState<string | null>(null);

  const handleConfirmRetry = useCallback(() => {
    if (confirmJobId) {
      onRetry(confirmJobId);
      setConfirmJobId(null);
    }
  }, [confirmJobId, onRetry]);

  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] py-12">
        <AlertTriangle aria-hidden="true" className="h-8 w-8 text-[var(--text-tertiary)] mb-2" />
        <p className="text-sm text-[var(--text-secondary)]">{tf("noFailed")}</p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-[var(--border-subtle)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
              <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                {tf("queue")}
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                {tf("jobId")}
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                {tf("error")}
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                {tf("failedAt")}
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                {tf("attempts")}
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                {tf("retry")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)]">
            {jobs.map((job) => (
              <tr key={job.id} className="bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)]">
                <td className="px-4 py-2.5 text-[var(--text-primary)]">
                  <Badge variant="neutral" size="sm">
                    {job.queue ?? job.name}
                  </Badge>
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-secondary)]">
                  {job.id}
                </td>
                <td
                  className="max-w-xs truncate px-4 py-2.5 text-[var(--error)]"
                  title={job.failedReason}
                >
                  {job.failedReason}
                </td>
                <td className="px-4 py-2.5 text-[var(--text-tertiary)] whitespace-nowrap">
                  {new Date(job.timestamp).toLocaleString()}
                </td>
                <td className="px-4 py-2.5 text-center text-[var(--text-secondary)]">
                  {job.attemptsMade}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {hasPermission("system:configure") && (
                    <ActionButton
                      variant="secondary"
                      size="sm"
                      onClick={() => setConfirmJobId(job.id)}
                      aria-label={`Retry job ${job.id}`}
                    >
                      <RotateCw className="h-3 w-3" />
                      {tf("retry")}
                    </ActionButton>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!confirmJobId}
        onOpenChange={(open) => {
          if (!open) setConfirmJobId(null);
        }}
        title={tf("retryTitle")}
        description={tf("retryDesc", { id: confirmJobId ?? "" })}
        confirmLabel={tf("retry")}
        onConfirm={handleConfirmRetry}
        loading={isRetrying}
      />
    </>
  );
}
