/**
 * @file XAdapter.comments.test.ts
 * @description Unit tests for X/Twitter getComments and postReply methods.
 *   The adapter is constructed with an injected fake apiClientFactory and
 *   credentials are passed through `channelCredentials`. Tier 0.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { makeAdapter } from "./XAdapter.test-helpers.js";

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

describe("XAdapter - getComments", { concurrent: false }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns replies for a tweet via conversation_id search", async () => {
    const { adapter, client } = makeAdapter();
    client.searchReplies = vi.fn(async () => ({
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
    }));

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
    assert.strictEqual(client.searchReplies.mock.calls.length, 1);
  });

  it("returns empty comments when no postExternalId", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.getComments({
      channelCredentials: TEST_CREDENTIALS,
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.comments.length, 0);
  });

  it("passes cursor and limit to searchReplies", async () => {
    const { adapter, client } = makeAdapter();

    await adapter.getComments({
      channelCredentials: TEST_CREDENTIALS,
      postExternalId: "tweet-001",
      cursor: "page-2-token",
      limit: 50,
    });

    const call = client.searchReplies.mock.calls[0];
    assert.ok(call);
    assert.strictEqual(call[0], "tweet-001");
    assert.strictEqual(call[1], 50);
    assert.strictEqual(call[2], "page-2-token");
  });

  it("returns AUTH error on 401/403", async () => {
    const { adapter, client } = makeAdapter();
    client.searchReplies = vi.fn(async () => {
      throw new Error("Twitter API error: 403 Forbidden");
    });

    const result = await adapter.getComments({
      channelCredentials: TEST_CREDENTIALS,
      postExternalId: "tweet-001",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "AUTH");
  });

  it("returns NETWORK error on general failure", async () => {
    const { adapter, client } = makeAdapter();
    client.searchReplies = vi.fn(async () => {
      throw new Error("Connection timeout");
    });

    const result = await adapter.getComments({
      channelCredentials: TEST_CREDENTIALS,
      postExternalId: "tweet-001",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "NETWORK");
  });
});

// ============================================================================
// 2. postReply Tests
// ============================================================================

describe("XAdapter - postReply", { concurrent: false }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts a reply using postTweet with replyToTweetId", async () => {
    const { adapter, client } = makeAdapter();
    client.postTweet = vi.fn(async () => ({
      data: {
        id: "reply-new-001",
        text: "Thanks for the reply!",
        created_at: "2026-03-10T12:00:00Z",
      },
    }));

    const result = await adapter.postReply({
      channelCredentials: TEST_CREDENTIALS,
      inReplyToProviderMessageId: "tweet-001",
      body: "Thanks for sharing!",
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.providerReplyId, "reply-new-001");
    assert.ok(result.value.createdAt instanceof Date);

    const call = client.postTweet.mock.calls[0];
    assert.ok(call);
    assert.strictEqual(call[0], "Thanks for sharing!");
    assert.deepStrictEqual(call[1], []);
    assert.strictEqual(call[2], "tweet-001");
  });

  it("returns RATE_LIMIT error on 429", async () => {
    const { adapter, client } = makeAdapter();
    client.postTweet = vi.fn(async () => {
      throw new Error("Twitter API error: 429 Too Many Requests");
    });

    const result = await adapter.postReply({
      channelCredentials: TEST_CREDENTIALS,
      inReplyToProviderMessageId: "tweet-001",
      body: "Reply text",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "RATE_LIMIT");
  });

  it("returns AUTH error on 401", async () => {
    const { adapter, client } = makeAdapter();
    client.postTweet = vi.fn(async () => {
      throw new Error("Twitter API error: 401 Unauthorized");
    });

    const result = await adapter.postReply({
      channelCredentials: TEST_CREDENTIALS,
      inReplyToProviderMessageId: "tweet-001",
      body: "Reply text",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "AUTH");
  });
});
