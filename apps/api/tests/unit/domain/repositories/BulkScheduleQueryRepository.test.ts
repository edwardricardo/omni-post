/**
 * @file BulkScheduleQueryRepository.test.ts
 * @description Contract tests for the bulk-schedule read port. Exercises an
 *              in-memory reference implementation against the semantics every
 *              adapter must honour: account-scoped reads (tenant isolation),
 *              items ordered by rowNumber, and the all-terminal ⇒ COMPLETED
 *              status derivation. The Prisma adapter is verified against the
 *              same behaviour in the integration suite.
 * @layer infrastructure
 */
import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type {
  BulkScheduleQueryRepository,
  BulkScheduleBatchDTO,
} from "@core/domain/repositories/BulkScheduleQueryRepository.js";

class InMemoryQueryRepo implements BulkScheduleQueryRepository {
  constructor(private readonly batches: BulkScheduleBatchDTO[]) {}

  async getBatch(accountId: string, batchId: string): Promise<BulkScheduleBatchDTO | null> {
    const row = this.batches.find((b) => b.id === batchId && b.accountId === accountId);
    if (!row) return null;
    const items = [...row.items].sort((a, b) => a.rowNumber - b.rowNumber);
    const allTerminal = items.every((i) => i.status !== "PENDING");
    const status = row.status === "PROCESSING" && allTerminal ? "COMPLETED" : row.status;
    return { ...row, status, items };
  }
}

const batch = (over?: Partial<BulkScheduleBatchDTO>): BulkScheduleBatchDTO => ({
  id: "batch-1",
  accountId: "acc-1",
  projectId: "proj-1",
  totalRows: 2,
  status: "PROCESSING",
  createdAt: new Date("2026-05-22T00:00:00Z"),
  updatedAt: new Date("2026-05-22T00:00:00Z"),
  items: [
    {
      id: "i2",
      rowNumber: 2,
      provider: "X",
      status: "SCHEDULED",
      postId: "p2",
      errorMessage: null,
    },
    { id: "i1", rowNumber: 1, provider: "X", status: "FAILED", postId: null, errorMessage: "bad" },
  ],
  ...over,
});

describe("BulkScheduleQueryRepository contract", () => {
  let repo: InMemoryQueryRepo;
  beforeEach(() => {
    repo = new InMemoryQueryRepo([batch()]);
  });

  it("returns null for an unknown batch id", async () => {
    assert.strictEqual(await repo.getBatch("acc-1", "missing"), null);
  });

  it("returns null when the batch belongs to another account (tenant isolation)", async () => {
    assert.strictEqual(await repo.getBatch("other-acc", "batch-1"), null);
  });

  it("returns items ordered by rowNumber", async () => {
    const dto = await repo.getBatch("acc-1", "batch-1");
    assert.deepStrictEqual(
      dto?.items.map((i) => i.rowNumber),
      [1, 2]
    );
  });

  it("derives COMPLETED when all items are terminal but the batch is still PROCESSING", async () => {
    const dto = await repo.getBatch("acc-1", "batch-1");
    assert.strictEqual(dto?.status, "COMPLETED");
  });

  it("keeps PROCESSING while any item is still PENDING", async () => {
    repo = new InMemoryQueryRepo([
      batch({
        items: [
          {
            id: "i1",
            rowNumber: 1,
            provider: "X",
            status: "PENDING",
            postId: null,
            errorMessage: null,
          },
          {
            id: "i2",
            rowNumber: 2,
            provider: "X",
            status: "SCHEDULED",
            postId: "p2",
            errorMessage: null,
          },
        ],
      }),
    ]);
    const dto = await repo.getBatch("acc-1", "batch-1");
    assert.strictEqual(dto?.status, "PROCESSING");
  });
});
