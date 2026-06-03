/**
 * @file bulkScheduleHarness.ts
 * @description Shared test harness for the bulk-scheduling integration tests.
 *   Provides a stub QueuePort (records jobs in-memory, no Redis/BullMQ), a minimal
 *   OutboxRelay wired to a real DB, and tenant seeding/cleanup helpers. Keeping these
 *   in one place avoids duplicating the scaffolding across the outbox-smoke,
 *   reconciliation, media-path, and relay-retry suites.
 * @layer infrastructure
 */

import { ok, err, type Result } from "@shared/types";
import type { PrismaClient } from "@infra/prisma";
import type { InMemoryEventDispatcher } from "@core/domain/index.js";
import type { QueuePort, QueueJob, QueueHealth, JobStatesAggregate } from "@ports/core";
import { OutboxRelay } from "../../../src/infrastructure/outbox/OutboxRelay.js";
import { OutboxClaimService } from "../../../src/infrastructure/outbox/OutboxClaimService.js";
import { OutboxBackoff } from "../../../src/infrastructure/outbox/OutboxBackoff.js";
import { OutboxInbox } from "../../../src/infrastructure/outbox/OutboxInbox.js";
import { NoopBackgroundTaskScheduler } from "@observability/background-scheduler";

/** A queue error code the stub can be told to fail with. */
type QueueError = "CONNECTION_ERROR" | "VALIDATION_ERROR";

/**
 * @function makeStubQueue
 * @description Minimal in-memory QueuePort — records enqueued jobs without touching
 *   Redis. Pass `{ failWith }` to make every enqueue return an error (used to exercise
 *   the dispatch handler's throw-to-retry path without a real broker).
 * @param options - `failWith` forces enqueue/enqueueBulk to return `err(code)`.
 * @returns The stub `queue` plus the `jobs` array it records into.
 */
export function makeStubQueue(options?: { failWith?: QueueError }): {
  queue: QueuePort;
  jobs: QueueJob[];
} {
  const jobs: QueueJob[] = [];
  const fail = options?.failWith;
  const queue: QueuePort = {
    enqueue: async (job: QueueJob): Promise<Result<string, QueueError>> => {
      if (fail) return err(fail);
      jobs.push(job);
      return ok(`job-${jobs.length}`);
    },
    enqueueBulk: async (batch: QueueJob[]): Promise<Result<string[], QueueError>> => {
      if (fail) return err(fail);
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

/**
 * @function makeRelay
 * @description Builds an OutboxRelay bound to a real DB and the given dispatcher,
 *   with a long poll interval so `poll()` is only driven manually by the test.
 * @param prisma - Real test PrismaClient.
 * @param dispatcher - In-memory event dispatcher the relay routes events to.
 * @returns A configured OutboxRelay.
 */
export function makeRelay(prisma: PrismaClient, dispatcher: InMemoryEventDispatcher): OutboxRelay {
  return new OutboxRelay({
    prisma,
    eventDispatcher: dispatcher,
    scheduler: new NoopBackgroundTaskScheduler(),
    claimService: new OutboxClaimService({ prisma, workerId: "harness-worker" }),
    backoff: new OutboxBackoff(),
    inbox: new OutboxInbox(prisma),
    consumerId: "harness-worker",
    pollIntervalMs: 100_000,
    batchSize: 50,
    maxRetries: 3,
  });
}

/** Ids of a seeded tenant (one owned account/project/channel + a foreign account/project). */
export interface SeededTenant {
  accountId: string;
  projectId: string;
  channelId: string;
  foreignAccountId: string;
  foreignProjectId: string;
}

/**
 * @function seedTenant
 * @description Creates one account + project + Instagram channel (the owned target) plus a
 *   second account + project (for foreign-channel scenarios). Returns their ids.
 * @param prisma - Real test PrismaClient.
 * @param tag - Unique suffix to isolate this suite's rows.
 * @returns The seeded ids.
 */
export async function seedTenant(prisma: PrismaClient, tag: string): Promise<SeededTenant> {
  const account = await prisma.account.create({
    data: { email: `${tag}@test.com`, name: `Harness Account ${tag}` },
  });
  const project = await prisma.project.create({
    data: { accountId: account.id, name: `Harness Project ${tag}` },
  });
  const channel = await prisma.channel.create({
    data: {
      projectId: project.id,
      provider: "INSTAGRAM",
      providerAccountId: `ig-${tag}`,
      handle: `handle-${tag}`,
      credentialsCiphertext: "harness-ciphertext",
      credentialsIv: "harness-iv",
      credentialsAuthTag: "harness-auth-tag",
    },
  });
  const foreignAccount = await prisma.account.create({
    data: { email: `${tag}-foreign@test.com`, name: `Harness Foreign Account ${tag}` },
  });
  const foreignProject = await prisma.project.create({
    data: { accountId: foreignAccount.id, name: `Harness Foreign Project ${tag}` },
  });
  return {
    accountId: account.id,
    projectId: project.id,
    channelId: channel.id,
    foreignAccountId: foreignAccount.id,
    foreignProjectId: foreignProject.id,
  };
}

/**
 * @function cleanupTenant
 * @description Removes all rows a suite created: BulkScheduleItem outbox events + inbox,
 *   the given batches, and the seeded tenant. Safe to call in `after`.
 * @param prisma - Real test PrismaClient.
 * @param tenant - The seeded ids.
 * @param batchIds - Batch ids created during the suite.
 */
export async function cleanupTenant(
  prisma: PrismaClient,
  tenant: SeededTenant,
  batchIds: string[]
): Promise<void> {
  const events = await prisma.outboxEvent.findMany({
    where: { aggregateType: "BulkScheduleItem" },
    select: { id: true },
  });
  await prisma.outboxInbox.deleteMany({ where: { messageId: { in: events.map((e) => e.id) } } });
  await prisma.outboxEvent.deleteMany({ where: { aggregateType: "BulkScheduleItem" } });
  await prisma.outboxDeadLetter.deleteMany({ where: { aggregateType: "BulkScheduleItem" } });
  if (batchIds.length > 0) {
    await prisma.bulkScheduleItem.deleteMany({ where: { batch: { id: { in: batchIds } } } });
    await prisma.bulkScheduleBatch.deleteMany({ where: { id: { in: batchIds } } });
  }
  await prisma.channel.deleteMany({
    where: { projectId: { in: [tenant.projectId, tenant.foreignProjectId] } },
  });
  await prisma.project.deleteMany({
    where: { id: { in: [tenant.projectId, tenant.foreignProjectId] } },
  });
  await prisma.account.deleteMany({
    where: { id: { in: [tenant.accountId, tenant.foreignAccountId] } },
  });
}
