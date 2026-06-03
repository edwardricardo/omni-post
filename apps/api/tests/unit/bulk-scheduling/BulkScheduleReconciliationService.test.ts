/**
 * @file BulkScheduleReconciliationService.test.ts
 * @description Unit tests for BulkScheduleReconciliationService.
 *   Spec scenario: "Stuck PENDING batch recovered by reconciliation sweep".
 *   The sweep queries OutboxDeadLetter for unresolved BulkScheduleItem events
 *   and re-enqueues the original BullMQ job from the saved payload.
 *   P1.7 (RED) → P1.8 (GREEN).
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import { BulkScheduleReconciliationService } from "../../../src/bulk-scheduling/BulkScheduleReconciliationService.js";
import type { QueuePort } from "@ports/core";

const BATCH_ID = "batch-001";
const ITEM_ID_A = "item-001";
const ITEM_ID_B = "item-002";

/** A dead-lettered outbox row for a BulkScheduleItem — has the full intent payload. */
function makeDlqRow(itemId: string) {
  return {
    id: `dlq-${itemId}`,
    originalEventId: `evt-${itemId}`,
    eventType: "BulkScheduleRowConfirmed",
    aggregateId: itemId,
    aggregateType: "BulkScheduleItem",
    payload: {
      itemId,
      batchId: BATCH_ID,
      accountId: "account-001",
      projectId: "project-001",
      body: "Hello bulk!",
      scheduledFor: "2026-07-01T10:00:00.000Z",
      timezone: "UTC",
      channelIds: ["ch-001"],
      media: [],
      tags: [],
    },
    failureReason: "BullMQ unavailable",
    retryCount: 5,
    firstFailedAt: new Date(Date.now() - 10 * 60 * 1000),
    archivedAt: new Date(Date.now() - 6 * 60 * 1000),
    resolvedAt: null,
    resolvedBy: null,
  };
}

function makePrisma(dlqRows: ReturnType<typeof makeDlqRow>[]) {
  return {
    outboxDeadLetter: {
      findMany: vi.fn(async () => dlqRows),
    },
  };
}

function makeQueue(enqueueImpl: QueuePort["enqueue"]): QueuePort {
  return { enqueue: vi.fn(enqueueImpl) } as unknown as QueuePort;
}

describe("BulkScheduleReconciliationService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor — registers task with scheduler", () => {
    it("registers a task with taskId 'bulk-schedule-reconciliation' and 60000ms interval", () => {
      const scheduler = new NoopBackgroundTaskScheduler();
      const prisma = makePrisma([]);
      const queue = makeQueue(async () => ok(undefined));

      new BulkScheduleReconciliationService(
        prisma as unknown as ConstructorParameters<typeof BulkScheduleReconciliationService>[0],
        scheduler,
        queue
      );

      const activeTasks = scheduler.getActiveTasks();
      assert.ok(activeTasks.includes("bulk-schedule-reconciliation"));

      const meta = scheduler.getTaskMetadata("bulk-schedule-reconciliation");
      assert.strictEqual(meta?.intervalMs, 60_000);
    });
  });

  describe("reconciliation sweep", () => {
    it("re-enqueues a job with dedupeKey = bulk-{batchId}-{itemId} for each DLQ row", async () => {
      const scheduler = new NoopBackgroundTaskScheduler();
      const dlqRow = makeDlqRow(ITEM_ID_A);
      const prisma = makePrisma([dlqRow]);
      const queue = makeQueue(async () => ok(undefined));

      new BulkScheduleReconciliationService(
        prisma as unknown as ConstructorParameters<typeof BulkScheduleReconciliationService>[0],
        scheduler,
        queue
      );

      await scheduler.triggerTask("bulk-schedule-reconciliation");

      const enqueue = queue.enqueue as ReturnType<typeof vi.fn>;
      assert.strictEqual(enqueue.mock.calls.length, 1);
      const call = enqueue.mock.calls[0]?.[0];
      assert.strictEqual(call?.dedupeKey, `bulk-${BATCH_ID}-${ITEM_ID_A}`);
    });

    it("re-enqueues once per DLQ row when multiple items are stuck", async () => {
      const scheduler = new NoopBackgroundTaskScheduler();
      const dlqRows = [makeDlqRow(ITEM_ID_A), makeDlqRow(ITEM_ID_B)];
      const prisma = makePrisma(dlqRows);
      const queue = makeQueue(async () => ok(undefined));

      new BulkScheduleReconciliationService(
        prisma as unknown as ConstructorParameters<typeof BulkScheduleReconciliationService>[0],
        scheduler,
        queue
      );

      await scheduler.triggerTask("bulk-schedule-reconciliation");

      const enqueue = queue.enqueue as ReturnType<typeof vi.fn>;
      assert.strictEqual(enqueue.mock.calls.length, 2);
    });

    it("makes zero enqueue calls when there are no DLQ rows", async () => {
      const scheduler = new NoopBackgroundTaskScheduler();
      const prisma = makePrisma([]);
      const queue = makeQueue(async () => ok(undefined));

      new BulkScheduleReconciliationService(
        prisma as unknown as ConstructorParameters<typeof BulkScheduleReconciliationService>[0],
        scheduler,
        queue
      );

      await scheduler.triggerTask("bulk-schedule-reconciliation");

      const enqueue = queue.enqueue as ReturnType<typeof vi.fn>;
      assert.strictEqual(enqueue.mock.calls.length, 0);
    });

    it("continues processing remaining items when a single enqueue fails", async () => {
      const scheduler = new NoopBackgroundTaskScheduler();
      const dlqRows = [makeDlqRow(ITEM_ID_A), makeDlqRow(ITEM_ID_B)];
      const prisma = makePrisma(dlqRows);

      let callCount = 0;
      const queue = makeQueue(async () => {
        callCount++;
        if (callCount === 1) return err("BullMQ unavailable");
        return ok(undefined);
      });

      new BulkScheduleReconciliationService(
        prisma as unknown as ConstructorParameters<typeof BulkScheduleReconciliationService>[0],
        scheduler,
        queue
      );

      // swallowErrors: the outer sweep catches per-item failures and continues
      await scheduler.triggerTask("bulk-schedule-reconciliation", { swallowErrors: true });

      const enqueue = queue.enqueue as ReturnType<typeof vi.fn>;
      assert.strictEqual(enqueue.mock.calls.length, 2);
    });

    it("queries outboxDeadLetter for unresolved BulkScheduleItem events", async () => {
      const scheduler = new NoopBackgroundTaskScheduler();
      const prisma = makePrisma([]);
      const queue = makeQueue(async () => ok(undefined));

      new BulkScheduleReconciliationService(
        prisma as unknown as ConstructorParameters<typeof BulkScheduleReconciliationService>[0],
        scheduler,
        queue
      );

      await scheduler.triggerTask("bulk-schedule-reconciliation");

      const findMany = prisma.outboxDeadLetter.findMany as ReturnType<typeof vi.fn>;
      assert.strictEqual(findMany.mock.calls.length, 1);
      const whereArg = findMany.mock.calls[0]?.[0]?.where;
      assert.strictEqual(whereArg?.aggregateType, "BulkScheduleItem");
      assert.strictEqual(whereArg?.resolvedAt, null);
    });
  });
});
