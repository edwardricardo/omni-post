/**
 * @file bulkScheduleRelayRetry.integration.test.ts
 * @description Integration test for the dispatch handler's throw-to-retry contract.
 *   When the queue is unavailable, the BulkScheduleDispatchEventHandler must throw so
 *   the OutboxRelay leaves the event UNPUBLISHED (to be retried) — never silently
 *   dropping the row. Exercised with an in-memory queue that returns CONNECTION_ERROR
 *   (no real Redis/BullMQ retry loop). The test polls until the relay has attempted its
 *   own event and asserts the retry state the relay records — one attempt, the claim
 *   released, the retry rescheduled, no dead letter — so it cannot pass on a poll that
 *   never reached the event.
 *
 *   Pre-requisite: `pnpm db:up` (Postgres). In-memory QueuePort (no Redis/BullMQ).
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@infra/prisma";
import { InMemoryEventDispatcher } from "@core/domain/index.js";
import { ConfirmBulkScheduleUseCase } from "@core/bulk-scheduling/ConfirmBulkScheduleUseCase.js";
import type { SchedulingCsvRow } from "@core/bulk-scheduling/schedulingCsv.js";
import { PrismaBulkScheduleBatchRepository } from "../../src/infrastructure/repositories/PrismaBulkScheduleBatchRepository.js";
import { PrismaChannelRepository } from "../../src/infrastructure/repositories/PrismaChannelRepository.js";
import { PrismaUnitOfWork, PrismaOutboxWriter } from "@adapters/db-prisma";
import { ambientTenantContextProvider } from "../../src/security/tenantContext.js";
import { BulkScheduleDispatchEventHandler } from "../../src/bulk-scheduling/BulkScheduleDispatchEventHandler.js";
import { createSeedPrismaClient } from "./helpers/seedPrismaClient.js";
import {
  makeStubQueue,
  makeRelay,
  pollUntilBatchEvents,
  seedTenant,
  cleanupTenant,
  type SeededTenant,
} from "./helpers/bulkScheduleHarness.js";

const future = (ms: number): string => new Date(Date.now() + ms).toISOString();
const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;

describe("BulkSchedule relay retry on enqueue failure — integration", () => {
  let prisma: PrismaClient;
  let tenant: SeededTenant;
  const tag = `bulk-retry-${Date.now()}`;
  const batchIds: string[] = [];

  before(async () => {
    prisma = createSeedPrismaClient();
    tenant = await seedTenant(prisma, tag);
  });

  after(async () => {
    await cleanupTenant(prisma, tenant, batchIds);
    await prisma.$disconnect();
  });

  it("leaves the outbox event unpublished when the queue is unavailable", async () => {
    // A failing queue (returns CONNECTION_ERROR) drives the handler's throw-to-retry path.
    const { queue, jobs } = makeStubQueue({ failWith: "CONNECTION_ERROR" });
    const dispatcher = new InMemoryEventDispatcher();
    dispatcher.register("BulkScheduleRowConfirmed", new BulkScheduleDispatchEventHandler(queue));

    const confirmUseCase = new ConfirmBulkScheduleUseCase(
      new PrismaBulkScheduleBatchRepository(prisma),
      new PrismaChannelRepository(prisma),
      new PrismaOutboxWriter(),
      new PrismaUnitOfWork(prisma, ambientTenantContextProvider)
    );

    const rows: SchedulingCsvRow[] = [
      {
        row: 1,
        content: "Will not enqueue",
        scheduledFor: future(TWO_DAYS),
        timezone: "UTC",
        media: [],
        tags: [],
      },
    ];

    const result = await confirmUseCase.execute({
      accountId: tenant.accountId,
      projectId: tenant.projectId,
      channelIds: [tenant.channelId],
      rows,
    });
    assert.ok(result.ok, "confirm should succeed (the failure happens at dispatch, not confirm)");
    const batchId = result.value.batchId;
    batchIds.push(batchId);

    const batch = await prisma.bulkScheduleBatch.findUnique({
      where: { id: batchId },
      include: { items: true },
    });
    const itemId = batch?.items[0]?.id;
    assert.ok(itemId);

    // Relay polls: the handler throws on the failed enqueue; the relay records the
    // failure and does NOT publish the event. One poll is not enough: the claim takes
    // the oldest eligible events first, so a poll can be spent on rows an earlier suite
    // left behind and never attempt this one, and a test that read the row after it
    // would see `publishedAt` null without the retry path having run. The relay polls
    // until the event shows an attempt, published or released for a retry.
    const attemptsFrom = new Date();
    const events = await pollUntilBatchEvents(prisma, makeRelay(prisma, dispatcher), batchId, {
      settled: (row) => row.retryCount > 0 || row.publishedAt !== null,
      state: "attempted by the relay",
    });

    assert.strictEqual(jobs.length, 0, "no job enqueued when the queue is unavailable");

    assert.strictEqual(events.length, 1, "the outbox event still exists");
    const [event] = events;
    assert.ok(event);
    assert.strictEqual(
      event.publishedAt,
      null,
      "the event must NOT be marked published — it will be retried"
    );
    assert.strictEqual(event.retryCount, 1, "the failed dispatch is recorded as one attempt");
    assert.strictEqual(event.claimedAt, null, "the claim is released so a later poll retries it");
    assert.strictEqual(event.claimedBy, null, "no worker holds the released event");
    assert.ok(
      event.nextRetryAt.getTime() >= attemptsFrom.getTime(),
      "the retry is rescheduled by the backoff from the failed attempt"
    );
    assert.strictEqual(
      await prisma.outboxDeadLetter.count({ where: { aggregateId: itemId } }),
      0,
      "a first failure is retried, never dead-lettered"
    );
  });
});
