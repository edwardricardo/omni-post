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
import { UseCaseError, USE_CASE_ERRORS } from "../../../../src/application/UseCase.js";
import { ProcessBulkScheduleRowUseCase } from "../../../../src/application/bulk-scheduling/ProcessBulkScheduleRowUseCase.js";
import type {
  BulkScheduleBatchRepository,
  BulkScheduleItemState,
} from "../../../../src/domain/repositories/BulkScheduleBatchRepository.js";
import type { ChannelRepository } from "../../../../src/domain/repositories/ChannelRepository.js";
import type { CreatePostUseCase } from "../../../../src/application/posts/CreatePostUseCase.js";
import type { SchedulePostUseCase } from "../../../../src/application/posts/SchedulePostUseCase.js";
import type { Channel } from "../../../../src/domain/entities/Channel.js";
import type { UnitOfWork } from "../../../../src/domain/repositories/Repository.js";

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

const makeCreate = (impl: CreatePostUseCase["execute"]): CreatePostUseCase =>
  ({ execute: vi.fn(impl) }) as unknown as CreatePostUseCase;

const makeSchedule = (impl: SchedulePostUseCase["execute"]): SchedulePostUseCase =>
  ({ execute: vi.fn(impl) }) as unknown as SchedulePostUseCase;

const createOk: CreatePostUseCase["execute"] = async () =>
  ok({
    id: "post-1",
    projectId: PROJECT_ID,
    body: "Hello",
    tags: [],
    locale: "en",
    status: "DRAFT",
    createdAt: new Date(),
  });

const scheduleOk: SchedulePostUseCase["execute"] = async () =>
  ok({
    id: "post-1",
    status: "SCHEDULED",
    scheduledFor: "2026-06-01T00:00:00Z",
    channelIds: ["c1"],
  });

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
      makeCreate(createOk),
      makeSchedule(scheduleOk),
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
    const create = makeCreate(createOk);
    const uc = new ProcessBulkScheduleRowUseCase(
      batchRepo,
      makeChannelRepo([]),
      create,
      makeSchedule(scheduleOk),
      passthroughUow
    );

    const result = await uc.execute(input());

    assert.ok(result.ok, "deterministic failure returns ok(FAILED)");
    assert.strictEqual(result.value.status, "FAILED");
    assert.strictEqual((batchRepo.markItemFailed as ReturnType<typeof vi.fn>).mock.calls.length, 1);
    assert.strictEqual((create.execute as ReturnType<typeof vi.fn>).mock.calls.length, 0);
  });

  it("marks the item FAILED on an unsupported provider value", async () => {
    const batchRepo = makeBatchRepo(pendingItem());
    const uc = new ProcessBulkScheduleRowUseCase(
      batchRepo,
      makeChannelRepo([channel("c1")]),
      makeCreate(createOk),
      makeSchedule(scheduleOk),
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
      makeCreate(async () => err(new UseCaseError("bad body", USE_CASE_ERRORS.VALIDATION_FAILED))),
      makeSchedule(scheduleOk),
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
      makeCreate(async () => err(new UseCaseError("db down", USE_CASE_ERRORS.INTERNAL_ERROR))),
      makeSchedule(scheduleOk),
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
      makeCreate(createOk),
      makeSchedule(async () => err(new UseCaseError("db down", USE_CASE_ERRORS.INTERNAL_ERROR))),
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
    const create = makeCreate(createOk);
    const uc = new ProcessBulkScheduleRowUseCase(
      batchRepo,
      makeChannelRepo([channel("c1")]),
      create,
      makeSchedule(scheduleOk),
      passthroughUow
    );

    const result = await uc.execute(input());

    assert.ok(result.ok);
    assert.strictEqual(result.value.status, "SCHEDULED");
    assert.strictEqual(result.value.postId, "post-1");
    assert.strictEqual((create.execute as ReturnType<typeof vi.fn>).mock.calls.length, 0);
  });

  it("reuses the existing post on retry instead of creating a duplicate", async () => {
    const batchRepo = makeBatchRepo(pendingItem("post-existing"));
    const create = makeCreate(createOk);
    const schedule = makeSchedule(scheduleOk);
    const uc = new ProcessBulkScheduleRowUseCase(
      batchRepo,
      makeChannelRepo([channel("c1")]),
      create,
      schedule,
      passthroughUow
    );

    const result = await uc.execute(input());

    assert.ok(result.ok);
    assert.strictEqual(result.value.status, "SCHEDULED");
    assert.strictEqual((create.execute as ReturnType<typeof vi.fn>).mock.calls.length, 0);
    const scheduleArgs = (schedule.execute as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      postId: string;
    };
    assert.strictEqual(scheduleArgs.postId, "post-existing");
  });
});
