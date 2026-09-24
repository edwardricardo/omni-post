/**
 * @file publishThreadPost.test.ts
 * @description Tests for PublishHandler.publishThreadPost
 * @layer infrastructure
 */
import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { err as errResult, ok } from "@shared/types";
import { PUBLICATION_OUTCOME_KINDS } from "@core/domain/index.js";
import {
  createTestDeps,
  createTestThread,
  createTestTweet,
  createTestThreadPlan,
  createTestThreadReceipt,
  RecordingOutcomeRecorder,
  StubPublicationRecordProbe,
  TEST_ATTEMPT,
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
      xProvider,
      TEST_ATTEMPT
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
      TEST_ATTEMPT
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
      TEST_ATTEMPT
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
          TEST_ATTEMPT
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
        TEST_ATTEMPT
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
          TEST_ATTEMPT
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
      TEST_ATTEMPT
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
          TEST_ATTEMPT
        ),
      (err: Error) => {
        assert.ok(err.message.includes("does not support thread publishing"));
        return true;
      }
    );
  });

  it("hands a transient thread failure back to the queue and writes no log row", async () => {
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

    const statuses: string[] = [];
    deps.repo.logPublish = async (input) => {
      statuses.push(input.status);
      return { ok: true, value: {} };
    };
    handler = new PublishHandler(deps);

    await assert.rejects(
      () =>
        handler.publishThreadPost(
          POST_ID,
          CHANNEL_ID,
          DEDUPE_KEY,
          plan,
          PROVIDER_NAME,
          xProvider,
          TEST_ATTEMPT
        ),
      (raised: Error) => {
        assert.ok(raised.message.includes("RATE_LIMIT"));
        return true;
      }
    );

    // Nothing went out, the channel keeps its budget, and the log stays a mirror
    // of what published rather than a second account of what did not.
    assert.deepStrictEqual(statuses, []);
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
        TEST_ATTEMPT
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

    /** Ordered trace of the three observable effects, so the order can be asserted. */
    let callLog: string[];
    let updatedTweets: Array<{ id: string; data: Record<string, unknown> }>;
    let sagaMessages: string[];
    let recorder: RecordingOutcomeRecorder;

    beforeEach(() => {
      callLog = [];
      updatedTweets = [];
      sagaMessages = [];

      recorder = new RecordingOutcomeRecorder();
      const settle = recorder.answer;
      recorder.answer = (receipt) => {
        callLog.push("recordOutcome");
        return settle(receipt);
      };
      deps.outcomeRecorder = recorder;

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
      await handler.publishThreadPost(
        POST_ID,
        CHANNEL_ID,
        DEDUPE_KEY,
        createTestThreadPlan(),
        PROVIDER_NAME,
        xProvider,
        TEST_ATTEMPT,
        SAGA_ID
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

    it("records the channel EXCLUDED with the live set after the rows and before the saga", async () => {
      await runInterruptedThread();

      assert.deepStrictEqual(
        callLog,
        ["updateTweet:db-tweet-1", "updateTweet:db-tweet-2", "recordOutcome", "notifySaga"],
        "the rows go first so the record's fragment references have rows behind them, and " +
          "the record goes before the saga so the channel is named excluded before anyone acts on it"
      );

      assert.strictEqual(recorder.receipts.length, 1);
      const receipt = recorder.receipts[0];
      assert.ok(receipt);
      assert.strictEqual(receipt.episode, TEST_ATTEMPT.episode);
      assert.strictEqual(receipt.attemptNo, TEST_ATTEMPT.attemptNo);
      assert.strictEqual(receipt.planSize, 2);
      assert.strictEqual(receipt.result.kind, "failed");
      assert.deepStrictEqual(
        receipt.result.kind === "failed"
          ? receipt.result.publishedFragments.map((f) => [f.index, f.externalId])
          : [],
        [
          [1, "x-live-001"],
          [2, "x-live-002"],
        ],
        "the record carries what is live on the provider, in order"
      );
      assert.strictEqual(
        receipt.result.kind === "failed" ? receipt.result.code : undefined,
        "THREAD_INTERRUPTED"
      );
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

    it("still records the outcome when a tweet row cannot be written", async () => {
      // The record write sits OUTSIDE the row-update catch. A repository blip must
      // not take the channel's exclusion with it: the rows are a secondary trace,
      // and the record is the only thing that names what is live on the provider.
      deps.repo.updateTweet = async () => {
        callLog.push("updateTweet:rejected");
        throw new Error("DB_UNAVAILABLE");
      };
      handler = new PublishHandler(deps);

      await runInterruptedThread();

      assert.deepStrictEqual(callLog, ["updateTweet:rejected", "recordOutcome", "notifySaga"]);
      const receipt = recorder.receipts[0];
      assert.ok(receipt, "the outcome is recorded even though its rows could not be written");
      assert.deepStrictEqual(
        receipt.result.kind === "failed"
          ? receipt.result.publishedFragments.map((f) => f.externalId)
          : [],
        ["x-live-001", "x-live-002"]
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

    it("reports a repository that refuses the fragment rows instead of skipping it", async () => {
      // `rows = []` on a `!ok` read silently drops EVERY fragment update while the
      // provider's verdict still reaches the saga: the live set would have no rows
      // and nothing would say so.
      const errors: object[] = [];
      deps.repo.getTweetsByThread = async () => ({ ok: false, error: "DATABASE_ERROR" });
      deps.logger.error = ((obj: object) => {
        errors.push(obj);
      }) as typeof deps.logger.error;
      handler = new PublishHandler(deps);

      await runInterruptedThread();

      assert.deepStrictEqual(updatedTweets, [], "no row could be read, so none is claimed written");
      assert.strictEqual(errors.length, 1, "the dropped updates are reported, not swallowed");

      const counted = await deps.workerMetrics.metrics.errorsByType.get();
      const match = counted.values.find(
        (v) =>
          v.labels.component === "publisher" &&
          v.labels.error_type === "thread_live_fragments_unrecorded"
      );
      assert.ok(match, "the same counter the row-write failure feeds sees this arm too");
      assert.strictEqual(match.value, 1);
    });

    it("completes without rethrow when the record is EXCLUDED, and when the recorder answers err", async () => {
      // A rethrow here reaches BullMQ, which re-runs the handler over a plan whose
      // first fragments are already live — the duplicate send this whole ordering
      // exists to prevent. Counting the provider call is how "completed" is told
      // apart from "failed and not yet retried".
      let providerCalls = 0;
      xProvider.publishThread = async () => {
        providerCalls += 1;
        return {
          ok: false,
          error: { code: "THREAD_INTERRUPTED" as const, publishedFragments: LIVE_FRAGMENTS },
        };
      };
      handler = new PublishHandler(deps);

      await runInterruptedThread();
      assert.strictEqual(providerCalls, 1, "an EXCLUDED channel is never handed back to the queue");
      assert.strictEqual(recorder.receipts.length, 1);

      // An unwritten record is the same case: the durable job carries the outcome,
      // and re-running the provider to earn another chance at writing it would
      // publish the same fragments twice.
      providerCalls = 0;
      recorder.answer = () => {
        callLog.push("recordOutcome");
        return errResult({ reason: "the record stayed contended", durable: true });
      };
      handler = new PublishHandler(deps);

      await runInterruptedThread();
      assert.strictEqual(providerCalls, 1, "an unwritten record never re-runs the provider");
    });

    it("should touch no tweet row when nothing went out", async () => {
      xProvider.publishThread = async () => ({
        ok: false,
        error: { code: "AUTH" as const, publishedFragments: [] },
      });
      handler = new PublishHandler(deps);

      await runInterruptedThread();

      assert.deepStrictEqual(updatedTweets, []);
      assert.deepStrictEqual(callLog, ["recordOutcome", "notifySaga"]);
    });
  });

  describe("when a fully-published thread cannot write its rows", () => {
    // The twin of the interrupted-thread case above, on the path where every
    // fragment went out. The record is this channel's only idempotency
    // authority, so a row failure that escapes takes the record write with it
    // and the redelivery reads a channel that is still unresolved over a thread
    // that is already live on the provider.
    const JOB_ID = `publish-${POST_ID}-${CHANNEL_ID}-e1`;

    let recorder: RecordingOutcomeRecorder;
    let providerCalls: number;
    let deliverJob: (attemptsMade: number) => Promise<void>;

    beforeEach(() => {
      recorder = new RecordingOutcomeRecorder();
      deps.outcomeRecorder = recorder;
      providerCalls = 0;

      // The probe answers from what the recorder actually holds, because that is
      // the coupling under test: the redelivery decides on the record, and only a
      // record that was written can refuse it.
      const probe = new StubPublicationRecordProbe();
      probe.answer = () =>
        ok({
          episode: TEST_ATTEMPT.episode,
          outcome: recorder.receipts.some((entry) => entry.result.kind === "published")
            ? PUBLICATION_OUTCOME_KINDS.PUBLISHED
            : PUBLICATION_OUTCOME_KINDS.UNRESOLVED,
        });
      deps.publicationRecord = probe;

      let threadCreated = false;
      deps.repo.createThread = async () => {
        if (threadCreated) {
          return { ok: false, error: "THREAD_EXISTS" };
        }
        threadCreated = true;
        return { ok: true, value: createTestThread() };
      };
      deps.repo.getThreadByPostId = async () => ({ ok: true, value: createTestThread() });
      deps.repo.createTweet = async () => ({ ok: true, value: createTestTweet() });
      // Still PENDING on the redelivery, because writing them is precisely what
      // failed: the row-based completion check cannot stand in for the record.
      deps.repo.getTweetsByThread = async () => ({
        ok: true,
        value: [
          createTestTweet({ id: "db-tweet-1", sequenceNumber: 1 }),
          createTestTweet({ id: "db-tweet-2", sequenceNumber: 2 }),
        ],
      });
      deps.repo.updateTweet = async () => {
        throw new Error("DB_UNAVAILABLE");
      };

      xProvider.render = () => ({
        ok: true,
        value: { type: "thread" as const, content: createTestThreadPlan() },
      });
      xProvider.publishThread = async () => {
        providerCalls += 1;
        return { ok: true, value: createTestThreadReceipt() };
      };
      handler = new PublishHandler(deps);

      deliverJob = async (attemptsMade: number) => {
        await handler.handleJob({
          payload: {
            postId: POST_ID,
            channelId: CHANNEL_ID,
            accountId: TEST_ATTEMPT.accountId,
            provider: PROVIDER_NAME,
          },
          dedupeKey: JOB_ID,
          attemptsMade,
        });
      };
    });

    it("records the published outcome and never re-sends the thread on redelivery", async () => {
      await assert.doesNotReject(
        deliverJob(0),
        "a row that could not be written must not hand the job back to the queue"
      );

      const receipt = recorder.receipts[0];
      assert.ok(receipt, "the outcome is recorded even though its rows could not be written");
      assert.strictEqual(receipt.result.kind, "published");

      // The redelivery BullMQ would run had the job been handed back. Every row
      // is still PENDING, so the row-based completion check answers "not
      // published" and the record is the only thing left that can refuse this.
      await deliverJob(1);
      assert.strictEqual(providerCalls, 1, "the whole thread is never published a second time");
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
      TEST_ATTEMPT
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
      TEST_ATTEMPT
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
      TEST_ATTEMPT
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
      TEST_ATTEMPT
    );

    const corr = deps.workerMetrics.getCorrelationId(DEDUPE_KEY);
    assert.strictEqual(corr, undefined);
  });
});
