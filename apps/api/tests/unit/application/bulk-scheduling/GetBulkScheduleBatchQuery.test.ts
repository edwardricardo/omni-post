/**
 * @file GetBulkScheduleBatchQuery.test.ts
 * @description Unit tests for the bulk-schedule manifest read query: found,
 *              NOT_FOUND (absent or foreign-tenant), and INTERNAL_ERROR.
 * @layer infrastructure
 */
import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { GetBulkScheduleBatchQuery } from "@core/application/bulk-scheduling/GetBulkScheduleBatchQuery.js";
import type {
  BulkScheduleQueryRepository,
  BulkScheduleBatchDTO,
} from "../../../../src/domain/repositories/BulkScheduleQueryRepository.js";

const makeBatch = (overrides?: Partial<BulkScheduleBatchDTO>): BulkScheduleBatchDTO => ({
  id: "batch-1",
  accountId: "acc-1",
  projectId: "proj-1",
  totalRows: 2,
  status: "PROCESSING",
  createdAt: new Date("2026-05-22T00:00:00Z"),
  updatedAt: new Date("2026-05-22T00:00:00Z"),
  items: [
    { id: "i1", rowNumber: 1, provider: "X", status: "PENDING", postId: null, errorMessage: null },
  ],
  ...overrides,
});

const makeRepo = (
  getBatch: BulkScheduleQueryRepository["getBatch"]
): BulkScheduleQueryRepository => ({ getBatch: vi.fn(getBatch) });

describe("GetBulkScheduleBatchQuery", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the manifest DTO when the batch exists for the account", async () => {
    const batch = makeBatch();
    const query = new GetBulkScheduleBatchQuery(makeRepo(async () => batch));

    const result = await query.execute({ accountId: "acc-1", batchId: "batch-1" });

    assert.ok(result.ok, "should succeed");
    assert.strictEqual(result.value.id, "batch-1");
    assert.strictEqual(result.value.items.length, 1);
  });

  it("returns NOT_FOUND when the batch is absent or owned by another account", async () => {
    const query = new GetBulkScheduleBatchQuery(makeRepo(async () => null));

    const result = await query.execute({ accountId: "acc-1", batchId: "missing" });

    assert.ok(!result.ok, "should fail");
    assert.strictEqual(result.error.code, "NOT_FOUND");
  });

  it("scopes the read to the caller's account", async () => {
    const getBatch = vi.fn(async () => null);
    const query = new GetBulkScheduleBatchQuery({ getBatch });

    await query.execute({ accountId: "acc-9", batchId: "batch-1" });

    assert.deepStrictEqual(getBatch.mock.calls[0], ["acc-9", "batch-1"]);
  });

  it("returns INTERNAL_ERROR when the repository throws", async () => {
    const query = new GetBulkScheduleBatchQuery(
      makeRepo(async () => {
        throw new Error("db down");
      })
    );

    const result = await query.execute({ accountId: "acc-1", batchId: "batch-1" });

    assert.ok(!result.ok, "should fail");
    assert.strictEqual(result.error.code, "INTERNAL_ERROR");
  });
});
