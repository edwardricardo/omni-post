/**
 * @file ProcessBulkScheduleRowUseCase.test.ts
 * @description Unit tests for the per-row worker use case: happy path, the
 *              deterministic-vs-transient failure split, idempotency (terminal
 *              item skip + post reuse on retry), and the no-channel case.
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
import type { ChannelRepository } from "@core/domain/repositories/ChannelRepository.js";
import type { PostCreationPort } from "@ports/core";
import type { Channel } from "@core/domain/entities/Channel.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

const PROJECT_ID = "550e8400-e29b-41d4-a716-446655440000";
const passthroughUow: UnitOfWork = { executeInTransaction: async (fn) => fn() };

const channel = (id: string): Channel => ({ id: { value: id } }) as unknown as Channel;

const makeBatchRepo = (item: BulkScheduleItemState | null): BulkScheduleBatchRepository => ({
  createBatch: vi.fn(async () => {}),
  findItem: vi.fn(async () => item),
  markItemPostCreated: vi.fn(async () => {}),
  markItemScheduled: vi.fn(async () => {}),
  markItemFailed: vi.fn(async () => {}),
  completeBatchIfSettled: vi.fn(async () => {}),
});

const makeChannelRepo = (channels: Channel[]): ChannelRepository =>
  ({ findByProjectAndProvider: vi.fn(async () => channels) }) as unknown as ChannelRepository;

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

const input = (overrides?: Partial<{ provider: string; postId: string }>) => ({
  batchId: "batch-1",
  itemId: "item-1",
  accountId: "acc-1",
  projectId: PROJECT_ID,
  row: {
    provider: overrides?.provider ?? "X",
    content: "Hello",
    scheduledFor: "2026-06-01T00:00:00Z",
    timezone: "UTC",
    mediaUrls: [] as string[],
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
      makeChannelRepo([channel("c1")]),
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

  it("marks the item FAILED (no retry) when no channel exists for the provider", async () => {
    const batchRepo = makeBatchRepo(pendingItem());
    const postCreation = makePostCreation(createOk, scheduleOk);
    const uc = new ProcessBulkScheduleRowUseCase(
      batchRepo,
      makeChannelRepo([]),
      postCreation,
      passthroughUow
    );

    const result = await uc.execute(input());

    assert.ok(result.ok, "deterministic failure returns ok(FAILED)");
    assert.strictEqual(result.value.status, "FAILED");
    assert.strictEqual((batchRepo.markItemFailed as ReturnType<typeof vi.fn>).mock.calls.length, 1);
    assert.strictEqual((postCreation.createPost as ReturnType<typeof vi.fn>).mock.calls.length, 0);
  });

  it("marks the item FAILED on an unsupported provider value", async () => {
    const batchRepo = makeBatchRepo(pendingItem());
    const uc = new ProcessBulkScheduleRowUseCase(
      batchRepo,
      makeChannelRepo([channel("c1")]),
      makePostCreation(createOk, scheduleOk),
      passthroughUow
    );

    const result = await uc.execute(input({ provider: "MYSPACE" }));

    assert.ok(result.ok);
    assert.strictEqual(result.value.status, "FAILED");
  });

  it("marks the item FAILED when CreatePost returns a deterministic error", async () => {
    const batchRepo = makeBatchRepo(pendingItem());
    const uc = new ProcessBulkScheduleRowUseCase(
      batchRepo,
      makeChannelRepo([channel("c1")]),
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
      makeChannelRepo([channel("c1")]),
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
      makeChannelRepo([channel("c1")]),
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
    const uc = new ProcessBulkScheduleRowUseCase(
      batchRepo,
      makeChannelRepo([channel("c1")]),
      postCreation,
      passthroughUow
    );

    const result = await uc.execute(input());

    assert.ok(result.ok);
    assert.strictEqual(result.value.status, "SCHEDULED");
    assert.strictEqual(result.value.postId, "post-1");
    assert.strictEqual((postCreation.createPost as ReturnType<typeof vi.fn>).mock.calls.length, 0);
  });

  it("reuses the existing post on retry instead of creating a duplicate", async () => {
    const batchRepo = makeBatchRepo(pendingItem("post-existing"));
    const postCreation = makePostCreation(createOk, scheduleOk);
    const uc = new ProcessBulkScheduleRowUseCase(
      batchRepo,
      makeChannelRepo([channel("c1")]),
      postCreation,
      passthroughUow
    );

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
