/**
 * @file triageDispatchEventHandler.test.ts
 * @description Unit tests for TriageDispatchEventHandler: enqueues TRIAGE_INBOX
 *              with messageId+accountId extracted from the outbox-reconstructed
 *              SocialMessageReceived payload, idempotent via dedupeKey, skips
 *              unrelated event types, and throws on enqueue failure to signal
 *              outbox retry.
 * @layer infrastructure
 */
import { describe, it, expect, vi } from "vitest";
import assert from "node:assert/strict";
import { ok, err, type Result } from "@shared/types";
import type { QueuePort } from "@ports/core";
import type { DomainEvent } from "@core/domain/events/DomainEvent.js";
import { TriageDispatchEventHandler } from "../../../../src/inbox/handlers/TriageDispatchEventHandler.js";

function makeQueue(enqueueResult: Result<string, "CONNECTION_ERROR" | "VALIDATION_ERROR">): {
  queue: QueuePort;
  calls: unknown[];
} {
  const calls: unknown[] = [];
  const queue = {
    enqueue: vi.fn(async (job: Parameters<QueuePort["enqueue"]>[0]) => {
      calls.push(job);
      return enqueueResult;
    }),
    health: vi.fn(),
    remove: vi.fn(),
    getJobStates: vi.fn(),
  } as unknown as QueuePort;
  return { queue, calls };
}

function makeEvent(
  overrides: Partial<DomainEvent> & { payload?: Record<string, unknown> } = {}
): DomainEvent {
  const { payload, ...rest } = overrides;
  return {
    eventId: "evt-1",
    eventType: "SocialMessageReceived",
    aggregateId: "msg-1",
    aggregateType: "SocialMessage",
    occurredAt: new Date("2026-05-19T00:00:00Z"),
    version: 1,
    metadata: { payload: payload ?? { messageId: "msg-1", accountId: "acc-1" } },
    ...rest,
  };
}

describe("TriageDispatchEventHandler", () => {
  it("enqueues TRIAGE_INBOX with messageId+accountId on SocialMessageReceived", async () => {
    const { queue, calls } = makeQueue(ok("job-1") as Result<string, never>);
    const handler = new TriageDispatchEventHandler(queue);

    await handler.handle(makeEvent());

    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0], {
      payload: { messageId: "msg-1", accountId: "acc-1" },
      dedupeKey: "triage-msg-1",
    });
  });

  it("dedupeKey is deterministic per message id (idempotent across replays)", async () => {
    const { queue, calls } = makeQueue(ok("job-1") as Result<string, never>);
    const handler = new TriageDispatchEventHandler(queue);

    await handler.handle(makeEvent());
    await handler.handle(makeEvent());

    const dedupeKeys = (calls as Array<{ dedupeKey: string }>).map((c) => c.dedupeKey);
    assert.deepStrictEqual(dedupeKeys, ["triage-msg-1", "triage-msg-1"]);
  });

  it("skips unrelated event types without enqueueing", async () => {
    const { queue, calls } = makeQueue(ok("job-1") as Result<string, never>);
    const handler = new TriageDispatchEventHandler(queue);

    await handler.handle(makeEvent({ eventType: "SomeOtherEvent" } as Partial<DomainEvent>));

    assert.strictEqual(calls.length, 0);
  });

  it("skips when payload is missing accountId", async () => {
    const { queue, calls } = makeQueue(ok("job-1") as Result<string, never>);
    const handler = new TriageDispatchEventHandler(queue);

    await handler.handle(makeEvent({ payload: { messageId: "msg-1" } }));

    assert.strictEqual(calls.length, 0);
  });

  it("falls back to event.aggregateId when payload.messageId is missing", async () => {
    const { queue, calls } = makeQueue(ok("job-1") as Result<string, never>);
    const handler = new TriageDispatchEventHandler(queue);

    await handler.handle(makeEvent({ payload: { accountId: "acc-1" } }));

    assert.strictEqual(calls.length, 1);
    const first = calls[0] as { payload: { messageId: string } };
    assert.strictEqual(first.payload.messageId, "msg-1");
  });

  it("throws when enqueue fails so the outbox relay retries", async () => {
    const { queue } = makeQueue(err("CONNECTION_ERROR"));
    const handler = new TriageDispatchEventHandler(queue);

    await expect(handler.handle(makeEvent())).rejects.toThrow(/Failed to enqueue triage job/);
  });
});
