/**
 * @file publishThreadPost.test.ts
 * @description Tests for PublishHandler.publishThreadPost
 * @layer infrastructure
 */
import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import {
  createTestDeps,
  createTestThread,
  createTestTweet,
  createTestThreadPlan,
  createTestThreadReceipt,
} from "./setup.js";
import { PublishHandler } from "../src/publishHandler.js";
import type { PublishHandlerDeps, PublishProvider } from "../src/publishHandler.js";

describe("PublishHandler.publishThreadPost", { sequential: true }, () => {
  let deps: PublishHandlerDeps;
  let handler: PublishHandler;
  /** Shortcut to the "x" mock provider in the registry. */
  let xProvider: PublishProvider;

  const POST_ID = "post-thread-001";
  const CHANNEL_ID = "channel-x-001";
  const DEDUPE_KEY = `${POST_ID}:${CHANNEL_ID}`;
  const PROVIDER_NAME = "x";

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createTestDeps();
    const p = deps.providerRegistry["x"];
    assert.ok(p, "x provider must exist in test registry");
    xProvider = p;
    handler = new PublishHandler(deps);
  });

  it("should successfully publish a thread", async () => {
    const plan = createTestThreadPlan();
    const receipt = createTestThreadReceipt();

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
    xProvider.publishThread = async () => ({
      ok: true,
      value: receipt,
    });

    const result = await handler.publishThreadPost(
      POST_ID,
      CHANNEL_ID,
      DEDUPE_KEY,
      plan,
      PROVIDER_NAME,
      xProvider
    );

    assert.deepStrictEqual(result, receipt);
  });

  it("should create tweet records for each fragment in the plan", async () => {
    const plan = createTestThreadPlan({
      tweets: [
        { sequence: 1, text: "First", estimatedChars: 5 },
        { sequence: 2, text: "Second", estimatedChars: 6 },
        { sequence: 3, text: "Third", estimatedChars: 5 },
      ],
    });

    const createdSequences: number[] = [];
    deps.repo.createTweet = async (input) => {
      createdSequences.push(input.sequenceNumber);
      return { ok: true, value: createTestTweet() };
    };

    deps.repo.getTweetsByThread = async () => ({
      ok: true,
      value: [
        createTestTweet({ sequenceNumber: 1 }),
        createTestTweet({ id: "tweet-002", sequenceNumber: 2 }),
        createTestTweet({ id: "tweet-003", sequenceNumber: 3 }),
      ],
    });

    const receipt = createTestThreadReceipt({
      tweets: [
        { sequence: 1, providerTweetId: "x-1", publishedAt: new Date() },
        { sequence: 2, providerTweetId: "x-2", publishedAt: new Date() },
        { sequence: 3, providerTweetId: "x-3", publishedAt: new Date() },
      ],
      totalTweets: 3,
    });
    xProvider.publishThread = async () => ({ ok: true, value: receipt });

    await handler.publishThreadPost(
      POST_ID,
      CHANNEL_ID,
      DEDUPE_KEY,
      plan,
      PROVIDER_NAME,
      xProvider
    );

    assert.deepStrictEqual(createdSequences, [1, 2, 3]);
  });

  it("should skip when thread already exists and is fully published", async () => {
    const plan = createTestThreadPlan();

    deps.repo.createThread = async () => ({
      ok: false,
      error: "THREAD_EXISTS",
    });
    deps.repo.getThreadByPostId = async () => ({
      ok: true,
      value: createTestThread({ id: "existing-thread" }),
    });
    deps.repo.getTweetsByThread = async () => ({
      ok: true,
      value: [
        createTestTweet({ sequenceNumber: 1, status: "PUBLISHED" }),
        createTestTweet({
          id: "tweet-002",
          sequenceNumber: 2,
          status: "PUBLISHED",
        }),
      ],
    });

    // publishThread should NOT be called
    let publishThreadCalled = false;
    xProvider.publishThread = async () => {
      publishThreadCalled = true;
      return { ok: true, value: createTestThreadReceipt() };
    };

    const result = await handler.publishThreadPost(
      POST_ID,
      CHANNEL_ID,
      DEDUPE_KEY,
      plan,
      PROVIDER_NAME,
      xProvider
    );

    assert.strictEqual(result, undefined);
    assert.strictEqual(publishThreadCalled, false);
  });

  it("should throw when thread creation fails with non-THREAD_EXISTS error", async () => {
    const plan = createTestThreadPlan();

    deps.repo.createThread = async () => ({
      ok: false,
      error: "DATABASE_ERROR",
    });

    await assert.rejects(
      () =>
        handler.publishThreadPost(POST_ID, CHANNEL_ID, DEDUPE_KEY, plan, PROVIDER_NAME, xProvider),
      (err: Error) => {
        assert.ok(err.message.includes("Failed to create thread"));
        assert.ok(err.message.includes("DATABASE_ERROR"));
        return true;
      }
    );
  });

  it("should increment threadErrors on creation failure", async () => {
    const plan = createTestThreadPlan();
    deps.repo.createThread = async () => ({
      ok: false,
      error: "DATABASE_ERROR",
    });

    try {
      await handler.publishThreadPost(
        POST_ID,
        CHANNEL_ID,
        DEDUPE_KEY,
        plan,
        PROVIDER_NAME,
        xProvider
      );
    } catch {
      // expected
    }

    const value = await deps.workerMetrics.metrics.threadErrors.get();
    const match = value.values.find(
      (v) => v.labels.phase === "creation" && v.labels.error_type === "thread_creation_failed"
    );
    assert.ok(match);
    assert.strictEqual(match.value, 1);
  });

  it("should throw when tweet creation fails", async () => {
    const plan = createTestThreadPlan();
    deps.repo.createThread = async () => ({
      ok: true,
      value: createTestThread(),
    });
    deps.repo.createTweet = async () => ({
      ok: false,
      error: "DATABASE_ERROR",
    });

    await assert.rejects(
      () =>
        handler.publishThreadPost(POST_ID, CHANNEL_ID, DEDUPE_KEY, plan, PROVIDER_NAME, xProvider),
      (err: Error) => {
        assert.ok(err.message.includes("Failed to create tweet"));
        return true;
      }
    );
  });

  it("should skip existing tweet sequences (SEQUENCE_EXISTS)", async () => {
    const plan = createTestThreadPlan();

    let createCount = 0;
    deps.repo.createTweet = async () => {
      createCount++;
      // First tweet already exists, second succeeds
      if (createCount === 1) {
        return { ok: false, error: "SEQUENCE_EXISTS" };
      }
      return { ok: true, value: createTestTweet() };
    };
    deps.repo.getTweetsByThread = async () => ({
      ok: true,
      value: [
        createTestTweet({ sequenceNumber: 1 }),
        createTestTweet({ id: "tweet-002", sequenceNumber: 2 }),
      ],
    });
    xProvider.publishThread = async () => ({
      ok: true,
      value: createTestThreadReceipt(),
    });

    // Should NOT throw for SEQUENCE_EXISTS
    await handler.publishThreadPost(
      POST_ID,
      CHANNEL_ID,
      DEDUPE_KEY,
      plan,
      PROVIDER_NAME,
      xProvider
    );
    assert.strictEqual(createCount, 2);
  });

  it("should throw when provider does not support threads", async () => {
    const plan = createTestThreadPlan();
    deps.repo.createThread = async () => ({
      ok: true,
      value: createTestThread(),
    });
    deps.repo.createTweet = async () => ({
      ok: true,
      value: createTestTweet(),
    });

    // Create a provider without publishThread
    const noThreadProvider: PublishProvider = {
      publish: xProvider.publish,
      render: xProvider.render,
    };

    await assert.rejects(
      () =>
        handler.publishThreadPost(
          POST_ID,
          CHANNEL_ID,
          DEDUPE_KEY,
          plan,
          PROVIDER_NAME,
          noThreadProvider
        ),
      (err: Error) => {
        assert.ok(err.message.includes("does not support thread publishing"));
        return true;
      }
    );
  });

  it("should throw and log ERR when publishThread returns error", async () => {
    const plan = createTestThreadPlan();
    deps.repo.createThread = async () => ({
      ok: true,
      value: createTestThread(),
    });
    deps.repo.createTweet = async () => ({
      ok: true,
      value: createTestTweet(),
    });
    xProvider.publishThread = async () => ({
      ok: false,
      error: "RATE_LIMIT" as const,
    });

    let loggedStatus: string | undefined;
    deps.repo.logPublish = async (input) => {
      loggedStatus = input.status;
      return { ok: true, value: {} };
    };

    await assert.rejects(
      () =>
        handler.publishThreadPost(POST_ID, CHANNEL_ID, DEDUPE_KEY, plan, PROVIDER_NAME, xProvider),
      (err: Error) => {
        assert.ok(err.message.includes("RATE_LIMIT"));
        return true;
      }
    );

    assert.strictEqual(loggedStatus, "ERR");
  });

  it("should increment publishErr and threadErrors on publish failure", async () => {
    const plan = createTestThreadPlan();
    deps.repo.createThread = async () => ({
      ok: true,
      value: createTestThread(),
    });
    deps.repo.createTweet = async () => ({
      ok: true,
      value: createTestTweet(),
    });
    xProvider.publishThread = async () => ({
      ok: false,
      error: "NETWORK" as const,
    });

    try {
      await handler.publishThreadPost(
        POST_ID,
        CHANNEL_ID,
        DEDUPE_KEY,
        plan,
        PROVIDER_NAME,
        xProvider
      );
    } catch {
      // expected
    }

    const errValue = await deps.workerMetrics.metrics.publishErr.get();
    const errMatch = errValue.values.find(
      (v) => v.labels.content_type === "thread" && v.labels.error_type === "provider_error"
    );
    assert.ok(errMatch);
    assert.strictEqual(errMatch.value, 1);

    const threadErrValue = await deps.workerMetrics.metrics.threadErrors.get();
    const threadErrMatch = threadErrValue.values.find(
      (v) => v.labels.phase === "publishing" && v.labels.error_type === "provider_error"
    );
    assert.ok(threadErrMatch);
    assert.strictEqual(threadErrMatch.value, 1);
  });

  it("should update tweets with providerTweetId and PUBLISHED status after success", async () => {
    const plan = createTestThreadPlan();
    const publishedAt = new Date("2026-03-02T12:30:00Z");

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
        createTestTweet({ id: "db-tweet-1", sequenceNumber: 1 }),
        createTestTweet({ id: "db-tweet-2", sequenceNumber: 2 }),
      ],
    });

    const receipt = createTestThreadReceipt({
      tweets: [
        {
          sequence: 1,
          providerTweetId: "x-tweet-aaa",
          publishedAt,
        },
        {
          sequence: 2,
          providerTweetId: "x-tweet-bbb",
          publishedAt,
        },
      ],
    });
    xProvider.publishThread = async () => ({ ok: true, value: receipt });

    const updatedTweets: Array<{
      id: string;
      data: Record<string, unknown>;
    }> = [];
    deps.repo.updateTweet = async (id, data) => {
      updatedTweets.push({
        id,
        data: data as unknown as Record<string, unknown>,
      });
      return { ok: true, value: createTestTweet() };
    };

    await handler.publishThreadPost(
      POST_ID,
      CHANNEL_ID,
      DEDUPE_KEY,
      plan,
      PROVIDER_NAME,
      xProvider
    );

    assert.strictEqual(updatedTweets.length, 2);

    const first = updatedTweets.find((t) => t.id === "db-tweet-1");
    assert.ok(first);
    assert.strictEqual(first.data.tweetId, "x-tweet-aaa");
    assert.strictEqual(first.data.status, "PUBLISHED");

    const second = updatedTweets.find((t) => t.id === "db-tweet-2");
    assert.ok(second);
    assert.strictEqual(second.data.tweetId, "x-tweet-bbb");
    assert.strictEqual(second.data.status, "PUBLISHED");
  });

  it("should log OK and increment publishOk on success", async () => {
    const plan = createTestThreadPlan();
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
    xProvider.publishThread = async () => ({
      ok: true,
      value: createTestThreadReceipt(),
    });

    const logStatuses: string[] = [];
    deps.repo.logPublish = async (input) => {
      logStatuses.push(input.status);
      return { ok: true, value: {} };
    };

    await handler.publishThreadPost(
      POST_ID,
      CHANNEL_ID,
      DEDUPE_KEY,
      plan,
      PROVIDER_NAME,
      xProvider
    );

    assert.ok(logStatuses.includes("OK"));

    const publishOk = await deps.workerMetrics.metrics.publishOk.get();
    const match = publishOk.values.find(
      (v) => v.labels.content_type === "thread" && v.labels.channel_id === CHANNEL_ID
    );
    assert.ok(match);
    assert.strictEqual(match.value, 1);
  });

  it("should track threadCreated and threadPublished metrics", async () => {
    const plan = createTestThreadPlan({ strategy: "MANUAL" });
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
    xProvider.publishThread = async () => ({
      ok: true,
      value: createTestThreadReceipt(),
    });

    await handler.publishThreadPost(
      POST_ID,
      CHANNEL_ID,
      DEDUPE_KEY,
      plan,
      PROVIDER_NAME,
      xProvider
    );

    const created = await deps.workerMetrics.metrics.threadCreated.get();
    const createdMatch = created.values.find(
      (v) => v.labels.strategy === "MANUAL" && v.labels.provider === "x"
    );
    assert.ok(createdMatch);
    assert.strictEqual(createdMatch.value, 1);

    const published = await deps.workerMetrics.metrics.threadPublished.get();
    const publishedMatch = published.values.find(
      (v) => v.labels.strategy === "MANUAL" && v.labels.provider === "x"
    );
    assert.ok(publishedMatch);
    assert.strictEqual(publishedMatch.value, 1);
  });

  it("should remove correlation ID after successful thread publish", async () => {
    const plan = createTestThreadPlan();
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
    xProvider.publishThread = async () => ({
      ok: true,
      value: createTestThreadReceipt(),
    });

    await handler.publishThreadPost(
      POST_ID,
      CHANNEL_ID,
      DEDUPE_KEY,
      plan,
      PROVIDER_NAME,
      xProvider
    );

    const corr = deps.workerMetrics.getCorrelationId(DEDUPE_KEY);
    assert.strictEqual(corr, undefined);
  });
});
