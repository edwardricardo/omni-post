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
  const ACCOUNT_ID = "account-test";

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
      xProvider,
      ACCOUNT_ID
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
      xProvider,
      ACCOUNT_ID
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
      xProvider,
      ACCOUNT_ID
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
        handler.publishThreadPost(
          POST_ID,
          CHANNEL_ID,
          DEDUPE_KEY,
          plan,
          PROVIDER_NAME,
          xProvider,
          ACCOUNT_ID
        ),
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
        xProvider,
        ACCOUNT_ID
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
        handler.publishThreadPost(
          POST_ID,
          CHANNEL_ID,
          DEDUPE_KEY,
          plan,
          PROVIDER_NAME,
          xProvider,
          ACCOUNT_ID
        ),
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
      xProvider,
      ACCOUNT_ID
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
          noThreadProvider,
          ACCOUNT_ID
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
      error: { code: "RATE_LIMIT" as const, publishedFragments: [] },
    });

    let loggedStatus: string | undefined;
    deps.repo.logPublish = async (input) => {
      loggedStatus = input.status;
      return { ok: true, value: {} };
    };

    await assert.rejects(
      () =>
        handler.publishThreadPost(
          POST_ID,
          CHANNEL_ID,
          DEDUPE_KEY,
          plan,
          PROVIDER_NAME,
          xProvider,
          ACCOUNT_ID
        ),
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
      error: { code: "NETWORK" as const, publishedFragments: [] },
    });

    try {
      await handler.publishThreadPost(
        POST_ID,
        CHANNEL_ID,
        DEDUPE_KEY,
        plan,
        PROVIDER_NAME,
        xProvider,
        ACCOUNT_ID
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

  // ==========================================================================
  // Interrupted thread — what went out must survive the failure
  // ==========================================================================

  describe("when the thread is interrupted mid-way", () => {
    const SAGA_ID = "saga-thread-001";
    const LIVE_FRAGMENTS = [
      {
        sequence: 1,
        providerTweetId: "x-live-001",
        url: "https://x.com/i/status/001",
        publishedAt: new Date("2026-03-02T12:30:00Z"),
      },
      {
        sequence: 2,
        providerTweetId: "x-live-002",
        url: "https://x.com/i/status/002",
        publishedAt: new Date("2026-03-02T12:30:05Z"),
      },
    ];

    /** Ordered trace of the two observable effects, so the order can be asserted. */
    let callLog: string[];
    let updatedTweets: Array<{ id: string; data: Record<string, unknown> }>;
    let sagaMessages: string[];

    beforeEach(() => {
      callLog = [];
      updatedTweets = [];
      sagaMessages = [];

      deps.repo.createThread = async () => ({ ok: true, value: createTestThread() });
      deps.repo.createTweet = async () => ({ ok: true, value: createTestTweet() });
      deps.repo.getTweetsByThread = async () => ({
        ok: true,
        value: [
          createTestTweet({ id: "db-tweet-1", sequenceNumber: 1 }),
          createTestTweet({ id: "db-tweet-2", sequenceNumber: 2 }),
          createTestTweet({ id: "db-tweet-3", sequenceNumber: 3 }),
        ],
      });
      deps.repo.updateTweet = async (id, data) => {
        callLog.push(`updateTweet:${id}`);
        updatedTweets.push({ id, data: data as unknown as Record<string, unknown> });
        return { ok: true, value: createTestTweet() };
      };
      deps.notifyRedis = {
        publish: async (_channel: string, message: string) => {
          callLog.push("notifySaga");
          sagaMessages.push(message);
          return 1;
        },
      };
      xProvider.publishThread = async () => ({
        ok: false,
        error: { code: "THREAD_INTERRUPTED" as const, publishedFragments: LIVE_FRAGMENTS },
      });
      handler = new PublishHandler(deps);
    });

    const runInterruptedThread = async () => {
      await assert.rejects(() =>
        handler.publishThreadPost(
          POST_ID,
          CHANNEL_ID,
          DEDUPE_KEY,
          createTestThreadPlan(),
          PROVIDER_NAME,
          xProvider,
          ACCOUNT_ID,
          SAGA_ID
        )
      );
    };

    it("should mark every live fragment PUBLISHED and leave the rest untouched", async () => {
      await runInterruptedThread();

      assert.deepStrictEqual(
        updatedTweets.map((t) => t.id),
        ["db-tweet-1", "db-tweet-2"],
        "only the fragments that reached the provider are marked published"
      );
      assert.strictEqual(updatedTweets[0]?.data.tweetId, "x-live-001");
      assert.strictEqual(updatedTweets[0]?.data.status, "PUBLISHED");
      assert.strictEqual(updatedTweets[1]?.data.tweetId, "x-live-002");
      assert.strictEqual(updatedTweets[1]?.data.status, "PUBLISHED");
    });

    it("should record what went out BEFORE reporting the failure to the saga", async () => {
      await runInterruptedThread();

      assert.deepStrictEqual(callLog, [
        "updateTweet:db-tweet-1",
        "updateTweet:db-tweet-2",
        "notifySaga",
      ]);
    });

    it("should carry the live fragments into the publish.job.failed notification", async () => {
      await runInterruptedThread();

      assert.strictEqual(sagaMessages.length, 1);
      const event = JSON.parse(sagaMessages[0] ?? "{}") as {
        type: string;
        data: { publishedFragments?: Array<{ sequence: number; providerTweetId: string }> };
      };
      assert.strictEqual(event.type, "publish.job.failed");
      assert.deepStrictEqual(
        event.data.publishedFragments?.map((f) => [f.sequence, f.providerTweetId]),
        [
          [1, "x-live-001"],
          [2, "x-live-002"],
        ]
      );
    });

    it("should still report the publish failure when a tweet row cannot be written", async () => {
      // A repository blip must not swallow the provider's verdict: the saga is
      // waiting on this channel, and a DB error in its place tells it nothing
      // about what is live.
      deps.repo.updateTweet = async () => {
        callLog.push("updateTweet:rejected");
        throw new Error("DB_UNAVAILABLE");
      };
      handler = new PublishHandler(deps);

      await assert.rejects(
        () =>
          handler.publishThreadPost(
            POST_ID,
            CHANNEL_ID,
            DEDUPE_KEY,
            createTestThreadPlan(),
            PROVIDER_NAME,
            xProvider,
            ACCOUNT_ID,
            SAGA_ID
          ),
        (err: Error) => {
          assert.strictEqual(
            err.message,
            "THREAD_INTERRUPTED",
            "the publish code survives a failure to write the row"
          );
          return true;
        }
      );

      assert.strictEqual(sagaMessages.length, 1, "the saga is still told the job failed");
      const event = JSON.parse(sagaMessages[0] ?? "{}") as {
        type: string;
        data: { publishedFragments?: Array<{ providerTweetId: string }> };
      };
      assert.strictEqual(event.type, "publish.job.failed");
      assert.deepStrictEqual(
        event.data.publishedFragments?.map((f) => f.providerTweetId),
        ["x-live-001", "x-live-002"],
        "the live set is reported even though its rows could not be written"
      );
    });

    it("should carry the live fragments into the ERR publish log", async () => {
      const errorPayloads: Array<Record<string, unknown>> = [];
      deps.repo.logPublish = async (input) => {
        if (input.status === "ERR") {
          errorPayloads.push(input.payload as Record<string, unknown>);
        }
        return { ok: true, value: {} };
      };
      handler = new PublishHandler(deps);

      await runInterruptedThread();

      assert.strictEqual(errorPayloads.length, 1);
      const payload = errorPayloads[0] as {
        error?: string;
        publishedFragments?: Array<{ providerTweetId: string }>;
      };
      assert.strictEqual(payload.error, "THREAD_INTERRUPTED");
      assert.deepStrictEqual(
        payload.publishedFragments?.map((f) => f.providerTweetId),
        ["x-live-001", "x-live-002"]
      );
    });

    it("should touch no tweet row when nothing went out", async () => {
      xProvider.publishThread = async () => ({
        ok: false,
        error: { code: "AUTH" as const, publishedFragments: [] },
      });
      handler = new PublishHandler(deps);

      await runInterruptedThread();

      assert.deepStrictEqual(updatedTweets, []);
      assert.deepStrictEqual(callLog, ["notifySaga"]);
    });
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
      xProvider,
      ACCOUNT_ID
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
      xProvider,
      ACCOUNT_ID
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
      xProvider,
      ACCOUNT_ID
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
      xProvider,
      ACCOUNT_ID
    );

    const corr = deps.workerMetrics.getCorrelationId(DEDUPE_KEY);
    assert.strictEqual(corr, undefined);
  });
});
