/**
 * Unit Tests - OutboxCleaner
 *
 * Part of P2-1: Transactional Outbox Implementation
 * Tier-0 tests with mocked Prisma.
 *
 * @file OutboxCleaner.test.ts
 * @description Tests for OutboxCleaner
 * @layer infrastructure
 */

import { describe, it, beforeEach, afterEach, vi, expect } from "vitest";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import { OutboxCleaner } from "../../../src/infrastructure/outbox/OutboxCleaner.js";

const scheduler = new NoopBackgroundTaskScheduler();

describe("OutboxCleaner", () => {
  let mockPrisma: { outboxEvent: { deleteMany: ReturnType<typeof import("node:test").mock.fn> } };
  let cleaner: OutboxCleaner;

  beforeEach(() => {
    mockPrisma = {
      outboxEvent: {
        deleteMany: vi.fn(async () => ({ count: 5 })),
      },
    };
    cleaner = new OutboxCleaner(mockPrisma as never, scheduler, 7);
  });

  afterEach(() => {
    cleaner.stop();
  });

  it("should start and stop correctly", () => {
    expect(cleaner.isRunning).toBeFalsy();
    cleaner.start();
    expect(cleaner.isRunning).toBeTruthy();
    cleaner.stop();
    expect(cleaner.isRunning).toBeFalsy();
  });

  it("should delete published events older than retention period", async () => {
    const count = await cleaner.clean();

    expect(count).toBe(5);
    expect(mockPrisma.outboxEvent.deleteMany.mock.calls.length).toBe(1);

    const args = mockPrisma.outboxEvent.deleteMany.mock.calls[0]?.[0] as {
      where: { publishedAt: { not: null }; createdAt: { lt: Date } };
    };
    expect(args.where.publishedAt).toBeTruthy();
    expect(args.where.createdAt.lt instanceof Date).toBeTruthy();

    // Verify cutoff is approximately 7 days ago
    const cutoffDiff = Date.now() - args.where.createdAt.lt.getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoffDiff - sevenDaysMs) < 1000).toBeTruthy();
  });

  it("should only delete published events (publishedAt: not null)", async () => {
    await cleaner.clean();

    const args = mockPrisma.outboxEvent.deleteMany.mock.calls[0]?.[0] as {
      where: { publishedAt: unknown };
    };
    expect(args.where.publishedAt).toEqual({ not: null });
  });

  it("should return 0 when no events to clean", async (_t) => {
    mockPrisma.outboxEvent.deleteMany = vi.fn(async () => ({ count: 0 }));
    const count = await cleaner.clean();
    expect(count).toBe(0);
  });

  it("should use custom retention days", async () => {
    const customCleaner = new OutboxCleaner(mockPrisma as never, scheduler, 30);
    await customCleaner.clean();

    const args = mockPrisma.outboxEvent.deleteMany.mock.calls[0]?.[0] as {
      where: { createdAt: { lt: Date } };
    };
    const cutoffDiff = Date.now() - args.where.createdAt.lt.getTime();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoffDiff - thirtyDaysMs) < 1000).toBeTruthy();
  });
});
