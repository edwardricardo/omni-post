/**
 * @file bulkScheduleWorker.test.ts
 * @description Unit tests for the bulk-schedule worker handlers: the row job
 *              throws on a transient failure (BullMQ retry) and resolves on a
 *              terminal outcome; the failure handler is a no-op while retries
 *              remain and, once exhausted, DLQs the job and records the row's
 *              terminal failure (DLQ enqueue and manifest write are independent).
 * @layer infrastructure
 */
import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import type { Job } from "bullmq";
import { ok, err } from "@shared/types";
import type { QueuePort } from "@ports/core";
import {
  processBulkScheduleRowJob,
  handleBulkScheduleRowFailure,
} from "../../../src/bulk-scheduling/bulkScheduleWorker.js";
import { UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type { ProcessBulkScheduleRowUseCase } from "@core/bulk-scheduling/ProcessBulkScheduleRowUseCase.js";
import type { FailBulkScheduleRowUseCase } from "@core/bulk-scheduling/FailBulkScheduleRowUseCase.js";

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const makeProcess = (
  impl: ProcessBulkScheduleRowUseCase["execute"]
): ProcessBulkScheduleRowUseCase =>
  ({ execute: vi.fn(impl) }) as unknown as ProcessBulkScheduleRowUseCase;

const makeFail = (impl: FailBulkScheduleRowUseCase["execute"]): FailBulkScheduleRowUseCase =>
  ({ execute: vi.fn(impl) }) as unknown as FailBulkScheduleRowUseCase;

const makeDeadLetter = (impl: QueuePort["enqueue"]): QueuePort =>
  ({ enqueue: vi.fn(impl) }) as unknown as QueuePort;

const payload = { batchId: "b1", itemId: "i1", accountId: "a1", projectId: "p1", row: {} };

const job = (over: Partial<Job>): Job =>
  ({ id: "bulk-b1-i1", data: payload, attemptsMade: 3, opts: { attempts: 3 }, ...over }) as Job;

describe("processBulkScheduleRowJob", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves when the use case returns a terminal outcome", async () => {
    const deps = {
      process: makeProcess(async () => ok({ itemId: "i1", status: "SCHEDULED", postId: "post-1" })),
      logger,
    };
    await processBulkScheduleRowJob(deps, payload);
    assert.strictEqual(logger.info.mock.calls.length, 1);
  });

  it("throws on a transient failure so BullMQ retries", async () => {
    const deps = {
      process: makeProcess(async () =>
        err(new UseCaseError("db down", USE_CASE_ERRORS.INTERNAL_ERROR))
      ),
      logger,
    };
    await assert.rejects(() => processBulkScheduleRowJob(deps, payload), /failed/i);
  });
});

describe("handleBulkScheduleRowFailure", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is a no-op when the job is undefined", async () => {
    const fail = makeFail(async () => ok(undefined));
    const deadLetter = makeDeadLetter(async () => ok("x"));
    await handleBulkScheduleRowFailure({ fail, deadLetter, logger }, undefined, new Error("x"));
    assert.strictEqual((fail.execute as ReturnType<typeof vi.fn>).mock.calls.length, 0);
    assert.strictEqual((deadLetter.enqueue as ReturnType<typeof vi.fn>).mock.calls.length, 0);
  });

  it("is a no-op while retries remain", async () => {
    const fail = makeFail(async () => ok(undefined));
    const deadLetter = makeDeadLetter(async () => ok("x"));
    await handleBulkScheduleRowFailure(
      { fail, deadLetter, logger },
      job({ attemptsMade: 1, opts: { attempts: 3 } }),
      new Error("transient")
    );
    assert.strictEqual((fail.execute as ReturnType<typeof vi.fn>).mock.calls.length, 0);
    assert.strictEqual((deadLetter.enqueue as ReturnType<typeof vi.fn>).mock.calls.length, 0);
  });

  it("DLQs the job and records the terminal failure once retries are exhausted", async () => {
    const fail = makeFail(async () => ok(undefined));
    const deadLetter = makeDeadLetter(async () => ok("dlq-1"));
    await handleBulkScheduleRowFailure(
      { fail, deadLetter, logger },
      job({ attemptsMade: 3, opts: { attempts: 3 } }),
      new Error("still broken")
    );
    assert.strictEqual((deadLetter.enqueue as ReturnType<typeof vi.fn>).mock.calls.length, 1);
    const failArgs = (fail.execute as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      batchId: string;
      itemId: string;
      reason: string;
    };
    assert.strictEqual(failArgs.batchId, "b1");
    assert.strictEqual(failArgs.itemId, "i1");
    assert.match(failArgs.reason, /Exhausted 3 attempts/);
  });

  it("still records the terminal failure when the DLQ enqueue fails", async () => {
    const fail = makeFail(async () => ok(undefined));
    const deadLetter = makeDeadLetter(async () => err("CONNECTION_ERROR"));
    await handleBulkScheduleRowFailure(
      { fail, deadLetter, logger },
      job({ attemptsMade: 3, opts: { attempts: 3 } }),
      new Error("still broken")
    );
    assert.strictEqual((fail.execute as ReturnType<typeof vi.fn>).mock.calls.length, 1);
    assert.ok(logger.error.mock.calls.length >= 1);
  });
});
