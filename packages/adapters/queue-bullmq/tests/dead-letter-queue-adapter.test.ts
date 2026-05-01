/**
 * @file dead-letter-queue-adapter.test.ts
 * @description Tests for `BullMQDeadLetterQueueAdapter`.
 *   - `archive()`: serialises canonical entry shape and enqueues to the DLQ
 *     queue via the supplied `QueuePortRegistry`.
 *   - `list()` / `retry()`: return `NOT_IMPLEMENTED` per scope T4-H — these
 *     methods are tracked in PR-26 backlog.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi, expect } from "vitest";
import { ok, err } from "@shared/types";
import type { QueuePort, QueuePortRegistry, DeadLetterEntry } from "@ports/core";
import { BullMQDeadLetterQueueAdapter } from "../src/dead-letter-queue-adapter.js";
import { QUEUE_NAMES } from "../src/constants.js";

function createMockRegistry(): {
  registry: QueuePortRegistry;
  enqueue: ReturnType<typeof vi.fn>;
  forQueueCalls: string[];
} {
  const enqueue = vi.fn(async () => ok("dlq-job-123"));
  const port: QueuePort = {
    enqueue,
    health: vi.fn(),
    remove: vi.fn(),
  };
  const forQueueCalls: string[] = [];
  const registry: QueuePortRegistry = {
    forQueue(name: string) {
      forQueueCalls.push(name);
      return port;
    },
    close: vi.fn(async () => {}),
  };
  return { registry, enqueue, forQueueCalls };
}

function makeEntry(overrides: Partial<DeadLetterEntry> = {}): DeadLetterEntry {
  return {
    originalJobId: "evt-1",
    originalQueueName: "publish",
    originalJobName: "PostCreated",
    payload: { foo: "bar" },
    failure: {
      reason: "Boom",
      attemptsMade: 5,
      failedAt: new Date("2026-04-30T00:00:00Z"),
    },
    metadata: { movedAt: new Date("2026-04-30T00:00:01Z") },
    ...overrides,
  };
}

describe("BullMQDeadLetterQueueAdapter", () => {
  let mock: ReturnType<typeof createMockRegistry>;
  let adapter: BullMQDeadLetterQueueAdapter;

  beforeEach(() => {
    mock = createMockRegistry();
    adapter = new BullMQDeadLetterQueueAdapter({ registry: mock.registry });
  });

  it("uses DEAD_LETTER_QUEUE by default", async () => {
    await adapter.archive(makeEntry());
    expect(mock.forQueueCalls[0]).toBe(QUEUE_NAMES.DEAD_LETTER_QUEUE);
  });

  it("uses the configured dlqName when provided", async () => {
    const customAdapter = new BullMQDeadLetterQueueAdapter({
      registry: mock.registry,
      dlqName: QUEUE_NAMES.WEBHOOK_DEAD_LETTER,
    });
    await customAdapter.archive(makeEntry());
    expect(mock.forQueueCalls[0]).toBe(QUEUE_NAMES.WEBHOOK_DEAD_LETTER);
  });

  it("archives the entry with the canonical shape on the payload", async () => {
    const entry = makeEntry({ originalJobName: "AnalyticsIngest" });
    await adapter.archive(entry);
    expect(mock.enqueue).toHaveBeenCalledTimes(1);
    const args = mock.enqueue.mock.calls[0]?.[0] as {
      dedupeKey: string;
      payload: Record<string, unknown>;
    };
    expect(args.dedupeKey).toBe("evt-1");
    expect(args.payload.originalJobId).toBe("evt-1");
    expect(args.payload.originalQueueName).toBe("publish");
    expect(args.payload.originalJobName).toBe("AnalyticsIngest");
    const failure = args.payload.failure as { reason: string; failedAt: string };
    expect(failure.reason).toBe("Boom");
    expect(typeof failure.failedAt).toBe("string");
  });

  it("falls back to a synthetic dedupeKey when originalJobId is absent", async () => {
    const entryWithoutId: DeadLetterEntry = {
      ...makeEntry(),
      originalJobId: undefined as unknown as string | undefined,
    };
    delete (entryWithoutId as { originalJobId?: string }).originalJobId;
    await adapter.archive(entryWithoutId);
    const args = mock.enqueue.mock.calls[0]?.[0] as { dedupeKey: string };
    expect(args.dedupeKey.startsWith("dlq-publish-")).toBe(true);
  });

  it("returns VALIDATION_ERROR when failure.reason is missing", async () => {
    const bad: DeadLetterEntry = {
      ...makeEntry(),
      failure: {
        reason: "",
        attemptsMade: 5,
        failedAt: new Date(),
      },
    };
    const result = await adapter.archive(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("VALIDATION_ERROR");
  });

  it("propagates enqueue errors from the underlying QueuePort", async () => {
    mock.enqueue.mockResolvedValueOnce(err("CONNECTION_ERROR"));
    const result = await adapter.archive(makeEntry());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("CONNECTION_ERROR");
  });

  it("list() returns NOT_IMPLEMENTED in T4-H scope", async () => {
    const result = await adapter.list({ limit: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("NOT_IMPLEMENTED");
  });

  it("retry() returns NOT_IMPLEMENTED in T4-H scope", async () => {
    const result = await adapter.retry("any-id");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("NOT_IMPLEMENTED");
  });
});
