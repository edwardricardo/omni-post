/**
 * Unit Tests - OutboxCleaner
 *
 * Part of P2-1: Transactional Outbox Implementation
 * Tier-0 tests with mocked Prisma.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import { OutboxCleaner } from "../../../src/infrastructure/outbox/OutboxCleaner.js";

describe("OutboxCleaner", { concurrency: 1 }, () => {
  let mockPrisma: { outboxEvent: { deleteMany: ReturnType<typeof import("node:test").mock.fn> } };
  let cleaner: OutboxCleaner;

  beforeEach((t: TestContext) => {
    mockPrisma = {
      outboxEvent: {
        deleteMany: t.mock.fn(async () => ({ count: 5 })),
      },
    };
    cleaner = new OutboxCleaner(mockPrisma as never, 7);
  });

  afterEach(() => {
    cleaner.stop();
  });

  it("should start and stop correctly", () => {
    assert.ok(!cleaner.isRunning);
    cleaner.start();
    assert.ok(cleaner.isRunning);
    cleaner.stop();
    assert.ok(!cleaner.isRunning);
  });

  it("should delete published events older than retention period", async () => {
    const count = await cleaner.clean();

    assert.equal(count, 5);
    assert.equal(mockPrisma.outboxEvent.deleteMany.mock.calls.length, 1);

    const args = mockPrisma.outboxEvent.deleteMany.mock.calls[0]?.arguments[0] as {
      where: { publishedAt: { not: null }; createdAt: { lt: Date } };
    };
    assert.ok(args.where.publishedAt);
    assert.ok(args.where.createdAt.lt instanceof Date);

    // Verify cutoff is approximately 7 days ago
    const cutoffDiff = Date.now() - args.where.createdAt.lt.getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    assert.ok(Math.abs(cutoffDiff - sevenDaysMs) < 1000, "Cutoff should be ~7 days ago");
  });

  it("should only delete published events (publishedAt: not null)", async () => {
    await cleaner.clean();

    const args = mockPrisma.outboxEvent.deleteMany.mock.calls[0]?.arguments[0] as {
      where: { publishedAt: unknown };
    };
    assert.deepEqual(args.where.publishedAt, { not: null });
  });

  it("should return 0 when no events to clean", async (t) => {
    mockPrisma.outboxEvent.deleteMany = t.mock.fn(async () => ({ count: 0 }));
    const count = await cleaner.clean();
    assert.equal(count, 0);
  });

  it("should use custom retention days", async () => {
    const customCleaner = new OutboxCleaner(mockPrisma as never, 30);
    await customCleaner.clean();

    const args = mockPrisma.outboxEvent.deleteMany.mock.calls[0]?.arguments[0] as {
      where: { createdAt: { lt: Date } };
    };
    const cutoffDiff = Date.now() - args.where.createdAt.lt.getTime();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    assert.ok(Math.abs(cutoffDiff - thirtyDaysMs) < 1000, "Cutoff should be ~30 days ago");
  });
});
