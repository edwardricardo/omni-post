/**
 * @file DeadLetterQueuePort.ts
 * @description Producer port for archiving exhausted jobs to a dead-letter
 *              queue. Schema follows the canon described in
 *              https://oneuptime.com/blog/post/2026-01-21-bullmq-dead-letter-queue/view
 *              — `originalJob` + `failure` + `metadata` — so consumers can
 *              inspect, search, and re-process without losing context.
 * @layer domain
 */
import type { Result } from "@shared/types";

export interface DeadLetterFailure {
  reason: string;
  stacktrace?: string;
  attemptsMade: number;
  failedAt: Date;
  errorType?: string;
}

export interface DeadLetterEntry {
  originalJobId?: string;
  originalQueueName: string;
  originalJobName: string;
  payload: Record<string, unknown>;
  failure: DeadLetterFailure;
  metadata: {
    movedAt: Date;
    sourceWorker?: string;
    tags?: readonly string[];
  };
}

export interface DeadLetterQueuePort {
  /**
   * Persist a failed-and-exhausted job's snapshot to the DLQ. Returns the
   * jobId of the DLQ entry so admins can correlate during inspection.
   */
  archive(entry: DeadLetterEntry): Promise<Result<string, "CONNECTION_ERROR" | "VALIDATION_ERROR">>;

  /**
   * Page through DLQ entries for inspection. Implementation may not be
   * available in the initial release; consumers should treat
   * `"NOT_IMPLEMENTED"` as a deferral signal.
   */
  list(opts: {
    limit: number;
    offset?: number;
  }): Promise<Result<readonly DeadLetterEntry[], "CONNECTION_ERROR" | "NOT_IMPLEMENTED">>;

  /**
   * Re-enqueue a DLQ entry to its original queue and remove it from the DLQ.
   * Implementation may not be available in the initial release.
   */
  retry(jobId: string): Promise<Result<void, "CONNECTION_ERROR" | "NOT_FOUND" | "NOT_IMPLEMENTED">>;
}
