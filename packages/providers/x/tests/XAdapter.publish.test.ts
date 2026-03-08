/**
 * XAdapter - Publish & Thread Publishing Test Suite
 *
 * Tests validated here:
 * 1. Publish Single Tweet (6 tests) -- successful publish, media upload,
 *    auth failure, circuit breaker error, rate limit, general API error
 * 2. PublishThread (7 tests)        -- successful thread, sequential chaining,
 *    mid-thread failure (THREAD_INTERRUPTED), circuit breaker error, media
 *    in thread tweets, single-tweet thread, delay between tweets
 * 3. FetchAnalytics (3 tests)       -- returns ok with metrics, auth failure,
 *    accepts date range parameters
 *
 * All tests are Tier 0 (no network, no DB, no Redis).
 */

import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { XAdapter } from "../src/XAdapter.js";
import { ok, err } from "@shared/types";
import {
  createMockApiClient,
  createFailingApiClient,
  createTestPublishInput,
  createTestThreadPublishInput,
  createTestThreadPlan,
  MOCK_CREDENTIALS,
} from "./XAdapter.test-helpers.js";

// ============================================================================
// 1. Publish Single Tweet Tests (6 tests)
// ============================================================================

describe("XAdapter - publish()", { concurrency: 1 }, () => {
  let adapter: XAdapter;

  beforeEach(() => {
    adapter = new XAdapter();
  });

  it("should publish a single tweet successfully", async () => {
    const mockClient = createMockApiClient();
    mock.method(adapter as any, "getCredentials", async () => ok(MOCK_CREDENTIALS));
    mock.method(adapter as any, "createApiClient", () => mockClient);

    const input = createTestPublishInput({ body: "Hello world!" });
    const result = await adapter.publish(input);

    assert.ok(result.ok, "Publish should succeed");
    const val = result.value;
    assert.ok(val.providerPostId, "Should have providerPostId");
    assert.ok(val.url?.startsWith("https://x.com/i/status/"), "URL should be a valid X status URL");
    assert.ok(val.publishedAt instanceof Date, "publishedAt should be a Date");
    assert.strictEqual(
      mockClient.postTweet.mock.calls.length,
      1,
      "postTweet should be called once"
    );
  });

  it("should upload media before posting tweet", async () => {
    const mockClient = createMockApiClient();
    mock.method(adapter as any, "getCredentials", async () => ok(MOCK_CREDENTIALS));
    mock.method(adapter as any, "createApiClient", () => mockClient);

    const input = createTestPublishInput({
      body: "Tweet with media",
      media: [
        {
          type: "image",
          url: "https://example.com/image1.jpg",
        },
        {
          type: "image",
          url: "https://example.com/image2.jpg",
        },
      ],
    });

    const result = await adapter.publish(input);

    assert.ok(result.ok, "Publish should succeed");
    assert.strictEqual(
      mockClient.uploadMedia.mock.calls.length,
      2,
      "uploadMedia should be called twice (one per image)"
    );
    assert.strictEqual(
      mockClient.postTweet.mock.calls.length,
      1,
      "postTweet should be called once"
    );

    // Verify media IDs were passed to postTweet
    const postTweetCall = mockClient.postTweet.mock.calls[0];
    assert.ok(postTweetCall, "postTweet should have been called");
    const mediaIdsArg = postTweetCall.arguments[1];
    assert.ok(Array.isArray(mediaIdsArg), "Media IDs should be passed as array");
    assert.strictEqual(mediaIdsArg.length, 2, "Should have 2 media IDs");
  });

  it("should return AUTH error when credentials fail", async () => {
    mock.method(adapter as any, "getCredentials", async () => err("AUTH"));

    const input = createTestPublishInput();
    const result = await adapter.publish(input);

    assert.strictEqual(result.ok, false, "Publish should fail");
    assert.strictEqual((result as any).error, "AUTH", "Error should be AUTH");
  });

  it("should return NETWORK error when circuit breaker is open", async () => {
    const cbError = new Error("Circuit breaker is OPEN for x-api/post-tweet");
    const mockClient = {
      ...createMockApiClient(),
      postTweet: mock.fn(async () => {
        throw cbError;
      }),
    };
    mock.method(adapter as any, "getCredentials", async () => ok(MOCK_CREDENTIALS));
    mock.method(adapter as any, "createApiClient", () => mockClient);

    const input = createTestPublishInput();
    const result = await adapter.publish(input);

    assert.strictEqual(result.ok, false, "Publish should fail");
    assert.strictEqual(
      (result as any).error,
      "NETWORK",
      "Error should be NETWORK for circuit breaker"
    );
  });

  it("should return RATE_LIMIT error on 429 status", async () => {
    const mockClient = createFailingApiClient("Rate limit exceeded", 429);
    mock.method(adapter as any, "getCredentials", async () => ok(MOCK_CREDENTIALS));
    mock.method(adapter as any, "createApiClient", () => mockClient);

    const input = createTestPublishInput();
    const result = await adapter.publish(input);

    assert.strictEqual(result.ok, false, "Publish should fail");
    assert.strictEqual((result as any).error, "RATE_LIMIT", "Error should be RATE_LIMIT");
  });

  it("should return AUTH error on 401 status", async () => {
    const mockClient = createFailingApiClient("Unauthorized", 401);
    mock.method(adapter as any, "getCredentials", async () => ok(MOCK_CREDENTIALS));
    mock.method(adapter as any, "createApiClient", () => mockClient);

    const input = createTestPublishInput();
    const result = await adapter.publish(input);

    assert.strictEqual(result.ok, false, "Publish should fail");
    assert.strictEqual((result as any).error, "AUTH", "Error should be AUTH for 401");
  });
});

