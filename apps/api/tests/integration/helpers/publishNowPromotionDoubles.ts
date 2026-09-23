/**
 * @file publishNowPromotionDoubles.ts
 * @description The two deliberate doubles the publish-now promotion proof
 *   installs into an otherwise real composition, kept apart from
 *   `publishNowPromotionHarness.ts` so the harness reads as the composition
 *   and this file reads as the exhaustive list of what is NOT production.
 *
 *   `RecordingQueue` exists because the total-success path has to be reached
 *   without a BullMQ worker: it records each enqueue — which is what makes "the
 *   rejected second start enqueued nothing" a direct observation instead of a
 *   poll over queue retention — and then runs what that job's worker would.
 *   What it stands in for is the PROVIDER CALL alone; the publication write the
 *   worker performs afterwards is the real one, installed by the harness, because
 *   the wait step settles on that record.
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
  episode: number;
}

/** What a job's worker does once the provider has answered. */
export type PublishJobWorker = (job: RecordedJob) => Promise<void>;

/**
 * A queue that records what was enqueued and then runs that job's worker.
 *
 * Recording is what makes "the rejected second start enqueued nothing" a direct
 * observation instead of a poll over BullMQ retention. Running the worker inline
 * is what puts the saga on the total-success path without a BullMQ process — and
 * the worker installed here performs the REAL publication write, so the wait step
 * settles on a record a writer actually produced.
 */
export class RecordingQueue implements QueuePort {
  readonly jobs: RecordedJob[] = [];

  /** Installed by the harness once the real attempt writer exists. */
  runWorker: PublishJobWorker = async () => {};

  async enqueue(job: QueueJob) {
    const payload = job.payload as { postId?: unknown; channelId?: unknown; episode?: unknown };
    const recorded: RecordedJob = {
      dedupeKey: job.dedupeKey,
      postId: String(payload.postId),
      channelId: String(payload.channelId),
      episode: Number(payload.episode),
    };
    this.jobs.push(recorded);
    // A delayed job is HELD by BullMQ until its moment. Running it here anyway
    // would publish a scheduled post the instant it was scheduled, which is the
    // one thing the schedule mode exists to avoid.
    if (job.runAt === undefined || job.runAt.getTime() <= Date.now()) {
      await this.runWorker(recorded);
    }
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
