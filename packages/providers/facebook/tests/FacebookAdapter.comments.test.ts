/**
 * @file FacebookAdapter.comments.test.ts
 * @description Unit tests for Facebook getComments, postReply, and capability flags.
 *   The adapter takes credentials per-call; the suite injects a fake
 *   `FacebookApiClient` factory so tests do not hit the network.
 *   All tests are Tier 0 (no network, no DB, no Redis).
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { FacebookAdapter, type FacebookApiClientFactory } from "../src/FacebookAdapter.js";
import type { FacebookApiClient, FacebookCredentials } from "../src/apiClient.js";

// ============================================================================
// Mock factories
// ============================================================================

function makeMockApiClient() {
  return {
    getPostComments: vi.fn(async () => ({
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
    replyToComment: vi.fn(async () => ({
      id: "reply-fb-new-001",
    })),
    validateCredentials: vi.fn(async () => ({
      id: "page-001",
      name: "Test Page",
      username: "testpage",
      access_token: "token",
    })),
    getPageInsights: vi.fn(async () => ({
      impressions: 100,
      engagements: 50,
      likes: 30,
      shares: 10,
      comments: 5,
      clicks: 20,
    })),
    uploadMedia: vi.fn(async () => ({
      id: "media-001",
      media_key: "facebook_media-001",
      size: 1000,
    })),
    postToPage: vi.fn(async () => ({
      id: "post-001",
    })),
  };
}

type MockApiClient = ReturnType<typeof makeMockApiClient>;

function makeAdapter(client: MockApiClient = makeMockApiClient()) {
  const factory: FacebookApiClientFactory = () => client as unknown as FacebookApiClient;
  return new FacebookAdapter({ apiClientFactory: factory });
}

const TEST_CREDENTIALS: FacebookCredentials = {
  accessToken: "test-token",
  pageId: "page-001",
  appId: "app-001",
  appSecret: "secret-001",
};

// ============================================================================
// 1. getComments Tests
// ============================================================================

describe("FacebookAdapter - getComments", { concurrency: 1 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns comments with threading info", async () => {
    const mockClient = makeMockApiClient();
    const adapter = makeAdapter(mockClient);

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
  });

  it("returns empty when no postExternalId", async () => {
    const adapter = makeAdapter();
    const result = await adapter.getComments({
      channelCredentials: TEST_CREDENTIALS,
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.comments.length, 0);
  });

  it("returns AUTH error when credentials missing required fields", async () => {
    const adapter = makeAdapter();
    const result = await adapter.getComments({
      channelCredentials: { accessToken: "only-token" },
      postExternalId: "post-001",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "AUTH");
  });

  it("returns NETWORK error on failure", async () => {
    const mockClient = makeMockApiClient();
    mockClient.getPostComments = vi.fn(async () => {
      throw new Error("API error");
    });
    const adapter = makeAdapter(mockClient);

    const result = await adapter.getComments({
      channelCredentials: TEST_CREDENTIALS,
      postExternalId: "post-001",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "NETWORK");
  });
});

// ============================================================================
// 2. postReply Tests
// ============================================================================

describe("FacebookAdapter - postReply", { concurrency: 1 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts a reply to a comment", async () => {
    const mockClient = makeMockApiClient();
    const adapter = makeAdapter(mockClient);

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
    assert.strictEqual(call[0], "comment-fb-001");
    assert.strictEqual(call[1], "Thanks for the feedback!");
  });

  it("returns AUTH error when credentials missing", async () => {
    const adapter = makeAdapter();
    const result = await adapter.postReply({
      channelCredentials: {},
      inReplyToProviderMessageId: "comment-fb-001",
      body: "reply",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "AUTH");
  });

  it("returns RATE_LIMIT on rate limit error", async () => {
    const mockClient = makeMockApiClient();
    mockClient.replyToComment = vi.fn(async () => {
      throw new Error("Facebook Rate Limit Error");
    });
    const adapter = makeAdapter(mockClient);

    const result = await adapter.postReply({
      channelCredentials: TEST_CREDENTIALS,
      inReplyToProviderMessageId: "comment-fb-001",
      body: "reply",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "RATE_LIMIT");
  });
});

// ============================================================================
// 3. Capabilities Test
// ============================================================================

describe("FacebookAdapter - Capabilities", { concurrency: 1 }, () => {
  it("reports replies as true", () => {
    const adapter = new FacebookAdapter();
    assert.strictEqual(adapter.capabilities.replies, true);
    assert.strictEqual(adapter.capabilities.comments, true);
  });
});
