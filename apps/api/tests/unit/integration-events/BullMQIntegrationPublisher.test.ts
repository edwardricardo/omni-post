/**
 * Unit Tests - BullMQIntegrationPublisher
 *
 * Part of P2-2: Integration Events via BullMQ
 * Tier-0 tests — no real Redis or BullMQ connection required.
 * The BullMQ Queue is mocked via a minimal interface to verify correct
 * delegation without coupling the test to BullMQ internals.
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
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

function createMockQueue(): MockQueue {
  return {
    add: vi.fn(async () => ({ id: "job-1" })),
    addBulk: vi.fn(async () => [{ id: "job-1" }, { id: "job-2" }]),
    close: vi.fn(async () => undefined),
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

describe("BullMQIntegrationPublisher", () => {
  let mockQueue: MockQueue;
  let publisher: BullMQIntegrationPublisher;

  beforeEach(() => {
    mockQueue = createMockQueue();
    // Cast to `any` so we can pass the minimal mock where Queue<any> is expected
    publisher = new BullMQIntegrationPublisher(mockQueue as any);
  });

  // -------------------------------------------------------------------------

  it("publish() calls queue.add with event type as job name", async () => {
    const event = createMockEvent({ eventType: "PostCreated" });

    await publisher.publish(event);

    expect(mockQueue.add.mock.calls.length).toBe(1);
    const call = mockQueue.add.mock.calls[0];
    expect(call).toBeTruthy();
    // First argument is the job name (event type)
    expect(call[0]).toBe("PostCreated");
  });

  it("publish() passes the full event as job data", async () => {
    const event = createMockEvent();

    await publisher.publish(event);

    const call = mockQueue.add.mock.calls[0];
    expect(call).toBeTruthy();
    // Second argument is the job data — must be the entire IntegrationEvent DTO
    expect(call[1]).toEqual(event);
  });

  it("publish() uses eventId as jobId for BullMQ deduplication", async () => {
    const event = createMockEvent({ eventId: "dedup-event-id-xyz" });

    await publisher.publish(event);

    const call = mockQueue.add.mock.calls[0];
    expect(call).toBeTruthy();
    // Third argument is opts — must contain jobId equal to eventId
    const opts = call[2] as { jobId?: string };
    expect(opts.jobId).toBe("dedup-event-id-xyz");
  });

  it("publishBatch() calls queue.addBulk with correctly mapped jobs", async () => {
    const events = [
      createMockEvent({ eventId: "evt-1", eventType: "PostCreated" }),
      createMockEvent({ eventId: "evt-2", eventType: "PostPublished" }),
    ];

    await publisher.publishBatch(events);

    expect(mockQueue.addBulk.mock.calls.length).toBe(1);
    const call = mockQueue.addBulk.mock.calls[0];
    expect(call).toBeTruthy();

    const jobs = call[0] as Array<{
      name: string;
      data: IntegrationEvent;
      opts: { jobId: string };
    }>;

    expect(jobs.length).toBe(2);

    expect(jobs[0]?.name).toBe("PostCreated");
    expect(jobs[0]?.data).toEqual(events[0]);
    expect(jobs[0]?.opts.jobId).toBe("evt-1");

    expect(jobs[1]?.name).toBe("PostPublished");
    expect(jobs[1]?.data).toEqual(events[1]);
    expect(jobs[1]?.opts.jobId).toBe("evt-2");
  });

  it("publishBatch() does nothing and does not call addBulk for empty array", async () => {
    await publisher.publishBatch([]);

    expect(mockQueue.addBulk.mock.calls.length).toBe(0);
  });

  it("close() delegates to queue.close()", async () => {
    await publisher.close();

    expect(mockQueue.close.mock.calls.length).toBe(1);
  });

  it("publish() propagates errors thrown by queue.add()", async (t) => {
    const queueError = new Error("Redis connection refused");
    mockQueue.add = vi.fn(async () => {
      throw queueError;
    });

    const event = createMockEvent();

    await expect(publisher.publish(event)).rejects.toThrow("Redis connection refused");
  });
});
