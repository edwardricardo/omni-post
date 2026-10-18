/**
 * @file bulkScheduleReconciliation.integration.test.ts
 * @description Integration test for the bulk-scheduling reconciliation backstop.
 *   Proves the real `BulkScheduleReconciliationService` sweep against a real DB:
 *   an unresolved `BulkScheduleItem` row in the OutboxDeadLetter (whose
 *   BulkScheduleRowConfirmed event was relay-exhausted) is re-driven into a fresh
 *   BullMQ job from the surviving DLQ payload, with the original deterministic
 *   dedupeKey; a RESOLVED DLQ row is left alone.
 *
 *   The sweep reads every unresolved `BulkScheduleItem` DLQ row in the table, whatever
 *   suite wrote it, so each test counts only the jobs of the batches it inserted and the
 *   teardown removes only the rows this suite inserted.
 *
 *   Pre-requisite: `pnpm db:up` (Postgres). Stub QueuePort (no Redis/BullMQ).
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@infra/prisma";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import { BulkScheduleReconciliationService } from "../../src/bulk-scheduling/BulkScheduleReconciliationService.js";
import { makeStubQueue, jobsOfBatch } from "./helpers/bulkScheduleHarness.js";
import { createSeedPrismaClient } from "./helpers/seedPrismaClient.js";

const RECONCILE_TASK_ID = "bulk-schedule-reconciliation";

/** Insert one unresolved BulkScheduleItem DLQ row with a full post-intent payload. */
async function insertDlqRow(
  prisma: PrismaClient,
  args: { batchId: string; itemId: string; channelId: string; resolved: boolean }
): Promise<void> {
  await prisma.outboxDeadLetter.create({
    data: {
      originalEventId: randomUUID(),
      eventType: "BulkScheduleRowConfirmed",
      aggregateId: args.itemId,
      aggregateType: "BulkScheduleItem",
      payload: {
        batchId: args.batchId,
        itemId: args.itemId,
        accountId: randomUUID(),
        projectId: randomUUID(),
        body: "Stuck post content",
        scheduledFor: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        timezone: "UTC",
        media: [{ url: "https://cdn.example.com/stuck.jpg", type: "image" }],
        channelIds: [args.channelId],
        tags: ["recon"],
      },
      failureReason: "relay retries exhausted (test)",
      retryCount: 3,
      firstFailedAt: new Date(),
      ...(args.resolved && { resolvedAt: new Date(), resolvedBy: "test" }),
    },
  });
}

describe("BulkSchedule reconciliation sweep — integration", () => {
  let prisma: PrismaClient;
  /** The item of every DLQ row this suite inserts, recorded before the insert. */
  const insertedItemIds: string[] = [];

  /** Records the row's item for the teardown, then inserts it. */
  async function insertOwnDlqRow(args: Parameters<typeof insertDlqRow>[1]): Promise<void> {
    insertedItemIds.push(args.itemId);
    await insertDlqRow(prisma, args);
  }

  before(() => {
    prisma = createSeedPrismaClient();
  });

  after(async () => {
    await prisma.outboxDeadLetter.deleteMany({
      where: { aggregateType: "BulkScheduleItem", aggregateId: { in: insertedItemIds } },
    });
    await prisma.$disconnect();
  });

  it("re-enqueues a stuck row from the DLQ payload with the deterministic dedupeKey", async () => {
    const batchId = randomUUID();
    const itemId = randomUUID();
    const channelId = randomUUID();
    await insertOwnDlqRow({ batchId, itemId, channelId, resolved: false });

    const scheduler = new NoopBackgroundTaskScheduler();
    const { queue, jobs } = makeStubQueue();
    // Constructor registers the sweep under RECONCILE_TASK_ID.
    new BulkScheduleReconciliationService(prisma, scheduler, queue);

    await scheduler.triggerTask(RECONCILE_TASK_ID);

    const batchJobs = jobsOfBatch(jobs, batchId);
    assert.strictEqual(batchJobs.length, 1, "one job re-enqueued for the stuck row");
    const job = batchJobs[0];
    assert.ok(job);
    assert.strictEqual(job.dedupeKey, `bulk-${batchId}-${itemId}`);

    const payload = job.payload as Record<string, unknown>;
    assert.strictEqual(payload.batchId, batchId);
    assert.strictEqual(payload.itemId, itemId);
    assert.deepStrictEqual(payload.channelIds, [channelId]);

    const row = payload.row as Record<string, unknown>;
    assert.strictEqual(row.content, "Stuck post content");
    assert.deepStrictEqual(row.media, [
      { url: "https://cdn.example.com/stuck.jpg", type: "image" },
    ]);
  });

  it("does NOT re-enqueue a DLQ row that has already been resolved", async () => {
    const resolvedBatchId = randomUUID();
    await insertOwnDlqRow({
      batchId: resolvedBatchId,
      itemId: randomUUID(),
      channelId: randomUUID(),
      resolved: true,
    });
    // An unresolved row swept in the same tick: its job proves the sweep ran and read this
    // test's rows, so the resolved row's missing job is the sweep's selection and not a
    // tick that never reached it.
    const unresolvedBatchId = randomUUID();
    await insertOwnDlqRow({
      batchId: unresolvedBatchId,
      itemId: randomUUID(),
      channelId: randomUUID(),
      resolved: false,
    });

    const scheduler = new NoopBackgroundTaskScheduler();
    const { queue, jobs } = makeStubQueue();
    new BulkScheduleReconciliationService(prisma, scheduler, queue);

    await scheduler.triggerTask(RECONCILE_TASK_ID);

    assert.strictEqual(
      jobsOfBatch(jobs, unresolvedBatchId).length,
      1,
      "the unresolved row swept in the same tick is re-enqueued"
    );
    assert.strictEqual(
      jobsOfBatch(jobs, resolvedBatchId).length,
      0,
      "resolved DLQ rows are skipped"
    );
  });
});
