/**
 * @file dead-letter-queue-adapter.ts
 * @description `DeadLetterQueuePort` adapter implementation backed by
 *              BullMQ. Producer side (`archive`) is fully implemented —
 *              wraps the canonical `DeadLetterEntry` shape into the BullMQ
 *              job payload of the configured DLQ queue. The consumer-side
 *              methods (`list`, `retry`) return `NOT_IMPLEMENTED` until a
 *              consumer drives their final shape (PR-26 backlog).
 * @layer infrastructure
 */
import { err, type Result } from "@shared/types";
import type { DeadLetterEntry, DeadLetterQueuePort, QueuePortRegistry } from "@ports/core";
import { QUEUE_NAMES, type QueueName } from "./constants.js";

export interface BullMQDeadLetterQueueAdapterOptions {
  registry: QueuePortRegistry;
  /** DLQ name. Defaults to `QUEUE_NAMES.DEAD_LETTER_QUEUE`. */
  dlqName?: QueueName;
}

export class BullMQDeadLetterQueueAdapter implements DeadLetterQueuePort {
  private readonly registry: QueuePortRegistry;
  private readonly dlqName: QueueName;

  constructor(options: BullMQDeadLetterQueueAdapterOptions) {
    this.registry = options.registry;
    this.dlqName = options.dlqName ?? QUEUE_NAMES.DEAD_LETTER_QUEUE;
  }

  async archive(
    entry: DeadLetterEntry
  ): Promise<Result<string, "CONNECTION_ERROR" | "VALIDATION_ERROR">> {
    if (!entry.originalQueueName || !entry.failure?.reason) {
      return err("VALIDATION_ERROR");
    }
    const port = this.registry.forQueue(this.dlqName);
    const dedupeKey =
      entry.originalJobId ??
      `dlq-${entry.originalQueueName}-${entry.failure.failedAt.getTime()}-${Math.random().toString(36).slice(2, 10)}`;
    return port.enqueue({
      dedupeKey,
      payload: serializeEntry(entry),
    });
  }

  /**
   * Not implemented in T4-H scope. Consumer-side iteration over BullMQ DLQ
   * entries requires deciding pagination shape (cursor vs. offset) and
   * how to deserialise back to `DeadLetterEntry`. Tracked in PR-26.
   */
  async list(_opts: {
    limit: number;
    offset?: number;
  }): Promise<Result<readonly DeadLetterEntry[], "CONNECTION_ERROR" | "NOT_IMPLEMENTED">> {
    return err("NOT_IMPLEMENTED");
  }

  /**
   * Not implemented in T4-H scope. Re-enqueueing requires reading the
   * original job's `data` + `opts` from BullMQ, atomically pushing back to
   * the source queue, and removing the DLQ entry. Tracked in PR-26.
   */
  async retry(
    _jobId: string
  ): Promise<Result<void, "CONNECTION_ERROR" | "NOT_FOUND" | "NOT_IMPLEMENTED">> {
    return err("NOT_IMPLEMENTED");
  }
}

function serializeEntry(entry: DeadLetterEntry): Record<string, unknown> {
  return {
    originalJobId: entry.originalJobId,
    originalQueueName: entry.originalQueueName,
    originalJobName: entry.originalJobName,
    payload: entry.payload,
    failure: {
      reason: entry.failure.reason,
      stacktrace: entry.failure.stacktrace,
      attemptsMade: entry.failure.attemptsMade,
      failedAt: entry.failure.failedAt.toISOString(),
      errorType: entry.failure.errorType,
    },
    metadata: {
      movedAt: entry.metadata.movedAt.toISOString(),
      sourceWorker: entry.metadata.sourceWorker,
      tags: entry.metadata.tags,
    },
  };
}
