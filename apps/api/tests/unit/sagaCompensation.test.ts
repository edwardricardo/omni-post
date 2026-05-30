/**
 * @file sagaCompensation.test.ts
 * @description Tests for SchedulePublishingJobsStep — classified as PivotStep
 *   per Azure saga §5-8 / §15-20. As a pivot, the step has no compensate()
 *   method (point of no return); the forward path enqueues publishing jobs
 *   for each channel. These tests cover the canonical pivot contract.
 *
 *   The filename is retained for git-blame continuity with the prior
 *   compensable-step test suite (deleted when the step was reclassified
 *   during the saga canon retrofit).
 * @layer infrastructure
 */
import { describe, it, expect, vi } from "vitest";
import { SchedulePublishingJobsStep, createSagaContext } from "@shared/saga";

interface ScheduleStepData {
  jobIds: string[];
  channelCount: number;
  scheduledAt?: Date;
}

function makeContext(
  opts: { mode?: "publish-now" | "schedule" | "draft"; stepData?: Record<string, unknown> } = {}
) {
  const ctx = createSagaContext("saga-test-1", "corr-1", "user-1", {
    mode: opts.mode ?? "publish-now",
  });
  if (opts.stepData) {
    Object.assign(ctx.stepData, opts.stepData);
  }
  return ctx;
}

describe("SchedulePublishingJobsStep — Pivot contract", () => {
  it("is classified as pivot (no compensate, point of no return per Azure §15-20)", () => {
    const step = new SchedulePublishingJobsStep(vi.fn());
    expect(step.class).toBe("pivot");
    expect((step as unknown as { compensate?: unknown }).compensate).toBeUndefined();
  });

  it("execute in publish-now mode enqueues one job per channel", async () => {
    const enqueued: Array<Record<string, unknown>> = [];
    const queueJob = vi.fn(async (job: Record<string, unknown>) => {
      enqueued.push(job);
      return `job-${enqueued.length}`;
    });

    const step = new SchedulePublishingJobsStep(queueJob);
    const ctx = makeContext({
      mode: "publish-now",
      stepData: {
        "create-post": { postId: "post-abc" },
        "validate-post-data": {
          validatedData: { channelIds: ["ch-1", "ch-2", "ch-3"] },
        },
      },
    });

    const result = await step.execute(ctx);

    expect(result.success).toBe(true);
    expect(queueJob).toHaveBeenCalledTimes(3);
    const data = result.data as ScheduleStepData;
    expect(data.channelCount).toBe(3);
    expect(data.jobIds).toStrictEqual(["job-1", "job-2", "job-3"]);
  });

  it("execute in schedule mode passes scheduledAt to each enqueued job", async () => {
    const enqueued: Array<Record<string, unknown>> = [];
    const queueJob = vi.fn(async (job: Record<string, unknown>) => {
      enqueued.push(job);
      return "job-x";
    });

    const futureDate = new Date(Date.now() + 3600_000);
    const step = new SchedulePublishingJobsStep(queueJob);
    const ctx = makeContext({
      mode: "schedule",
      stepData: {
        "create-post": { postId: "post-abc" },
        "validate-post-data": {
          validatedData: { channelIds: ["ch-1"], scheduledAt: futureDate },
        },
      },
    });

    const result = await step.execute(ctx);

    expect(result.success).toBe(true);
    expect(enqueued.length).toBe(1);
    expect(enqueued[0]!.scheduledAt).toEqual(futureDate);
    expect(enqueued[0]!.postId).toBe("post-abc");
    expect(enqueued[0]!.channelId).toBe("ch-1");
    expect(enqueued[0]!.sagaId).toBe(ctx.sagaId);
    expect(enqueued[0]!.correlationId).toBe(ctx.correlationId);
  });

  it("execute in draft mode short-circuits with no enqueued jobs", async () => {
    const queueJob = vi.fn();
    const step = new SchedulePublishingJobsStep(queueJob);
    const ctx = makeContext({
      mode: "draft",
      stepData: { "create-post": { postId: "post-abc" } },
    });

    const result = await step.execute(ctx);

    expect(result.success).toBe(true);
    expect(queueJob).not.toHaveBeenCalled();
    const data = result.data as Record<string, unknown>;
    expect(data.skipped).toBe(true);
    expect(data.reason).toBe("draft-mode");
    expect(data.channelCount).toBe(0);
    expect(data.jobIds).toStrictEqual([]);
  });

  it("execute fails when postId is missing from upstream step data and command data", async () => {
    const queueJob = vi.fn();
    const step = new SchedulePublishingJobsStep(queueJob);
    const ctx = makeContext({
      mode: "publish-now",
      // No "create-post" stepData and no data argument with postId.
    });

    const result = await step.execute(ctx);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Post ID not found/i);
    expect(queueJob).not.toHaveBeenCalled();
  });

  it("execute returns success: false when queueJob throws (no rollback — pivot semantics)", async () => {
    const queueJob = vi.fn(async () => {
      throw new Error("Queue unreachable");
    });
    const step = new SchedulePublishingJobsStep(queueJob);
    const ctx = makeContext({
      mode: "publish-now",
      stepData: {
        "create-post": { postId: "post-abc" },
        "validate-post-data": { validatedData: { channelIds: ["ch-1"] } },
      },
    });

    const result = await step.execute(ctx);

    // Pivots do not roll back. The step reports failure, but no compensate()
    // exists — the engine treats this as terminal FAILED per canon Azure §5.
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Queue unreachable/);
    expect((step as unknown as { compensate?: unknown }).compensate).toBeUndefined();
  });

  it("execute persists scheduling stepData on success for downstream consumption", async () => {
    const step = new SchedulePublishingJobsStep(async () => "job-1");
    const ctx = makeContext({
      mode: "publish-now",
      stepData: {
        "create-post": { postId: "post-abc" },
        "validate-post-data": { validatedData: { channelIds: ["ch-1", "ch-2"] } },
      },
    });

    await step.execute(ctx);

    const persisted = ctx.stepData["schedule-publishing-jobs"] as ScheduleStepData;
    expect(persisted).toBeTruthy();
    expect(persisted.jobIds).toStrictEqual(["job-1", "job-1"]);
    expect(persisted.channelCount).toBe(2);
  });
});
