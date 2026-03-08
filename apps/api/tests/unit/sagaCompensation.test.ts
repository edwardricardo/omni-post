/**
 * Tests for Fase 2 compliance fix:
 *   V3: SchedulePublishingJobsStep.compensate() must actually cancel jobs
 *
 * Verifies:
 * - compensate() with cancelJob → calls cancelJob for each jobId
 * - compensate() without cancelJob (backward compat) → no crash
 * - compensate() with partial cancellation failures → best-effort continues
 * - compensate() without jobIds → returns success immediately
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SchedulePublishingJobsStep, createSagaContext } from "@shared/saga";

function createContext(stepData: Record<string, unknown> = {}) {
  const ctx = createSagaContext("saga-test-1", "corr-1", "user-1", {});
  Object.assign(ctx.stepData, stepData);
  return ctx;
}

describe("V3: SchedulePublishingJobsStep compensation", { concurrency: 1 }, () => {
  it("should call cancelJob for each jobId during compensation", async () => {
    const cancelledIds: string[] = [];
    const step = new SchedulePublishingJobsStep(
      async () => "job-1",
      async (jobId: string) => {
        cancelledIds.push(jobId);
        return true;
      }
    );

    const context = createContext({
      "schedule-publishing-jobs": {
        jobIds: ["job-a", "job-b", "job-c"],
        channelCount: 3,
      },
    });

    const result = await step.compensate(context, { jobIds: ["job-a", "job-b", "job-c"] });

    assert.ok(result.success, "Compensation should succeed");
    assert.deepStrictEqual(cancelledIds, ["job-a", "job-b", "job-c"]);
    assert.strictEqual(result.data?.cancelledCount, 3);
  });

  it("should work without cancelJob (backward compat)", async () => {
    // No cancelJob passed — should still succeed but with log-only mode
    const step = new SchedulePublishingJobsStep(async () => "job-1");

    const context = createContext();
    const result = await step.compensate(context, { jobIds: ["job-x", "job-y"] });

    assert.ok(result.success, "Compensation should succeed in backward compat mode");
    assert.strictEqual(result.data?.cancelledCount, 2);
  });

  it("should handle partial cancellation failures (best-effort)", async () => {
    let callCount = 0;
    const step = new SchedulePublishingJobsStep(
      async () => "job-1",
      async (jobId: string) => {
        callCount++;
        // Second job fails to cancel (already completed)
        if (jobId === "job-2") return false;
        return true;
      }
    );

    const context = createContext();
    const result = await step.compensate(context, { jobIds: ["job-1", "job-2", "job-3"] });

    assert.ok(result.success, "Compensation should succeed even with partial failures");
    assert.strictEqual(callCount, 3, "Should attempt all 3 cancellations");
    // Only job-1 and job-3 were successfully cancelled
    assert.strictEqual(result.data?.cancelledCount, 2);
  });

  it("should handle cancelJob throwing errors (best-effort)", async () => {
    const step = new SchedulePublishingJobsStep(
      async () => "job-1",
      async (jobId: string) => {
        if (jobId === "job-err") throw new Error("Connection lost");
        return true;
      }
    );

    const context = createContext();
    const result = await step.compensate(context, { jobIds: ["job-ok", "job-err", "job-ok2"] });

    assert.ok(result.success, "Compensation should succeed despite thrown errors");
    // job-ok and job-ok2 cancelled, job-err caught by try/catch
    assert.strictEqual(result.data?.cancelledCount, 2);
  });

  it("should return success immediately when no jobIds exist", async () => {
    const cancelCalls: string[] = [];
    const step = new SchedulePublishingJobsStep(
      async () => "job-1",
      async (jobId: string) => {
        cancelCalls.push(jobId);
        return true;
      }
    );

    const context = createContext();
    const result = await step.compensate(context, { jobIds: [] });

    assert.ok(result.success);
    assert.strictEqual(cancelCalls.length, 0, "Should not call cancelJob when no jobIds");
  });

  it("should return success when compensationData is empty", async () => {
    const step = new SchedulePublishingJobsStep(
      async () => "job-1",
      async () => true
    );

    const context = createContext({
      "schedule-publishing-jobs": { jobIds: [], channelCount: 0 },
    });

    // No compensationData, falls back to context.stepData
    const result = await step.compensate(context);

    assert.ok(result.success);
  });
});
