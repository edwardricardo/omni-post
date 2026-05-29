/**
 * @file ImportSchedulingCsvUseCase.test.ts
 * @description Unit tests for the bulk-scheduling CSV import use case: manifest
 *              creation (valid → PENDING + job, invalid → FAILED), tenant
 *              ownership, header/parse rejection, the row cap, the all-invalid
 *              COMPLETED short-circuit, and enqueue-failure handling.
 * @layer infrastructure
 */
import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { ok, err } from "@shared/types";
import type { QueuePort } from "@ports/core";
import {
  ImportSchedulingCsvUseCase,
  MAX_BULK_SCHEDULE_ROWS,
} from "@core/bulk-scheduling/ImportSchedulingCsvUseCase.js";
import type { ProjectQueryRepositoryPort } from "@core/domain/repositories/ProjectQueryRepository.js";
import type {
  BulkScheduleBatchRepository,
  NewBulkScheduleBatch,
} from "@core/domain/repositories/BulkScheduleBatchRepository.js";
import type { ProjectDto } from "@core/domain/repositories/ReadModelDtos.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

const future = (ms: number): string => new Date(Date.now() + ms).toISOString();
const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;
const HEADER = "provider,content,scheduledFor";

const makeProject = (overrides?: Partial<ProjectDto>): ProjectDto => ({
  id: "proj-1",
  name: "Proj",
  locale: "en",
  accountId: "acc-1",
  isInCrisisMode: false,
  crisisStartedAt: null,
  crisisReason: null,
  crisisModeHistory: null,
  deletedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

const makeProjectRepo = (project: ProjectDto | null): ProjectQueryRepositoryPort =>
  ({ findById: vi.fn(async () => project) }) as unknown as ProjectQueryRepositoryPort;

interface BatchRepoMock {
  repo: BulkScheduleBatchRepository;
  created: NewBulkScheduleBatch[];
}
const makeBatchRepo = (): BatchRepoMock => {
  const created: NewBulkScheduleBatch[] = [];
  const repo: BulkScheduleBatchRepository = {
    createBatch: vi.fn(async (batch) => {
      created.push(batch);
    }),
    findItem: vi.fn(async () => null),
    markItemPostCreated: vi.fn(async () => {}),
    markItemScheduled: vi.fn(async () => {}),
    markItemFailed: vi.fn(async () => {}),
    completeBatchIfSettled: vi.fn(async () => {}),
  };
  return { repo, created };
};

const makeQueue = (
  enqueueBulk: QueuePort["enqueueBulk"]
): { queue: QueuePort; calls: Parameters<QueuePort["enqueueBulk"]>[0][] } => {
  const calls: Parameters<QueuePort["enqueueBulk"]>[0][] = [];
  const queue = {
    enqueue: vi.fn(),
    enqueueBulk: vi.fn(async (jobs: Parameters<QueuePort["enqueueBulk"]>[0]) => {
      calls.push(jobs);
      return enqueueBulk(jobs);
    }),
    health: vi.fn(),
    remove: vi.fn(),
    getJobStates: vi.fn(),
  } as unknown as QueuePort;
  return { queue, calls };
};

const passthroughUow: UnitOfWork = { executeInTransaction: async (fn) => fn() };

const okEnqueue: QueuePort["enqueueBulk"] = async (jobs) => ok(jobs.map((_, i) => `job-${i}`));

describe("ImportSchedulingCsvUseCase", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a manifest (valid→PENDING, invalid→FAILED) and enqueues only valid rows", async () => {
    const batchRepo = makeBatchRepo();
    const { queue, calls } = makeQueue(okEnqueue);
    const uc = new ImportSchedulingCsvUseCase(
      makeProjectRepo(makeProject()),
      batchRepo.repo,
      queue,
      passthroughUow
    );

    const csv = `${HEADER}\nX,Hello,${future(TWO_DAYS)}\nMYSPACE,Bad,${future(TWO_DAYS)}`;
    const result = await uc.execute({ accountId: "acc-1", projectId: "proj-1", csv });

    assert.ok(result.ok, "should succeed");
    assert.strictEqual(result.value.totalRows, 2);
    assert.strictEqual(result.value.validRows, 1);
    assert.strictEqual(result.value.invalidRows, 1);

    const batch = batchRepo.created[0];
    assert.ok(batch, "a batch was created");
    assert.strictEqual(batch.status, "PROCESSING");
    assert.strictEqual(batch.items.length, 2);
    const pending = batch.items.filter((i) => i.status === "PENDING");
    const failed = batch.items.filter((i) => i.status === "FAILED");
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0]?.provider, "X");
    assert.strictEqual(pending[0]?.rowNumber, 1);
    assert.strictEqual(failed.length, 1);
    assert.strictEqual(failed[0]?.rowNumber, 2);
    assert.match(failed[0]?.errorMessage ?? "", /provider/i);

    // Exactly one job for the single valid row, keyed deterministically.
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0]?.length, 1);
    assert.strictEqual(calls[0]?.[0]?.dedupeKey, `bulk-${batch.id}-${pending[0]?.id}`);
    assert.strictEqual(calls[0]?.[0]?.payload?.itemId, pending[0]?.id);
  });

  it("returns NOT_FOUND when the project belongs to another account", async () => {
    const batchRepo = makeBatchRepo();
    const { queue } = makeQueue(okEnqueue);
    const uc = new ImportSchedulingCsvUseCase(
      makeProjectRepo(makeProject({ accountId: "other-acc" })),
      batchRepo.repo,
      queue,
      passthroughUow
    );

    const csv = `${HEADER}\nX,Hello,${future(TWO_DAYS)}`;
    const result = await uc.execute({ accountId: "acc-1", projectId: "proj-1", csv });

    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, "NOT_FOUND");
    assert.strictEqual(batchRepo.created.length, 0);
  });

  it("returns NOT_FOUND when the project is soft-deleted", async () => {
    const batchRepo = makeBatchRepo();
    const { queue } = makeQueue(okEnqueue);
    const uc = new ImportSchedulingCsvUseCase(
      makeProjectRepo(makeProject({ deletedAt: new Date() })),
      batchRepo.repo,
      queue,
      passthroughUow
    );

    const csv = `${HEADER}\nX,Hello,${future(TWO_DAYS)}`;
    const result = await uc.execute({ accountId: "acc-1", projectId: "proj-1", csv });

    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, "NOT_FOUND");
  });

  it("rejects a header/parse-level error with VALIDATION_FAILED and creates no batch", async () => {
    const batchRepo = makeBatchRepo();
    const { queue } = makeQueue(okEnqueue);
    const uc = new ImportSchedulingCsvUseCase(
      makeProjectRepo(makeProject()),
      batchRepo.repo,
      queue,
      passthroughUow
    );

    const csv = `provider,content\nX,no schedule column`;
    const result = await uc.execute({ accountId: "acc-1", projectId: "proj-1", csv });

    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, "VALIDATION_FAILED");
    assert.strictEqual(batchRepo.created.length, 0);
  });

  it("rejects a CSV over the row cap with VALIDATION_FAILED", async () => {
    const batchRepo = makeBatchRepo();
    const { queue } = makeQueue(okEnqueue);
    const uc = new ImportSchedulingCsvUseCase(
      makeProjectRepo(makeProject()),
      batchRepo.repo,
      queue,
      passthroughUow
    );

    // One row over the cap; invalid provider keeps per-row parsing cheap.
    const rows = Array.from({ length: MAX_BULK_SCHEDULE_ROWS + 1 }, () => "MYSPACE,c,x").join("\n");
    const result = await uc.execute({
      accountId: "acc-1",
      projectId: "proj-1",
      csv: `${HEADER}\n${rows}`,
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, "VALIDATION_FAILED");
    assert.match(result.error.message, /limit/);
    assert.strictEqual(batchRepo.created.length, 0);
  });

  it("marks the batch COMPLETED and enqueues nothing when every row is invalid", async () => {
    const batchRepo = makeBatchRepo();
    const { queue, calls } = makeQueue(okEnqueue);
    const uc = new ImportSchedulingCsvUseCase(
      makeProjectRepo(makeProject()),
      batchRepo.repo,
      queue,
      passthroughUow
    );

    const csv = `${HEADER}\nMYSPACE,a,x\nORKUT,b,x`;
    const result = await uc.execute({ accountId: "acc-1", projectId: "proj-1", csv });

    assert.ok(result.ok);
    assert.strictEqual(result.value.validRows, 0);
    assert.strictEqual(result.value.invalidRows, 2);
    assert.strictEqual(batchRepo.created[0]?.status, "COMPLETED");
    assert.strictEqual(calls.length, 0, "enqueueBulk not called when no valid rows");
  });

  it("returns INTERNAL_ERROR when enqueue fails after the batch is persisted", async () => {
    const batchRepo = makeBatchRepo();
    const { queue } = makeQueue(async () => err("CONNECTION_ERROR"));
    const uc = new ImportSchedulingCsvUseCase(
      makeProjectRepo(makeProject()),
      batchRepo.repo,
      queue,
      passthroughUow
    );

    const csv = `${HEADER}\nX,Hello,${future(TWO_DAYS)}`;
    const result = await uc.execute({ accountId: "acc-1", projectId: "proj-1", csv });

    assert.ok(!result.ok);
    assert.strictEqual(result.error.code, "INTERNAL_ERROR");
    assert.strictEqual(batchRepo.created.length, 1, "batch was persisted before enqueue");
  });
});
