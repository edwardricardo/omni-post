/**
 * @file sagaDeterministicIds.test.ts
 * @description Verifies that saga steps emit deterministic command IDs keyed
 *              on (sagaId, stepId) so retries collapse to a single dedupeKey
 *              instead of fanning out per-attempt (Richardson saga + Azure
 *              §15-20 OCC), and that the promotion step is a THIN FORWARDER:
 *              it carries the publish outcome into the dedicated transition
 *              command and refuses — emitting nothing — whenever the outcome
 *              cannot be shown to be a total success.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import {
  CreatePostStep,
  SchedulePublishingJobsStep,
  UpdatePostStatusStep,
  createSagaContext,
  type SagaContext,
} from "@shared/types/saga.js";
import type { Command } from "@shared/types/cqrs.js";

const ACCOUNT_ID = "acc-1";
const POST_ID = "post-1";

/**
 * The fields a caller may bend to drive one precondition off its happy value.
 * `channelIds: null` is the saga persisted BEFORE the pivot recorded channel
 * identities — a distinct fact from "the pivot scheduled none", which is `[]`.
 */
interface ContextSeed {
  accountId?: string;
  postId?: string;
  channelIds?: string[] | null;
  jobIds?: string[];
  totalJobs?: number;
  completed?: number;
  failed?: number;
  publishingComplete?: boolean;
  mode?: string;
}

/**
 * A publish-now context whose three step-data entries describe ONE channel that
 * was scheduled and published. Every refusal case below starts from this and
 * changes exactly one value, so the case names what makes the step refuse
 * rather than what it happened to be handed.
 */
function makeContext(seed: ContextSeed = {}): SagaContext {
  const channelIds = seed.channelIds === undefined ? ["c1"] : seed.channelIds;
  const jobIds = seed.jobIds ?? (channelIds ?? []).map((id) => `job-${id}`);
  const accountId = seed.accountId === undefined ? ACCOUNT_ID : seed.accountId;

  const ctx = createSagaContext({
    sagaId: "saga-fixed-id",
    correlationId: "corr-1",
    userId: "user-1",
    metadata: {
      mode: seed.mode ?? "publish-now",
      postData: { body: "x", channelIds: channelIds ?? [] },
      ...(accountId !== "" && { accountId }),
    },
  });

  ctx.stepData["create-post"] = {
    postId: seed.postId === undefined ? POST_ID : seed.postId,
    version: 7,
  };
  ctx.stepData["schedule-publishing-jobs"] = {
    jobIds,
    ...(channelIds !== null && { channelIds }),
    channelCount: (channelIds ?? []).length,
  };
  ctx.stepData["wait-publishing-completion"] = {
    totalJobs: seed.totalJobs ?? jobIds.length,
    completed: seed.completed ?? jobIds.length,
    failed: seed.failed ?? 0,
    publishingComplete: seed.publishingComplete ?? true,
  };

  return ctx;
}

/** Records every command a step emitted while answering each one with success. */
function recordingExecutor(): { commands: Command[]; execute: (c: Command) => Promise<unknown> } {
  const commands: Command[] = [];
  return {
    commands,
    execute: async (command: Command) => {
      commands.push(command);
      return { success: true, data: {} };
    },
  };
}

