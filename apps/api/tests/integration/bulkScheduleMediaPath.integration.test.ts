/**
 * @file bulkScheduleMediaPath.integration.test.ts
 * @description Integration test proving media survives the real bulk-scheduling path
 *   (confirm → outbox in same TX → relay → dispatch → job payload). Beyond the
 *   single-image case in the outbox smoke, this covers a multi-item media row
 *   (image + video) and a text-only row (empty media) confirmed in one batch.
 *
 *   Pre-requisite: `pnpm db:up` (Postgres). Stub QueuePort (no Redis/BullMQ).
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

describe("BulkSchedule media path — integration", () => {
  let prisma: PrismaClient;
  let tenant: SeededTenant;
  const tag = `bulk-media-${Date.now()}`;
  const batchIds: string[] = [];

  before(async () => {
    prisma = createTestPrismaClient();
    tenant = await seedTenant(prisma, tag);
  });

  after(async () => {
    await cleanupTenant(prisma, tenant, batchIds);
    await prisma.$disconnect();
  });

  it("carries typed multi-item media and empty media through confirm → relay → job", async () => {
    const { queue, jobs } = makeStubQueue();
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
        content: "Post with image and video",
        scheduledFor: future(TWO_DAYS),
        timezone: "UTC",
        media: [
          { url: "https://cdn.example.com/photo.jpg", type: "image" },
          { url: "https://cdn.example.com/clip.mp4", type: "video" },
        ],
        tags: [],
      },
      {
        row: 2,
        content: "Text only post",
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
    assert.ok(
      result.ok,
      `confirm should succeed: ${!result.ok ? String(result.error.message) : ""}`
    );
    batchIds.push(result.value.batchId);

    await makeRelay(prisma, dispatcher).poll();

    assert.strictEqual(jobs.length, 2, "one job per confirmed row");

    const findRow = (content: string): Record<string, unknown> => {
      const job = jobs.find(
        (j) => (j.payload as { row: { content: string } }).row.content === content
      );
      assert.ok(job, `job for "${content}" should exist`);
      return (job.payload as { row: Record<string, unknown> }).row;
    };

    assert.deepStrictEqual(findRow("Post with image and video").media, [
      { url: "https://cdn.example.com/photo.jpg", type: "image" },
      { url: "https://cdn.example.com/clip.mp4", type: "video" },
    ]);
    assert.deepStrictEqual(findRow("Text only post").media, []);
  });
});
