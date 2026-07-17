/**
 * @file OutboxRelay.test.ts
 * @description Tests for `OutboxRelay` at-least-once delivery:
 *   - claim/markPublished/releaseForRetry/archiveToDeadLetter delegated to
 *     `OutboxClaimService`,
 *   - `markPublished` runs ONLY after `dispatch` resolves (no false publish),
 *   - a failure after dispatch releases for retry (redelivery, never loss),
 *   - full-jitter backoff via `OutboxBackoff`.
 *
 *   Lifecycle (start/stop/isRunning) and the dispatch happy path are covered
 *   alongside the correctness invariants of the lease-based claim flow: DLQ
 *   atomicity, release-on-transient-failure, terminal DLQ on exhausted
 *   retries, and tolerance of a concurrent DLQ-race unique violation.
 * @layer infrastructure
 */

import { describe, it, beforeEach, afterEach, vi, expect } from "vitest";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import { OutboxRelay } from "../../../src/infrastructure/outbox/OutboxRelay.js";
import type { ClaimedOutboxEvent } from "../../../src/infrastructure/outbox/OutboxClaimService.js";

const scheduler = new NoopBackgroundTaskScheduler();

function createMockDispatcher() {
  return {
    dispatch: vi.fn(async () => {}),
    dispatchAll: vi.fn(async () => {}),
    register: vi.fn(() => {}),
  };
}

function createMockClaimService() {
  return {
    claim: vi.fn(async (_batchSize: number): Promise<ClaimedOutboxEvent[]> => []),
    markPublished: vi.fn(async (_id: string) => {}),
    releaseForRetry: vi.fn(async (_id: string, _retry: number, _next: Date) => {}),
    archiveToDeadLetter: vi.fn(
      async (_event: ClaimedOutboxEvent, _reason: string, _retry: number) => {}
    ),
  };
}

function createMockBackoff() {
  return {
    computeDelayMs: vi.fn((_attempt: number) => 1000),
    computeNextRetryAt: vi.fn((_attempt: number) => new Date("2099-01-01T00:00:00Z")),
  };
}

function makeRow(overrides: Partial<ClaimedOutboxEvent> = {}): ClaimedOutboxEvent {
  return {
    id: "evt-1",
    eventType: "PostCreated",
    aggregateId: "post-1",
    aggregateType: "Post",
    payload: { body: "x" },
    version: 1,
    occurredAt: new Date("2026-04-30T00:00:00Z"),
    retryCount: 0,
    createdAt: new Date("2026-04-30T00:00:00Z"),
    ...overrides,
  };
}

