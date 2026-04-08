/**
 * @file FailedJobsTable.tsx
 * @description Table displaying failed BullMQ jobs with retry capability.
 *   Each row shows queue, job ID, error reason, timestamp, attempts, and a retry action.
 * @layer presentation
 */
"use client";

import { useCallback, useState } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

import { ActionButton } from "@/components/ui/ActionButton";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { FailedJob } from "@/hooks/api/useQueueManagement";

interface FailedJobsTableProps {
  jobs: FailedJob[];
  onRetry: (jobId: string) => void;
  isRetrying: boolean;
}

/**
 * @function FailedJobsTable
 * @description Renders a data table of failed jobs with per-row retry action.
 */
export function FailedJobsTable({ jobs, onRetry, isRetrying }: FailedJobsTableProps) {
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
        <AlertTriangle className="h-8 w-8 text-[var(--text-tertiary)] mb-2" />
        <p className="text-sm text-[var(--text-secondary)]">No failed jobs</p>
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
                Queue
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                Job ID
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                Error
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                Failed At
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                Attempts
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
                Actions
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
                  <ActionButton
                    variant="secondary"
                    size="sm"
                    onClick={() => setConfirmJobId(job.id)}
                    aria-label={`Retry job ${job.id}`}
                  >
                    <RotateCw className="h-3 w-3" />
                    Retry
                  </ActionButton>
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
        title="Retry Failed Job"
        description={`Retry job ${confirmJobId ?? ""}? It will be re-queued for processing.`}
        confirmLabel="Retry"
        onConfirm={handleConfirmRetry}
        loading={isRetrying}
      />
    </>
  );
}
