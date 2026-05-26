/**
 * @file bulkScheduling.test.ts
 * @description Integration tests for the F1-API-3 bulk-scheduling manifest
 *   against the real database: per-row manifest persistence (a bad row never
 *   aborts the batch), batch settling, the read-side status derivation, tenant
 *   isolation, and the import use case end-to-end (parse → validate → persist)
 *   over a real UnitOfWork transaction.
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ok, type Result } from "@shared/types";
import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import type { QueuePort, QueueJob } from "@ports/core";
import { PrismaBulkScheduleBatchRepository } from "../../src/infrastructure/repositories/PrismaBulkScheduleBatchRepository.js";
import { PrismaBulkScheduleQueryRepository } from "../../src/infrastructure/repositories/PrismaBulkScheduleQueryRepository.js";
import { PrismaProjectQueryRepository } from "../../src/infrastructure/repositories/PrismaProjectQueryRepository.js";
import { PrismaUnitOfWork } from "../../src/infrastructure/unitofwork/PrismaUnitOfWork.js";
import { ImportSchedulingCsvUseCase } from "@core/application/bulk-scheduling/ImportSchedulingCsvUseCase.js";

const future = (ms: number): string => new Date(Date.now() + ms).toISOString();
const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;
const HEADER = "provider,content,scheduledFor";

/** Records enqueued jobs without touching Redis. */
function makeStubQueue(): { queue: QueuePort; jobs: QueueJob[] } {
  const jobs: QueueJob[] = [];
  const queue: QueuePort = {
    enqueue: async () => ok("job-1"),
    enqueueBulk: async (
      batch: QueueJob[]
    ): Promise<Result<string[], "CONNECTION_ERROR" | "VALIDATION_ERROR">> => {
      jobs.push(...batch);
      return ok(batch.map((_, i) => `job-${i}`));
    },
    health: async () => ok({ connected: true, waiting: 0, active: 0, completed: 0, failed: 0 }),
    remove: async () => ok(true),
    getJobStates: async () => ok({ completed: 0, failed: 0, pending: 0 }),
  };
  return { queue, jobs };
}

