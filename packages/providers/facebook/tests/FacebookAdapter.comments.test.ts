/**
 * @file FacebookAdapter.comments.test.ts
 * @description Unit tests for Facebook getComments, postReply, and scheduling.
 *              All tests are Tier 0 (no network, no DB, no Redis).
 * @layer test
 */

import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { FacebookAdapter } from "../src/FacebookAdapter.js";

// ============================================================================
// Mock factories
// ============================================================================

function makeMockApiClient() {
  return {
    getPostComments: mock.fn(async () => ({
      data: [
        {
          id: "comment-fb-001",
          message: "Great post!",
          from: { id: "user-001", name: "Alice" },
          created_time: "2026-03-10T10:00:00+0000",
        },
        {
          id: "comment-fb-002",
          message: "I agree with Alice",
          from: { id: "user-002", name: "Bob" },
          created_time: "2026-03-10T11:00:00+0000",
          parent: { id: "comment-fb-001" },
        },
      ],
      paging: {
        cursors: { after: "cursor-next" },
        next: "https://graph.facebook.com/v23.0/...",
      },
    })),
    replyToComment: mock.fn(async () => ({
      id: "reply-fb-new-001",
    })),
    postScheduled: mock.fn(async () => ({
      id: "scheduled-post-001",
    })),
    postWithLink: mock.fn(async () => ({
      id: "link-post-001",
    })),
    validateCredentials: mock.fn(async () => ({
      id: "page-001",
      name: "Test Page",
      username: "testpage",
      access_token: "token",
    })),
    getPageInsights: mock.fn(async () => ({
      impressions: 100,
      engagements: 50,
      likes: 30,
      shares: 10,
      comments: 5,
      clicks: 20,
    })),
    uploadMedia: mock.fn(async () => ({
      id: "media-001",
      media_key: "facebook_media-001",
      size: 1000,
    })),
    postToPage: mock.fn(async () => ({
      id: "post-001",
    })),
    makeApiRequest: mock.fn(async () => ({ json: async () => ({}) })),
  };
}

const TEST_CREDENTIALS = {
  accessToken: "test-token",
  pageId: "page-001",
  appId: "app-001",
  appSecret: "secret-001",
};

// ============================================================================
// 1. getComments Tests
// ============================================================================

describe("FacebookAdapter - getComments", { concurrency: 1 }, () => {
  let adapter: FacebookAdapter;

  beforeEach(() => {
    adapter = new FacebookAdapter();
  });

  it("returns comments with threading info", async () => {
    const mockClient = makeMockApiClient();
    const createClientMock = mock.method(
      adapter as never,
      "createApiClient" as never,
      () => mockClient
    );

    const result = await adapter.getComments({
      channelCredentials: TEST_CREDENTIALS,
      postExternalId: "post-001",
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.comments.length, 2);

    const first = result.value.comments[0];
    assert.ok(first);
    assert.strictEqual(first.providerMessageId, "comment-fb-001");
    assert.strictEqual(first.authorName, "Alice");
    assert.strictEqual(first.authorProviderId, "user-001");
    assert.strictEqual(first.providerParentId, undefined);

    const second = result.value.comments[1];
    assert.ok(second);
    assert.strictEqual(second.providerParentId, "comment-fb-001");

    assert.strictEqual(result.value.nextCursor, "cursor-next");

    createClientMock.mock.restore();
  });

  it("returns empty when no postExternalId", async () => {
    const result = await adapter.getComments({
      channelCredentials: TEST_CREDENTIALS,
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.comments.length, 0);
  });

  it("returns NETWORK error on failure", async () => {
    const mockClient = makeMockApiClient();
    mockClient.getPostComments = mock.fn(async () => {
      throw new Error("API error");
    });

    const createClientMock = mock.method(
      adapter as never,
      "createApiClient" as never,
      () => mockClient
    );

    const result = await adapter.getComments({
      channelCredentials: TEST_CREDENTIALS,
      postExternalId: "post-001",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "NETWORK");

    createClientMock.mock.restore();
  });
});

// ============================================================================
// 2. postReply Tests
// ============================================================================

describe("FacebookAdapter - postReply", { concurrency: 1 }, () => {
  let adapter: FacebookAdapter;

  beforeEach(() => {
    adapter = new FacebookAdapter();
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
      inReplyToProviderMessageId: "comment-fb-001",
      body: "Thanks for the feedback!",
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.providerReplyId, "reply-fb-new-001");
    assert.ok(result.value.createdAt instanceof Date);

    const call = mockClient.replyToComment.mock.calls[0];
    assert.ok(call);
    assert.strictEqual(call.arguments[0], "comment-fb-001");
    assert.strictEqual(call.arguments[1], "Thanks for the feedback!");

    createClientMock.mock.restore();
  });

  it("returns RATE_LIMIT on rate limit error", async () => {
    const mockClient = makeMockApiClient();
    mockClient.replyToComment = mock.fn(async () => {
      throw new Error("Facebook Rate Limit Error");
    });

    const createClientMock = mock.method(
      adapter as never,
      "createApiClient" as never,
      () => mockClient
    );

    const result = await adapter.postReply({
      channelCredentials: TEST_CREDENTIALS,
      inReplyToProviderMessageId: "comment-fb-001",
      body: "reply",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "RATE_LIMIT");

    createClientMock.mock.restore();
  });
});

// ============================================================================
// 3. Capabilities Test
// ============================================================================

describe("FacebookAdapter - Updated Capabilities", { concurrency: 1 }, () => {
  it("reports replies as true", () => {
    const adapter = new FacebookAdapter();
    assert.strictEqual(adapter.capabilities.replies, true);
    assert.strictEqual(adapter.capabilities.comments, true);
  });
});
