/**
 * @file BulkScheduleBatchRepository.test.ts
 * @description Contract tests for the bulk-schedule command port. Exercises an
 *              in-memory reference implementation against the semantics every
 *              adapter must honour: atomic batch creation, idempotency-guard
 *              reads, post-id reuse, terminal marks, and batch settling. The
 *              Prisma adapter is verified against the same behaviour in the
 *              integration suite.
 * @layer infrastructure
 */
import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import type {
  BulkScheduleBatchRepository,
  BulkScheduleItemState,
  BulkScheduleItemStatus,
  NewBulkScheduleBatch,
} from "@core/domain/repositories/BulkScheduleBatchRepository.js";

interface ItemRow {
  batchId: string;
  rowNumber: number;
  provider: string;
  status: BulkScheduleItemStatus;
  postId: string | null;
  errorMessage: string | null;
}

class InMemoryBatchRepo implements BulkScheduleBatchRepository {
  readonly batchStatus = new Map<string, "PROCESSING" | "COMPLETED">();
  readonly items = new Map<string, ItemRow>();

  async createBatch(batch: NewBulkScheduleBatch): Promise<void> {
    this.batchStatus.set(batch.id, batch.status);
    for (const item of batch.items) {
      this.items.set(item.id, {
        batchId: batch.id,
        rowNumber: item.rowNumber,
        provider: item.provider,
        status: item.status,
        postId: null,
        errorMessage: item.errorMessage ?? null,
      });
    }
  }

  async findItem(itemId: string): Promise<BulkScheduleItemState | null> {
    const row = this.items.get(itemId);
    if (!row) return null;
    return { id: itemId, batchId: row.batchId, status: row.status, postId: row.postId };
  }

  async markItemPostCreated(itemId: string, postId: string): Promise<void> {
    const row = this.items.get(itemId);
    if (row) row.postId = postId;
  }

  async markItemScheduled(itemId: string, postId: string): Promise<void> {
    const row = this.items.get(itemId);
    if (row) {
      row.status = "SCHEDULED";
      row.postId = postId;
    }
  }

  async markItemFailed(itemId: string, errorMessage: string): Promise<void> {
    const row = this.items.get(itemId);
    if (row) {
      row.status = "FAILED";
      row.errorMessage = errorMessage;
    }
  }

  async completeBatchIfSettled(batchId: string): Promise<void> {
    const anyPending = [...this.items.values()].some(
      (r) => r.batchId === batchId && r.status === "PENDING"
    );
    if (!anyPending && this.batchStatus.get(batchId) === "PROCESSING") {
      this.batchStatus.set(batchId, "COMPLETED");
    }
  }
}

const newBatch = (): NewBulkScheduleBatch => ({
  id: "batch-1",
  accountId: "acc-1",
  projectId: "proj-1",
  totalRows: 2,
  status: "PROCESSING",
  items: [
    { id: "ok-1", rowNumber: 1, provider: "X", status: "PENDING" },
    { id: "bad-2", rowNumber: 2, provider: "", status: "FAILED", errorMessage: "provider: bad" },
  ],
});

describe("BulkScheduleBatchRepository contract", () => {
  let repo: InMemoryBatchRepo;
  beforeEach(() => {
    repo = new InMemoryBatchRepo();
  });

  it("persists the batch and all its items on createBatch", async () => {
    await repo.createBatch(newBatch());
    assert.strictEqual(repo.batchStatus.get("batch-1"), "PROCESSING");
    assert.strictEqual((await repo.findItem("ok-1"))?.status, "PENDING");
    assert.strictEqual((await repo.findItem("bad-2"))?.status, "FAILED");
  });

  it("returns null from findItem for an unknown id", async () => {
    await repo.createBatch(newBatch());
    assert.strictEqual(await repo.findItem("nope"), null);
  });

  it("records the post id without leaving PENDING (reuse on retry)", async () => {
    await repo.createBatch(newBatch());
    await repo.markItemPostCreated("ok-1", "post-1");
    const state = await repo.findItem("ok-1");
    assert.strictEqual(state?.postId, "post-1");
    assert.strictEqual(state?.status, "PENDING");
  });

  it("does not settle the batch while an item is still PENDING", async () => {
    await repo.createBatch(newBatch());
    await repo.completeBatchIfSettled("batch-1");
    assert.strictEqual(repo.batchStatus.get("batch-1"), "PROCESSING");
  });

  it("settles the batch once every item is terminal", async () => {
    await repo.createBatch(newBatch());
    await repo.markItemScheduled("ok-1", "post-1");
    await repo.completeBatchIfSettled("batch-1");
    assert.strictEqual(repo.batchStatus.get("batch-1"), "COMPLETED");
  });

  it("marks an item FAILED with its reason", async () => {
    await repo.createBatch(newBatch());
    await repo.markItemFailed("ok-1", "no channel");
    const state = await repo.findItem("ok-1");
    assert.strictEqual(state?.status, "FAILED");
  });
});
