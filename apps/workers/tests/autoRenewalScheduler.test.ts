/**
 * @file autoRenewalScheduler.test.ts
 * @description Unit tests for the auto-renewal Job Scheduler registration:
 *              asserts the modern idempotent `upsertJobScheduler` contract
 *              (stable id, UTC cron, template) and that no deprecated BullMQ
 *              repeatable API is used.
 * @layer infrastructure
 */
import { describe, it, beforeEach, vi, expect } from "vitest";
import assert from "node:assert/strict";
import {
  AUTO_RENEWAL_JOB_NAME,
  AUTO_RENEWAL_PATTERN,
  AUTO_RENEWAL_SCHEDULER_ID,
  upsertAutoRenewalSchedule,
  type SchedulableQueue,
} from "../src/autoRenewalScheduler.js";

/**
 * Queue test double: records `upsertJobScheduler` calls and exposes spies for
 * the deprecated repeatable API so a regression to it is asserted against.
 */
function makeQueueDouble() {
  const upsertJobScheduler = vi.fn(async () => undefined);
  const add = vi.fn(async () => undefined);
  const getRepeatableJobs = vi.fn(async () => []);
  const removeRepeatableByKey = vi.fn(async () => true);
  const queue = { upsertJobScheduler } as unknown as SchedulableQueue;
  return { queue, upsertJobScheduler, add, getRepeatableJobs, removeRepeatableByKey };
}

describe("upsertAutoRenewalSchedule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers exactly one scheduler with the stable id, UTC cron and template", async () => {
    const { queue, upsertJobScheduler } = makeQueueDouble();

    await upsertAutoRenewalSchedule(queue);

    assert.strictEqual(upsertJobScheduler.mock.calls.length, 1);
    const [id, repeatOpts, template] = upsertJobScheduler.mock.calls[0] as unknown as [
      string,
      { pattern: string; tz: string },
      { name: string; data: unknown; opts: Record<string, unknown> },
    ];
    assert.strictEqual(id, AUTO_RENEWAL_SCHEDULER_ID);
    assert.deepStrictEqual(repeatOpts, { pattern: AUTO_RENEWAL_PATTERN, tz: "UTC" });
    assert.strictEqual(repeatOpts.pattern, "0 2 * * *");
    assert.strictEqual(template.name, AUTO_RENEWAL_JOB_NAME);
    assert.deepStrictEqual(template.data, {});
    assert.deepStrictEqual(template.opts, {
      removeOnComplete: { count: 30 },
      removeOnFail: { count: 30 },
    });
  });

  it("does not use any deprecated repeatable API", async () => {
    const { queue, add, getRepeatableJobs, removeRepeatableByKey } = makeQueueDouble();

    await upsertAutoRenewalSchedule(queue);

    assert.strictEqual(add.mock.calls.length, 0);
    assert.strictEqual(getRepeatableJobs.mock.calls.length, 0);
    assert.strictEqual(removeRepeatableByKey.mock.calls.length, 0);
  });

  it("is idempotent by scheduler id across repeated invocations (no cleanup needed)", async () => {
    const { queue, upsertJobScheduler } = makeQueueDouble();

    await upsertAutoRenewalSchedule(queue);
    await upsertAutoRenewalSchedule(queue);

    assert.strictEqual(upsertJobScheduler.mock.calls.length, 2);
    const ids = upsertJobScheduler.mock.calls.map((c) => (c as unknown as [string])[0]);
    assert.deepStrictEqual(ids, [AUTO_RENEWAL_SCHEDULER_ID, AUTO_RENEWAL_SCHEDULER_ID]);
    expect(new Set(ids).size).toBe(1);
  });
});