describe("Bulk scheduling manifest integration", () => {
  let prisma: PrismaClient;
  let batchRepo: PrismaBulkScheduleBatchRepository;
  let queryRepo: PrismaBulkScheduleQueryRepository;
  let accountAId: string;
  let projectAId: string;
  let accountBId: string;
  const tag = `bulk-int-${Date.now()}`;
  const batchIds: string[] = [];

  before(async () => {
    prisma = createTestPrismaClient();
    batchRepo = new PrismaBulkScheduleBatchRepository(prisma);
    queryRepo = new PrismaBulkScheduleQueryRepository(prisma);

    const accountA = await prisma.account.create({
      data: { email: `${tag}-a@test.com`, name: "Bulk Account A" },
    });
    accountAId = accountA.id;
    const projectA = await prisma.project.create({
      data: { accountId: accountAId, name: `Bulk Project A ${tag}` },
    });
    projectAId = projectA.id;

    const accountB = await prisma.account.create({
      data: { email: `${tag}-b@test.com`, name: "Bulk Account B" },
    });
    accountBId = accountB.id;
  });

  after(async () => {
    await prisma.bulkScheduleBatch.deleteMany({
      where: { accountId: { in: [accountAId, accountBId] } },
    });
    await prisma.project.deleteMany({ where: { accountId: { in: [accountAId, accountBId] } } });
    await prisma.account.deleteMany({ where: { id: { in: [accountAId, accountBId] } } });
  });

  it("persists a per-row manifest where a bad row does not abort the batch", async () => {
    const batchId = randomUUID();
    batchIds.push(batchId);
    await batchRepo.createBatch({
      id: batchId,
      accountId: accountAId,
      projectId: projectAId,
      totalRows: 2,
      status: "PROCESSING",
      items: [
        { id: randomUUID(), rowNumber: 1, provider: "X", status: "PENDING" },
        {
          id: randomUUID(),
          rowNumber: 2,
          provider: "",
          status: "FAILED",
          errorMessage: "provider: bad",
        },
      ],
    });

    const dto = await queryRepo.getBatch(accountAId, batchId);
    assert.ok(dto, "batch should be readable");
    assert.strictEqual(dto.totalRows, 2);
    assert.strictEqual(dto.items.length, 2);
    assert.strictEqual(dto.status, "PROCESSING", "still processing while a row is PENDING");
    assert.strictEqual(dto.items[0]?.status, "PENDING");
    assert.strictEqual(dto.items[1]?.status, "FAILED");
    assert.strictEqual(dto.items[1]?.errorMessage, "provider: bad");
  });

  it("settles the batch to COMPLETED once the last pending row is terminal", async () => {
    const batchId = randomUUID();
    batchIds.push(batchId);
    const pendingId = randomUUID();
    await batchRepo.createBatch({
      id: batchId,
      accountId: accountAId,
      projectId: projectAId,
      totalRows: 1,
      status: "PROCESSING",
      items: [{ id: pendingId, rowNumber: 1, provider: "X", status: "PENDING" }],
    });

    // Reuse-on-retry: post id persists, item stays PENDING until scheduled.
    await batchRepo.markItemPostCreated(pendingId, "post-xyz");
    const mid = await batchRepo.findItem(pendingId);
    assert.strictEqual(mid?.status, "PENDING");
    assert.strictEqual(mid?.postId, "post-xyz");

    await batchRepo.markItemScheduled(pendingId, "post-xyz");
    await batchRepo.completeBatchIfSettled(batchId);

    const dto = await queryRepo.getBatch(accountAId, batchId);
    assert.strictEqual(dto?.status, "COMPLETED");
    assert.strictEqual(dto?.items[0]?.postId, "post-xyz");
  });

  it("does not leak a batch across tenants", async () => {
    const batchId = batchIds[0];
    assert.ok(batchId);
    const foreign = await queryRepo.getBatch(accountBId, batchId);
    assert.strictEqual(foreign, null, "account B must not read account A's batch");
  });

  it("imports a mixed CSV end-to-end: valid rows PENDING, bad rows FAILED", async () => {
    const projectQueryRepo = new PrismaProjectQueryRepository(prisma);
    const uow = new PrismaUnitOfWork(prisma);
    const { queue, jobs } = makeStubQueue();
    const useCase = new ImportSchedulingCsvUseCase(projectQueryRepo, batchRepo, queue, uow);

    const csv = `${HEADER}\nX,Hello there,${future(TWO_DAYS)}\nMYSPACE,Bad provider,${future(TWO_DAYS)}`;
    const result = await useCase.execute({
      accountId: accountAId,
      projectId: projectAId,
      csv,
    });

    assert.ok(result.ok, "import should succeed");
    batchIds.push(result.value.batchId);
    assert.strictEqual(result.value.totalRows, 2);
    assert.strictEqual(result.value.validRows, 1);
    assert.strictEqual(result.value.invalidRows, 1);
    assert.strictEqual(jobs.length, 1, "one job enqueued for the single valid row");

    const dto = await queryRepo.getBatch(accountAId, result.value.batchId);
    assert.strictEqual(dto?.items.length, 2);
    const pending = dto?.items.filter((i) => i.status === "PENDING") ?? [];
    const failed = dto?.items.filter((i) => i.status === "FAILED") ?? [];
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0]?.provider, "X");
    assert.strictEqual(failed.length, 1);
  });

  it("rejects an import for a project owned by another account", async () => {
    const projectQueryRepo = new PrismaProjectQueryRepository(prisma);
    const uow = new PrismaUnitOfWork(prisma);
    const { queue } = makeStubQueue();
    const useCase = new ImportSchedulingCsvUseCase(projectQueryRepo, batchRepo, queue, uow);

    const csv = `${HEADER}\nX,Hello,${future(TWO_DAYS)}`;
    const result = await useCase.execute({
      accountId: accountBId, // B does not own projectA
      projectId: projectAId,
      csv,
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, "NOT_FOUND");
  });
});
