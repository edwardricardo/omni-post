/**
 * @file jobHandler.test.ts
 * @description Tests for PublishHandler.handleJob
 * @layer infrastructure
 */
import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { mintPublishJobId, ok, readPublishJobId } from "@shared/types";
import {
  createTestDeps,
  createTestPost,
  createTestRenderedPost,
  createTestPublishReceipt,
  createTestThreadPlan,
  createTestThread,
  createTestTweet,
  createTestThreadReceipt,
  createMockProvider,
  RecordingOutcomeRecorder,
  StubPublicationRecordProbe,
  TEST_ATTEMPT,
} from "./setup.js";
import { PublishHandler } from "../src/publishHandler.js";
import type { PublishHandlerDeps, PublishProvider } from "../src/publishHandler.js";

describe("PublishHandler.handleJob", { sequential: true }, () => {
  let deps: PublishHandlerDeps;
  let handler: PublishHandler;
  /** Shortcut to the "x" mock provider in the registry. */
  let xProvider: PublishProvider;

  const POST_ID = "post-job-001";
  const CHANNEL_ID = "channel-x-001";
  /** The id the pivot mints: one per channel, per episode. */
  const JOB_ID = mintPublishJobId({ postId: POST_ID, channelId: CHANNEL_ID, episode: 1 });
  /**
   * The same id with its episode removed — one receipt mirror row per target. Read
   * back through the reader the handler itself uses, so this fixture cannot come to
   * disagree with the id it is derived from.
   */
  const JOB_IDENTITY = readPublishJobId(JOB_ID);
  assert.ok(JOB_IDENTITY, "a minted job id must name an episode");
  const MIRROR_KEY = JOB_IDENTITY.mirrorKey;

  let probe: StubPublicationRecordProbe;
  let recorder: RecordingOutcomeRecorder;

  /** A well-formed job, so a scenario states only what it is about. */
  const job = (payload: Partial<Parameters<PublishHandler["handleJob"]>[0]["payload"]> = {}) => ({
    payload: {
      postId: POST_ID,
      channelId: CHANNEL_ID,
      accountId: TEST_ATTEMPT.accountId,
      ...payload,
    },
    dedupeKey: JOB_ID,
    attemptsMade: 0,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createTestDeps();
    probe = deps.publicationRecord as StubPublicationRecordProbe;
    recorder = deps.outcomeRecorder as RecordingOutcomeRecorder;
    const p = deps.providerRegistry["x"];
    assert.ok(p, "x provider must exist in test registry");
    xProvider = p;
    handler = new PublishHandler(deps);
  });

  it("skips a channel the record already published, and tells the saga so", async () => {
    probe.answer = () => ok({ episode: 1, outcome: "published" });

    let publishCalled = false;
    xProvider.publish = async () => {
      publishCalled = true;
      return { ok: true, value: createTestPublishReceipt() };
    };
    const sagaEvents: string[] = [];
    deps.notifyRedis = {
      publish: async (_channel: string, message: string) => {
        sagaEvents.push(message);
        return 1;
      },
    };
    handler = new PublishHandler(deps);

    await handler.handleJob(job({ sagaId: "saga-001" }));

    assert.strictEqual(publishCalled, false);
    assert.strictEqual(recorder.receipts.length, 0, "a settled channel records no new attempt");
    assert.strictEqual(sagaEvents.length, 1);
    assert.match(sagaEvents[0] ?? "", /publish\.job\.completed/);

    const skipped = await deps.workerMetrics.metrics.jobsSkipped.get();
    assert.strictEqual(skipped.values[0]?.value, 1);
  });

  it("publishes a channel the record still leaves unresolved", async () => {
    probe.answer = () => ok({ episode: 1, outcome: "unresolved" });

    const post = createTestPost({ id: POST_ID });
    deps.repo.getPostById = async () => ({ ok: true, value: post });

    const rendered = createTestRenderedPost();
    xProvider.render = () => ({
      ok: true,
      value: { type: "single" as const, content: rendered },
    });
    xProvider.publish = async () => ({
      ok: true,
      value: createTestPublishReceipt(),
    });

    await handler.handleJob(job());

    const completed = await deps.workerMetrics.metrics.jobsCompleted.get();
    const match = completed.values.find((v) => v.labels.content_type === "single");
    assert.ok(match);
    assert.strictEqual(match.value, 1);
  });

  it("should handle post not found gracefully", async () => {
    deps.repo.getPostById = async () => ({
      ok: false,
      error: "NOT_FOUND",
    });

    // handleJob re-throws so BullMQ's retry policy can take effect.
    await assert.rejects(handler.handleJob(job()));

    const failed = await deps.workerMetrics.metrics.jobsFailed.get();
    const match = failed.values.find((v) => v.labels.error_category === "processing_error");
    assert.ok(match);
    assert.strictEqual(match.value, 1);
  });

  it("records a render failure as the channel's own cause and completes the job", async () => {
    deps.repo.getPostById = async () => ({
      ok: true,
      value: createTestPost({ id: POST_ID }),
    });
    xProvider.render = () => ({
      ok: false,
      error: "TEXT_TOO_LONG" as const,
    });

    // Content this channel cannot render is that channel's problem, not a
    // transient one: retrying sends the same content into the same limit.
    await handler.handleJob(job());

    assert.strictEqual(recorder.receipts.length, 1);
    const receipt = recorder.receipts[0];
    assert.ok(receipt);
    assert.strictEqual(
      receipt.result.kind === "failed" ? receipt.result.code : undefined,
      "RENDER_FAILED",
      "the render error VALUE reaches the classifier, not a string built from it"
    );

    const errors = await deps.workerMetrics.metrics.errorsByType.get();
    const renderErr = errors.values.find(
      (v) => v.labels.component === "renderer" && v.labels.error_type === "render_failed"
    );
    assert.ok(renderErr);
  });

  it("should route single content to publishSinglePost", async () => {
    deps.repo.getPostById = async () => ({
      ok: true,
      value: createTestPost({ id: POST_ID }),
    });

    const rendered = createTestRenderedPost();
    xProvider.render = () => ({
      ok: true,
      value: { type: "single" as const, content: rendered },
    });

    let publishCalledWith: Record<string, unknown> | undefined;
    xProvider.publish = async (input) => {
      publishCalledWith = input as unknown as Record<string, unknown>;
      return { ok: true, value: createTestPublishReceipt() };
    };

    await handler.handleJob(job());

    assert.ok(publishCalledWith);
    assert.strictEqual(publishCalledWith.channelId, CHANNEL_ID);

    const completed = await deps.workerMetrics.metrics.jobsCompleted.get();
    const match = completed.values.find((v) => v.labels.content_type === "single");
    assert.ok(match);
    assert.strictEqual(match.value, 1);
  });

  it("should route thread content to publishThreadPost", async () => {
    const plan = createTestThreadPlan();

    deps.repo.getPostById = async () => ({
      ok: true,
      value: createTestPost({ id: POST_ID }),
    });
    xProvider.render = () => ({
      ok: true,
      value: { type: "thread" as const, content: plan },
    });

    // Setup thread publishing dependencies
    deps.repo.createThread = async () => ({
      ok: true,
      value: createTestThread(),
    });
    deps.repo.createTweet = async () => ({
      ok: true,
      value: createTestTweet(),
    });
    deps.repo.getTweetsByThread = async () => ({
      ok: true,
      value: [
        createTestTweet({ sequenceNumber: 1 }),
        createTestTweet({ id: "tweet-002", sequenceNumber: 2 }),
      ],
    });

    let publishThreadCalled = false;
    xProvider.publishThread = async () => {
      publishThreadCalled = true;
      return { ok: true, value: createTestThreadReceipt() };
    };

    await handler.handleJob(job());

    assert.strictEqual(publishThreadCalled, true);

    const completed = await deps.workerMetrics.metrics.jobsCompleted.get();
    const match = completed.values.find((v) => v.labels.content_type === "thread");
    assert.ok(match);
    assert.strictEqual(match.value, 1);
  });

  it("refuses a job whose id names no episode, and one that names no tenant", async () => {
    let publishCalled = false;
    xProvider.publish = async () => {
      publishCalled = true;
      return { ok: true, value: createTestPublishReceipt() };
    };
    handler = new PublishHandler(deps);

    for (const malformed of [
      { ...job(), dedupeKey: `${POST_ID}:${CHANNEL_ID}` },
      { ...job(), payload: { ...job().payload, accountId: "" } },
    ]) {
      await assert.rejects(handler.handleJob(malformed), (raised: Error) => {
        // UnrecoverableError, so BullMQ retires the job instead of spending its
        // retry budget on a payload that cannot become well-formed.
        assert.strictEqual(raised.name, "UnrecoverableError");
        return true;
      });
    }

    assert.strictEqual(publishCalled, false, "nothing is sent for a job that is refused");
    assert.strictEqual(probe.reads.length, 0, "the refusal precedes every read");

    const refused = await deps.workerMetrics.metrics.publishJobUnrecoverable.get();
    const match = refused.values.find((v) => v.labels.reason === "pre_change_job");
    assert.ok(match);
    assert.strictEqual(match.value, 2);
  });

  it("refuses a job whose channel the record does not hold", async () => {
    probe.answer = () => ok(undefined);

    await assert.rejects(handler.handleJob(job()), (raised: Error) => {
      assert.strictEqual(raised.name, "UnrecoverableError");
      return true;
    });

    const refused = await deps.workerMetrics.metrics.publishJobUnrecoverable.get();
    const match = refused.values.find((v) => v.labels.reason === "missing_record");
    assert.ok(match);
    assert.strictEqual(match.value, 1);
  });

  it("returns without publishing when the record has moved to another episode", async () => {
    probe.answer = () => ok({ episode: 2, outcome: "unresolved" });

    let publishCalled = false;
    xProvider.publish = async () => {
      publishCalled = true;
      return { ok: true, value: createTestPublishReceipt() };
    };
    handler = new PublishHandler(deps);

    await handler.handleJob(job());

    assert.strictEqual(publishCalled, false, "a superseded episode sends nothing");
    const refused = await deps.workerMetrics.metrics.publishJobUnrecoverable.get();
    const match = refused.values.find((v) => v.labels.reason === "stale_episode");
    assert.ok(match);
    assert.strictEqual(match.value, 1);
  });

  it("should increment and decrement jobsActive gauge", async () => {
    probe.answer = () => ok({ episode: 1, outcome: "published" });

    // Before the job
    const before = await deps.workerMetrics.metrics.jobsActive.get();
    assert.strictEqual(before.values[0]?.value, 0);

    await handler.handleJob(job());

    // After the job completes, active should be back to 0
    const after = await deps.workerMetrics.metrics.jobsActive.get();
    assert.strictEqual(after.values[0]?.value, 0);
  });

  it("writes one OK receipt, keyed without the episode, after the record commits", async () => {
    deps.repo.getPostById = async () => ({
      ok: true,
      value: createTestPost({ id: POST_ID }),
    });
    xProvider.render = () => ({
      ok: true,
      value: {
        type: "single" as const,
        content: createTestRenderedPost(),
      },
    });
    xProvider.publish = async () => ({
      ok: true,
      value: createTestPublishReceipt(),
    });

    const order: string[] = [];
    const settle = recorder.answer;
    recorder.answer = (receipt) => {
      order.push("record");
      return settle(receipt);
    };
    const rows: Array<{ status: string; dedupeKey: string }> = [];
    deps.repo.logPublish = async (input) => {
      order.push(`log:${input.status}`);
      rows.push({ status: input.status, dedupeKey: input.dedupeKey });
      return { ok: true, value: {} };
    };
    handler = new PublishHandler(deps);

    await handler.handleJob(job());

    // No RUNNING and no ERR: the log is a receipt mirror now, and a row written
    // before the record would be the only durable trace of a publication the
    // record does not account for.
    assert.deepStrictEqual(order, ["record", "log:OK"]);
    assert.deepStrictEqual(rows, [{ status: "OK", dedupeKey: MIRROR_KEY }]);
  });

  it("should record worker error on unhandled exception", async () => {
    probe.answer = () => {
      throw new Error("Unexpected DB crash");
    };

    await assert.rejects(handler.handleJob(job()));

    const errors = await deps.workerMetrics.metrics.errorsByType.get();
    const match = errors.values.find(
      (v) => v.labels.component === "worker" && v.labels.error_type === "job_failed"
    );
    assert.ok(match);
    assert.strictEqual(match.value, 1);
  });

  it("should decrement jobsActive even on error", async () => {
    probe.answer = () => {
      throw new Error("crash");
    };

    await assert.rejects(handler.handleJob(job()));

    const value = await deps.workerMetrics.metrics.jobsActive.get();
    assert.strictEqual(value.values[0]?.value, 0);
  });

  it("should throw for unknown provider name", async () => {
    // handleJob re-throws after recording the error so BullMQ retries.
    await assert.rejects(
      handler.handleJob(job({ provider: "unknown_platform" })),
      /Unknown provider/
    );

    const failed = await deps.workerMetrics.metrics.jobsFailed.get();
    const match = failed.values.find((v) => v.labels.error_category === "processing_error");
    assert.ok(match);
    assert.strictEqual(match.value, 1);
  });

  it("should route to specific provider from payload", async () => {
    // Add instagram mock to registry
    const instagramProvider = createMockProvider();
    deps.providerRegistry["instagram"] = instagramProvider;
    handler = new PublishHandler(deps);

    deps.repo.getPostById = async () => ({
      ok: true,
      value: createTestPost({ id: POST_ID }),
    });

    const rendered = createTestRenderedPost();
    instagramProvider.render = () => ({
      ok: true,
      value: { type: "single" as const, content: rendered },
    });

    let publishCalledOnInstagram = false;
    instagramProvider.publish = async () => {
      publishCalledOnInstagram = true;
      return { ok: true, value: createTestPublishReceipt() };
    };

    let publishCalledOnX = false;
    xProvider.publish = async () => {
      publishCalledOnX = true;
      return { ok: true, value: createTestPublishReceipt() };
    };

    await handler.handleJob(job({ provider: "instagram" }));

    assert.strictEqual(publishCalledOnInstagram, true, "Instagram provider should be called");
    assert.strictEqual(publishCalledOnX, false, "X provider should NOT be called");
  });

  describe("deletion liveness gate — SOFT_DELETED chain", () => {
    it("completes as a no-op (no publish, no publish_log, no failure) when the chain is soft-deleted", async () => {
      // The db-prisma adapter classifies a dead post -> project -> account chain
      // as "SOFT_DELETED", distinct from "NOT_FOUND". Fidelity pinned in
      // packages/adapters/db-prisma/tests/postRepositoryLiveness.test.ts.
      deps.repo.getPostById = async () => ({ ok: false, error: "SOFT_DELETED" });

      let publishCalled = false;
      xProvider.publish = async () => {
        publishCalled = true;
        return { ok: true, value: createTestPublishReceipt() };
      };
      const logStatuses: string[] = [];
      deps.repo.logPublish = async (input) => {
        logStatuses.push(input.status);
        return { ok: true, value: {} };
      };

      // Adjudicated semantics: a job for a deleted entity is NOT an error to
      // retry — BullMQ retrying it would republish the content if the entity is
      // restored after the fact. The job must RESOLVE (terminal no-op).
      await handler.handleJob(job());

      assert.strictEqual(
        publishCalled,
        false,
        "provider.publish must never run for a deleted chain"
      );
      assert.deepStrictEqual(logStatuses, [], "no publish_log rows for a deleted chain");

      const skipped = await deps.workerMetrics.metrics.jobsSkipped.get();
      assert.strictEqual(skipped.values[0]?.value, 1, "the no-op counts as a skipped job");
      const failed = await deps.workerMetrics.metrics.jobsFailed.get();
      assert.strictEqual(failed.values[0]?.value ?? 0, 0, "a deleted chain is not a job failure");

      const active = await deps.workerMetrics.metrics.jobsActive.get();
      assert.strictEqual(active.values[0]?.value, 0, "the job must still finish cleanly");
    });

    it("still throws (BullMQ retry policy) for NOT_FOUND — the terminal no-op is deletion-specific", async () => {
      deps.repo.getPostById = async () => ({ ok: false, error: "NOT_FOUND" });

      await assert.rejects(handler.handleJob(job()));

      const skipped = await deps.workerMetrics.metrics.jobsSkipped.get();
      assert.strictEqual(
        skipped.values[0]?.value ?? 0,
        0,
        "NOT_FOUND must not be swallowed as a skip"
      );
    });
  });

  it("should default to 'x' provider when no provider specified", async () => {
    deps.repo.getPostById = async () => ({
      ok: true,
      value: createTestPost({ id: POST_ID }),
    });

    const rendered = createTestRenderedPost();
    xProvider.render = () => ({
      ok: true,
      value: { type: "single" as const, content: rendered },
    });

    let publishCalledOnX = false;
    xProvider.publish = async () => {
      publishCalledOnX = true;
      return { ok: true, value: createTestPublishReceipt() };
    };

    await handler.handleJob(job());

    assert.strictEqual(publishCalledOnX, true, "Should default to X provider");
  });
});
