/**
 * @file XAdapter.publish.test.ts
 * @description Publish + thread publishing test suite for XAdapter. The
 *   adapter is constructed via the injected fake apiClientFactory and
 *   credentials are passed per-call. Tier 0: no network, no DB, no Redis.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import type { ThreadReceipt } from "@shared/types";
import {
  createMockApiClient,
  createFailingApiClient,
  createTestPublishInput,
  createTestThreadPublishInput,
  createTestThreadPlan,
  makeAdapter,
  MOCK_CREDENTIALS,
} from "./XAdapter.test-helpers.js";

// ============================================================================
// 1. Publish Single Tweet Tests
// ============================================================================

describe("XAdapter - publish()", { concurrent: false }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should publish a single tweet successfully", async () => {
    const { adapter, client } = makeAdapter();

    const input = createTestPublishInput({ body: "Hello world!" });
    const result = await adapter.publish(input, MOCK_CREDENTIALS);

    assert.ok(result.ok, "Publish should succeed");
    const val = result.value;
    assert.ok(val.providerPostId, "Should have providerPostId");
    assert.ok(val.url?.startsWith("https://x.com/i/status/"), "URL should be a valid X status URL");
    assert.ok(val.publishedAt instanceof Date, "publishedAt should be a Date");
    assert.strictEqual(client.postTweet.mock.calls.length, 1);
  });

  it("should upload media before posting tweet", async () => {
    const { adapter, client } = makeAdapter();

    const input = createTestPublishInput({
      body: "Tweet with media",
      media: [
        { type: "image", url: "https://example.com/image1.jpg" },
        { type: "image", url: "https://example.com/image2.jpg" },
      ],
    });

    const result = await adapter.publish(input, MOCK_CREDENTIALS);

    assert.ok(result.ok, "Publish should succeed");
    assert.strictEqual(client.uploadMedia.mock.calls.length, 2);
    assert.strictEqual(client.postTweet.mock.calls.length, 1);

    const postTweetCall = client.postTweet.mock.calls[0];
    assert.ok(postTweetCall, "postTweet should have been called");
    const mediaIdsArg = postTweetCall[1];
    assert.ok(Array.isArray(mediaIdsArg), "Media IDs should be passed as array");
    assert.strictEqual(mediaIdsArg.length, 2);
  });

  it("should return AUTH error when credentials are missing required fields", async () => {
    const { adapter } = makeAdapter();
    const input = createTestPublishInput();
    const result = await adapter.publish(input, { apiKey: "k" });

    assert.strictEqual(result.ok, false, "Publish should fail");
    assert.strictEqual((result as { error: string }).error, "AUTH");
  });

  it("should return AUTH error when credentials are null", async () => {
    const { adapter } = makeAdapter();
    const input = createTestPublishInput();
    const result = await adapter.publish(input, null);

    assert.strictEqual(result.ok, false);
    assert.strictEqual((result as { error: string }).error, "AUTH");
  });

  it("should return NETWORK error when circuit breaker is open", async () => {
    const cbError = new Error("Circuit breaker is OPEN for x-api/post-tweet");
    const client = createMockApiClient();
    client.postTweet = vi.fn(async () => {
      throw cbError;
    });
    const { adapter } = makeAdapter(client);

    const input = createTestPublishInput();
    const result = await adapter.publish(input, MOCK_CREDENTIALS);

    assert.strictEqual(result.ok, false);
    assert.strictEqual((result as { error: string }).error, "NETWORK");
  });

  it("should return RATE_LIMIT error on 429 status", async () => {
    const failingClient = createFailingApiClient("Rate limit exceeded", 429);
    const { adapter } = makeAdapter(failingClient);

    const input = createTestPublishInput();
    const result = await adapter.publish(input, MOCK_CREDENTIALS);

    assert.strictEqual(result.ok, false);
    assert.strictEqual((result as { error: string }).error, "RATE_LIMIT");
  });

  it("should return AUTH error on 401 status", async () => {
    const failingClient = createFailingApiClient("Unauthorized", 401);
    const { adapter } = makeAdapter(failingClient);

    const input = createTestPublishInput();
    const result = await adapter.publish(input, MOCK_CREDENTIALS);

    assert.strictEqual(result.ok, false);
    assert.strictEqual((result as { error: string }).error, "AUTH");
  });
});

// ============================================================================
// 2. PublishThread Tests
// ============================================================================

/**
 * Build a mock client whose `postTweet` succeeds until `failingCall`, where it
 * throws an error carrying `status`. Every earlier call returns a deterministic
 * `tweet-N` id so the live-fragment assertions can pin both value and order.
 */
function failingAtCall(failingCall: number, status: number, message: string) {
  let callCount = 0;
  const client = createMockApiClient();
  client.postTweet = vi.fn(async (text: string) => {
    callCount++;
    if (callCount === failingCall) {
      const error = new Error(message) as Error & { status: number };
      error.status = status;
      throw error;
    }
    return {
      data: {
        id: `tweet-${callCount}`,
        text,
        created_at: new Date().toISOString(),
      },
    };
  });
  return client;
}

/** Project the fragment references down to what the assertions pin: id and order. */
function fragmentRefs(fragments: ThreadReceipt["tweets"]) {
  return fragments.map((fragment) => ({
    sequence: fragment.sequence,
    providerTweetId: fragment.providerTweetId,
  }));
}

