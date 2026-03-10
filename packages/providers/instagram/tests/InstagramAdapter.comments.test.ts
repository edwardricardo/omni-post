/**
 * @file InstagramAdapter.comments.test.ts
 * @description Unit tests for Instagram getComments and postReply methods.
 *              All tests are Tier 0 (no network, no DB, no Redis).
 * @layer test
 */

import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { InstagramAdapter } from "../src/InstagramAdapter.js";

// ============================================================================
// Mock factories
// ============================================================================

function makeMockApiClient() {
  return {
    getMediaComments: mock.fn(async () => ({
      data: [
        {
          id: "comment-001",
          text: "Love this photo!",
          username: "user_a",
          timestamp: "2026-03-10T10:00:00Z",
          replies: {
            data: [
              {
                id: "reply-001",
                text: "Thanks!",
                username: "owner",
                timestamp: "2026-03-10T11:00:00Z",
              },
            ],
          },
        },
        {
          id: "comment-002",
          text: "Great content",
          username: "user_b",
          timestamp: "2026-03-10T12:00:00Z",
        },
      ],
      paging: {
        cursors: { after: "cursor-page-2" },
        next: "https://graph.facebook.com/v23.0/...",
      },
    })),
    replyToComment: mock.fn(async () => ({
      id: "reply-new-001",
    })),
    validateCredentials: mock.fn(async () => ({
      id: "user-001",
      username: "testuser",
      account_type: "BUSINESS",
    })),
  };
}

const TEST_CREDENTIALS = {
  accessToken: "test-token",
  userId: "test-user-id",
};

// ============================================================================
// 1. getComments Tests
// ============================================================================

describe("InstagramAdapter - getComments", { concurrency: 1 }, () => {
  let adapter: InstagramAdapter;

  beforeEach(() => {
    adapter = new InstagramAdapter();
  });

  it("returns comments with threaded replies", async () => {
    const mockClient = makeMockApiClient();
    const createClientMock = mock.method(
      adapter as never,
      "createApiClient" as never,
      () => mockClient
    );

    const result = await adapter.getComments({
      channelCredentials: TEST_CREDENTIALS,
      postExternalId: "media-001",
    });

    assert.ok(result.ok);
    // 2 top-level + 1 reply = 3 total
    assert.strictEqual(result.value.comments.length, 3);

    const first = result.value.comments[0];
    assert.ok(first);
    assert.strictEqual(first.providerMessageId, "comment-001");
    assert.strictEqual(first.body, "Love this photo!");
    assert.strictEqual(first.authorName, "user_a");
    assert.strictEqual(first.providerParentId, undefined);

    const reply = result.value.comments[1];
    assert.ok(reply);
    assert.strictEqual(reply.providerMessageId, "reply-001");
    assert.strictEqual(reply.providerParentId, "comment-001");
    assert.strictEqual(reply.authorName, "owner");

    const second = result.value.comments[2];
    assert.ok(second);
    assert.strictEqual(second.providerMessageId, "comment-002");

    assert.strictEqual(result.value.nextCursor, "cursor-page-2");

    createClientMock.mock.restore();
  });

  it("returns empty when no postExternalId", async () => {
    const result = await adapter.getComments({
      channelCredentials: TEST_CREDENTIALS,
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.comments.length, 0);
  });

  it("passes cursor and limit to API client", async () => {
    const mockClient = makeMockApiClient();
    const createClientMock = mock.method(
      adapter as never,
      "createApiClient" as never,
      () => mockClient
    );

    await adapter.getComments({
      channelCredentials: TEST_CREDENTIALS,
      postExternalId: "media-001",
      cursor: "page-2-cursor",
      limit: 25,
    });

    const call = mockClient.getMediaComments.mock.calls[0];
    assert.ok(call);
    assert.strictEqual(call.arguments[0], "media-001");
    assert.strictEqual(call.arguments[1], 25);
    assert.strictEqual(call.arguments[2], "page-2-cursor");

    createClientMock.mock.restore();
  });

  it("returns NETWORK error on failure", async () => {
    const mockClient = makeMockApiClient();
    mockClient.getMediaComments = mock.fn(async () => {
      throw new Error("API unavailable");
    });

    const createClientMock = mock.method(
      adapter as never,
      "createApiClient" as never,
      () => mockClient
    );

    const result = await adapter.getComments({
      channelCredentials: TEST_CREDENTIALS,
      postExternalId: "media-001",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "NETWORK");

    createClientMock.mock.restore();
  });
});

// ============================================================================
// 2. postReply Tests
// ============================================================================

describe("InstagramAdapter - postReply", { concurrency: 1 }, () => {
  let adapter: InstagramAdapter;

  beforeEach(() => {
    adapter = new InstagramAdapter();
  });

  it("posts a reply to a comment", async () => {
    const mockClient = makeMockApiClient();
    const createClientMock = mock.method(
      adapter as never,
      "createApiClient" as never,
      () => mockClient
    );

    const result = await adapter.postReply({
      channelCredentials: TEST_CREDENTIALS,
      inReplyToProviderMessageId: "comment-001",
      body: "Thanks for the kind words!",
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.providerReplyId, "reply-new-001");
    assert.ok(result.value.createdAt instanceof Date);

    const call = mockClient.replyToComment.mock.calls[0];
    assert.ok(call);
    assert.strictEqual(call.arguments[0], "comment-001");
    assert.strictEqual(call.arguments[1], "Thanks for the kind words!");

    createClientMock.mock.restore();
  });

  it("returns RATE_LIMIT error on 429", async () => {
    const mockClient = makeMockApiClient();
    mockClient.replyToComment = mock.fn(async () => {
      throw new Error("Instagram API Error: 429 Too Many Requests");
    });

    const createClientMock = mock.method(
      adapter as never,
      "createApiClient" as never,
      () => mockClient
    );

    const result = await adapter.postReply({
      channelCredentials: TEST_CREDENTIALS,
      inReplyToProviderMessageId: "comment-001",
      body: "reply",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "RATE_LIMIT");

    createClientMock.mock.restore();
  });

  it("returns NETWORK error on general failure", async () => {
    const mockClient = makeMockApiClient();
    mockClient.replyToComment = mock.fn(async () => {
      throw new Error("Connection refused");
    });

    const createClientMock = mock.method(
      adapter as never,
      "createApiClient" as never,
      () => mockClient
    );

    const result = await adapter.postReply({
      channelCredentials: TEST_CREDENTIALS,
      inReplyToProviderMessageId: "comment-001",
      body: "reply",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "NETWORK");

    createClientMock.mock.restore();
  });
});
