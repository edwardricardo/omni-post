/**
 * @file ProcessBulkScheduleRowUseCase.test.ts
 * @description Unit tests for the per-row worker use case: happy path, the
 *              deterministic-vs-transient failure split, idempotency (terminal
 *              item skip + post reuse on retry), and the empty-channelIds case.
 *              Updated to use the new job payload shape: channelIds[] + typed
 *              media[] (no provider fan-out, no findByProjectAndProvider).
 * @layer infrastructure
 */
import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import { UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import { ProcessBulkScheduleRowUseCase } from "@core/bulk-scheduling/ProcessBulkScheduleRowUseCase.js";
import type {
  BulkScheduleBatchRepository,
  BulkScheduleItemState,
} from "@core/domain/repositories/BulkScheduleBatchRepository.js";
import type { PostCreationPort } from "@ports/core";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

const PROJECT_ID = "550e8400-e29b-41d4-a716-446655440000";
const passthroughUow: UnitOfWork = { executeInTransaction: async (fn) => fn() };

const makeBatchRepo = (item: BulkScheduleItemState | null): BulkScheduleBatchRepository => ({
  createBatch: vi.fn(async () => {}),
  findItem: vi.fn(async () => item),
  markItemPostCreated: vi.fn(async () => {}),
  markItemScheduled: vi.fn(async () => {}),
  markItemFailed: vi.fn(async () => {}),
  completeBatchIfSettled: vi.fn(async () => {}),
});

const makePostCreation = (
  createImpl: PostCreationPort["createPost"],
  scheduleImpl: PostCreationPort["schedulePost"]
): PostCreationPort => ({
  createPost: vi.fn(createImpl),
  schedulePost: vi.fn(scheduleImpl),
});

const createOk: PostCreationPort["createPost"] = async () => ok({ id: "post-1" });

const scheduleOk: PostCreationPort["schedulePost"] = async () =>
  ok({ id: "post-1", scheduledFor: "2026-06-01T00:00:00Z" });

const input = (overrides?: { channelIds?: string[] }) => ({
  batchId: "batch-1",
  itemId: "item-1",
  accountId: "acc-1",
  projectId: PROJECT_ID,
  channelIds: overrides?.channelIds ?? ["ch-001"],
  row: {
    content: "Hello",
    scheduledFor: "2026-06-01T00:00:00Z",
    timezone: "UTC",
    media: [] as Array<{ url: string; type: "image" | "video" | "gif" }>,
    tags: [] as string[],
  },
});

const pendingItem = (postId: string | null = null): BulkScheduleItemState => ({
  id: "item-1",
  batchId: "batch-1",
  status: "PENDING",
  postId,
});

describe("ProcessBulkScheduleRowUseCase", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates + schedules the post and marks the item SCHEDULED", async () => {
    const batchRepo = makeBatchRepo(pendingItem());
    const uc = new ProcessBulkScheduleRowUseCase(
      batchRepo,
      makePostCreation(createOk, scheduleOk),
      passthroughUow
    );

    const result = await uc.execute(input());

    assert.ok(result.ok, "should succeed");
    assert.strictEqual(result.value.status, "SCHEDULED");
    assert.strictEqual(result.value.postId, "post-1");
    assert.strictEqual(
      (batchRepo.markItemPostCreated as ReturnType<typeof vi.fn>).mock.calls.length,
      1
    );
    assert.strictEqual(
      (batchRepo.markItemScheduled as ReturnType<typeof vi.fn>).mock.calls.length,
      1
    );
    assert.strictEqual(
      (batchRepo.completeBatchIfSettled as ReturnType<typeof vi.fn>).mock.calls.length,
      1
    );
  });

  it("passes channelIds to schedulePost directly (no findByProjectAndProvider)", async () => {
    const batchRepo = makeBatchRepo(pendingItem());
    const postCreation = makePostCreation(createOk, scheduleOk);
    const uc = new ProcessBulkScheduleRowUseCase(batchRepo, postCreation, passthroughUow);

    await uc.execute(input({ channelIds: ["ch-abc", "ch-def"] }));

    const scheduleArgs = (postCreation.schedulePost as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as {
      channelIds: string[];
    };
    assert.deepStrictEqual(scheduleArgs?.channelIds, ["ch-abc", "ch-def"]);
  });

  it("marks the item FAILED (no retry) when channelIds is empty", async () => {
    const batchRepo = makeBatchRepo(pendingItem());
    const postCreation = makePostCreation(createOk, scheduleOk);
    const uc = new ProcessBulkScheduleRowUseCase(batchRepo, postCreation, passthroughUow);

    const result = await uc.execute(input({ channelIds: [] }));

    assert.ok(result.ok, "deterministic failure returns ok(FAILED)");
    assert.strictEqual(result.value.status, "FAILED");
    assert.strictEqual((batchRepo.markItemFailed as ReturnType<typeof vi.fn>).mock.calls.length, 1);
    assert.strictEqual((postCreation.createPost as ReturnType<typeof vi.fn>).mock.calls.length, 0);
  });

  it("passes typed media[] to createPost", async () => {
    const batchRepo = makeBatchRepo(pendingItem());
    const postCreation = makePostCreation(createOk, scheduleOk);
    const uc = new ProcessBulkScheduleRowUseCase(batchRepo, postCreation, passthroughUow);

    const inputWithMedia = {
      ...input(),
      row: {
        ...input().row,
        media: [{ url: "https://cdn.example.com/photo.jpg", type: "image" as const }],
      },
    };

    await uc.execute(inputWithMedia);

    const createArgs = (postCreation.createPost as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      media: Array<{ url: string; type: string }>;
    };
    assert.deepStrictEqual(createArgs?.media, [
      { url: "https://cdn.example.com/photo.jpg", type: "image" },
    ]);
  });

  it("marks the item FAILED when CreatePost returns a deterministic error", async () => {
    const batchRepo = makeBatchRepo(pendingItem());
    const uc = new ProcessBulkScheduleRowUseCase(
      batchRepo,
      makePostCreation(
        async () => err(new UseCaseError("bad body", USE_CASE_ERRORS.VALIDATION_FAILED)),
        scheduleOk
      ),
      passthroughUow
    );

    const result = await uc.execute(input());

    assert.ok(result.ok);
    assert.strictEqual(result.value.status, "FAILED");
    assert.strictEqual((batchRepo.markItemFailed as ReturnType<typeof vi.fn>).mock.calls.length, 1);
  });

  it("returns INTERNAL_ERROR (transient, no FAILED mark) when CreatePost fails internally", async () => {
    const batchRepo = makeBatchRepo(pendingItem());
    const uc = new ProcessBulkScheduleRowUseCase(
      batchRepo,
      makePostCreation(
        async () => err(new UseCaseError("db down", USE_CASE_ERRORS.INTERNAL_ERROR)),
        scheduleOk
      ),
      passthroughUow
    );

    const result = await uc.execute(input());

    assert.ok(!result.ok, "transient failure surfaces as an error for the worker to retry");
    assert.strictEqual(result.error.code, "INTERNAL_ERROR");
    assert.strictEqual((batchRepo.markItemFailed as ReturnType<typeof vi.fn>).mock.calls.length, 0);
  });

  it("returns INTERNAL_ERROR when SchedulePost fails internally (post already created)", async () => {
    const batchRepo = makeBatchRepo(pendingItem());
    const uc = new ProcessBulkScheduleRowUseCase(
      batchRepo,
      makePostCreation(createOk, async () =>
        err(new UseCaseError("db down", USE_CASE_ERRORS.INTERNAL_ERROR))
      ),
      passthroughUow
    );

    const result = await uc.execute(input());

    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, "INTERNAL_ERROR");
    assert.strictEqual(
      (batchRepo.markItemPostCreated as ReturnType<typeof vi.fn>).mock.calls.length,
      1
    );
    assert.strictEqual((batchRepo.markItemFailed as ReturnType<typeof vi.fn>).mock.calls.length, 0);
  });

  it("skips an item that is already SCHEDULED (idempotency)", async () => {
    const batchRepo = makeBatchRepo({
      id: "item-1",
      batchId: "batch-1",
      status: "SCHEDULED",
      postId: "post-1",
    });
    const postCreation = makePostCreation(createOk, scheduleOk);
    const uc = new ProcessBulkScheduleRowUseCase(batchRepo, postCreation, passthroughUow);

    const result = await uc.execute(input());

    assert.ok(result.ok);
    assert.strictEqual(result.value.status, "SCHEDULED");
    assert.strictEqual(result.value.postId, "post-1");
    assert.strictEqual((postCreation.createPost as ReturnType<typeof vi.fn>).mock.calls.length, 0);
  });

  it("reuses the existing post on retry instead of creating a duplicate", async () => {
    const batchRepo = makeBatchRepo(pendingItem("post-existing"));
    const postCreation = makePostCreation(createOk, scheduleOk);
    const uc = new ProcessBulkScheduleRowUseCase(batchRepo, postCreation, passthroughUow);

    const result = await uc.execute(input());

    assert.ok(result.ok);
    assert.strictEqual(result.value.status, "SCHEDULED");
    assert.strictEqual((postCreation.createPost as ReturnType<typeof vi.fn>).mock.calls.length, 0);
    const scheduleArgs = (postCreation.schedulePost as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as {
      postId: string;
    };
    assert.strictEqual(scheduleArgs.postId, "post-existing");
  });
});