describe("XAdapter - publishThread()", { concurrent: false }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should publish a thread successfully with sequential tweets", async () => {
    const { adapter } = makeAdapter();

    const input = createTestThreadPublishInput(3);
    const result = await adapter.publishThread(input, MOCK_CREDENTIALS);

    assert.ok(result.ok, "PublishThread should succeed");
    assert.strictEqual(result.value.totalTweets, 3);
    assert.strictEqual(result.value.tweets.length, 3);
    assert.strictEqual(result.value.threadId, input.dedupeKey);

    for (const tweet of result.value.tweets) {
      assert.ok(tweet.providerTweetId, "Each tweet should have providerTweetId");
      assert.ok(tweet.url?.startsWith("https://x.com/i/status/"));
      assert.ok(tweet.publishedAt instanceof Date);
    }
  });

  it("should chain tweets with parentTweetId (reply threading)", async () => {
    const { adapter, client } = makeAdapter();

    const input = createTestThreadPublishInput(3);
    await adapter.publishThread(input, MOCK_CREDENTIALS);

    const calls = client.postTweet.mock.calls;
    assert.strictEqual(calls.length, 3);

    const firstCall = calls[0];
    assert.ok(firstCall);
    assert.strictEqual(firstCall[2], undefined, "First tweet should not have replyToTweetId");

    const secondCall = calls[1];
    assert.ok(secondCall);
    assert.ok(secondCall[2], "Second tweet should have replyToTweetId");

    const thirdCall = calls[2];
    assert.ok(thirdCall);
    assert.ok(thirdCall[2], "Third tweet should have replyToTweetId");
    assert.notStrictEqual(thirdCall[2], secondCall[2]);
  });

  it("should return AUTH with no published fragments when credentials are missing", async () => {
    const { adapter } = makeAdapter();
    const input = createTestThreadPublishInput(2);
    const result = await adapter.publishThread(input, { apiKey: "" });

    assert.ok(!result.ok, "PublishThread should fail");
    assert.strictEqual(result.error.code, "AUTH");
    assert.deepStrictEqual(result.error.publishedFragments, []);
  });

  it("should return THREAD_INTERRUPTED carrying both live fragments on mid-thread 4xx", async () => {
    const { adapter } = makeAdapter(failingAtCall(3, 400, "Bad Request"));

    const input = createTestThreadPublishInput(4);
    const result = await adapter.publishThread(input, MOCK_CREDENTIALS);

    assert.ok(!result.ok, "PublishThread should fail");
    assert.strictEqual(result.error.code, "THREAD_INTERRUPTED");
    assert.deepStrictEqual(fragmentRefs(result.error.publishedFragments), [
      { sequence: 1, providerTweetId: "tweet-1" },
      { sequence: 2, providerTweetId: "tweet-2" },
    ]);
  });

  it("should carry the live fragments on a mid-thread non-4xx failure too", async () => {
    const { adapter } = makeAdapter(failingAtCall(3, 503, "Service Unavailable"));

    const input = createTestThreadPublishInput(4);
    const result = await adapter.publishThread(input, MOCK_CREDENTIALS);

    assert.ok(!result.ok, "PublishThread should fail");
    assert.strictEqual(result.error.code, "NETWORK");
    assert.deepStrictEqual(fragmentRefs(result.error.publishedFragments), [
      { sequence: 1, providerTweetId: "tweet-1" },
      { sequence: 2, providerTweetId: "tweet-2" },
    ]);
  });

  it("should report no published fragments when the first fragment fails", async () => {
    const { adapter } = makeAdapter(failingAtCall(1, 400, "Bad Request"));

    const input = createTestThreadPublishInput(4);
    const result = await adapter.publishThread(input, MOCK_CREDENTIALS);

    assert.ok(!result.ok, "PublishThread should fail");
    assert.strictEqual(result.error.code, "VALIDATION");
    assert.deepStrictEqual(result.error.publishedFragments, []);
  });

  it("should return NETWORK when circuit breaker is open during thread", async () => {
    const cbError = new Error("Circuit breaker is OPEN for x-api/post-tweet");
    const client = createMockApiClient();
    client.postTweet = vi.fn(async () => {
      throw cbError;
    });
    const { adapter } = makeAdapter(client);

    const input = createTestThreadPublishInput(2);
    const result = await adapter.publishThread(input, MOCK_CREDENTIALS);

    assert.ok(!result.ok, "PublishThread should fail");
    assert.strictEqual(result.error.code, "NETWORK");
    assert.deepStrictEqual(result.error.publishedFragments, []);
  });

  it("should upload media for each tweet in the thread", async () => {
    const { adapter, client } = makeAdapter();

    const threadPlan = createTestThreadPlan(2);
    threadPlan.tweets[0]!.media = [
      { id: "m1", type: "image", url: "https://example.com/img1.jpg" },
    ];
    threadPlan.tweets[1]!.media = [
      { id: "m2", type: "image", url: "https://example.com/img2.jpg" },
    ];

    const input = {
      channelId: "channel-x-123",
      threadPlan,
      dedupeKey: `thread-media-${Date.now()}`,
    };

    const result = await adapter.publishThread(input, MOCK_CREDENTIALS);

    assert.ok(result.ok, "PublishThread should succeed");
    assert.strictEqual(client.uploadMedia.mock.calls.length, 2);
  });

  it("should handle single-tweet thread plan", async () => {
    const { adapter } = makeAdapter();

    const input = createTestThreadPublishInput(1);
    const result = await adapter.publishThread(input, MOCK_CREDENTIALS);

    assert.ok(result.ok, "Should succeed");
    assert.strictEqual(result.value.totalTweets, 1);
    assert.strictEqual(result.value.tweets.length, 1);
  });
});
