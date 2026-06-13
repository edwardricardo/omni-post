/**
 * @file bulkScheduleWorker.ts
 * @description In-process worker for the bulk-schedule queue. The job handler
 *   runs ProcessBulkScheduleRowUseCase (resolved from DI) and throws on a
 *   transient failure so BullMQ retries; the worker `failed` callback moves a
 *   retry-exhausted job to the DLQ and records the row's terminal failure in the
 *   manifest so its batch can complete. Hosted in apps/api (like the repurpose /
 *   triage consumers) so use cases come from the app container — no direct
 *   Prisma, no apps/workers dependency.
 * @layer infrastructure
 */

import type { Job } from "bullmq";
import type Redis from "ioredis";
import type { QueuePort } from "@ports/core";
import { createBullMQConsumerAdapter, QUEUE_NAMES } from "@adapters/queue-bullmq";
import type {
  ProcessBulkScheduleRowUseCase,
  ProcessBulkScheduleRowInput,
} from "@core/bulk-scheduling/ProcessBulkScheduleRowUseCase.js";
import type { FailBulkScheduleRowUseCase } from "@core/bulk-scheduling/FailBulkScheduleRowUseCase.js";

/** Minimal logger surface (a pino child satisfies this structurally). */
export interface BulkScheduleJobLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

/** Falls back to the queue's configured attempts when the job omits them. */
const DEFAULT_ATTEMPTS = 3;

export interface BulkScheduleRowDeps {
  readonly process: ProcessBulkScheduleRowUseCase;
  readonly logger: BulkScheduleJobLogger;
}

/**
 * @function processBulkScheduleRowJob
 * @description Runs one row through ProcessBulkScheduleRowUseCase. A transient
 *   failure (INTERNAL_ERROR) throws so BullMQ retries; deterministic outcomes
 *   (SCHEDULED / FAILED / SKIPPED) resolve the job successfully.
 * @param deps - The per-row use case + logger.
 * @param payload - The row job payload.
 */
export async function processBulkScheduleRowJob(
  deps: BulkScheduleRowDeps,
  payload: Record<string, unknown>
): Promise<void> {
  const input = payload as unknown as ProcessBulkScheduleRowInput;
  const result = await deps.process.execute(input);
  if (!result.ok) {
    deps.logger.warn(
      { itemId: input.itemId, batchId: input.batchId, error: result.error.message },
      "Bulk schedule row failed transiently; retrying"
    );
    throw new Error(`Bulk schedule row ${input.itemId} failed: ${result.error.message}`);
  }
  deps.logger.info(
    { itemId: input.itemId, batchId: input.batchId, status: result.value.status },
    "Bulk schedule row processed"
  );
}

export interface BulkScheduleFailureDeps {
  readonly fail: FailBulkScheduleRowUseCase;
  readonly deadLetter: QueuePort;
  readonly logger: BulkScheduleJobLogger;
}

/**
 * @function handleBulkScheduleRowFailure
 * @description Worker `failed` callback. While retries remain it is a no-op;
 *   once a job exhausts its retries it moves the payload to the DLQ (for
 *   inspection / replay) and records the row's terminal failure so the batch
 *   can settle. DLQ enqueue and manifest write are independent — one failing
 *   never blocks the other.
 * @param deps - The fail use case, the DLQ queue port, and a logger.
 * @param job - The failed BullMQ job (undefined if unavailable).
 * @param error - The error that failed the job.
 */
export async function handleBulkScheduleRowFailure(
  deps: BulkScheduleFailureDeps,
  job: Job | undefined,
  error: Error
): Promise<void> {
  if (!job) {
    return;
  }
  const attempts = job.opts?.attempts ?? DEFAULT_ATTEMPTS;
  if (job.attemptsMade < attempts) {
    return; // retries remain
  }

  const payload = job.data as Partial<ProcessBulkScheduleRowInput>;
  const reason = `Exhausted ${attempts} attempts: ${error.message}`;

  const dlqResult = await deps.deadLetter.enqueue({
    dedupeKey: `dlq-${job.id ?? `${payload.batchId}-${payload.itemId}`}`,
    payload: {
      original: job.data,
      failedReason: error.message,
      attemptsMade: job.attemptsMade,
      movedAt: new Date().toISOString(),
    },
  });
  if (!dlqResult.ok) {
    deps.logger.error(
      { jobId: job.id, error: dlqResult.error },
      "Failed to move bulk schedule row to the dead-letter queue"
    );
  }

  if (payload.batchId !== undefined && payload.itemId !== undefined) {
    const result = await deps.fail.execute({
      batchId: payload.batchId,
      itemId: payload.itemId,
      reason,
    });
    if (!result.ok) {
      deps.logger.error(
        { jobId: job.id, itemId: payload.itemId, error: result.error.message },
        "Failed to record terminal failure for bulk schedule row"
      );
    }
  }
}

/** Handle returned by {@link startBulkScheduleWorker} for graceful shutdown. */
export interface BulkScheduleWorkerHandle {
  close(): Promise<void>;
}

export interface StartBulkScheduleWorkerDeps {
  readonly process: ProcessBulkScheduleRowUseCase;
  readonly fail: FailBulkScheduleRowUseCase;
  readonly deadLetter: QueuePort;
  readonly logger: BulkScheduleJobLogger;
  /**
   * Shared Redis connection (composition-root-owned). Required — the consumer
   * adapter never self-constructs one from env; index.ts injects
   * `TOKENS.BullMQWorkerConnection` here.
   */
  readonly connection: Redis;
}

/**
 * @function startBulkScheduleWorker
 * @description Wires the in-process bulk-schedule consumer: subscribes the row
 *   handler and attaches the retry-exhaustion DLQ handler. Returns a handle that
 *   closes the consumer on shutdown.
 * @param deps - Use cases, DLQ port, logger, and the shared Redis connection.
 * @returns A handle whose `close()` drains the consumer.
 */
export async function startBulkScheduleWorker(
  deps: StartBulkScheduleWorkerDeps
): Promise<BulkScheduleWorkerHandle> {
  const consumer = createBullMQConsumerAdapter({
    queueName: QUEUE_NAMES.BULK_SCHEDULE,
    connection: deps.connection,
  });

  const worker = await consumer.subscribe((job) =>
    processBulkScheduleRowJob({ process: deps.process, logger: deps.logger }, job.payload)
  );

  worker.on("failed", (job, error) => {
    void handleBulkScheduleRowFailure(
      { fail: deps.fail, deadLetter: deps.deadLetter, logger: deps.logger },
      job,
      error
    );
  });

  return { close: () => consumer.close() };
}
