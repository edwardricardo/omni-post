/**
 * @file FailBulkScheduleRowUseCase.test.ts
 * @description Unit tests for recording a row's terminal failure: marks the
 *              item FAILED, settles the batch, and maps a write throw to
 *              INTERNAL_ERROR.
 * @layer infrastructure
 */
import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { FailBulkScheduleRowUseCase } from "../../../../src/application/bulk-scheduling/FailBulkScheduleRowUseCase.js";
import type { BulkScheduleBatchRepository } from "../../../../src/domain/repositories/BulkScheduleBatchRepository.js";
import type { UnitOfWork } from "../../../../src/domain/repositories/Repository.js";

const passthroughUow: UnitOfWork = { executeInTransaction: async (fn) => fn() };

const makeBatchRepo = (
  overrides?: Partial<BulkScheduleBatchRepository>
): BulkScheduleBatchRepository => ({
  createBatch: vi.fn(async () => {}),
  findItem: vi.fn(async () => null),
  markItemPostCreated: vi.fn(async () => {}),
  markItemScheduled: vi.fn(async () => {}),
  markItemFailed: vi.fn(async () => {}),
  completeBatchIfSettled: vi.fn(async () => {}),
  ...overrides,
});

describe("FailBulkScheduleRowUseCase", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marks the item FAILED and settles the batch", async () => {
    const repo = makeBatchRepo();
    const uc = new FailBulkScheduleRowUseCase(repo, passthroughUow);

    const result = await uc.execute({ batchId: "b1", itemId: "i1", reason: "boom" });

    assert.ok(result.ok);
    assert.deepStrictEqual((repo.markItemFailed as ReturnType<typeof vi.fn>).mock.calls[0], [
      "i1",
      "boom",
    ]);
    assert.deepStrictEqual(
      (repo.completeBatchIfSettled as ReturnType<typeof vi.fn>).mock.calls[0],
      ["b1"]
    );
  });

  it("returns INTERNAL_ERROR when the write throws", async () => {
    const repo = makeBatchRepo({
      markItemFailed: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    const uc = new FailBulkScheduleRowUseCase(repo, passthroughUow);

    const result = await uc.execute({ batchId: "b1", itemId: "i1", reason: "boom" });

    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, "INTERNAL_ERROR");
  });
});
