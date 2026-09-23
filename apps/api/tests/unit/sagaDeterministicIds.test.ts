/**
 * @file sagaDeterministicIds.test.ts
 * @description Verifies that saga steps emit deterministic command IDs keyed
 *              on (sagaId, stepId) so retries collapse to a single dedupeKey
 *              instead of fanning out per-attempt (Richardson saga + Azure
 *              §15-20 OCC), and that the publish-now path decides from the
 *              post's per-channel PUBLICATION RECORD rather than from queue
 *              state: the pivot opens an attempt episode before it enqueues,
 *              the wait step settles only when every scheduled channel has a
 *              recorded outcome, and the promotion step forwards that outcome
 *              whole — failures included.
 * @layer infrastructure
 */
import { describe, it, expect } from "vitest";
import {
  CreatePostStep,
  SchedulePublishingJobsStep,
  UpdatePostStatusStep,
  WaitForPublishingCompletionStep,
  createPostPublishingSagaDefinition,
  createSagaContext,
  type PublicationChannelView,
  type PublicationRecordView,
  type RereadCheck,
  type SagaContext,
} from "@shared/types/saga.js";
import { ok, err, type Result } from "@shared/types";
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
  /** What the wait step recorded, when the case starts after it ran. */
  channels?: PublishChannelReportSeed[] | null;
  mode?: string;
}

/** One entry of the outcome the wait step records for the promotion to forward. */
interface PublishChannelReportSeed {
  channelId: string;
  success: boolean;
  externalId?: string;
  error?: string;
  reasonCode?: string;
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
  const channels =
    seed.channels === undefined
      ? (channelIds ?? []).map((channelId) => ({ channelId, success: true }))
      : seed.channels;

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
    ...(channels !== null && { channels }),
  };

  return ctx;
}

/** A published channel, as the record answers for it. */
function published(channelId: string, externalId = `ext-${channelId}`): PublicationChannelView {
  return { channelId, outcome: "published", externalId, redrivable: false };
}

/** A channel that settled without publishing, carrying the code a reader branches on. */
function excluded(
  channelId: string,
  reasonCode = "CONTENT_REJECTED",
  reasonDetail = "the provider rejected the content"
): PublicationChannelView {
  return { channelId, outcome: "excluded", reasonCode, reasonDetail, redrivable: true };
}

/** A channel the record holds with no settlement yet: the step must ask again. */
function unresolved(channelId: string): PublicationChannelView {
  return { channelId, outcome: "unresolved", redrivable: true };
}

/** A channel holding live fragments, which no episode may be opened for. */
function pendingRetraction(channelId: string): PublicationChannelView {
  return { channelId, outcome: "excluded", reasonCode: "THREAD_INTERRUPTED", redrivable: false };
}

/** A reader that answers with the given record, whatever post it is asked about. */
function recordReader(
  record: PublicationRecordView | undefined
): (postId: string) => Promise<Result<PublicationRecordView | undefined, string>> {
  return async () => ok(record);
}

/** A reader that could not observe the record at all. */
function unreadableRecord(
  reason = "connection refused"
): (postId: string) => Promise<Result<PublicationRecordView | undefined, string>> {
  return async () => err(reason);
}

/** Records every command a step emitted while answering each one with success. */
function recordingExecutor(): { commands: Command[]; execute: (c: Command) => Promise<unknown> } {
  const commands: Command[] = [];
  return {
    commands,
    execute: async (command: Command) => {
      commands.push(command);
      return { success: true, data: openedFor(command) };
    },
  };
}

/**
 * The answer an accepted `post.open-publication-episode` carries: every channel
 * the command named, opened at episode 1. Any other command type gets the empty
 * data the other steps already ignore.
 */
function openedFor(command: Command): Record<string, unknown> {
  if (command.type !== "post.open-publication-episode") {
    return {};
  }
  const data = command.data as { channelIds?: string[] };
  return {
    postId: command.aggregateId,
    opened: (data.channelIds ?? []).map((channelId) => ({ channelId, episode: 1 })),
    alreadyOpen: false,
    status: "PUBLISHING",
  };
}

/** Every job the pivot handed to the queue, in the order it enqueued them. */
function recordingQueue(): {
  jobs: Record<string, unknown>[];
  enqueue: (j: Record<string, unknown>) => Promise<string>;
} {
  const jobs: Record<string, unknown>[] = [];
  return {
    jobs,
    enqueue: async (job: Record<string, unknown>) => {
      jobs.push(job);
      return `job-${String(job.channelId)}`;
    },
  };
}

