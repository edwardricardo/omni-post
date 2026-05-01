/**
 * @file OutboxRelay.integration.test.ts
 * @description Integration test for the T4-C concurrent-claim guarantee.
 *   Two `OutboxRelay` instances polling the same DB concurrently must
 *   dispatch each event exactly once across both — never twice. Exercises
 *   the real PostgreSQL `UPDATE ... FOR UPDATE SKIP LOCKED ... RETURNING`
 *   query and the `outbox_inbox` unique constraint together.
 *
 *   Pre-requisite: `pnpm db:up` (Postgres + Redis) so the Prisma client can
 *   connect. The test seeds 100 unpublished events, runs both relays many
 *   poll cycles in parallel, and asserts:
 *     - total dispatch invocations == 100,
 *     - `outbox_inbox` row count == 100,
 *     - every outbox row has `publishedAt IS NOT NULL`,
 *     - no duplicate dispatches (every eventId appears exactly once).
 * @layer infrastructure
 */

import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@infra/prisma";
import { OutboxClaimService } from "../../../src/infrastructure/outbox/OutboxClaimService.js";
import { OutboxBackoff } from "../../../src/infrastructure/outbox/OutboxBackoff.js";
import { OutboxInbox } from "../../../src/infrastructure/outbox/OutboxInbox.js";
import { OutboxRelay } from "../../../src/infrastructure/outbox/OutboxRelay.js";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import type { DomainEvent } from "../../../src/domain/events/DomainEvent.js";

const EVENT_COUNT = 100;
const TEST_TAG = "T4C_INTEGRATION";

describe("OutboxRelay — concurrent claim integration", () => {
  before(async () => {
    await prisma.outboxInbox.deleteMany({});
    await prisma.outboxEvent.deleteMany({ where: { eventType: TEST_TAG } });
  });

  after(async () => {
    await prisma.outboxInbox.deleteMany({});
    await prisma.outboxEvent.deleteMany({ where: { eventType: TEST_TAG } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.outboxInbox.deleteMany({});
    await prisma.outboxEvent.deleteMany({ where: { eventType: TEST_TAG } });
    const now = new Date();
    await prisma.outboxEvent.createMany({
      data: Array.from({ length: EVENT_COUNT }, (_, i) => ({
        id: `t4c-evt-${i}`,
        eventType: TEST_TAG,
        aggregateId: `t4c-agg-${i}`,
        aggregateType: "Post",
        payload: { i } as object,
        version: 1,
        occurredAt: new Date(now.getTime() + i),
        publishedAt: null,
        retryCount: 0,
        maxRetries: 5,
        nextRetryAt: now,
        createdAt: now,
      })),
    });
  });

  afterEach(async () => {
    await prisma.outboxInbox.deleteMany({});
    await prisma.outboxEvent.deleteMany({ where: { eventType: TEST_TAG } });
  });

  it("dispatches each of 100 events exactly once across two concurrent relays", async () => {
    const dispatched: string[] = [];
    const dispatcher = {
      async dispatch(event: DomainEvent): Promise<void> {
        dispatched.push(event.eventId);
      },
      async dispatchAll(events: DomainEvent[]): Promise<void> {
        for (const e of events) await this.dispatch(e);
      },
      register(): void {
        // not used in this test
      },
    };

    const scheduler = new NoopBackgroundTaskScheduler();
    const backoff = new OutboxBackoff();
    const inbox = new OutboxInbox(prisma);

    const makeRelay = (workerId: string): OutboxRelay =>
      new OutboxRelay({
        prisma,
        eventDispatcher: dispatcher,
        scheduler,
        claimService: new OutboxClaimService({ prisma, workerId }),
        backoff,
        inbox,
        consumerId: workerId,
        pollIntervalMs: 100_000,
        batchSize: 25,
        maxRetries: 5,
      });

    const relayA = makeRelay("worker-A");
    const relayB = makeRelay("worker-B");

    // Several concurrent rounds drain the queue. Both relays compete on the
    // same rows; SKIP LOCKED ensures no double-claim.
    for (let i = 0; i < 10; i++) {
      await Promise.all([relayA.poll(), relayB.poll()]);
    }

    assert.strictEqual(dispatched.length, EVENT_COUNT, "dispatch invocations");
    const unique = new Set(dispatched);
    assert.strictEqual(unique.size, EVENT_COUNT, "no duplicate dispatches");

    const inboxRows = await prisma.outboxInbox.findMany({
      where: { messageId: { startsWith: "t4c-evt-" } },
    });
    assert.strictEqual(inboxRows.length, EVENT_COUNT, "outbox_inbox rows");

    const unpublished = await prisma.outboxEvent.count({
      where: { eventType: TEST_TAG, publishedAt: null },
    });
    assert.strictEqual(unpublished, 0, "all rows terminal");

    for (const id of dispatched) {
      assert.ok(id.startsWith("t4c-evt-"), `unexpected eventId: ${id}`);
    }
  });
});
