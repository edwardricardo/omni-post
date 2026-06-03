/**
 * @file bulkScheduleReconciliation.integration.test.ts
 * @description Integration test for the bulk-scheduling reconciliation backstop.
 *   Proves the real `BulkScheduleReconciliationService` sweep against a real DB:
 *   an unresolved `BulkScheduleItem` row in the OutboxDeadLetter (whose
 *   BulkScheduleRowConfirmed event was relay-exhausted) is re-driven into a fresh
 *   BullMQ job from the surviving DLQ payload, with the original deterministic
 *   dedupeKey; a RESOLVED DLQ row is left alone.
 *
 *   Pre-requisite: `pnpm db:up` (Postgres). Stub QueuePort (no Redis/BullMQ).
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import { BulkScheduleReconciliationService } from "../../src/bulk-scheduling/BulkScheduleReconciliationService.js";
import { makeStubQueue } from "./helpers/bulkScheduleHarness.js";

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

  before(() => {
    prisma = createTestPrismaClient();
  });

  after(async () => {
    await prisma.outboxDeadLetter.deleteMany({ where: { aggregateType: "BulkScheduleItem" } });
    await prisma.$disconnect();
  });

  it("re-enqueues a stuck row from the DLQ payload with the deterministic dedupeKey", async () => {
    const batchId = randomUUID();
    const itemId = randomUUID();
    const channelId = randomUUID();
    await insertDlqRow(prisma, { batchId, itemId, channelId, resolved: false });

    const scheduler = new NoopBackgroundTaskScheduler();
    const { queue, jobs } = makeStubQueue();
    // Constructor registers the sweep under RECONCILE_TASK_ID.
    new BulkScheduleReconciliationService(prisma, scheduler, queue);

    await scheduler.triggerTask(RECONCILE_TASK_ID);

    assert.strictEqual(jobs.length, 1, "one job re-enqueued for the stuck row");
    const job = jobs[0];
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
    await prisma.outboxDeadLetter.deleteMany({ where: { aggregateType: "BulkScheduleItem" } });
    await insertDlqRow(prisma, {
      batchId: randomUUID(),
      itemId: randomUUID(),
      channelId: randomUUID(),
      resolved: true,
    });

    const scheduler = new NoopBackgroundTaskScheduler();
    const { queue, jobs } = makeStubQueue();
    new BulkScheduleReconciliationService(prisma, scheduler, queue);

    await scheduler.triggerTask(RECONCILE_TASK_ID);

    assert.strictEqual(jobs.length, 0, "resolved DLQ rows are skipped");
  });
});
