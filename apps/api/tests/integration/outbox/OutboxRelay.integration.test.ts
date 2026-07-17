/**
 * @file OutboxRelay.integration.test.ts
 * @description Integration test for the deterministic-drain guarantee under
 *   concurrency. Two `OutboxRelay` instances polling the same DB must drain a
 *   seeded backlog to terminal (published) state for every event, dispatching
 *   each event at least once and each DISTINCT event exactly by identity —
 *   at-least-once transport, no loss, no stuck rows. Exercises the real
 *   PostgreSQL `UPDATE ... FOR UPDATE SKIP LOCKED ... RETURNING` claim query
 *   and the atomic dispatch→markPublished terminal write.
 *
 *   Fixture isolation: the outbox table is process-global, so any OTHER relay
 *   pointed at the same DB (e.g. a locally running `pnpm dev:api`, or a second
 *   test) would compete for these rows and make the drain assertions flaky. To
 *   stay deterministic on a shared DB, the fixture seeds each event as already
 *   leased `PRECLAIM_AGE_MS` in the past by a sentinel worker. A production
 *   relay's default 5-minute lease treats such a recent claim as LIVE and skips
 *   the row (SKIP LOCKED + `claimedAt < leaseExpiry`), while THIS test's relays
 *   use an aggressive short lease (`TEST_LEASE_MS`) that makes the same rows
 *   immediately re-claimable. The two test relays still race each other via
 *   SKIP LOCKED — the concurrency under test is real; only foreign pollers are
 *   fenced out.
 *
 *   Pre-requisite: `pnpm db:up` (Postgres + Redis) so the Prisma client can
 *   connect. The test seeds 100 events, runs both relays many poll cycles in
 *   parallel, and asserts:
 *     - total dispatch invocations >= 100 (at-least-once),
 *     - distinct dispatched eventIds == 100 (every event delivered),
 *     - every seeded row has `publishedAt IS NOT NULL` (drain terminated).
 * @layer infrastructure
 */

import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@infra/prisma";
import { OutboxClaimService } from "../../../src/infrastructure/outbox/OutboxClaimService.js";
import { OutboxBackoff } from "../../../src/infrastructure/outbox/OutboxBackoff.js";
import { OutboxRelay } from "../../../src/infrastructure/outbox/OutboxRelay.js";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import type { DomainEvent } from "@core/domain/events/DomainEvent.js";

const EVENT_COUNT = 100;
const TEST_TAG = "T4C_INTEGRATION";
/** Seed each fixture row as leased this long ago (fences out 5-min-lease relays). */
const PRECLAIM_AGE_MS = 60_000;
/** The test relays reclaim any lease older than this — well below PRECLAIM_AGE_MS. */
const TEST_LEASE_MS = 30_000;

describe("OutboxRelay — concurrent drain integration", () => {
  before(async () => {
    await prisma.outboxEvent.deleteMany({ where: { eventType: TEST_TAG } });
  });

  after(async () => {
    await prisma.outboxEvent.deleteMany({ where: { eventType: TEST_TAG } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.outboxEvent.deleteMany({ where: { eventType: TEST_TAG } });
    const now = new Date();
    const preclaimedAt = new Date(now.getTime() - PRECLAIM_AGE_MS);
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
        // Pre-leased in the past by a sentinel: a foreign relay's 5-min lease
        // treats this as live and skips it; this test's short lease reclaims it.
        claimedAt: preclaimedAt,
        claimedBy: "seed-preclaim",
        createdAt: now,
      })),
    });
  });

  afterEach(async () => {
    await prisma.outboxEvent.deleteMany({ where: { eventType: TEST_TAG } });
  });

  it("drains 100 events under two concurrent relays: each dispatched >= once, each distinct once, all published", async () => {
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

    const makeRelay = (workerId: string): OutboxRelay =>
      new OutboxRelay({
        prisma,
        eventDispatcher: dispatcher,
        scheduler,
        claimService: new OutboxClaimService({ prisma, workerId, leaseDurationMs: TEST_LEASE_MS }),
        backoff,
        pollIntervalMs: 100_000,
        batchSize: 25,
        maxRetries: 5,
      });

    const relayA = makeRelay("worker-A");
    const relayB = makeRelay("worker-B");

    // Several concurrent rounds drain the queue. Both relays compete on the
    // same rows; SKIP LOCKED ensures no double-claim of a live-leased row.
    for (let i = 0; i < 10; i++) {
      await Promise.all([relayA.poll(), relayB.poll()]);
    }

    // At-least-once: every event dispatched, no loss, no stuck rows.
    assert.ok(
      dispatched.length >= EVENT_COUNT,
      `dispatch invocations should be >= ${EVENT_COUNT}, got ${dispatched.length}`
    );
    const unique = new Set(dispatched);
    assert.strictEqual(unique.size, EVENT_COUNT, "every distinct event dispatched");

    const unpublished = await prisma.outboxEvent.count({
      where: { eventType: TEST_TAG, publishedAt: null },
    });
    assert.strictEqual(unpublished, 0, "all rows terminal (drain terminated)");

    for (const id of dispatched) {
      assert.ok(id.startsWith("t4c-evt-"), `unexpected eventId: ${id}`);
    }
  });
});
