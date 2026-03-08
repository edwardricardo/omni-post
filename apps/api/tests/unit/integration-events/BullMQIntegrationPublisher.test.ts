/**
 * Unit Tests - BullMQIntegrationPublisher
 *
 * Part of P2-2: Integration Events via BullMQ
 * Tier-0 tests — no real Redis or BullMQ connection required.
 * The BullMQ Queue is mocked via a minimal interface to verify correct
 * delegation without coupling the test to BullMQ internals.
 */

import { describe, it, beforeEach } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { BullMQIntegrationPublisher } from "../../../src/infrastructure/integration-events/BullMQIntegrationPublisher.js";
import type { IntegrationEvent } from "../../../src/infrastructure/integration-events/IntegrationEvent.js";

// ---------------------------------------------------------------------------
// Minimal Queue interface — mirrors only the methods BullMQIntegrationPublisher
// actually calls. No bullmq import needed in test code.
// ---------------------------------------------------------------------------
interface MockQueue {
  add: ReturnType<typeof import("node:test").mock.fn>;
  addBulk: ReturnType<typeof import("node:test").mock.fn>;
  close: ReturnType<typeof import("node:test").mock.fn>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockQueue(t: TestContext): MockQueue {
  return {
    add: t.mock.fn(async () => ({ id: "job-1" })),
    addBulk: t.mock.fn(async () => [{ id: "job-1" }, { id: "job-2" }]),
    close: t.mock.fn(async () => undefined),
  };
}

function createMockEvent(overrides: Partial<IntegrationEvent> = {}): IntegrationEvent {
  return {
    eventId: "evt-123",
    eventType: "PostCreated",
    aggregateId: "post-456",
    aggregateType: "Post",
    occurredAt: "2026-02-23T12:00:00.000Z",
    schemaVersion: 1,
    payload: { postId: "post-456", body: "Hello" },
    metadata: {},
    source: "omnipost-api",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BullMQIntegrationPublisher", { concurrency: 1 }, () => {
  let mockQueue: MockQueue;
  let publisher: BullMQIntegrationPublisher;

  beforeEach((t: TestContext) => {
    mockQueue = createMockQueue(t);
    // Cast to `any` so we can pass the minimal mock where Queue<any> is expected
    publisher = new BullMQIntegrationPublisher(mockQueue as any);
  });

  // -------------------------------------------------------------------------

  it("publish() calls queue.add with event type as job name", async () => {
    const event = createMockEvent({ eventType: "PostCreated" });

    await publisher.publish(event);

    assert.equal(mockQueue.add.mock.calls.length, 1);
    const call = mockQueue.add.mock.calls[0];
    assert.ok(call, "queue.add was not called");
    // First argument is the job name (event type)
    assert.equal(call.arguments[0], "PostCreated");
  });

  it("publish() passes the full event as job data", async () => {
    const event = createMockEvent();

    await publisher.publish(event);

    const call = mockQueue.add.mock.calls[0];
    assert.ok(call, "queue.add was not called");
    // Second argument is the job data — must be the entire IntegrationEvent DTO
    assert.deepEqual(call.arguments[1], event);
  });

  it("publish() uses eventId as jobId for BullMQ deduplication", async () => {
    const event = createMockEvent({ eventId: "dedup-event-id-xyz" });

    await publisher.publish(event);

    const call = mockQueue.add.mock.calls[0];
    assert.ok(call, "queue.add was not called");
    // Third argument is opts — must contain jobId equal to eventId
    const opts = call.arguments[2] as { jobId?: string };
    assert.equal(opts.jobId, "dedup-event-id-xyz");
  });

  it("publishBatch() calls queue.addBulk with correctly mapped jobs", async () => {
    const events = [
      createMockEvent({ eventId: "evt-1", eventType: "PostCreated" }),
      createMockEvent({ eventId: "evt-2", eventType: "PostPublished" }),
    ];

    await publisher.publishBatch(events);

    assert.equal(mockQueue.addBulk.mock.calls.length, 1);
    const call = mockQueue.addBulk.mock.calls[0];
    assert.ok(call, "queue.addBulk was not called");

    const jobs = call.arguments[0] as Array<{
      name: string;
      data: IntegrationEvent;
      opts: { jobId: string };
    }>;

    assert.equal(jobs.length, 2);

    assert.equal(jobs[0]?.name, "PostCreated");
    assert.deepEqual(jobs[0]?.data, events[0]);
    assert.equal(jobs[0]?.opts.jobId, "evt-1");

    assert.equal(jobs[1]?.name, "PostPublished");
    assert.deepEqual(jobs[1]?.data, events[1]);
    assert.equal(jobs[1]?.opts.jobId, "evt-2");
  });

  it("publishBatch() does nothing and does not call addBulk for empty array", async () => {
    await publisher.publishBatch([]);

    assert.equal(mockQueue.addBulk.mock.calls.length, 0);
  });

  it("close() delegates to queue.close()", async () => {
    await publisher.close();

    assert.equal(mockQueue.close.mock.calls.length, 1);
  });

  it("publish() propagates errors thrown by queue.add()", async (t) => {
    const queueError = new Error("Redis connection refused");
    mockQueue.add = t.mock.fn(async () => {
      throw queueError;
    });

    const event = createMockEvent();

    await assert.rejects(
      () => publisher.publish(event),
      (err: Error) => {
        assert.equal(err.message, "Redis connection refused");
        return true;
      }
    );
  });
});
