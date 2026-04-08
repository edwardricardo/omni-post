/**
 * @file page.tsx
 * @description System maintenance page with queue overview stats, failed jobs
 *   table, and queue health panel. Uses TanStack Query hooks for data fetching.
 * @layer page
 */
"use client";

import { useCallback } from "react";
import { Activity, AlertTriangle, CheckCircle2, Clock, RefreshCw, Timer } from "lucide-react";

import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { ActionButton } from "@/components/ui/ActionButton";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { FailedJobsTable } from "@/components/maintenance/FailedJobsTable";
import { QueueHealthPanel } from "@/components/maintenance/QueueHealthPanel";
import { ScheduledJobsPanel } from "@/components/maintenance/ScheduledJobsPanel";
import { useQueueStats, useFailedJobs, useRetryJob } from "@/hooks/api/useQueueManagement";

// ---------------------------------------------------------------------------
// Section heading helper
// ---------------------------------------------------------------------------

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
      {children}
    </h2>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function MaintenancePage() {
  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQueueStats();

  const { data: failedJobs, isLoading: jobsLoading, refetch: refetchJobs } = useFailedJobs();

  const retryMutation = useRetryJob();

  const handleRefresh = useCallback(() => {
    refetchStats();
    refetchJobs();
  }, [refetchStats, refetchJobs]);

  const handleRetry = useCallback(
    (jobId: string) => {
      retryMutation.mutate(jobId);
    },
    [retryMutation]
  );

  // --- Loading state -------------------------------------------------------

  if (statsLoading && jobsLoading) {
    return (
      <div>
        <PageHeader title="Maintenance" description="Queue monitoring and operations" />
        <div className="flex h-64 items-center justify-center">
          <LoadingSpinner size="lg" label="Loading maintenance data..." />
        </div>
      </div>
    );
  }

  // --- Derived values for StatCards -----------------------------------------

  const activeJobs = stats?.active ?? stats?.processing ?? 0;
  const waitingJobs = stats?.waiting ?? stats?.queued ?? 0;
  const completedJobs = stats?.completed ?? stats?.published ?? 0;
  const failedCount = stats?.failed ?? 0;
  const delayedJobs = stats?.delayed ?? 0;

  // --- Render --------------------------------------------------------------

  return (
    <div>
      <PageHeader
        title="Maintenance"
        description="Queue monitoring and operations"
        actions={
          <ActionButton variant="secondary" size="sm" onClick={handleRefresh}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </ActionButton>
        }
      />

      {/* Section 1 - Queue Overview */}
      <section className="mb-8" aria-labelledby="queue-overview-heading">
        <SectionHeading>
          <span id="queue-overview-heading">Queue Overview</span>
        </SectionHeading>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <StatCard
            label="Active Jobs"
            value={activeJobs}
            icon={<Activity className="h-4 w-4" />}
          />
          <StatCard label="Waiting" value={waitingJobs} icon={<Clock className="h-4 w-4" />} />
          <StatCard
            label="Completed"
            value={completedJobs}
            icon={<CheckCircle2 className="h-4 w-4" />}
          />
          <StatCard
            label="Failed"
            value={failedCount}
            icon={<AlertTriangle className="h-4 w-4" />}
          />
          <StatCard label="Delayed" value={delayedJobs} icon={<Timer className="h-4 w-4" />} />
        </div>
      </section>

      {/* Section 2 - Scheduled Jobs */}
      <section className="mb-8" aria-labelledby="scheduled-jobs-heading">
        <SectionHeading>
          <span id="scheduled-jobs-heading">Scheduled Jobs</span>
        </SectionHeading>
        <ScheduledJobsPanel />
      </section>

      {/* Section 3 - Failed Jobs */}
      <section className="mb-8" aria-labelledby="failed-jobs-heading">
        <SectionHeading>
          <span id="failed-jobs-heading">Failed Jobs</span>
        </SectionHeading>
        <FailedJobsTable
          jobs={failedJobs ?? []}
          onRetry={handleRetry}
          isRetrying={retryMutation.isPending}
        />
      </section>

      {/* Section 4 - Queue Health */}
      <section aria-labelledby="queue-health-heading">
        <SectionHeading>
          <span id="queue-health-heading">Queue Health</span>
        </SectionHeading>
        <QueueHealthPanel stats={stats} />
      </section>
    </div>
  );
}
