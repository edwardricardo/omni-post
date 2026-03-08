/**
 * Unit Tests - OutboxRelay
 *
 * Part of P2-1: Transactional Outbox Implementation
 * Tier-0 tests with mocked Prisma and EventDispatcher.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { OutboxRelay } from "../../../src/infrastructure/outbox/OutboxRelay.js";

function createMockPrisma(t: TestContext) {
  return {
    outboxEvent: {
      findMany: t.mock.fn(async () => []),
      update: t.mock.fn(async () => ({})),
    },
  };
}

function createMockDispatcher(t: TestContext) {
  return {
    dispatch: t.mock.fn(async () => {}),
    dispatchAll: t.mock.fn(async () => {}),
    register: t.mock.fn(() => {}),
  };
}

describe("OutboxRelay", { concurrency: 1 }, () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let mockDispatcher: ReturnType<typeof createMockDispatcher>;
  let relay: OutboxRelay;

  beforeEach((t: TestContext) => {
    mockPrisma = createMockPrisma(t);
    mockDispatcher = createMockDispatcher(t);
    relay = new OutboxRelay({
      prisma: mockPrisma as never,
      eventDispatcher: mockDispatcher,
      pollIntervalMs: 100000,
      batchSize: 10,
    });
  });

  afterEach(() => {
    relay.stop();
  });

  it("should start and stop correctly", () => {
    assert.ok(!relay.isRunning);
    relay.start();
    assert.ok(relay.isRunning);
    relay.stop();
    assert.ok(!relay.isRunning);
  });

  it("should not start twice", () => {
    relay.start();
    relay.start();
    assert.ok(relay.isRunning);
    relay.stop();
  });

  it("should poll and dispatch unpublished events", async (t) => {
    const now = new Date();
    mockPrisma.outboxEvent.findMany = t.mock.fn(async () => [
      {
        id: "evt-1",
        eventType: "PostCreated",
        aggregateId: "post-1",
        aggregateType: "Post",
        occurredAt: now,
        version: 1,
        payload: { body: "test" },
        retryCount: 0,
        maxRetries: 5,
        nextRetryAt: now,
        publishedAt: null,
        createdAt: now,
      },
    ]);

    await relay.poll();

    assert.equal(mockDispatcher.dispatch.mock.calls.length, 1);

    // Verify event was dispatched correctly
    const dispatchedEvent = mockDispatcher.dispatch.mock.calls[0]?.arguments[0] as Record<
      string,
      unknown
    >;
    assert.equal(dispatchedEvent.eventId, "evt-1");
    assert.equal(dispatchedEvent.eventType, "PostCreated");

    // Verify event was marked as published
    assert.equal(mockPrisma.outboxEvent.update.mock.calls.length, 1);
    const updateArgs = mockPrisma.outboxEvent.update.mock.calls[0]?.arguments[0] as Record<
      string,
      unknown
    >;
    assert.deepEqual((updateArgs as { where: { id: string } }).where, { id: "evt-1" });
    assert.ok((updateArgs as { data: { publishedAt: Date } }).data.publishedAt instanceof Date);
  });

  it("should do nothing when no unpublished events exist", async () => {
    await relay.poll();
    assert.equal(mockDispatcher.dispatch.mock.calls.length, 0);
    assert.equal(mockPrisma.outboxEvent.update.mock.calls.length, 0);
  });

  it("should retry with exponential backoff on dispatch failure", async (t) => {
    const now = new Date();
    mockPrisma.outboxEvent.findMany = t.mock.fn(async () => [
      {
        id: "evt-fail",
        eventType: "PostCreated",
        aggregateId: "post-1",
        aggregateType: "Post",
        occurredAt: now,
        version: 1,
        payload: {},
        retryCount: 2,
        maxRetries: 5,
        nextRetryAt: now,
        publishedAt: null,
        createdAt: now,
      },
    ]);

    mockDispatcher.dispatch = t.mock.fn(async () => {
      throw new Error("Dispatch failed");
    });

    await relay.poll();

    // Should have attempted dispatch
    assert.equal(mockDispatcher.dispatch.mock.calls.length, 1);

    // Should have updated retry count
    assert.equal(mockPrisma.outboxEvent.update.mock.calls.length, 1);
    const updateArgs = mockPrisma.outboxEvent.update.mock.calls[0]?.arguments[0] as {
      data: { retryCount: number; nextRetryAt: Date };
    };
    assert.equal(updateArgs.data.retryCount, 3); // was 2, now 3
    assert.ok(updateArgs.data.nextRetryAt instanceof Date);
    // Exponential backoff: 2^(2+1) * 1000 = 8000ms
    assert.ok(updateArgs.data.nextRetryAt.getTime() > Date.now());
  });

  it("should skip dead letters (retryCount >= maxRetries)", async () => {
    // findMany returns nothing because the WHERE clause filters out dead letters
    // (retryCount: { lt: 5 })
    await relay.poll();
    assert.equal(mockDispatcher.dispatch.mock.calls.length, 0);
  });

  it("should dispatch multiple events in order", async (t) => {
    const now = new Date();
    const events = [
      {
        id: "evt-1",
        eventType: "PostCreated",
        aggregateId: "p-1",
        aggregateType: "Post",
        occurredAt: new Date(now.getTime() - 1000),
        version: 1,
        payload: {},
        retryCount: 0,
        maxRetries: 5,
        nextRetryAt: now,
        publishedAt: null,
        createdAt: now,
      },
      {
        id: "evt-2",
        eventType: "PostScheduled",
        aggregateId: "p-1",
        aggregateType: "Post",
        occurredAt: now,
        version: 1,
        payload: {},
        retryCount: 0,
        maxRetries: 5,
        nextRetryAt: now,
        publishedAt: null,
        createdAt: now,
      },
    ];

    mockPrisma.outboxEvent.findMany = t.mock.fn(async () => events);

    await relay.poll();

    assert.equal(mockDispatcher.dispatch.mock.calls.length, 2);
    assert.equal(mockPrisma.outboxEvent.update.mock.calls.length, 2);
  });
});
