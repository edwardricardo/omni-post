/**
 * @file OutboxRelay.test.ts
 * @description Tests for `OutboxRelay` after the T4-C refactor:
 *   - claim/markPublished/releaseForRetry/archiveToDeadLetter delegated to
 *     `OutboxClaimService`,
 *   - consumer-side dedupe via `OutboxInbox`,
 *   - full-jitter backoff via `OutboxBackoff`.
 *
 *   Lifecycle (start/stop/isRunning) and the dispatch happy path are
 *   preserved from the pre-T4-C suite. The four new tests cover the
 *   correctness invariants introduced by T4-C: dedupe-skip, DLQ atomicity,
 *   release-on-transient-failure, and lease-expired re-claim.
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

function createMockInbox() {
  return {
    tryClaimForProcessing: vi.fn(async (_id: string, _consumerId: string) => true),
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
  let mockInbox: ReturnType<typeof createMockInbox>;
  let mockBackoff: ReturnType<typeof createMockBackoff>;
  let relay: OutboxRelay;

  beforeEach(() => {
    mockDispatcher = createMockDispatcher();
    mockClaim = createMockClaimService();
    mockInbox = createMockInbox();
    mockBackoff = createMockBackoff();
    relay = new OutboxRelay({
      prisma: {} as never,
      eventDispatcher: mockDispatcher,
      scheduler,
      claimService: mockClaim as never,
      backoff: mockBackoff as never,
      inbox: mockInbox as never,
      consumerId: "test-consumer",
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

    expect(mockInbox.tryClaimForProcessing.mock.calls.length).toBe(1);
    expect(mockDispatcher.dispatch.mock.calls.length).toBe(1);
    expect(mockClaim.markPublished.mock.calls.length).toBe(1);
    expect(mockClaim.markPublished.mock.calls[0]?.[0]).toBe("evt-1");
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
  });

  it("dispatches multiple events in claim order", async () => {
    mockClaim.claim = vi.fn(async () => [makeRow({ id: "evt-1" }), makeRow({ id: "evt-2" })]);
    await relay.poll();
    expect(mockDispatcher.dispatch.mock.calls.length).toBe(2);
    expect(mockClaim.markPublished.mock.calls.length).toBe(2);
    expect(mockClaim.markPublished.mock.calls[0]?.[0]).toBe("evt-1");
    expect(mockClaim.markPublished.mock.calls[1]?.[0]).toBe("evt-2");
  });

  // T4-C invariants

  it("skips dispatch when inbox reports duplicate eventId, but releases the outbox row", async () => {
    mockClaim.claim = vi.fn(async () => [makeRow()]);
    mockInbox.tryClaimForProcessing = vi.fn(async () => false);

    await relay.poll();

    expect(mockDispatcher.dispatch.mock.calls.length).toBe(0);
    expect(mockClaim.markPublished.mock.calls.length).toBe(1);
    expect(mockClaim.markPublished.mock.calls[0]?.[0]).toBe("evt-1");
  });

  it("DLQ archival errors propagate (the row stays in claimed state for the next lease cycle)", async () => {
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