/** The pivot's reread countermeasure, as the composition attaches it. */
function pivotReread(
  read: (postId: string) => Promise<Result<PublicationRecordView | undefined, string>>
): RereadCheck {
  const definition = createPostPublishingSagaDefinition(
    async () => ({ success: true }),
    async () => "never enqueued",
    read
  );
  const pivot = definition.steps[definition.pivotStepIndex];
  const reread = pivot?.countermeasures?.rereadCheck;
  if (reread === undefined) {
    throw new Error("the composition attached no reread countermeasure to the pivot");
  }
  return reread;
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

  it("SchedulePublishingJobsStep opens its episode under one ID across retries", async () => {
    const executor = recordingExecutor();
    const step = new SchedulePublishingJobsStep(executor.execute, recordingQueue().enqueue);

    const ctx = makeContext();
    await step.execute(ctx);
    await step.execute(ctx);

    const ids = executor.commands.map((command) => command.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBe("cmd-saga-fixed-id-schedule-publishing-jobs");
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

describe("the pivot opens an attempt episode before it enqueues anything", () => {
  it("issues post.open-publication-episode for the channels the request named", async () => {
    const executor = recordingExecutor();
    const step = new SchedulePublishingJobsStep(executor.execute, recordingQueue().enqueue);

    const result = await step.execute(makeContext({ channelIds: ["c1", "c2"] }));

    expect(result.outcome).toBe("succeeded");
    expect(executor.commands).toHaveLength(1);
    const emitted = executor.commands[0]!;
    expect(emitted.type).toBe("post.open-publication-episode");
    expect(emitted.aggregateId).toBe(POST_ID);
    expect(emitted.data).toStrictEqual({
      channelIds: ["c1", "c2"],
      enterPublishing: true,
    });
  });

  it("does not enter the publication family for a scheduled post", async () => {
    const executor = recordingExecutor();
    const step = new SchedulePublishingJobsStep(executor.execute, recordingQueue().enqueue);

    await step.execute(makeContext({ mode: "schedule" }));

    const data = executor.commands[0]!.data as Record<string, unknown>;
    expect(data.enterPublishing).toBe(false);
  });

  it("enqueues one job per OPENED channel, each carrying the episode it was opened at", async () => {
    // The episode is what makes the job id episode-scoped, so a re-drive is a
    // new job instead of a BullMQ no-op against the retained id of the last one.
    const queue = recordingQueue();
    const step = new SchedulePublishingJobsStep(recordingExecutor().execute, queue.enqueue);

    await step.execute(makeContext({ channelIds: ["c1", "c2"] }));

    expect(queue.jobs.map((job) => job.channelId)).toStrictEqual(["c1", "c2"]);
    expect(queue.jobs.map((job) => job.episode)).toStrictEqual([1, 1]);
  });

  it("enqueues only the channels the episode opened, never the whole request", async () => {
    // A published channel is not re-sent, so the opener answers with a subset and
    // the pivot must follow it — enqueueing the request would double-post.
    const queue = recordingQueue();
    const step = new SchedulePublishingJobsStep(
      async () => ({ success: true, data: { opened: [{ channelId: "c2", episode: 4 }] } }),
      queue.enqueue
    );

    const ctx = makeContext({ channelIds: ["c1", "c2"] });
    await step.execute(ctx);

    expect(queue.jobs.map((job) => job.channelId)).toStrictEqual(["c2"]);
    expect(queue.jobs.map((job) => job.episode)).toStrictEqual([4]);
    const recorded = ctx.stepData["schedule-publishing-jobs"] as { channelIds: string[] };
    expect(recorded.channelIds).toStrictEqual(["c2"]);
  });

  it("records the channels it enqueued, index-aligned with the job ids", async () => {
    const queue = recordingQueue();
    const step = new SchedulePublishingJobsStep(recordingExecutor().execute, queue.enqueue);

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
    // Index-aligned: the promotion pairs one with the other by position, so a
    // matching length alone would let a reordering pass.
    expect(recorded.jobIds).toStrictEqual(["job-c1", "job-c2", "job-c3"]);
  });

  it("enqueues NOTHING when the episode is refused, and reports the refusal", async () => {
    const queue = recordingQueue();
    const step = new SchedulePublishingJobsStep(
      async () => ({ success: false, error: "CHANNEL_HAS_LIVE_FRAGMENTS: channel c1 …" }),
      queue.enqueue
    );

    const result = await step.execute(makeContext());

    expect(result.outcome).toBe("failed");
    expect(result.outcome === "failed" && result.error).toContain("CHANNEL_HAS_LIVE_FRAGMENTS");
    expect(queue.jobs).toHaveLength(0);
  });

  it("refuses an episode that opened no channel rather than enqueueing nothing quietly", async () => {
    const queue = recordingQueue();
    const step = new SchedulePublishingJobsStep(
      async () => ({ success: true, data: { opened: [] } }),
      queue.enqueue
    );

    const result = await step.execute(makeContext());

    expect(result.outcome).toBe("failed");
    expect(result.outcome === "failed" && result.error).toMatch(/no channel/i);
    expect(queue.jobs).toHaveLength(0);
  });

  it("refuses an opened channel whose episode is not a positive ordinal", async () => {
    // Episode 0 is the ordinal a DECLARED-but-never-attempted record carries, so
    // a job minted at it would name an episode nothing opened.
    const queue = recordingQueue();
    const step = new SchedulePublishingJobsStep(
      async () => ({ success: true, data: { opened: [{ channelId: "c1", episode: 0 }] } }),
      queue.enqueue
    );

    const result = await step.execute(makeContext());

    expect(result.outcome).toBe("failed");
    expect(result.outcome === "failed" && result.error).toMatch(/episode/i);
    expect(queue.jobs).toHaveLength(0);
  });

  it("opens no episode and enqueues nothing for a draft saga", async () => {
    const executor = recordingExecutor();
    const queue = recordingQueue();
    const step = new SchedulePublishingJobsStep(executor.execute, queue.enqueue);

    const ctx = makeContext({ mode: "draft", channelIds: ["c1"] });
    ctx.stepData["schedule-publishing-jobs"] = {};

    await step.execute(ctx);

    expect(executor.commands).toHaveLength(0);
    expect(queue.jobs).toHaveLength(0);
    const recorded = ctx.stepData["schedule-publishing-jobs"] as { channelIds: string[] };
    expect(recorded.channelIds).toStrictEqual([]);
  });
});

describe("the pivot rereads the publication record per channel", () => {
  it("admits a post that carries no publication record yet", async () => {
    const reread = pivotReread(recordReader(undefined));

    const answer = await reread.rereadBeforeUpdate(makeContext({ channelIds: ["c1", "c2"] }));

    expect(answer.stillValid).toBe(true);
  });

  it("admits a request whose every named channel can be attempted again", async () => {
    const reread = pivotReread(recordReader({ channels: [excluded("c1"), unresolved("c2")] }));

    const answer = await reread.rereadBeforeUpdate(makeContext({ channelIds: ["c1", "c2"] }));

    expect(answer.stillValid).toBe(true);
  });

  it("refuses a named channel that is holding live fragments, and names it", async () => {
    const reread = pivotReread(
      recordReader({ channels: [excluded("c1"), pendingRetraction("c2")] })
    );

    const answer = await reread.rereadBeforeUpdate(makeContext({ channelIds: ["c1", "c2"] }));

    expect(answer.stillValid).toBe(false);
    expect(answer.reason).toContain("c2");
    expect(answer.reason).not.toContain("c1");
  });

  it("refuses a named channel that already published", async () => {
    const reread = pivotReread(recordReader({ channels: [published("c1")] }));

    const answer = await reread.rereadBeforeUpdate(makeContext({ channelIds: ["c1"] }));

    expect(answer.stillValid).toBe(false);
    expect(answer.reason).toContain("c1");
  });

  it("ignores a recorded channel this run did not name", async () => {
    const reread = pivotReread(recordReader({ channels: [published("c1"), excluded("c2")] }));

    const answer = await reread.rereadBeforeUpdate(makeContext({ channelIds: ["c2"] }));

    expect(answer.stillValid).toBe(true);
  });

  it("refuses when the record could not be read at all", async () => {
    const reread = pivotReread(unreadableRecord("pool exhausted"));

    const answer = await reread.rereadBeforeUpdate(makeContext());

    expect(answer.stillValid).toBe(false);
    expect(answer.reason).toContain("pool exhausted");
  });
});

describe("the wait step decides from the publication record", () => {
  /** Runs the wait step over one reader and returns both its answer and the context. */
  async function waitOn(
    read: (postId: string) => Promise<Result<PublicationRecordView | undefined, string>>,
    seed: ContextSeed = {}
  ): Promise<{
    result: Awaited<ReturnType<WaitForPublishingCompletionStep["execute"]>>;
    ctx: SagaContext;
  }> {
    const ctx = makeContext({ channels: null, ...seed });
    const result = await new WaitForPublishingCompletionStep(read).execute(ctx);
    return { result, ctx };
  }

  it("fails when the record could not be read, rather than reporting an unfinished wait", async () => {
    // An unreadable dependency is not evidence that work is still in progress:
    // reporting it as waiting spends no budget and makes an outage look exactly
    // like four channels healthily publishing.
    const { result } = await waitOn(unreadableRecord("connection refused"));

    expect(result.outcome).toBe("failed");
    expect(result.outcome === "failed" && result.error).toContain("connection refused");
  });

  it("fails naming the post when it carries no publication record at all", async () => {
    const { result } = await waitOn(recordReader(undefined));

    expect(result.outcome).toBe("failed");
    expect(result.outcome === "failed" && result.error).toContain(POST_ID);
  });

  it("fails naming the channel whose record is missing from the set", async () => {
    // "No record" is never read as "never published": a scheduled channel the
    // record does not hold is a fact nobody wrote, not an outcome.
    const { result } = await waitOn(recordReader({ channels: [published("c1")] }), {
      channelIds: ["c1", "c2"],
    });

    expect(result.outcome).toBe("failed");
    expect(result.outcome === "failed" && result.error).toContain("c2");
  });

  it("waits while any scheduled channel is still unresolved", async () => {
    const { result, ctx } = await waitOn(
      recordReader({ channels: [published("c1"), unresolved("c2")] }),
      { channelIds: ["c1", "c2"] }
    );

    expect(result.outcome).toBe("waiting");
    expect(result.outcome === "waiting" && result.reason).toContain("c2");
    // Nothing is recorded while the answer is "ask again": a half-filled outcome
    // is what the promotion would read if the step were re-entered and failed.
    expect(ctx.stepData["wait-publishing-completion"]).toStrictEqual({});
  });

  it("succeeds recording one outcome entry per scheduled channel once every one settled", async () => {
    const { result, ctx } = await waitOn(
      recordReader({ channels: [published("c1", "ext-1"), excluded("c2")] }),
      { channelIds: ["c1", "c2"] }
    );

    expect(result.outcome).toBe("succeeded");
    const recorded = ctx.stepData["wait-publishing-completion"] as {
      channels: PublishChannelReportSeed[];
    };
    expect(recorded.channels).toStrictEqual([
      { channelId: "c1", success: true, externalId: "ext-1" },
      {
        channelId: "c2",
        success: false,
        error: "the provider rejected the content",
        reasonCode: "CONTENT_REJECTED",
      },
    ]);
  });

  it("settles a channel that will never publish instead of waiting on it forever", async () => {
    // An EXCLUDED channel is resolved. Treating a terminal not-published outcome
    // as unfinished is what parks a publish on its 30-minute horizon.
    const { result } = await waitOn(recordReader({ channels: [excluded("c1")] }));

    expect(result.outcome).toBe("succeeded");
  });

  it("fails a saga persisted before the pivot recorded its channel identities", async () => {
    const { result } = await waitOn(recordReader({ channels: [published("c1")] }), {
      channelIds: null,
      jobIds: ["job-c1"],
    });

    expect(result.outcome).toBe("failed");
    expect(result.outcome === "failed" && result.error).toMatch(/channel/i);
  });

  it("fails when the pivot scheduled zero channels", async () => {
    const { result } = await waitOn(recordReader({ channels: [] }), {
      channelIds: [],
      jobIds: [],
    });

    expect(result.outcome).toBe("failed");
    expect(result.outcome === "failed" && result.error).toMatch(/channel/i);
  });

  it("reads no record for a draft or scheduled saga", async () => {
    for (const mode of ["draft", "schedule"]) {
      let reads = 0;
      const result = await new WaitForPublishingCompletionStep(async () => {
        reads += 1;
        return ok(undefined);
      }).execute(makeContext({ mode, channels: null }));

      expect(result.outcome).toBe("succeeded");
      expect(reads).toBe(0);
    }
  });
});

describe("UpdatePostStatusStep as a forwarder of the publish outcome", () => {
  it("emits post.complete-publishing carrying the outcome the wait step recorded", async () => {
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

  it("FORWARDS a channel that did not publish instead of refusing the outcome", async () => {
    // The step chooses nothing, including whether a partial publish is worth
    // reporting. Refusing here is how a post that half-published reached the
    // saga's timeout with nobody told which half.
    const executor = recordingExecutor();
    const step = new UpdatePostStatusStep(executor.execute);

    const result = await step.execute(
      makeContext({
        channelIds: ["c1", "c2"],
        channels: [
          { channelId: "c1", success: true, externalId: "ext-1" },
          {
            channelId: "c2",
            success: false,
            error: "the provider rejected the content",
            reasonCode: "CONTENT_REJECTED",
          },
        ],
      })
    );

    expect(result.outcome).toBe("succeeded");
    expect(executor.commands[0]!.data).toStrictEqual({
      outcome: {
        channels: [
          { channelId: "c1", success: true, externalId: "ext-1" },
          {
            channelId: "c2",
            success: false,
            error: "the provider rejected the content",
            reasonCode: "CONTENT_REJECTED",
          },
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

describe("UpdatePostStatusStep fails closed over an outcome nobody recorded", () => {
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

  it("refuses a saga persisted before the wait step recorded a per-channel outcome", async () => {
    await expectRefusal({ channels: null }, /outcome/i);
  });

  it("refuses when the wait step recorded an empty outcome", async () => {
    await expectRefusal({ channels: [] }, /channel/i);
  });
});
