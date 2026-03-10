/**
 * @file YouTubeAdapter.comments.test.ts
 * @description Unit tests for YouTube getComments and postReply.
 *              All tests are Tier 0 (no network, no DB, no Redis).
 * @layer test
 */

import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { YouTubeAdapter } from "../src/YouTubeAdapter.js";

// ============================================================================
// Mock factories
// ============================================================================

function makeMockApiClient() {
  return {
    getVideoComments: mock.fn(async () => ({
      items: [
        {
          id: "thread-001",
          snippet: {
            topLevelComment: {
              id: "comment-yt-001",
              snippet: {
                textDisplay: "Great video!",
                authorDisplayName: "Alice",
                authorChannelId: { value: "channel-alice" },
                authorProfileImageUrl: "https://example.com/alice.jpg",
                publishedAt: "2026-03-10T10:00:00Z",
              },
            },
            totalReplyCount: 1,
          },
        },
        {
          id: "thread-002",
          snippet: {
            topLevelComment: {
              id: "comment-yt-002",
              snippet: {
                textDisplay: "Awesome content",
                authorDisplayName: "Bob",
                publishedAt: "2026-03-10T11:00:00Z",
              },
            },
            totalReplyCount: 0,
          },
        },
      ],
      nextPageToken: "page-token-next",
    })),
    postComment: mock.fn(async () => ({
      id: "reply-yt-new-001",
      publishedAt: "2026-03-10T12:00:00Z",
    })),
    uploadVideo: mock.fn(async () => ({
      id: "video-123",
      publishedAt: new Date().toISOString(),
    })),
    validateCredentials: mock.fn(async () => ({
      id: "channel-123",
      title: "Test Channel",
    })),
    getChannelAnalytics: mock.fn(async () => ({
      views: 100,
      likes: 50,
      comments: 10,
      shares: 5,
      subscribersGained: 3,
      watchTime: 500,
    })),
  };
}

const TEST_CREDENTIALS = {
  clientId: "client-001",
  clientSecret: "secret-001",
  refreshToken: "refresh-001",
  channelId: "channel-001",
};

// ============================================================================
// 1. getComments Tests
// ============================================================================

describe("YouTubeAdapter - getComments", { concurrency: 1 }, () => {
  let adapter: YouTubeAdapter;

  beforeEach(() => {
    adapter = new YouTubeAdapter();
  });

  it("returns comments with author info", async () => {
    const mockClient = makeMockApiClient();
    const createClientMock = mock.method(
      adapter as never,
      "createApiClient" as never,
      () => mockClient
    );

    const result = await adapter.getComments({
      channelCredentials: TEST_CREDENTIALS,
      postExternalId: "video-001",
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.comments.length, 2);

    const first = result.value.comments[0];
    assert.ok(first);
    assert.strictEqual(first.providerMessageId, "comment-yt-001");
    assert.strictEqual(first.authorName, "Alice");
    assert.strictEqual(first.authorProviderId, "channel-alice");
    assert.strictEqual(first.authorAvatarUrl, "https://example.com/alice.jpg");
    assert.strictEqual(first.body, "Great video!");

    const second = result.value.comments[1];
    assert.ok(second);
    assert.strictEqual(second.providerMessageId, "comment-yt-002");
    assert.strictEqual(second.authorName, "Bob");
    assert.strictEqual(second.authorProviderId, "");
    assert.strictEqual(second.authorAvatarUrl, undefined);

    assert.strictEqual(result.value.nextCursor, "page-token-next");

    createClientMock.mock.restore();
  });

  it("returns empty when no postExternalId", async () => {
    const result = await adapter.getComments({
      channelCredentials: TEST_CREDENTIALS,
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.comments.length, 0);
  });

  it("passes cursor and limit to API", async () => {
    const mockClient = makeMockApiClient();
    const createClientMock = mock.method(
      adapter as never,
      "createApiClient" as never,
      () => mockClient
    );

    await adapter.getComments({
      channelCredentials: TEST_CREDENTIALS,
      postExternalId: "video-001",
      cursor: "page-token-abc",
      limit: 50,
    });

    const call = mockClient.getVideoComments.mock.calls[0];
    assert.ok(call);
    assert.strictEqual(call.arguments[0], "video-001");
    assert.strictEqual(call.arguments[1], 50);
    assert.strictEqual(call.arguments[2], "page-token-abc");

    createClientMock.mock.restore();
  });

  it("returns NETWORK error on failure", async () => {
    const mockClient = makeMockApiClient();
    mockClient.getVideoComments = mock.fn(async () => {
      throw new Error("API error");
    });

    const createClientMock = mock.method(
      adapter as never,
      "createApiClient" as never,
      () => mockClient
    );

    const result = await adapter.getComments({
      channelCredentials: TEST_CREDENTIALS,
      postExternalId: "video-001",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "NETWORK");

    createClientMock.mock.restore();
  });
});

// ============================================================================
// 2. postReply Tests
// ============================================================================

describe("YouTubeAdapter - postReply", { concurrency: 1 }, () => {
  let adapter: YouTubeAdapter;

  beforeEach(() => {
    adapter = new YouTubeAdapter();
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
      inReplyToProviderMessageId: "comment-yt-001",
      body: "Thanks for watching!",
      postExternalId: "video-001",
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.providerReplyId, "reply-yt-new-001");
    assert.ok(result.value.createdAt instanceof Date);

    const call = mockClient.postComment.mock.calls[0];
    assert.ok(call);
    assert.strictEqual(call.arguments[0], "video-001");
    assert.strictEqual(call.arguments[1], "Thanks for watching!");
    assert.strictEqual(call.arguments[2], "comment-yt-001");

    createClientMock.mock.restore();
  });

  it("returns RATE_LIMIT on rate limit error", async () => {
    const mockClient = makeMockApiClient();
    mockClient.postComment = mock.fn(async () => {
      throw new Error("429 Too Many Requests");
    });

    const createClientMock = mock.method(
      adapter as never,
      "createApiClient" as never,
      () => mockClient
    );

    const result = await adapter.postReply({
      channelCredentials: TEST_CREDENTIALS,
      inReplyToProviderMessageId: "comment-yt-001",
      body: "reply",
      postExternalId: "video-001",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "RATE_LIMIT");

    createClientMock.mock.restore();
  });
});

// ============================================================================
// 3. Capabilities Test
// ============================================================================

describe("YouTubeAdapter - Updated Capabilities", { concurrency: 1 }, () => {
  it("reports replies as true", () => {
    const adapter = new YouTubeAdapter();
    assert.strictEqual(adapter.capabilities.replies, true);
    assert.strictEqual(adapter.capabilities.comments, true);
  });
});
