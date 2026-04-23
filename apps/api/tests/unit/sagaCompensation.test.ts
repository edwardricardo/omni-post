/**
 * Tests for Fase 2 compliance fix:
 *   V3: SchedulePublishingJobsStep.compensate() must actually cancel jobs
 *
 * Verifies:
 * - compensate() with cancelJob → calls cancelJob for each jobId
 * - compensate() without cancelJob (backward compat) → no crash
 * - compensate() with partial cancellation failures → best-effort continues
 * - compensate() without jobIds → returns success immediately
 *
 * @file sagaCompensation.test.ts
 * @description Tests for V3: SchedulePublishingJobsStep compensation
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import { SchedulePublishingJobsStep, createSagaContext } from "@shared/saga";

function createContext(stepData: Record<string, unknown> = {}) {
  const ctx = createSagaContext("saga-test-1", "corr-1", "user-1", {});
  Object.assign(ctx.stepData, stepData);
  return ctx;
}

describe("V3: SchedulePublishingJobsStep compensation", () => {
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

    expect(result.success).toBeTruthy();
    expect(cancelledIds).toStrictEqual(["job-a", "job-b", "job-c"]);
    expect(result.data?.cancelledCount).toBe(3);
  });

  it("should work without cancelJob (backward compat)", async () => {
    // No cancelJob passed — should still succeed but with log-only mode
    const step = new SchedulePublishingJobsStep(async () => "job-1");

    const context = createContext();
    const result = await step.compensate(context, { jobIds: ["job-x", "job-y"] });

    expect(result.success).toBeTruthy();
    expect(result.data?.cancelledCount).toBe(2);
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

    expect(result.success).toBeTruthy();
    expect(callCount).toBe(3);
    // Only job-1 and job-3 were successfully cancelled
    expect(result.data?.cancelledCount).toBe(2);
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

    expect(result.success).toBeTruthy();
    // job-ok and job-ok2 cancelled, job-err caught by try/catch
    expect(result.data?.cancelledCount).toBe(2);
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

    expect(result.success).toBeTruthy();
    expect(cancelCalls.length).toBe(0);
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

    expect(result.success).toBeTruthy();
  });
});
