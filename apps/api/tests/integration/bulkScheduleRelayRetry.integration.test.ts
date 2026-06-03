/**
 * @file bulkScheduleRelayRetry.integration.test.ts
 * @description Integration test for the dispatch handler's throw-to-retry contract.
 *   When the queue is unavailable, the BulkScheduleDispatchEventHandler must throw so
 *   the OutboxRelay leaves the event UNPUBLISHED (to be retried) — never silently
 *   dropping the row. Exercised with an in-memory queue that returns CONNECTION_ERROR
 *   (no real Redis/BullMQ retry loop).
 *
 *   Pre-requisite: `pnpm db:up` (Postgres). In-memory QueuePort (no Redis/BullMQ).
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import { InMemoryEventDispatcher } from "@core/domain/index.js";
import { ConfirmBulkScheduleUseCase } from "@core/bulk-scheduling/ConfirmBulkScheduleUseCase.js";
import type { SchedulingCsvRow } from "@core/bulk-scheduling/schedulingCsv.js";
import { PrismaBulkScheduleBatchRepository } from "../../src/infrastructure/repositories/PrismaBulkScheduleBatchRepository.js";
import { PrismaChannelRepository } from "../../src/infrastructure/repositories/PrismaChannelRepository.js";
import { PrismaUnitOfWork } from "../../src/infrastructure/unitofwork/PrismaUnitOfWork.js";
import { PrismaOutboxWriter } from "../../src/infrastructure/outbox/PrismaOutboxWriter.js";
import { BulkScheduleDispatchEventHandler } from "../../src/bulk-scheduling/BulkScheduleDispatchEventHandler.js";
import {
  makeStubQueue,
  makeRelay,
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
    prisma = createTestPrismaClient();
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
      new PrismaUnitOfWork(prisma)
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

    // Relay poll: the handler throws on the failed enqueue; the relay records the
    // failure and does NOT publish the event.
    await makeRelay(prisma, dispatcher).poll();

    assert.strictEqual(jobs.length, 0, "no job enqueued when the queue is unavailable");

    const event = await prisma.outboxEvent.findFirst({
      where: { aggregateType: "BulkScheduleItem", aggregateId: itemId },
    });
    assert.ok(event, "the outbox event still exists");
    assert.strictEqual(
      event.publishedAt,
      null,
      "the event must NOT be marked published — it will be retried"
    );
  });
});
