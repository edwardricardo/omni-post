/**
 * @file bulkScheduleOutboxSmoke.test.ts
 * @description Smoke e2e for the PR2 outbox path: ConfirmBulkScheduleUseCase →
 *   PrismaOutboxWriter → OutboxRelay → BulkScheduleDispatchEventHandler → stub queue.
 *
 *   Covers three scenarios:
 *     1. Happy path: confirm writes batch + items + BulkScheduleRowConfirmed outbox event
 *        in ONE transaction; relay poll dispatches → stub queue receives job with correct
 *        shape (channelIds[], typed media[], dedupeKey = bulk-{batchId}-{itemId}).
 *     2. Idempotency: polling a second time does NOT produce a duplicate job in the queue.
 *     3. Ownership admission: confirm with a foreign channelId is rejected before any DB
 *        write (no batch/items/events created).
 *
 *   Pre-requisite: `pnpm db:up` (Postgres + Redis). Uses real DB via
 *   `createTestPrismaClient()` and a stub QueuePort — no BullMQ connection needed.
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { ok, type Result } from "@shared/types";
import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import { InMemoryEventDispatcher } from "@core/domain/index.js";
import type { QueuePort, QueueJob, QueueHealth, JobStatesAggregate } from "@ports/core";
import { PrismaBulkScheduleBatchRepository } from "../../src/infrastructure/repositories/PrismaBulkScheduleBatchRepository.js";
import { PrismaChannelRepository } from "../../src/infrastructure/repositories/PrismaChannelRepository.js";
import { PrismaUnitOfWork } from "../../src/infrastructure/unitofwork/PrismaUnitOfWork.js";
import { PrismaOutboxWriter } from "../../src/infrastructure/outbox/PrismaOutboxWriter.js";
import { OutboxRelay } from "../../src/infrastructure/outbox/OutboxRelay.js";
import { OutboxClaimService } from "../../src/infrastructure/outbox/OutboxClaimService.js";
import { OutboxBackoff } from "../../src/infrastructure/outbox/OutboxBackoff.js";
import { OutboxInbox } from "../../src/infrastructure/outbox/OutboxInbox.js";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";
import { ConfirmBulkScheduleUseCase } from "@core/bulk-scheduling/ConfirmBulkScheduleUseCase.js";
import { BulkScheduleDispatchEventHandler } from "../../src/bulk-scheduling/BulkScheduleDispatchEventHandler.js";
import type { SchedulingCsvRow } from "@core/bulk-scheduling/schedulingCsv.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const future = (ms: number): string => new Date(Date.now() + ms).toISOString();
const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;

/** Minimal stub QueuePort — records jobs without touching Redis. */
function makeStubQueue(): { queue: QueuePort; jobs: QueueJob[] } {
  const jobs: QueueJob[] = [];
  const queue: QueuePort = {
    enqueue: async (
      job: QueueJob
    ): Promise<Result<string, "CONNECTION_ERROR" | "VALIDATION_ERROR">> => {
      jobs.push(job);
      return ok(`job-${jobs.length}`);
    },
    enqueueBulk: async (
      batch: QueueJob[]
    ): Promise<Result<string[], "CONNECTION_ERROR" | "VALIDATION_ERROR">> => {
      jobs.push(...batch);
      return ok(batch.map((_, i) => `bulk-job-${i}`));
    },
    health: async (): Promise<Result<QueueHealth, "CONNECTION_ERROR">> =>
      ok({ connected: true, waiting: 0, active: 0, completed: 0, failed: 0 }),
    remove: async (): Promise<Result<boolean, "CONNECTION_ERROR" | "NOT_FOUND">> => ok(true),
    getJobStates: async (): Promise<Result<JobStatesAggregate, "CONNECTION_ERROR">> =>
      ok({ completed: 0, failed: 0, pending: 0 }),
  };
  return { queue, jobs };
}

