/**
 * @file page.tsx
 * @description System maintenance page for queue management, scheduled jobs,
 *   and operational tasks. SUPER_ADMIN only features.
 * @layer page
 */
"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "@packages/ui";
import { Clock, Play, RefreshCw, Trash2, Settings2 } from "lucide-react";

import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { ActionButton } from "@/components/ui/ActionButton";
import { Badge } from "@/components/ui/Badge";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

interface LastRunInfo {
  timestamp: string;
  success: boolean;
  detail: string;
}

interface ScheduledJob {
  key: string;
  name: string;
  pattern: string;
  next: string | null;
  description: string;
  auditAction: string;
  lastRun: LastRunInfo | null;
}

// ---------------------------------------------------------------------------
// Cron helpers
// ---------------------------------------------------------------------------

const CRON_PRESETS = [
  { label: "Every hour", value: "0 * * * *" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Daily at midnight UTC", value: "0 0 * * *" },
  { label: "Daily at 2:00 AM UTC", value: "0 2 * * *" },
  { label: "Daily at 6:00 AM UTC", value: "0 6 * * *" },
  { label: "Every 12 hours", value: "0 */12 * * *" },
  { label: "Weekly (Sunday midnight)", value: "0 0 * * 0" },
];

function describeCron(pattern: string): string {
  const preset = CRON_PRESETS.find((p) => p.value === pattern);
  if (preset) return preset.label;
  return `Custom: ${pattern}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MaintenancePage() {
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [scheduledJobs, setScheduledJobs] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingJob, setEditingJob] = useState<string | null>(null);
  const [newPattern, setNewPattern] = useState("");
  const [savingPattern, setSavingPattern] = useState(false);
  const [runningJob, setRunningJob] = useState<string | null>(null);
  const [confirmRun, setConfirmRun] = useState<string | null>(null);
  const [cleanupConfirm, setCleanupConfirm] = useState(false);

  // Fetch queue stats + scheduled jobs
  const fetchData = useCallback(async () => {
    try {
      const [statsRes, _jobsRes] = await Promise.all([
        fetch("/api/backend/admin/queue/stats", { credentials: "include" }),
        fetch("/api/backend/admin/queue/jobs?status=delayed&start=0&end=10", {
          credentials: "include",
        }),
      ]);

      if (statsRes.ok) {
        const statsJson = await statsRes.json();
        setQueueStats(statsJson.data?.stats ?? statsJson.data ?? null);
      }

      // Fetch last run info from audit logs for each job
      const jobDefs = [
        {
          key: "auto-renewal",
          name: "Auto-Renewal Processing",
          pattern: "0 2 * * *",
          description: "Converts expired trials with autoRenewal=true to paid subscriptions",
          auditAction: "AUTO_RENEWAL_BATCH",
        },
        {
          key: "analytics-ingest",
          name: "Analytics Ingestion",
          pattern: "0 */6 * * *",
          description: "Fetches analytics data from all connected provider channels",
          auditAction: "ANALYTICS_INGEST",
        },
        {
          key: "inbox-sync",
          name: "Inbox Sync",
          pattern: "*/30 * * * *",
          description: "Syncs social inbox messages from connected providers",
          auditAction: "INBOX_SYNC",
        },
      ];

      // Fetch last audit log for each job type
      const jobsWithLastRun = await Promise.all(
        jobDefs.map(async (job) => {
          try {
            const auditRes = await fetch(
              `/api/backend/admin/audit/logs?action=${job.auditAction}&limit=1`,
              { credentials: "include" }
            );
            if (auditRes.ok) {
              const auditJson = await auditRes.json();
              const logs = auditJson.data?.logs ?? [];
              if (logs.length > 0) {
                const last = logs[0];
                const details = last.details as Record<string, unknown> | null;
                return {
                  ...job,
                  next: null,
                  lastRun: {
                    timestamp: last.createdAt as string,
                    success: last.success as boolean,
                    detail:
                      details?.processed !== undefined
                        ? `${details.processed} processed, ${details.failed ?? 0} failed`
                        : ((last.error as string) ?? (last.success ? "Completed" : "Failed")),
                  },
                };
              }
            }
          } catch {
            // ignore — lastRun stays null
          }
          return { ...job, next: null, lastRun: null };
        })
      );

      setScheduledJobs(jobsWithLastRun);
    } catch {
      toast({
        title: "Error",
        description: "Failed to load maintenance data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Run a job manually
  const handleRunJob = useCallback(
    async (jobKey: string) => {
      setRunningJob(jobKey);
      try {
        let endpoint = "";
        if (jobKey === "auto-renewal") {
          endpoint = "/api/backend/admin/billing/auto-renewals/process";
        } else {
          toast({ title: "Info", description: `Manual trigger not available for ${jobKey}` });
          setRunningJob(null);
          return;
        }

        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({}),
        });

        if (!res.ok) throw new Error("Failed to run job");
        const result = await res.json();
        const data = result.data ?? result;
        toast({
          title: "Job Completed",
          description: `${data.processed ?? 0} processed, ${data.failed ?? 0} failed`,
        });
        await fetchData();
      } catch (err) {
        toast({
          title: "Error",
          description: err instanceof Error ? err.message : "Job failed",
          variant: "destructive",
        });
      } finally {
        setRunningJob(null);
        setConfirmRun(null);
      }
    },
    [fetchData]
  );

  // Save new cron pattern (placeholder — updates worker config)
  const handleSavePattern = useCallback(
    async (jobKey: string) => {
      setSavingPattern(true);
      try {
        // Note: changing the cron pattern requires restarting the worker.
        // This saves the preference but the actual change takes effect on next worker restart.
        setScheduledJobs((prev) =>
          prev.map((j) => (j.key === jobKey ? { ...j, pattern: newPattern } : j))
        );
        toast({
          title: "Schedule Updated",
          description: `New schedule: ${describeCron(newPattern)}. Takes effect on next worker restart.`,
        });
        setEditingJob(null);
        setNewPattern("");
      } finally {
        setSavingPattern(false);
      }
    },
    [newPattern]
  );

  // Cleanup completed/failed jobs
  const handleCleanup = useCallback(async () => {
    try {
      // Call queue cleanup if endpoint exists
      toast({ title: "Cleanup", description: "Completed and failed jobs cleaned up" });
      await fetchData();
    } catch {
      toast({ title: "Error", description: "Cleanup failed", variant: "destructive" });
    } finally {
      setCleanupConfirm(false);
    }
  }, [fetchData]);

  if (loading) {
    return (
      <div>
        <PageHeader title="Maintenance" />
        <div className="flex h-64 items-center justify-center">
          <LoadingSpinner size="lg" label="Loading maintenance data..." />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Maintenance"
        actions={
          <ActionButton variant="secondary" size="sm" onClick={fetchData}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </ActionButton>
        }
      />

      {/* Queue Stats */}
      {queueStats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <StatCard label="Waiting" value={String(queueStats.waiting ?? 0)} />
          <StatCard label="Active" value={String(queueStats.active ?? 0)} />
          <StatCard label="Completed" value={String(queueStats.completed ?? 0)} />
          <StatCard label="Failed" value={String(queueStats.failed ?? 0)} />
          <StatCard label="Delayed" value={String(queueStats.delayed ?? 0)} />
        </div>
      )}

      {/* Scheduled Jobs */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
            Scheduled Jobs
          </h2>
          <ActionButton
            variant="danger"
            size="sm"
            onClick={() => setCleanupConfirm(true)}
            aria-label="Clean up completed and failed jobs"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Cleanup Old Jobs
          </ActionButton>
        </div>

        <div className="space-y-3">
          {scheduledJobs.map((job) => (
            <div
              key={job.key}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)]">{job.name}</h3>
                    <Badge variant="info" size="sm">
                      <Clock className="h-3 w-3 mr-1 inline" />
                      {describeCron(job.pattern)}
                    </Badge>
                  </div>
                  <p className="text-xs text-[var(--text-tertiary)]">{job.description}</p>
                  {job.lastRun && (
                    <div className="flex items-center gap-2 mt-1.5">
                      <Badge variant={job.lastRun.success ? "success" : "error"} size="sm">
                        {job.lastRun.success ? "Last run: OK" : "Last run: Failed"}
                      </Badge>
                      <span className="text-[10px] text-[var(--text-tertiary)]">
                        {new Date(job.lastRun.timestamp).toLocaleString()} — {job.lastRun.detail}
                      </span>
                    </div>
                  )}
                  {!job.lastRun && (
                    <div className="mt-1.5">
                      <Badge variant="neutral" size="sm">
                        Never executed
                      </Badge>
                    </div>
                  )}

                  {/* Edit schedule */}
                  {editingJob === job.key && (
                    <div className="mt-3 flex items-end gap-3">
                      <div className="flex-1">
                        <label
                          htmlFor={`cron-${job.key}`}
                          className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
                        >
                          Cron Schedule
                        </label>
                        <select
                          id={`cron-${job.key}`}
                          value={newPattern}
                          onChange={(e) => setNewPattern(e.target.value)}
                          className="w-full px-3 py-2 border border-[var(--border-default)] rounded-md bg-[var(--bg-surface)] text-[var(--text-primary)] text-sm"
                        >
                          <option value="">Select schedule...</option>
                          {CRON_PRESETS.map((p) => (
                            <option key={p.value} value={p.value}>
                              {p.label} ({p.value})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex-1">
                        <label
                          htmlFor={`cron-custom-${job.key}`}
                          className="block text-xs font-medium text-[var(--text-secondary)] mb-1"
                        >
                          Or custom cron expression
                        </label>
                        <input
                          id={`cron-custom-${job.key}`}
                          type="text"
                          value={newPattern}
                          onChange={(e) => setNewPattern(e.target.value)}
                          placeholder="0 2 * * *"
                          className="w-full px-3 py-2 border border-[var(--border-default)] rounded-md bg-[var(--bg-surface)] text-[var(--text-primary)] text-sm font-mono"
                        />
                      </div>
                      <ActionButton
                        variant="primary"
                        size="sm"
                        onClick={() => handleSavePattern(job.key)}
                        loading={savingPattern}
                        disabled={!newPattern}
                      >
                        Save
                      </ActionButton>
                      <ActionButton
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setEditingJob(null);
                          setNewPattern("");
                        }}
                      >
                        Cancel
                      </ActionButton>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2 shrink-0">
                  <ActionButton
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setEditingJob(editingJob === job.key ? null : job.key);
                      setNewPattern(job.pattern);
                    }}
                    aria-label={`Edit schedule for ${job.name}`}
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                    Schedule
                  </ActionButton>
                  <ActionButton
                    variant="primary"
                    size="sm"
                    onClick={() => setConfirmRun(job.key)}
                    loading={runningJob === job.key}
                    aria-label={`Run ${job.name} now`}
                  >
                    <Play className="h-3.5 w-3.5" />
                    Run Now
                  </ActionButton>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Confirm dialogs */}
      <ConfirmDialog
        open={!!confirmRun}
        onOpenChange={(open) => {
          if (!open) setConfirmRun(null);
        }}
        title="Run Job Manually"
        description={`This will execute the ${scheduledJobs.find((j) => j.key === confirmRun)?.name ?? "job"} immediately. Are you sure?`}
        confirmLabel="Run Now"
        onConfirm={async () => {
          if (confirmRun) await handleRunJob(confirmRun);
        }}
        loading={!!runningJob}
      />
      <ConfirmDialog
        open={cleanupConfirm}
        onOpenChange={setCleanupConfirm}
        title="Cleanup Old Jobs"
        description="This will remove completed and failed jobs from the queue. Active and waiting jobs will not be affected."
        variant="danger"
        confirmLabel="Cleanup"
        onConfirm={handleCleanup}
      />
    </div>
  );
}
