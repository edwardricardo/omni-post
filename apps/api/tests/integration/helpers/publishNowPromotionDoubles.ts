/**
 * @file publishNowPromotionDoubles.ts
 * @description The two deliberate doubles the publish-now promotion proof
 *   installs into an otherwise real composition, kept apart from
 *   `publishNowPromotionHarness.ts` so the harness reads as the composition
 *   and this file reads as the exhaustive list of what is NOT production.
 *
 *   `RecordingQueue` exists because the total-success path has to be reached
 *   without a BullMQ worker: reporting every job completed is what lets the
 *   wait step settle, and recording each enqueue is what makes "the rejected
 *   second start enqueued nothing" a direct observation instead of a poll over
 *   queue retention.
 *
 *   `ThrowingOutboxWriter` exists because the all-or-nothing case needs a
 *   failure the database cannot raise for it: a database-level error aborts the
 *   transaction by itself and would prove nothing about the seam, so the
 *   failure has to be raised on the JS side, between the row update and the
 *   commit — exactly the case the Result-aware Unit of Work exists for.
 *
 *   Anything else either scenario touches is the production object.
 *
 * @layer infrastructure
 */

import type { QueueJob, QueuePort } from "@ports/core";
import { ok } from "@shared/types";
import type { OutboxWriter } from "@core/domain/repositories/OutboxWriter.js";

/** One job the saga asked the queue to run. */
interface RecordedJob {
  dedupeKey: string;
  postId: string;
  channelId: string;
}

/**
 * A queue that records what was enqueued and reports every job as completed.
 *
 * Reporting completion is what puts the saga on the total-success path without
 * a worker; recording is what makes "the rejected second start enqueued
 * nothing" a direct observation instead of a poll over BullMQ retention.
 */
export class RecordingQueue implements QueuePort {
  readonly jobs: RecordedJob[] = [];

  async enqueue(job: QueueJob) {
    const payload = job.payload as { postId?: unknown; channelId?: unknown };
    this.jobs.push({
      dedupeKey: job.dedupeKey,
      postId: String(payload.postId),
      channelId: String(payload.channelId),
    });
    return ok(job.dedupeKey);
  }

  async enqueueBulk(jobs: QueueJob[]) {
    const ids: string[] = [];
    for (const job of jobs) {
      const result = await this.enqueue(job);
      if (result.ok) ids.push(result.value);
    }
    return ok(ids);
  }

  async health() {
    return ok({ connected: true, waiting: 0, active: 0, completed: 0, failed: 0, consumers: 1 });
  }

  async remove() {
    return ok(true);
  }

  async getJobStates(jobIds: string[]) {
    return ok({ completed: jobIds.length, failed: 0, pending: 0 });
  }

  /** How many publish jobs were enqueued for one post, across every start. */
  countFor(postId: string): number {
    return this.jobs.filter((job) => job.postId === postId).length;
  }
}

/**
 * An outbox writer that fails AFTER the row update inside the same transaction.
 *
 * A database-level failure aborts the transaction on its own, so it could prove
 * nothing about the seam. Only a JS-side failure raised between two statements
 * reaches the case the Result-aware Unit of Work exists for.
 */
export class ThrowingOutboxWriter implements OutboxWriter {
  async writeEvents(): Promise<void> {
    throw new Error("outbox unavailable: injected JS-side failure after the row update");
  }
}