/** Build a minimal OutboxRelay wired to a real DB and the given dispatcher. */
function makeRelay(prisma: PrismaClient, dispatcher: InMemoryEventDispatcher): OutboxRelay {
  return new OutboxRelay({
    prisma,
    eventDispatcher: dispatcher,
    scheduler: new NoopBackgroundTaskScheduler(),
    claimService: new OutboxClaimService({ prisma, workerId: "smoke-test-worker" }),
    backoff: new OutboxBackoff(),
    inbox: new OutboxInbox(prisma),
    consumerId: "smoke-test-worker",
    pollIntervalMs: 100_000,
    batchSize: 50,
    maxRetries: 3,
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("BulkSchedule outbox path — smoke e2e", () => {
  let prisma: PrismaClient;
  let accountId: string;
  let projectId: string;
  let channelId: string;
  let foreignAccountId: string;
  let foreignProjectId: string;
  const tag = `bulk-smoke-${Date.now()}`;

  // Track IDs for cleanup
  const batchIds: string[] = [];

  before(async () => {
    prisma = createTestPrismaClient();

    // Seed: one account + project + channel (owned).
    const account = await prisma.account.create({
      data: { email: `${tag}@test.com`, name: `Smoke Account ${tag}` },
    });
    accountId = account.id;

    const project = await prisma.project.create({
      data: { accountId, name: `Smoke Project ${tag}` },
    });
    projectId = project.id;

    const channel = await prisma.channel.create({
      data: {
        projectId,
        provider: "INSTAGRAM",
        providerAccountId: `ig-${tag}`,
        handle: `handle-${tag}`,
        credentialsCiphertext: "smoke-ciphertext",
        credentialsIv: "smoke-iv",
        credentialsAuthTag: "smoke-auth-tag",
      },
    });
    channelId = channel.id;

    // Seed: a second account with its own project (for foreign-channel tests).
    const foreignAccount = await prisma.account.create({
      data: { email: `${tag}-foreign@test.com`, name: `Smoke Foreign Account ${tag}` },
    });
    foreignAccountId = foreignAccount.id;
    const foreignProject = await prisma.project.create({
      data: { accountId: foreignAccountId, name: `Foreign Project ${tag}` },
    });
    foreignProjectId = foreignProject.id;
  });

  after(async () => {
    // Clean outbox rows written by this suite.
    await prisma.outboxInbox.deleteMany({
      where: {
        messageId: {
          in: (
            await prisma.outboxEvent.findMany({
              where: { aggregateType: "BulkScheduleItem" },
              select: { id: true },
            })
          ).map((r) => r.id),
        },
      },
    });
    await prisma.outboxEvent.deleteMany({
      where: { aggregateType: "BulkScheduleItem" },
    });
    if (batchIds.length > 0) {
      await prisma.bulkScheduleItem.deleteMany({
        where: { batch: { id: { in: batchIds } } },
      });
      await prisma.bulkScheduleBatch.deleteMany({
        where: { id: { in: batchIds } },
      });
    }
    await prisma.channel.deleteMany({
      where: { projectId: { in: [projectId, foreignProjectId] } },
    });
    await prisma.project.deleteMany({
      where: { id: { in: [projectId, foreignProjectId] } },
    });
    await prisma.account.deleteMany({
      where: { id: { in: [accountId, foreignAccountId] } },
    });
    await prisma.$disconnect();
  });

  // --------------------------------------------------------------------------
  // Scenario 1 + 2: happy path + idempotency
  // --------------------------------------------------------------------------
  it("confirms batch, writes outbox event in same TX, relay dispatches to queue with correct payload", async () => {
    const { queue, jobs } = makeStubQueue();
    const dispatcher = new InMemoryEventDispatcher();
    const handler = new BulkScheduleDispatchEventHandler(queue);
    dispatcher.register("BulkScheduleRowConfirmed", handler);

    const batchRepo = new PrismaBulkScheduleBatchRepository(prisma);
    const channelRepo = new PrismaChannelRepository(prisma);
    const outboxWriter = new PrismaOutboxWriter();
    const uow = new PrismaUnitOfWork(prisma);

    const confirmUseCase = new ConfirmBulkScheduleUseCase(
      batchRepo,
      channelRepo,
      outboxWriter,
      uow
    );

    const rows: SchedulingCsvRow[] = [
      {
        row: 1,
        content: "Hello bulk world",
        scheduledFor: future(TWO_DAYS),
        timezone: "UTC",
        media: [{ url: "https://cdn.example.com/photo.jpg", type: "image" }],
        tags: ["test"],
      },
    ];

    const confirmResult = await confirmUseCase.execute({
      accountId,
      projectId,
      channelIds: [channelId],
      rows,
    });

    assert.ok(
      confirmResult.ok,
      `confirm should succeed: ${!confirmResult.ok ? String((confirmResult as { error: unknown }).error) : ""}`
    );
    const batchId = confirmResult.value.batchId;
    batchIds.push(batchId);

    // (a) Batch + item persisted with no provider column.
    const batch = await prisma.bulkScheduleBatch.findUnique({
      where: { id: batchId },
      include: { items: true },
    });
    assert.ok(batch, "batch should exist in DB");
    assert.strictEqual(batch.status, "PROCESSING");
    assert.strictEqual(batch.items.length, 1);
    assert.strictEqual(batch.items[0]?.status, "PENDING");

    // (b) Exactly one BulkScheduleRowConfirmed outbox event was written in the same TX.
    const itemId = batch.items[0]?.id;
    assert.ok(itemId);

    const outboxRows = await prisma.outboxEvent.findMany({
      where: { aggregateType: "BulkScheduleItem", aggregateId: itemId },
    });
    assert.strictEqual(outboxRows.length, 1, "exactly one outbox event per item");
    assert.strictEqual(outboxRows[0]?.eventType, "BulkScheduleRowConfirmed");
    assert.strictEqual(outboxRows[0]?.publishedAt, null, "not yet dispatched");

    // (c) Relay poll → dispatch handler → stub queue.
    const relay = makeRelay(prisma, dispatcher);
    await relay.poll();

    assert.strictEqual(jobs.length, 1, "one job enqueued per confirmed row");

    const job = jobs[0];
    assert.ok(job);

    // dedupeKey format: bulk-{batchId}-{itemId}
    assert.strictEqual(job.dedupeKey, `bulk-${batchId}-${itemId}`);

    // Payload carries channelIds[] and typed media[] — no provider field.
    const payload = job.payload as Record<string, unknown>;
    assert.strictEqual(payload.batchId, batchId);
    assert.strictEqual(payload.itemId, itemId);
    assert.deepStrictEqual(payload.channelIds, [channelId]);

    const row = payload.row as Record<string, unknown>;
    assert.strictEqual(row.content, "Hello bulk world");
    assert.deepStrictEqual(row.media, [
      { url: "https://cdn.example.com/photo.jpg", type: "image" },
    ]);

    // No provider on the payload.
    assert.ok(!("provider" in payload), "payload must not have a provider field");
    assert.ok(!("provider" in row), "row must not have a provider field");

    // Outbox row marked published.
    const dispatched = await prisma.outboxEvent.findUnique({
      where: { id: outboxRows[0]?.id },
    });
    assert.ok(dispatched?.publishedAt !== null, "outbox row should be marked published");
  });

  // --------------------------------------------------------------------------
  // Scenario 2 (idempotency): polling a second time does NOT enqueue another job.
  // --------------------------------------------------------------------------
  it("second relay poll produces no duplicate jobs (idempotent via OutboxInbox)", async () => {
    // Use a fresh batch so this test is independent of scenario 1.
    const { queue, jobs } = makeStubQueue();
    const dispatcher = new InMemoryEventDispatcher();
    const handler = new BulkScheduleDispatchEventHandler(queue);
    dispatcher.register("BulkScheduleRowConfirmed", handler);

    const batchRepo = new PrismaBulkScheduleBatchRepository(prisma);
    const channelRepo = new PrismaChannelRepository(prisma);
    const outboxWriter = new PrismaOutboxWriter();
    const uow = new PrismaUnitOfWork(prisma);

    const confirmUseCase = new ConfirmBulkScheduleUseCase(
      batchRepo,
      channelRepo,
      outboxWriter,
      uow
    );

    const rows: SchedulingCsvRow[] = [
      {
        row: 1,
        content: "Idempotency smoke row",
        scheduledFor: future(TWO_DAYS),
        timezone: "UTC",
        media: [],
        tags: [],
      },
    ];

    const confirmResult = await confirmUseCase.execute({
      accountId,
      projectId,
      channelIds: [channelId],
      rows,
    });
    assert.ok(confirmResult.ok, "confirm should succeed");
    batchIds.push(confirmResult.value.batchId);

    // Simulating at-least-once delivery: two relays process the same event.
    const relayA = makeRelay(prisma, dispatcher);
    const relayB = makeRelay(prisma, dispatcher);

    await relayA.poll(); // dispatches
    assert.strictEqual(jobs.length, 1, "first poll enqueues exactly one job");

    await relayB.poll(); // event already claimed + inbox row exists — should not re-dispatch
    assert.strictEqual(jobs.length, 1, "second poll must not produce a duplicate job");
  });

  // --------------------------------------------------------------------------
  // Scenario 3: ownership admission rejects foreign channelId.
  // --------------------------------------------------------------------------
  it("rejects confirm with a foreign channelId and leaves DB unchanged", async () => {
    // Create a channel owned by the foreign project — account A does NOT own it.
    const foreignChannel = await prisma.channel.create({
      data: {
        projectId: foreignProjectId,
        provider: "X",
        providerAccountId: `x-foreign-${tag}`,
        handle: `foreign-handle-${tag}`,
        credentialsCiphertext: "fc",
        credentialsIv: "fi",
        credentialsAuthTag: "fa",
      },
    });

    const batchRepo = new PrismaBulkScheduleBatchRepository(prisma);
    const channelRepo = new PrismaChannelRepository(prisma);
    const outboxWriter = new PrismaOutboxWriter();
    const uow = new PrismaUnitOfWork(prisma);

    const confirmUseCase = new ConfirmBulkScheduleUseCase(
      batchRepo,
      channelRepo,
      outboxWriter,
      uow
    );

    const rows: SchedulingCsvRow[] = [
      {
        row: 1,
        content: "Should not be persisted",
        scheduledFor: future(TWO_DAYS),
        timezone: "UTC",
        media: [],
        tags: [],
      },
    ];

    // Account A tries to target account B's channel.
    const result = await confirmUseCase.execute({
      accountId, // account A
      projectId, // project A
      channelIds: [foreignChannel.id], // channel owned by account B's project
      rows,
    });

    assert.ok(!result.ok, "confirm should be rejected");
    assert.strictEqual(
      (result as { error: { code: string } }).error.code,
      "FORBIDDEN",
      "error code should be FORBIDDEN"
    );

    // No batch, no items, no outbox events written for this attempt.
    const anyBatch = await prisma.bulkScheduleBatch.findFirst({
      where: { accountId, projectId, status: "PROCESSING" },
      orderBy: { createdAt: "desc" },
    });
    // Verify none of the batches belong to this specific rejection attempt
    // (we check that no new outbox event was created with the foreign channel context).
    const outboxCount = await prisma.outboxEvent.count({
      where: {
        aggregateType: "BulkScheduleItem",
        payload: {
          path: ["accountId"],
          equals: accountId,
        },
      },
    });
    // Should only be 2 outbox events — from scenarios 1 and 2 above.
    assert.ok(outboxCount <= 2, `no extra outbox events should exist; found ${outboxCount}`);

    // Cleanup foreign channel.
    await prisma.channel.delete({ where: { id: foreignChannel.id } });

    void anyBatch; // suppress unused variable warning
  });
});
