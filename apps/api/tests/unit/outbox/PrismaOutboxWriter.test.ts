/**
 * Unit Tests - PrismaOutboxWriter
 *
 * Part of P2-1: Transactional Outbox Implementation
 * Tier-0 tests with mocked Prisma transaction client.
 */

import { describe, it, beforeEach } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { PrismaOutboxWriter } from "../../../src/infrastructure/outbox/PrismaOutboxWriter.js";
import type { DomainEvent } from "../../../src/domain/events/DomainEvent.js";

describe("PrismaOutboxWriter", { concurrency: 1 }, () => {
  let writer: PrismaOutboxWriter;
  let mockTx: { outboxEvent: { createMany: ReturnType<typeof import("node:test").mock.fn> } };

  beforeEach((t: TestContext) => {
    writer = new PrismaOutboxWriter();
    mockTx = {
      outboxEvent: {
        createMany: t.mock.fn(async () => ({ count: 0 })),
      },
    };
  });

  it("should do nothing for empty events array", async () => {
    await writer.writeEvents(mockTx, []);
    assert.equal(mockTx.outboxEvent.createMany.mock.calls.length, 0);
  });

  it("should write a single event to the outbox", async () => {
    const event: DomainEvent & { toPayload(): Record<string, unknown> } = {
      eventId: "evt-123",
      eventType: "PostCreated",
      aggregateId: "post-456",
      aggregateType: "Post",
      occurredAt: new Date("2026-02-24T00:00:00Z"),
      version: 1,
      toPayload: () => ({ body: "Hello world" }),
    };

    await writer.writeEvents(mockTx, [event]);

    assert.equal(mockTx.outboxEvent.createMany.mock.calls.length, 1);
    const callArgs = mockTx.outboxEvent.createMany.mock.calls[0]?.arguments[0] as {
      data: unknown[];
    };
    assert.equal(callArgs.data.length, 1);

    const row = callArgs.data[0] as Record<string, unknown>;
    assert.equal(row.id, "evt-123");
    assert.equal(row.eventType, "PostCreated");
    assert.equal(row.aggregateId, "post-456");
    assert.equal(row.aggregateType, "Post");
    assert.equal(row.version, 1);
    assert.deepEqual(row.payload, { body: "Hello world" });
  });

  it("should write multiple events in a single createMany", async () => {
    const events: (DomainEvent & { toPayload(): Record<string, unknown> })[] = [
      {
        eventId: "evt-1",
        eventType: "PostCreated",
        aggregateId: "post-1",
        aggregateType: "Post",
        occurredAt: new Date(),
        version: 1,
        toPayload: () => ({ body: "First" }),
      },
      {
        eventId: "evt-2",
        eventType: "PostScheduled",
        aggregateId: "post-1",
        aggregateType: "Post",
        occurredAt: new Date(),
        version: 1,
        toPayload: () => ({ scheduledAt: "2026-03-01" }),
      },
    ];

    await writer.writeEvents(mockTx, events);

    assert.equal(mockTx.outboxEvent.createMany.mock.calls.length, 1);
    const callArgs = mockTx.outboxEvent.createMany.mock.calls[0]?.arguments[0] as {
      data: unknown[];
    };
    assert.equal(callArgs.data.length, 2);
  });

  it("should handle events without toPayload using metadata fallback", async () => {
    const event: DomainEvent = {
      eventId: "evt-999",
      eventType: "CustomEvent",
      aggregateId: "agg-1",
      aggregateType: "Custom",
      occurredAt: new Date(),
      version: 1,
      metadata: { source: "test" },
    };

    await writer.writeEvents(mockTx, [event]);

    const callArgs = mockTx.outboxEvent.createMany.mock.calls[0]?.arguments[0] as {
      data: unknown[];
    };
    const row = callArgs.data[0] as Record<string, unknown>;
    assert.deepEqual(row.payload, { metadata: { source: "test" } });
  });

  it("should propagate errors from createMany without catching them", async (t) => {
    const failingTx = {
      outboxEvent: {
        createMany: t.mock.fn(async () => {
          throw new Error("DB constraint violation");
        }),
      },
    };

    const event: DomainEvent & { toPayload(): Record<string, unknown> } = {
      eventId: "evt-err",
      eventType: "PostCreated",
      aggregateId: "post-err",
      aggregateType: "Post",
      occurredAt: new Date(),
      version: 1,
      toPayload: () => ({ body: "will fail" }),
    };

    await assert.rejects(() => writer.writeEvents(failingTx, [event]), {
      message: "DB constraint violation",
    });
  });
});