describe("Saga deterministic command IDs", () => {
  it("CreatePostStep emits identical command IDs across retries of the same saga", async () => {
    const ids: string[] = [];
    const step = new CreatePostStep(async (cmd: Command) => {
      ids.push(cmd.id);
      return { success: true, data: { id: cmd.aggregateId, version: 1 } };
    });

    const ctx = makeContext();
    await step.execute(ctx);
    await step.execute(ctx);
    await step.execute(ctx);

    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBe("cmd-saga-fixed-id-create-post");
  });

  it("CreatePostStep compensate emits a distinct deterministic ID with -compensate suffix", async () => {
    let forwardId = "";
    let compensateId = "";
    const step = new CreatePostStep(async (cmd: Command) => {
      if (cmd.type === "post.create") forwardId = cmd.id;
      if (cmd.type === "post.delete") compensateId = cmd.id;
      return { success: true, data: { id: cmd.aggregateId, version: 1 } };
    });

    const ctx = makeContext();
    await step.execute(ctx);
    await step.compensate?.(ctx, { postId: POST_ID });

    expect(forwardId).toBe("cmd-saga-fixed-id-create-post");
    expect(compensateId).toBe("cmd-saga-fixed-id-create-post-compensate");
    expect(forwardId).not.toBe(compensateId);
  });

  it("UpdatePostStatusStep emits identical command IDs across retries of the same saga", async () => {
    const executor = recordingExecutor();
    const step = new UpdatePostStatusStep(executor.execute);

    const ctx = makeContext();
    await step.execute(ctx);
    await step.execute(ctx);
    await step.execute(ctx);

    const ids = executor.commands.map((command) => command.id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBe("cmd-saga-fixed-id-update-post-status");
  });

  it("UpdatePostStatusStep is a RetryableStep with no compensate (post-pivot canon)", () => {
    const step = new UpdatePostStatusStep(async () => ({ success: true, data: {} }));
    expect(step.class).toBe("retryable");
    expect((step as unknown as { compensate?: unknown }).compensate).toBeUndefined();
  });
});

describe("the pivot records the channel identities the promotion later forwards", () => {
  it("records the channels it enqueued, index-aligned with the job ids", async () => {
    const enqueued: string[] = [];
    const step = new SchedulePublishingJobsStep(async (job: Record<string, unknown>) => {
      enqueued.push(String(job.channelId));
      return `job-${String(job.channelId)}`;
    });

    const ctx = makeContext({ channelIds: ["c1", "c2", "c3"] });
    // The pivot builds its own step data; anything a previous run left is
    // irrelevant to what it records now.
    ctx.stepData["schedule-publishing-jobs"] = {};

    const result = await step.execute(ctx);

    expect(result.outcome).toBe("succeeded");
    const recorded = ctx.stepData["schedule-publishing-jobs"] as {
      jobIds: string[];
      channelIds: string[];
    };
    expect(recorded.channelIds).toStrictEqual(["c1", "c2", "c3"]);
    expect(recorded.channelIds).toStrictEqual(enqueued);
    // Index-aligned: the promotion pairs one with the other by position, so a
    // matching length alone would let a reordering pass.
    expect(recorded.jobIds).toStrictEqual(["job-c1", "job-c2", "job-c3"]);
  });

  it("records an empty channel list for a draft saga, which promotes nothing", async () => {
    const step = new SchedulePublishingJobsStep(async () => "never-enqueued");

    const ctx = makeContext({ mode: "draft", channelIds: ["c1"] });
    ctx.stepData["schedule-publishing-jobs"] = {};

    await step.execute(ctx);

    const recorded = ctx.stepData["schedule-publishing-jobs"] as { channelIds: string[] };
    expect(recorded.channelIds).toStrictEqual([]);
  });
});

describe("UpdatePostStatusStep as a forwarder of the publish outcome", () => {
  it("emits post.complete-publishing carrying one outcome entry per channel the pivot scheduled", async () => {
    const executor = recordingExecutor();
    const step = new UpdatePostStatusStep(executor.execute);

    const result = await step.execute(makeContext({ channelIds: ["c1", "c2"] }));

    expect(result.outcome).toBe("succeeded");
    expect(executor.commands).toHaveLength(1);
    const emitted = executor.commands[0]!;
    expect(emitted.type).toBe("post.complete-publishing");
    expect(emitted.aggregateId).toBe(POST_ID);
    expect(emitted.data).toStrictEqual({
      outcome: {
        channels: [
          { channelId: "c1", success: true },
          { channelId: "c2", success: true },
        ],
      },
    });
  });

  it("chooses no target status: the emitted command carries no status field", async () => {
    const executor = recordingExecutor();
    const step = new UpdatePostStatusStep(executor.execute);

    await step.execute(makeContext());

    const data = executor.commands[0]!.data as Record<string, unknown>;
    expect(data.status).toBeUndefined();
    expect(data.publishedAt).toBeUndefined();
  });

  it("forwards no expectedVersion even though the create step recorded one", async () => {
    // A create-time version never refreshes, so forwarding it made every retry
    // of a still-editable DRAFT conflict. The in-transaction CAS is the guard.
    const executor = recordingExecutor();
    const step = new UpdatePostStatusStep(executor.execute);

    await step.execute(makeContext());

    const data = executor.commands[0]!.data as Record<string, unknown>;
    expect(data.expectedVersion).toBeUndefined();
  });

  it("reports the failed outcome carrying the cause when the promotion is rejected", async () => {
    const step = new UpdatePostStatusStep(async () => ({
      success: false,
      error: "Partial publish outcomes are not promoted by this capability",
    }));

    const result = await step.execute(makeContext());

    expect(result.outcome).toBe("failed");
    expect(result.outcome === "failed" && result.error).toContain("Partial publish outcomes");
  });

  it("short-circuits a draft saga without emitting any command", async () => {
    const executor = recordingExecutor();
    const step = new UpdatePostStatusStep(executor.execute);

    const result = await step.execute(makeContext({ mode: "draft" }));

    expect(result.outcome).toBe("succeeded");
    expect(executor.commands).toHaveLength(0);
  });

  it("short-circuits a scheduled saga without emitting any command", async () => {
    const executor = recordingExecutor();
    const step = new UpdatePostStatusStep(executor.execute);

    const result = await step.execute(makeContext({ mode: "schedule" }));

    expect(result.outcome).toBe("succeeded");
    expect(executor.commands).toHaveLength(0);
  });
});

describe("UpdatePostStatusStep fails closed over an outcome it cannot show to be total", () => {
  /**
   * Every precondition refuses the SAME way: a failed step outcome naming the
   * cause, and — the half that matters — no command at all. A refusal that
   * still emitted would hand the promotion an outcome nobody vouched for.
   */
  async function expectRefusal(seed: ContextSeed, expectedReason: RegExp): Promise<void> {
    const executor = recordingExecutor();
    const step = new UpdatePostStatusStep(executor.execute);

    const result = await step.execute(makeContext(seed));

    expect(result.outcome).toBe("failed");
    expect(result.outcome === "failed" && result.error).toMatch(expectedReason);
    expect(executor.commands).toHaveLength(0);
  }

  it("refuses when the saga metadata carries no accountId", async () => {
    await expectRefusal({ accountId: "" }, /accountId/i);
  });

  it("refuses when the create step recorded no postId", async () => {
    await expectRefusal({ postId: "" }, /post id/i);
  });

  it("refuses a saga persisted before the pivot recorded its channel identities", async () => {
    await expectRefusal({ channelIds: null, jobIds: ["job-c1"] }, /channel/i);
  });

  it("refuses when the pivot scheduled zero channels", async () => {
    await expectRefusal({ channelIds: [], jobIds: [] }, /channel/i);
  });

  it("refuses when the recorded channels and jobs disagree in number", async () => {
    await expectRefusal({ channelIds: ["c1", "c2"], jobIds: ["job-c1"] }, /channel|job/i);
  });

  it("refuses when the wait step did not report publishing complete", async () => {
    await expectRefusal({ publishingComplete: false }, /complete/i);
  });

  it("refuses when any publish job failed", async () => {
    await expectRefusal({ failed: 1 }, /failed/i);
  });

  it("refuses when fewer jobs completed than were scheduled", async () => {
    await expectRefusal({ completed: 0 }, /complet/i);
  });

  it("refuses when the job total disagrees with the channels the pivot scheduled", async () => {
    await expectRefusal({ channelIds: ["c1", "c2"], jobIds: ["j1", "j2"], totalJobs: 1 }, /job/i);
  });
});
