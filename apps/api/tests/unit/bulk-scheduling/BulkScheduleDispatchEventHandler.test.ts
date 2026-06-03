/**
 * @file BulkScheduleDispatchEventHandler.test.ts
 * @description Unit tests for BulkScheduleDispatchEventHandler.
 *   Spec scenario: "Double-dispatch produces no duplicate jobs" (dedupeKey),
 *   "Enqueue failure then relay recovers" (throw-to-retry).
 *   P1.5 (RED) → P1.6 (GREEN).
 * @layer infrastructure
 */

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import type { QueuePort } from "@ports/core";
import {
  BulkScheduleDispatchEventHandler,
  BULK_SCHEDULE_HANDLED_EVENT_TYPES,
} from "../../../src/bulk-scheduling/BulkScheduleDispatchEventHandler.js";
import type { DomainEvent } from "@core/domain/events/DomainEvent.js";

const ITEM_ID = "item-uuid-001";
const BATCH_ID = "batch-uuid-001";
const ACCOUNT_ID = "account-uuid-001";
const PROJECT_ID = "project-uuid-001";

function makeEvent(overrides?: Partial<DomainEvent>): DomainEvent {
  return {
    eventId: "evt-001",
    eventType: "BulkScheduleRowConfirmed",
    aggregateId: ITEM_ID,
    aggregateType: "BulkScheduleItem",
    occurredAt: new Date(),
    version: 1,
    metadata: {
      payload: {
        itemId: ITEM_ID,
        batchId: BATCH_ID,
        accountId: ACCOUNT_ID,
        projectId: PROJECT_ID,
        body: "Hello!",
        scheduledFor: "2026-07-01T10:00:00.000Z",
        timezone: "UTC",
        channelIds: ["ch-001"],
        media: [],
        tags: [],
      },
    },
    ...overrides,
  };
}

function makeQueue(enqueueImpl: QueuePort["enqueue"]): QueuePort {
  return { enqueue: vi.fn(enqueueImpl) } as unknown as QueuePort;
}

describe("BulkScheduleDispatchEventHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("BULK_SCHEDULE_HANDLED_EVENT_TYPES", () => {
    it("contains BulkScheduleRowConfirmed", () => {
      assert.ok(BULK_SCHEDULE_HANDLED_EVENT_TYPES.includes("BulkScheduleRowConfirmed"));
    });
  });

  describe("handle()", () => {
    it("enqueues a BullMQ job with dedupeKey = bulk-{batchId}-{itemId}", async () => {
      const queue = makeQueue(async () => ok(undefined));
      const handler = new BulkScheduleDispatchEventHandler(queue);

      await handler.handle(makeEvent());

      const enqueue = queue.enqueue as ReturnType<typeof vi.fn>;
      assert.strictEqual(enqueue.mock.calls.length, 1);
      const call = enqueue.mock.calls[0]?.[0];
      assert.strictEqual(call?.dedupeKey, `bulk-${BATCH_ID}-${ITEM_ID}`);
    });

    it("includes batchId, itemId, accountId, projectId in the job payload", async () => {
      const queue = makeQueue(async () => ok(undefined));
      const handler = new BulkScheduleDispatchEventHandler(queue);

      await handler.handle(makeEvent());

      const enqueue = queue.enqueue as ReturnType<typeof vi.fn>;
      const payload = enqueue.mock.calls[0]?.[0]?.payload as Record<string, unknown>;
      assert.strictEqual(payload?.batchId, BATCH_ID);
      assert.strictEqual(payload?.itemId, ITEM_ID);
      assert.strictEqual(payload?.accountId, ACCOUNT_ID);
      assert.strictEqual(payload?.projectId, PROJECT_ID);
    });

    it("throws on enqueue failure so the outbox relay retries dispatch", async () => {
      const queue = makeQueue(async () => err("BullMQ unavailable"));
      const handler = new BulkScheduleDispatchEventHandler(queue);

      await assert.rejects(() => handler.handle(makeEvent()), /bulk schedule row/i);
    });

    it("logs warn and returns without throwing when payload is malformed (no poison)", async () => {
      const queue = makeQueue(async () => ok(undefined));
      const handler = new BulkScheduleDispatchEventHandler(queue);

      const malformedEvent = makeEvent({
        metadata: { payload: {} }, // missing itemId and batchId
      });

      // Should NOT throw
      await handler.handle(malformedEvent);

      // Should NOT enqueue a job
      const enqueue = queue.enqueue as ReturnType<typeof vi.fn>;
      assert.strictEqual(enqueue.mock.calls.length, 0);
    });

    it("ignores events with a different eventType (no-op)", async () => {
      const queue = makeQueue(async () => ok(undefined));
      const handler = new BulkScheduleDispatchEventHandler(queue);

      await handler.handle(makeEvent({ eventType: "SomeOtherEvent" }));

      const enqueue = queue.enqueue as ReturnType<typeof vi.fn>;
      assert.strictEqual(enqueue.mock.calls.length, 0);
    });
  });
});
