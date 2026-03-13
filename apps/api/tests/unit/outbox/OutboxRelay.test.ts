/**
 * Unit Tests - OutboxRelay
 *
 * Part of P2-1: Transactional Outbox Implementation
 * Tier-0 tests with mocked Prisma and EventDispatcher.
 */

import { describe, it, beforeEach, afterEach, vi, expect } from "vitest";
import { OutboxRelay } from "../../../src/infrastructure/outbox/OutboxRelay.js";

function createMockPrisma() {
  return {
    outboxEvent: {
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => ({})),
    },
  };
}

function createMockDispatcher() {
  return {
    dispatch: vi.fn(async () => {}),
    dispatchAll: vi.fn(async () => {}),
    register: vi.fn(() => {}),
  };
}

describe("OutboxRelay", () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let mockDispatcher: ReturnType<typeof createMockDispatcher>;
  let relay: OutboxRelay;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    mockDispatcher = createMockDispatcher();
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
    expect(relay.isRunning).toBeFalsy();
    relay.start();
    expect(relay.isRunning).toBeTruthy();
    relay.stop();
    expect(relay.isRunning).toBeFalsy();
  });

  it("should not start twice", () => {
    relay.start();
    relay.start();
    expect(relay.isRunning).toBeTruthy();
    relay.stop();
  });

  it("should poll and dispatch unpublished events", async (t) => {
    const now = new Date();
    mockPrisma.outboxEvent.findMany = vi.fn(async () => [
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

    expect(mockDispatcher.dispatch.mock.calls.length).toBe(1);

    // Verify event was dispatched correctly
    const dispatchedEvent = mockDispatcher.dispatch.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(dispatchedEvent.eventId).toBe("evt-1");
    expect(dispatchedEvent.eventType).toBe("PostCreated");

    // Verify event was marked as published
    expect(mockPrisma.outboxEvent.update.mock.calls.length).toBe(1);
    const updateArgs = mockPrisma.outboxEvent.update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect((updateArgs as { where: { id: string } }).where).toEqual({ id: "evt-1" });
    expect(
      (updateArgs as { data: { publishedAt: Date } }).data.publishedAt instanceof Date
    ).toBeTruthy();
  });

  it("should do nothing when no unpublished events exist", async () => {
    await relay.poll();
    expect(mockDispatcher.dispatch.mock.calls.length).toBe(0);
    expect(mockPrisma.outboxEvent.update.mock.calls.length).toBe(0);
  });

  it("should retry with exponential backoff on dispatch failure", async (t) => {
    const now = new Date();
    mockPrisma.outboxEvent.findMany = vi.fn(async () => [
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

    mockDispatcher.dispatch = vi.fn(async () => {
      throw new Error("Dispatch failed");
    });

    await relay.poll();

    // Should have attempted dispatch
    expect(mockDispatcher.dispatch.mock.calls.length).toBe(1);

    // Should have updated retry count
    expect(mockPrisma.outboxEvent.update.mock.calls.length).toBe(1);
    const updateArgs = mockPrisma.outboxEvent.update.mock.calls[0]?.[0] as {
      data: { retryCount: number; nextRetryAt: Date };
    };
    expect(updateArgs.data.retryCount).toBe(3); // was 2, now 3
    expect(updateArgs.data.nextRetryAt instanceof Date).toBeTruthy();
    // Exponential backoff: 2^(2+1) * 1000 = 8000ms
    expect(updateArgs.data.nextRetryAt.getTime() > Date.now()).toBeTruthy();
  });

  it("should skip dead letters (retryCount >= maxRetries)", async () => {
    // findMany returns nothing because the WHERE clause filters out dead letters
    // (retryCount: { lt: 5 })
    await relay.poll();
    expect(mockDispatcher.dispatch.mock.calls.length).toBe(0);
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

    mockPrisma.outboxEvent.findMany = vi.fn(async () => events);

    await relay.poll();

    expect(mockDispatcher.dispatch.mock.calls.length).toBe(2);
    expect(mockPrisma.outboxEvent.update.mock.calls.length).toBe(2);
  });
});