describe("OutboxRelay", () => {
  let mockDispatcher: ReturnType<typeof createMockDispatcher>;
  let mockClaim: ReturnType<typeof createMockClaimService>;
  let mockBackoff: ReturnType<typeof createMockBackoff>;
  let relay: OutboxRelay;

  beforeEach(() => {
    mockDispatcher = createMockDispatcher();
    mockClaim = createMockClaimService();
    mockBackoff = createMockBackoff();
    relay = new OutboxRelay({
      prisma: {} as never,
      eventDispatcher: mockDispatcher,
      scheduler,
      claimService: mockClaim as never,
      backoff: mockBackoff as never,
      pollIntervalMs: 100000,
      batchSize: 10,
    });
  });

  afterEach(() => {
    relay.stop();
  });

  it("starts and stops correctly", () => {
    expect(relay.isRunning).toBeFalsy();
    relay.start();
    expect(relay.isRunning).toBeTruthy();
    relay.stop();
    expect(relay.isRunning).toBeFalsy();
  });

  it("does not start twice", () => {
    relay.start();
    relay.start();
    expect(relay.isRunning).toBeTruthy();
    relay.stop();
  });

  it("polls and dispatches claimed events, then marks published", async () => {
    mockClaim.claim = vi.fn(async () => [makeRow()]);
    await relay.poll();

    expect(mockDispatcher.dispatch.mock.calls.length).toBe(1);
    expect(mockClaim.markPublished.mock.calls.length).toBe(1);
    expect(mockClaim.markPublished.mock.calls[0]?.[0]).toBe("evt-1");
  });

  it("marks published ONLY after dispatch resolves (no publish before delivery)", async () => {
    mockClaim.claim = vi.fn(async () => [makeRow()]);
    await relay.poll();

    // invocationCallOrder is a global monotonic counter across all vi mocks —
    // dispatch must have been invoked strictly before markPublished.
    const dispatchOrder = mockDispatcher.dispatch.mock.invocationCallOrder[0];
    const markPublishedOrder = mockClaim.markPublished.mock.invocationCallOrder[0];
    expect(dispatchOrder).toBeDefined();
    expect(markPublishedOrder).toBeDefined();
    expect(dispatchOrder as number).toBeLessThan(markPublishedOrder as number);
  });

  it("does not mark published when dispatch rejects — releases for retry instead", async () => {
    mockClaim.claim = vi.fn(async () => [makeRow({ retryCount: 2 })]);
    mockDispatcher.dispatch = vi.fn(async () => {
      throw new Error("Dispatch failed");
    });

    await relay.poll();

    expect(mockClaim.markPublished.mock.calls.length).toBe(0);
    expect(mockClaim.releaseForRetry.mock.calls.length).toBe(1);
    expect(mockClaim.releaseForRetry.mock.calls[0]?.[1]).toBe(3);
    expect(mockClaim.archiveToDeadLetter.mock.calls.length).toBe(0);
  });

  it("releases for retry (redelivery, never loss) when markPublished fails after a successful dispatch", async () => {
    mockClaim.claim = vi.fn(async () => [makeRow({ retryCount: 1 })]);
    mockClaim.markPublished = vi.fn(async () => {
      throw new Error("terminal UPDATE rolled back");
    });

    await relay.poll();

    // Dispatch already happened, so the event is delivered; the terminal write
    // failed, so the row stays unpublished and is released for redelivery —
    // never silently lost, never dead-lettered while retries remain.
    expect(mockDispatcher.dispatch.mock.calls.length).toBe(1);
    expect(mockClaim.markPublished.mock.calls.length).toBe(1);
    expect(mockClaim.releaseForRetry.mock.calls.length).toBe(1);
    expect(mockClaim.releaseForRetry.mock.calls[0]?.[1]).toBe(2);
    expect(mockClaim.archiveToDeadLetter.mock.calls.length).toBe(0);
  });

  it("does nothing when claim returns no rows", async () => {
    await relay.poll();
    expect(mockDispatcher.dispatch.mock.calls.length).toBe(0);
    expect(mockClaim.markPublished.mock.calls.length).toBe(0);
  });

  it("releases for retry with jittered backoff on dispatch failure", async () => {
    mockClaim.claim = vi.fn(async () => [makeRow({ retryCount: 2 })]);
    mockDispatcher.dispatch = vi.fn(async () => {
      throw new Error("Dispatch failed");
    });

    await relay.poll();

    expect(mockBackoff.computeNextRetryAt.mock.calls.length).toBe(1);
    expect(mockBackoff.computeNextRetryAt.mock.calls[0]?.[0]).toBe(3);
    expect(mockClaim.releaseForRetry.mock.calls.length).toBe(1);
    const releaseArgs = mockClaim.releaseForRetry.mock.calls[0];
    expect(releaseArgs?.[0]).toBe("evt-1");
    expect(releaseArgs?.[1]).toBe(3);
    expect(releaseArgs?.[2]).toEqual(new Date("2099-01-01T00:00:00Z"));
    expect(mockClaim.archiveToDeadLetter.mock.calls.length).toBe(0);
  });

  it("archives to DLQ once retries are exhausted", async () => {
    mockClaim.claim = vi.fn(async () => [makeRow({ retryCount: 4 })]);
    mockDispatcher.dispatch = vi.fn(async () => {
      throw new Error("Boom");
    });

    await relay.poll();

    expect(mockClaim.archiveToDeadLetter.mock.calls.length).toBe(1);
    const archiveArgs = mockClaim.archiveToDeadLetter.mock.calls[0];
    expect(archiveArgs?.[0]?.id).toBe("evt-1");
    expect(archiveArgs?.[1]).toBe("Boom");
    expect(archiveArgs?.[2]).toBe(5);
    expect(mockClaim.releaseForRetry.mock.calls.length).toBe(0);
    expect(mockClaim.markPublished.mock.calls.length).toBe(0);
  });

  it("dispatches multiple events in claim order", async () => {
    mockClaim.claim = vi.fn(async () => [makeRow({ id: "evt-1" }), makeRow({ id: "evt-2" })]);
    await relay.poll();
    expect(mockDispatcher.dispatch.mock.calls.length).toBe(2);
    expect(mockClaim.markPublished.mock.calls.length).toBe(2);
    expect(mockClaim.markPublished.mock.calls[0]?.[0]).toBe("evt-1");
    expect(mockClaim.markPublished.mock.calls[1]?.[0]).toBe("evt-2");
  });

  it("tolerates a concurrent DLQ-race unique violation (P2002) and continues the batch", async () => {
    // Two rows are exhausted; the first row's DLQ archival loses a race with a
    // concurrent relay that already dead-lettered it under lease expiry, so the
    // create raises Prisma P2002. That is a benign already-terminal outcome —
    // the relay must swallow it and keep processing the rest of the batch.
    mockClaim.claim = vi.fn(async () => [
      makeRow({ id: "evt-1", retryCount: 4 }),
      makeRow({ id: "evt-2", retryCount: 4 }),
    ]);
    mockDispatcher.dispatch = vi.fn(async () => {
      throw new Error("Boom");
    });
    let archiveCalls = 0;
    mockClaim.archiveToDeadLetter = vi.fn(async () => {
      archiveCalls += 1;
      if (archiveCalls === 1) {
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
    });

    await expect(relay.poll()).resolves.toBeUndefined();

    // Both rows attempted archival; the P2002 on the first did not abort the tick.
    expect(mockClaim.archiveToDeadLetter.mock.calls.length).toBe(2);
    expect(mockClaim.markPublished.mock.calls.length).toBe(0);
  });

  it("propagates non-P2002 DLQ archival errors (row stays claimed for the next lease cycle)", async () => {
    mockClaim.claim = vi.fn(async () => [makeRow({ retryCount: 4 })]);
    mockDispatcher.dispatch = vi.fn(async () => {
      throw new Error("Dispatch failed");
    });
    mockClaim.archiveToDeadLetter = vi.fn(async () => {
      throw new Error("DLQ transaction rolled back");
    });

    await expect(relay.poll()).rejects.toThrow("DLQ transaction rolled back");
    // The relay should NOT have marked the row published — the next poll
    // will re-process via lease expiry, which is the safe behaviour.
    expect(mockClaim.markPublished.mock.calls.length).toBe(0);
    expect(mockClaim.releaseForRetry.mock.calls.length).toBe(0);
  });

  it("releases the claim (not archives) on transient dispatch failure when retries remain", async () => {
    mockClaim.claim = vi.fn(async () => [makeRow({ retryCount: 0 })]);
    mockDispatcher.dispatch = vi.fn(async () => {
      throw new Error("Transient");
    });

    await relay.poll();

    expect(mockClaim.releaseForRetry.mock.calls.length).toBe(1);
    expect(mockClaim.archiveToDeadLetter.mock.calls.length).toBe(0);
    expect(mockClaim.markPublished.mock.calls.length).toBe(0);
  });

  it("does not re-enter poll while a previous tick is still running", async () => {
    let resolveDispatch: (() => void) | null = null;
    const blocked = new Promise<void>((resolve) => {
      resolveDispatch = resolve;
    });
    mockClaim.claim = vi.fn(async () => [makeRow()]);
    mockDispatcher.dispatch = vi.fn(async () => {
      await blocked;
    });

    const first = relay.poll();
    // Second poll should return immediately because `running` is set.
    await relay.poll();
    expect(mockClaim.claim.mock.calls.length).toBe(1);
    resolveDispatch?.();
    await first;
  });
});
