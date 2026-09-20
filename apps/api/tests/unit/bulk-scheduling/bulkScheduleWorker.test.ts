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
import { getTenantContext } from "../../../src/security/tenantContext.js";
import client from "prom-client";

/** Reads the live value of the refusal counter for one `reason` label. */
async function refusalCount(reason: string): Promise<number> {
  const metric = client.register.getSingleMetric("omnipost_bulk_schedule_rows_refused_total");
  if (metric === undefined) return 0;
  const { values } = await (metric as client.Counter).get();
  return values.find((value) => value.labels.reason === reason)?.value ?? 0;
}

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

  it("runs the use case INSIDE a tenant context bound to the payload's account", async () => {
    // A queue job carries no request, so the scope is bound from the payload the producer
    // put the account in — the convention the repurpose / triage / trend consumers already
    // follow. Without it the row's writes reach `post` / `postContent` / `postMedia`, all
    // tenant-guard-enrolled, with NO context: the guard throws, and the only thing that has
    // ever covered this path is a double that never consults the guard.
    let seen: string | undefined;
    const deps = {
      process: makeProcess(async () => {
        seen = getTenantContext()?.accountId;
        return ok({ itemId: "i1", status: "SCHEDULED", postId: "post-1" });
      }),
      logger,
    };

    await processBulkScheduleRowJob(deps, payload);

    assert.strictEqual(seen, "a1", "the row runs in the account its payload names");
  });

  it("refuses a row whose payload names no account, rather than running unbound", async () => {
    const deps = {
      process: makeProcess(async () => ok({ itemId: "i1", status: "SCHEDULED", postId: "post-1" })),
      logger,
    };

    await assert.rejects(
      () => processBulkScheduleRowJob(deps, { ...payload, accountId: undefined }),
      /account/i
    );
    assert.strictEqual(
      (deps.process.execute as ReturnType<typeof vi.fn>).mock.calls.length,
      0,
      "an unbound row is never processed — falling back to the system scope would write across tenants"
    );
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

  it("records the terminal failure INSIDE the tenant context the payload names", async () => {
    // The failure callback is part of the worker and writes the same tenant-scoped rows
    // the row path does: `FailBulkScheduleRowUseCase` updates `bulkScheduleItem` and then
    // `bulkScheduleBatch` through `completeBatchIfSettled`. Unbound, the guard throws for
    // EVERY retry-exhausted row and the batch never settles — so binding only the success
    // path would leave the failure path broken in precisely the situation it exists for.
    let seen: string | undefined;
    const fail = makeFail(async () => {
      seen = getTenantContext()?.accountId;
      return ok(undefined);
    });
    const deadLetter = makeDeadLetter(async () => ok("dlq-1"));

    await handleBulkScheduleRowFailure(
      { fail, deadLetter, logger },
      job({ attemptsMade: 3, opts: { attempts: 3 } }),
      new Error("still broken")
    );

    assert.strictEqual(seen, "a1", "the terminal failure is recorded in the row's account");
  });

  it("THROWS the shared refusal for a payload that names no account, and counts it", async () => {
    // Both arms of the worker answer the identical condition identically. The terminal
    // arm used to log and RETURN, which resolved the callback while the item stayed
    // unrecorded and its batch never settled — the one place a silent skip is worst,
    // because nothing retries after it. The counter is what makes that state visible:
    // a log line nobody greps is not an alert.
    const fail = makeFail(async () => ok(undefined));
    const deadLetter = makeDeadLetter(async () => ok("dlq-1"));
    const before = await refusalCount("terminal-failure");

    await assert.rejects(
      () =>
        handleBulkScheduleRowFailure(
          { fail, deadLetter, logger },
          job({
            attemptsMade: 3,
            opts: { attempts: 3 },
            data: { ...payload, accountId: undefined },
          }),
          new Error("still broken")
        ),
      /accountId/
    );

    assert.strictEqual(
      (fail.execute as ReturnType<typeof vi.fn>).mock.calls.length,
      0,
      "an unbound manifest write is refused, never attempted under the system scope"
    );
    assert.strictEqual(
      await refusalCount("terminal-failure"),
      before + 1,
      "the refusal is counted so the unsettled batch is observable"
    );
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
