/**
 * @file bulkScheduling.test.ts
 * @description Integration tests for the bulk-scheduling manifest against the
 *   real database: per-row manifest persistence (a bad row never aborts the
 *   batch), batch settling, the read-side status derivation, and tenant isolation.
 *
 *   End-to-end outbox path tests (confirm → relay → dispatch → queue) live in
 *   bulkScheduleOutboxSmoke.test.ts which covers the new 2-phase flow.
 * @layer infrastructure
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTestPrismaClient } from "@infra/prisma";
import type { PrismaClient } from "@infra/prisma";
import { PrismaBulkScheduleBatchRepository } from "../../src/infrastructure/repositories/PrismaBulkScheduleBatchRepository.js";
import { PrismaBulkScheduleQueryRepository } from "../../src/infrastructure/repositories/PrismaBulkScheduleQueryRepository.js";

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
    await prisma.$disconnect();
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
        { id: randomUUID(), rowNumber: 1, status: "PENDING" },
        {
          id: randomUUID(),
          rowNumber: 2,
          status: "FAILED",
          errorMessage: "scheduledFor: invalid date",
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
    assert.strictEqual(dto.items[1]?.errorMessage, "scheduledFor: invalid date");
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
      items: [{ id: pendingId, rowNumber: 1, status: "PENDING" }],
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
});