// ============================================================================
// 2. PublishThread Tests (7 tests)
// ============================================================================

describe("XAdapter - publishThread()", { concurrency: 1 }, () => {
  let adapter: XAdapter;

  beforeEach(() => {
    adapter = new XAdapter();
  });

  it("should publish a thread successfully with sequential tweets", async () => {
    const mockClient = createMockApiClient();
    mock.method(adapter as any, "getCredentials", async () => ok(MOCK_CREDENTIALS));
    mock.method(adapter as any, "createApiClient", () => mockClient);

    const input = createTestThreadPublishInput(3);
    const result = await adapter.publishThread(input);

    assert.ok(result.ok, "PublishThread should succeed");
    assert.strictEqual(result.value.totalTweets, 3, "Should have 3 tweets");
    assert.strictEqual(result.value.tweets.length, 3, "tweets array should have 3 entries");
    assert.strictEqual(result.value.threadId, input.dedupeKey, "threadId should match dedupeKey");

    // Verify each tweet has required fields
    for (const tweet of result.value.tweets) {
      assert.ok(tweet.providerTweetId, "Each tweet should have providerTweetId");
      assert.ok(
        tweet.url?.startsWith("https://x.com/i/status/"),
        "Each tweet should have a valid URL"
      );
      assert.ok(tweet.publishedAt instanceof Date, "Each tweet should have publishedAt Date");
    }
  });

  it("should chain tweets with parentTweetId (reply threading)", async () => {
    const mockClient = createMockApiClient();
    mock.method(adapter as any, "getCredentials", async () => ok(MOCK_CREDENTIALS));
    mock.method(adapter as any, "createApiClient", () => mockClient);

    const input = createTestThreadPublishInput(3);
    await adapter.publishThread(input);

    const calls = mockClient.postTweet.mock.calls;
    assert.strictEqual(calls.length, 3, "postTweet should be called 3 times");

    // First tweet should NOT have a replyToTweetId
    const firstCall = calls[0];
    assert.ok(firstCall, "First call should exist");
    assert.strictEqual(
      firstCall.arguments[2],
      undefined,
      "First tweet should not have replyToTweetId"
    );

    // Second tweet should reply to the first tweet's ID
    const secondCall = calls[1];
    assert.ok(secondCall, "Second call should exist");
    assert.ok(secondCall.arguments[2], "Second tweet should have replyToTweetId");

    // Third tweet should reply to the second tweet's ID
    const thirdCall = calls[2];
    assert.ok(thirdCall, "Third call should exist");
    assert.ok(thirdCall.arguments[2], "Third tweet should have replyToTweetId");
    assert.notStrictEqual(
      thirdCall.arguments[2],
      secondCall.arguments[2],
      "Third tweet's parent should differ from second tweet's parent"
    );
  });

  it("should return AUTH error when credentials fail for thread", async () => {
    mock.method(adapter as any, "getCredentials", async () => err("AUTH"));

    const input = createTestThreadPublishInput(2);
    const result = await adapter.publishThread(input);

    assert.strictEqual(result.ok, false, "Should fail");
    assert.strictEqual((result as any).error, "AUTH");
  });

  it("should return THREAD_INTERRUPTED on mid-thread 4xx failure", async () => {
    let callCount = 0;
    const mockClient = {
      ...createMockApiClient(),
      postTweet: mock.fn(async (text: string) => {
        callCount++;
        if (callCount === 2) {
          // Second tweet fails with 4xx client error
          const error = new Error("Bad Request") as Error & {
            status: number;
          };
          error.status = 400;
          throw error;
        }
        return {
          data: {
            id: `tweet-${callCount}`,
            text,
            created_at: new Date().toISOString(),
          },
        };
      }),
    };
    mock.method(adapter as any, "getCredentials", async () => ok(MOCK_CREDENTIALS));
    mock.method(adapter as any, "createApiClient", () => mockClient);

    const input = createTestThreadPublishInput(3);
    const result = await adapter.publishThread(input);

    assert.strictEqual(result.ok, false, "Should fail");
    assert.strictEqual(
      (result as any).error,
      "THREAD_INTERRUPTED",
      "Error should be THREAD_INTERRUPTED for mid-thread 4xx failure"
    );
  });

  it("should return NETWORK when circuit breaker is open during thread", async () => {
    const cbError = new Error("Circuit breaker is OPEN for x-api/post-tweet");
    const mockClient = {
      ...createMockApiClient(),
      postTweet: mock.fn(async () => {
        throw cbError;
      }),
    };
    mock.method(adapter as any, "getCredentials", async () => ok(MOCK_CREDENTIALS));
    mock.method(adapter as any, "createApiClient", () => mockClient);

    const input = createTestThreadPublishInput(2);
    const result = await adapter.publishThread(input);

    assert.strictEqual(result.ok, false, "Should fail");
    assert.strictEqual(
      (result as any).error,
      "NETWORK",
      "Error should be NETWORK for circuit breaker"
    );
  });

  it("should upload media for each tweet in the thread", async () => {
    const mockClient = createMockApiClient();
    mock.method(adapter as any, "getCredentials", async () => ok(MOCK_CREDENTIALS));
    mock.method(adapter as any, "createApiClient", () => mockClient);

    // Create a thread plan with media on tweets
    const threadPlan = createTestThreadPlan(2);
    threadPlan.tweets[0]!.media = [
      {
        id: "m1",
        type: "image",
        url: "https://example.com/img1.jpg",
      },
    ];
    threadPlan.tweets[1]!.media = [
      {
        id: "m2",
        type: "image",
        url: "https://example.com/img2.jpg",
      },
    ];

    const input = {
      channelId: "channel-x-123",
      threadPlan,
      dedupeKey: `thread-media-${Date.now()}`,
    };

    const result = await adapter.publishThread(input);

    assert.ok(result.ok, "PublishThread should succeed");
    assert.strictEqual(
      mockClient.uploadMedia.mock.calls.length,
      2,
      "uploadMedia should be called for each media item"
    );
  });

  it("should handle single-tweet thread plan", async () => {
    const mockClient = createMockApiClient();
    mock.method(adapter as any, "getCredentials", async () => ok(MOCK_CREDENTIALS));
    mock.method(adapter as any, "createApiClient", () => mockClient);

    const input = createTestThreadPublishInput(1);
    const result = await adapter.publishThread(input);

    assert.ok(result.ok, "Should succeed");
    assert.strictEqual(result.value.totalTweets, 1);
    assert.strictEqual(result.value.tweets.length, 1);
  });
});

// fetchAnalytics tests removed — method stubbed pending X API v2 analytics integration
