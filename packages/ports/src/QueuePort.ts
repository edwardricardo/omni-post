/**
 * @file QueuePort.ts
 * @description Queue port (interface) defining enqueue and health-check contracts plus the
 *              QueueJob and QueueHealth domain shapes.
 * @layer domain
 */
import type { Result } from "@shared/types";

export type QueueJob = {
  id?: string;
  dedupeKey: string;
  runAt?: Date;
  payload: Record<string, unknown>;
};

export type QueueHealth = {
  connected: boolean;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
};

/**
 * Per-job execution state. Mirrors BullMQ's `Job.getState()` return values
 * (https://docs.bullmq.io/guide/jobs/job-states). "missing" is our addition
 * for jobs that no longer exist in the queue (e.g., evicted by retention
 * policy) — the saga treats these as failed for safety.
 */
export type JobState = "waiting" | "active" | "completed" | "failed" | "delayed" | "missing";

export type JobStatesAggregate = {
  completed: number;
  failed: number;
  pending: number;
};

export interface QueuePort {
  /**
   * Enqueue a single job. `dedupeKey` is REQUIRED — the adapter relies on it
   * to suppress duplicates within the BullMQ deduplication window so saga
   * retries and outbox re-dispatch do not produce double executions.
   * Returns the assigned job id on success.
   */
  enqueue(job: QueueJob): Promise<Result<string, "CONNECTION_ERROR" | "VALIDATION_ERROR">>;
  /**
   * Enqueue many jobs in a single round-trip (BullMQ `addBulk`). Used for bulk
   * imports (e.g. CSV scheduling) where one row = one independent job; a single
   * failed job never aborts the others. Returns the enqueued job ids in order.
   */
  enqueueBulk(jobs: QueueJob[]): Promise<Result<string[], "CONNECTION_ERROR" | "VALIDATION_ERROR">>;
  /**
   * Report queue health snapshot (connection state + counters per JobState).
   * Used by liveness/readiness probes and ops dashboards.
   */
  health(): Promise<Result<QueueHealth, "CONNECTION_ERROR">>;
  /**
   * Remove a job by id. Returns `ok(true)` if removed, `err("NOT_FOUND")` if
   * the job no longer exists (already completed + evicted, or never existed).
   * Idempotent from the caller's perspective.
   */
  remove(jobId: string): Promise<Result<boolean, "CONNECTION_ERROR" | "NOT_FOUND">>;
  /**
   * Reads the current state of each job from the queue and returns an
   * aggregate {completed, failed, pending}. Jobs in waiting/active/delayed
   * count as pending; "missing" jobs (evicted from the queue) count as
   * failed so a saga waiting on them does NOT silently mark a post as
   * published when the underlying job is gone.
   *
   * Used by saga `WaitForPublishingCompletionStep` to derive the canonical
   * step result when the worker pub/sub event-driven flow fails (worker
   * crash before emitting completion event, broken Redis subscription,
   * etc.). Without this, the step would lie "all completed" and the saga
   * would wrongly transition Post.status to PUBLISHED.
   */
  getJobStates(jobIds: string[]): Promise<Result<JobStatesAggregate, "CONNECTION_ERROR">>;
}
