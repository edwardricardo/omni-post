/**
 * @file XAdapter.comments.test.ts
 * @description Unit tests for X/Twitter getComments and postReply methods.
 *              All tests are Tier 0 (no network, no DB, no Redis).
 * @layer test
 */

import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { XAdapter } from "../src/XAdapter.js";

// ============================================================================
// Mock factories
// ============================================================================

function makeMockApiClient() {
  return {
    searchReplies: mock.fn(async () => ({
      data: [
        {
          id: "reply-001",
          text: "Great tweet!",
          author_id: "user-123",
          created_at: "2026-03-10T10:00:00Z",
          in_reply_to_user_id: "user-456",
          conversation_id: "tweet-001",
        },
        {
          id: "reply-002",
          text: "I agree!",
          author_id: "user-789",
          created_at: "2026-03-10T11:00:00Z",
        },
      ],
      meta: {
        result_count: 2,
        next_token: "next-page-token",
      },
    })),
    postTweet: mock.fn(async () => ({
      data: {
        id: "reply-new-001",
        text: "Thanks for the reply!",
        created_at: "2026-03-10T12:00:00Z",
      },
    })),
    validateCredentials: mock.fn(async () => ({
      data: { id: "user-001", name: "Test", username: "test" },
    })),
    uploadMedia: mock.fn(async () => ({
      media_id_string: "media-001",
      media_id: 1,
      size: 1000,
      media_key: "7_media-001",
    })),
    getTweetAnalytics: mock.fn(async () => ({ data: [] })),
    deleteTweet: mock.fn(async () => ({ data: { deleted: true } })),
    getCircuitBreakerStatus: mock.fn(() => ({})),
    clearCache: mock.fn(),
    forceCircuitBreakerOpen: mock.fn(() => true),
    forceCircuitBreakerClose: mock.fn(() => true),
  };
}

const TEST_CREDENTIALS = {
  apiKey: "test-key",
  apiSecret: "test-secret",
  accessToken: "test-access",
  accessTokenSecret: "test-access-secret",
  bearerToken: "test-bearer",
};

// ============================================================================
// 1. getComments Tests
// ============================================================================

describe("XAdapter - getComments", { concurrency: 1 }, () => {
  let adapter: XAdapter;

  beforeEach(() => {
    adapter = new XAdapter();
  });

  it("returns replies for a tweet via conversation_id search", async () => {
    const mockClient = makeMockApiClient();
    const createClientMock = mock.method(
      adapter as never,
      "createApiClient" as never,
      () => mockClient
    );

    const result = await adapter.getComments({
      channelCredentials: TEST_CREDENTIALS,
      postExternalId: "tweet-001",
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.comments.length, 2);

    const first = result.value.comments[0];
    assert.ok(first);
    assert.strictEqual(first.providerMessageId, "reply-001");
    assert.strictEqual(first.body, "Great tweet!");
    assert.strictEqual(first.authorProviderId, "user-123");
    assert.strictEqual(first.providerParentId, "user-456");

    const second = result.value.comments[1];
    assert.ok(second);
    assert.strictEqual(second.providerMessageId, "reply-002");
    assert.strictEqual(second.providerParentId, undefined);

    assert.strictEqual(result.value.nextCursor, "next-page-token");
    assert.strictEqual(mockClient.searchReplies.mock.callCount(), 1);

    createClientMock.mock.restore();
  });

  it("returns empty comments when no postExternalId", async () => {
    const result = await adapter.getComments({
      channelCredentials: TEST_CREDENTIALS,
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.comments.length, 0);
  });

  it("passes cursor and limit to searchReplies", async () => {
    const mockClient = makeMockApiClient();
    const createClientMock = mock.method(
      adapter as never,
      "createApiClient" as never,
      () => mockClient
    );

    await adapter.getComments({
      channelCredentials: TEST_CREDENTIALS,
      postExternalId: "tweet-001",
      cursor: "page-2-token",
      limit: 50,
    });

    const call = mockClient.searchReplies.mock.calls[0];
    assert.ok(call);
    assert.strictEqual(call.arguments[0], "tweet-001");
    assert.strictEqual(call.arguments[1], 50);
    assert.strictEqual(call.arguments[2], "page-2-token");

    createClientMock.mock.restore();
  });

  it("returns AUTH error on 401/403", async () => {
    const mockClient = makeMockApiClient();
    mockClient.searchReplies = mock.fn(async () => {
      throw new Error("Twitter API error: 403 Forbidden");
    });

    const createClientMock = mock.method(
      adapter as never,
      "createApiClient" as never,
      () => mockClient
    );

    const result = await adapter.getComments({
      channelCredentials: TEST_CREDENTIALS,
      postExternalId: "tweet-001",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "AUTH");

    createClientMock.mock.restore();
  });

  it("returns NETWORK error on general failure", async () => {
    const mockClient = makeMockApiClient();
    mockClient.searchReplies = mock.fn(async () => {
      throw new Error("Connection timeout");
    });

    const createClientMock = mock.method(
      adapter as never,
      "createApiClient" as never,
      () => mockClient
    );

    const result = await adapter.getComments({
      channelCredentials: TEST_CREDENTIALS,
      postExternalId: "tweet-001",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "NETWORK");

    createClientMock.mock.restore();
  });
});

// ============================================================================
// 2. postReply Tests
// ============================================================================

describe("XAdapter - postReply", { concurrency: 1 }, () => {
  let adapter: XAdapter;

  beforeEach(() => {
    adapter = new XAdapter();
  });

  it("posts a reply using postTweet with replyToTweetId", async () => {
    const mockClient = makeMockApiClient();
    const createClientMock = mock.method(
      adapter as never,
      "createApiClient" as never,
      () => mockClient
    );

    const result = await adapter.postReply({
      channelCredentials: TEST_CREDENTIALS,
      inReplyToProviderMessageId: "tweet-001",
      body: "Thanks for sharing!",
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.providerReplyId, "reply-new-001");
    assert.ok(result.value.createdAt instanceof Date);

    // Verify postTweet was called with reply ID
    const call = mockClient.postTweet.mock.calls[0];
    assert.ok(call);
    assert.strictEqual(call.arguments[0], "Thanks for sharing!");
    assert.deepStrictEqual(call.arguments[1], []);
    assert.strictEqual(call.arguments[2], "tweet-001");

    createClientMock.mock.restore();
  });

  it("returns RATE_LIMIT error on 429", async () => {
    const mockClient = makeMockApiClient();
    mockClient.postTweet = mock.fn(async () => {
      throw new Error("Twitter API error: 429 Too Many Requests");
    });

    const createClientMock = mock.method(
      adapter as never,
      "createApiClient" as never,
      () => mockClient
    );

    const result = await adapter.postReply({
      channelCredentials: TEST_CREDENTIALS,
      inReplyToProviderMessageId: "tweet-001",
      body: "Reply text",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "RATE_LIMIT");

    createClientMock.mock.restore();
  });

  it("returns AUTH error on 401", async () => {
    const mockClient = makeMockApiClient();
    mockClient.postTweet = mock.fn(async () => {
      throw new Error("Twitter API error: 401 Unauthorized");
    });

    const createClientMock = mock.method(
      adapter as never,
      "createApiClient" as never,
      () => mockClient
    );

    const result = await adapter.postReply({
      channelCredentials: TEST_CREDENTIALS,
      inReplyToProviderMessageId: "tweet-001",
      body: "Reply text",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "AUTH");

    createClientMock.mock.restore();
  });
});
