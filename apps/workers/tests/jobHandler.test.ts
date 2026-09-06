/**
 * @file jobHandler.test.ts
 * @description Tests for PublishHandler.handleJob
 * @layer infrastructure
 */
import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
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

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createTestDeps();
    const p = deps.providerRegistry["x"];
    assert.ok(p, "x provider must exist in test registry");
    xProvider = p;
    handler = new PublishHandler(deps);
  });

  it("should skip when dedupeKey already has OK status (idempotency)", async () => {
    deps.repo.getLogByDedupeKey = async () => ({
      ok: true,
      value: { status: "OK" },
    });

    let publishCalled = false;
    xProvider.publish = async () => {
      publishCalled = true;
      return { ok: true, value: createTestPublishReceipt() };
    };

    await handler.handleJob({
      payload: { postId: POST_ID, channelId: CHANNEL_ID },
      dedupeKey: `${POST_ID}:${CHANNEL_ID}`,
    });

    assert.strictEqual(publishCalled, false);

    const skipped = await deps.workerMetrics.metrics.jobsSkipped.get();
    assert.strictEqual(skipped.values[0]?.value, 1);
  });

  it("should proceed when dedupeKey has ERR status (retry)", async () => {
    deps.repo.getLogByDedupeKey = async () => ({
      ok: true,
      value: { status: "ERR" },
    });

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

    await handler.handleJob({
      payload: { postId: POST_ID, channelId: CHANNEL_ID },
    });

    const completed = await deps.workerMetrics.metrics.jobsCompleted.get();
    const match = completed.values.find((v) => v.labels.content_type === "single");
    assert.ok(match);
    assert.strictEqual(match.value, 1);
  });

  it("should handle post not found gracefully", async () => {
    deps.repo.getLogByDedupeKey = async () => ({
      ok: true,
      value: null,
    });
    deps.repo.getPostById = async () => ({
      ok: false,
      error: "NOT_FOUND",
    });

    // handleJob re-throws so BullMQ's retry policy can take effect.
    await assert.rejects(
      handler.handleJob({
        payload: { postId: POST_ID, channelId: CHANNEL_ID },
      })
    );

    const failed = await deps.workerMetrics.metrics.jobsFailed.get();
    const match = failed.values.find((v) => v.labels.error_category === "processing_error");
    assert.ok(match);
    assert.strictEqual(match.value, 1);
  });

  it("should handle render failure gracefully", async () => {
    deps.repo.getLogByDedupeKey = async () => ({
      ok: true,
      value: null,
    });
    deps.repo.getPostById = async () => ({
      ok: true,
      value: createTestPost({ id: POST_ID }),
    });
    xProvider.render = () => ({
      ok: false,
      error: "TEXT_TOO_LONG" as const,
    });

    await assert.rejects(
      handler.handleJob({
        payload: { postId: POST_ID, channelId: CHANNEL_ID },
      })
    );

    const failed = await deps.workerMetrics.metrics.jobsFailed.get();
    const match = failed.values.find((v) => v.labels.error_category === "processing_error");
    assert.ok(match);
    assert.strictEqual(match.value, 1);

    const errors = await deps.workerMetrics.metrics.errorsByType.get();
    const renderErr = errors.values.find(
      (v) => v.labels.component === "renderer" && v.labels.error_type === "render_failed"
    );
    assert.ok(renderErr);
  });

  it("should route single content to publishSinglePost", async () => {
    deps.repo.getLogByDedupeKey = async () => ({
      ok: true,
      value: null,
    });
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

    await handler.handleJob({
      payload: { postId: POST_ID, channelId: CHANNEL_ID },
    });

    assert.ok(publishCalledWith);
    assert.strictEqual(publishCalledWith.channelId, CHANNEL_ID);

    const completed = await deps.workerMetrics.metrics.jobsCompleted.get();
    const match = completed.values.find((v) => v.labels.content_type === "single");
    assert.ok(match);
    assert.strictEqual(match.value, 1);
  });

  it("should route thread content to publishThreadPost", async () => {
    const plan = createTestThreadPlan();

    deps.repo.getLogByDedupeKey = async () => ({
      ok: true,
      value: null,
    });
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

    await handler.handleJob({
      payload: { postId: POST_ID, channelId: CHANNEL_ID },
    });

    assert.strictEqual(publishThreadCalled, true);

    const completed = await deps.workerMetrics.metrics.jobsCompleted.get();
    const match = completed.values.find((v) => v.labels.content_type === "thread");
    assert.ok(match);
    assert.strictEqual(match.value, 1);
  });

  it("should generate dedupeKey from postId:channelId when not provided", async () => {
    deps.repo.getLogByDedupeKey = async () => ({
      ok: true,
      value: null,
    });
    deps.repo.getPostById = async () => ({
      ok: true,
      value: createTestPost({ id: POST_ID }),
    });

    const rendered = createTestRenderedPost();
    xProvider.render = () => ({
      ok: true,
      value: { type: "single" as const, content: rendered },
    });
    xProvider.publish = async () => ({
      ok: true,
      value: createTestPublishReceipt(),
    });

    let loggedDedupeKey: string | undefined;
    deps.repo.logPublish = async (input) => {
      if (input.status === "RUNNING") {
        loggedDedupeKey = input.dedupeKey;
      }
      return { ok: true, value: {} };
    };

    await handler.handleJob({
      payload: { postId: POST_ID, channelId: CHANNEL_ID },
      // no dedupeKey provided
    });

    assert.strictEqual(loggedDedupeKey, `${POST_ID}:${CHANNEL_ID}`);
  });

  it("should use provided dedupeKey when available", async () => {
    const customDedupeKey = "custom-dedupe-key-123";

    deps.repo.getLogByDedupeKey = async () => ({
      ok: true,
      value: null,
    });
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

    let loggedDedupeKey: string | undefined;
    deps.repo.logPublish = async (input) => {
      if (input.status === "RUNNING") {
        loggedDedupeKey = input.dedupeKey;
      }
      return { ok: true, value: {} };
    };

    await handler.handleJob({
      payload: { postId: POST_ID, channelId: CHANNEL_ID },
      dedupeKey: customDedupeKey,
    });

    assert.strictEqual(loggedDedupeKey, customDedupeKey);
  });

  it("should increment and decrement jobsActive gauge", async () => {
    deps.repo.getLogByDedupeKey = async () => ({
      ok: true,
      value: { status: "OK" },
    });

    // Before the job
    const before = await deps.workerMetrics.metrics.jobsActive.get();
    assert.strictEqual(before.values[0]?.value, 0);

    await handler.handleJob({
      payload: { postId: POST_ID, channelId: CHANNEL_ID },
    });

    // After the job completes, active should be back to 0
    const after = await deps.workerMetrics.metrics.jobsActive.get();
    assert.strictEqual(after.values[0]?.value, 0);
  });

  it("should log RUNNING status before publishing", async () => {
    deps.repo.getLogByDedupeKey = async () => ({
      ok: true,
      value: null,
    });
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

    const logStatuses: string[] = [];
    deps.repo.logPublish = async (input) => {
      logStatuses.push(input.status);
      return { ok: true, value: {} };
    };

    await handler.handleJob({
      payload: { postId: POST_ID, channelId: CHANNEL_ID },
    });

    assert.ok(logStatuses.includes("RUNNING"));
    // RUNNING should come before OK
    const runningIdx = logStatuses.indexOf("RUNNING");
    const okIdx = logStatuses.indexOf("OK");
    assert.ok(runningIdx < okIdx, "RUNNING should be logged before OK");
  });

  it("should record worker error on unhandled exception", async () => {
    deps.repo.getLogByDedupeKey = async () => {
      throw new Error("Unexpected DB crash");
    };

    await assert.rejects(
      handler.handleJob({
        payload: { postId: POST_ID, channelId: CHANNEL_ID },
      })
    );

    const errors = await deps.workerMetrics.metrics.errorsByType.get();
    const match = errors.values.find(
      (v) => v.labels.component === "worker" && v.labels.error_type === "job_failed"
    );
    assert.ok(match);
    assert.strictEqual(match.value, 1);
  });

  it("should decrement jobsActive even on error", async () => {
    deps.repo.getLogByDedupeKey = async () => {
      throw new Error("crash");
    };

    await assert.rejects(
      handler.handleJob({
        payload: { postId: POST_ID, channelId: CHANNEL_ID },
      })
    );

    const value = await deps.workerMetrics.metrics.jobsActive.get();
    assert.strictEqual(value.values[0]?.value, 0);
  });

  it("should throw for unknown provider name", async () => {
    deps.repo.getLogByDedupeKey = async () => ({
      ok: true,
      value: null,
    });

    // handleJob re-throws after recording the error so BullMQ retries.
    await assert.rejects(
      handler.handleJob({
        payload: { postId: POST_ID, channelId: CHANNEL_ID, provider: "unknown_platform" },
      }),
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

    deps.repo.getLogByDedupeKey = async () => ({
      ok: true,
      value: null,
    });
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

    await handler.handleJob({
      payload: { postId: POST_ID, channelId: CHANNEL_ID, provider: "instagram" },
    });

    assert.strictEqual(publishCalledOnInstagram, true, "Instagram provider should be called");
    assert.strictEqual(publishCalledOnX, false, "X provider should NOT be called");
  });

  describe("deletion liveness gate — SOFT_DELETED chain", () => {
    it("completes as a no-op (no publish, no publish_log, no failure) when the chain is soft-deleted", async () => {
      deps.repo.getLogByDedupeKey = async () => ({ ok: true, value: null });
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
      await handler.handleJob({
        payload: { postId: POST_ID, channelId: CHANNEL_ID },
      });

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
      deps.repo.getLogByDedupeKey = async () => ({ ok: true, value: null });
      deps.repo.getPostById = async () => ({ ok: false, error: "NOT_FOUND" });

      await assert.rejects(
        handler.handleJob({
          payload: { postId: POST_ID, channelId: CHANNEL_ID },
        })
      );

      const skipped = await deps.workerMetrics.metrics.jobsSkipped.get();
      assert.strictEqual(
        skipped.values[0]?.value ?? 0,
        0,
        "NOT_FOUND must not be swallowed as a skip"
      );
    });
  });

  it("should default to 'x' provider when no provider specified", async () => {
    deps.repo.getLogByDedupeKey = async () => ({
      ok: true,
      value: null,
    });
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

    await handler.handleJob({
      payload: { postId: POST_ID, channelId: CHANNEL_ID },
      // no provider specified
    });

    assert.strictEqual(publishCalledOnX, true, "Should default to X provider");
  });
});
