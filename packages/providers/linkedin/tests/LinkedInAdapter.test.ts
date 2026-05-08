/**
 * @file LinkedInAdapter.test.ts
 * @description Unit tests for LinkedInAdapter covering metadata, render,
 *              publish, validateCredentials, fetchAnalytics, getComments,
 *              postReply, and error handling. Adapter is stateless w.r.t.
 *              credentials — tests inject a fake apiClientFactory and pass
 *              credentials per-call.
 *              All tests are Tier 0 (no network, no DB, no Redis).
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { LinkedInAdapter, type LinkedInApiClientFactory } from "../src/LinkedInAdapter.js";
import type { LinkedInApiClient } from "../src/apiClient.js";
import type { LinkedInCredentials } from "../src/types.js";
import type { CanonicalPost, RenderedPost } from "@shared/types";
import type { PublishInput } from "@ports/core";

// ============================================================================
// Test helpers
// ============================================================================

interface FakeApiClient {
  createPost: ReturnType<typeof vi.fn>;
  getProfile: ReturnType<typeof vi.fn>;
  validateCredentials?: ReturnType<typeof vi.fn>;
  getPostAnalytics: ReturnType<typeof vi.fn>;
  initializeImageUpload: ReturnType<typeof vi.fn>;
  initializeVideoUpload: ReturnType<typeof vi.fn>;
  initializeDocumentUpload: ReturnType<typeof vi.fn>;
  uploadMediaBinary: ReturnType<typeof vi.fn>;
  getComments: ReturnType<typeof vi.fn>;
  postComment: ReturnType<typeof vi.fn>;
}

function makeFakeApiClient(overrides: Partial<FakeApiClient> = {}): FakeApiClient {
  return {
    createPost: vi.fn(async () => ({
      id: "urn:li:share:12345",
      activity: "urn:li:activity:12345",
    })),
    getProfile: vi.fn(async () => ({ sub: "abc123", name: "Test User" })),
    getPostAnalytics: vi.fn(async () => ({
      totalShareStatistics: {
        shareCount: 10,
        likeCount: 50,
        commentCount: 5,
        impressionCount: 1000,
        uniqueImpressionsCount: 800,
        clickCount: 25,
        engagement: 0.09,
      },
    })),
    initializeImageUpload: vi.fn(async () => ({
      value: { uploadUrl: "https://api.linkedin.com/upload", image: "urn:li:image:1" },
    })),
    initializeVideoUpload: vi.fn(async () => ({
      value: {
        uploadInstructions: [{ uploadUrl: "https://x", firstByte: 0, lastByte: 0 }],
        video: "urn:li:video:1",
      },
    })),
    initializeDocumentUpload: vi.fn(async () => ({
      value: { uploadUrl: "https://api.linkedin.com/upload-doc", document: "urn:li:document:1" },
    })),
    uploadMediaBinary: vi.fn(async () => undefined),
    getComments: vi.fn(async () => ({
      elements: [],
      paging: { start: 0, count: 20, total: 0, links: [] },
    })),
    postComment: vi.fn(async () => ({
      id: "comment-001",
      actor: "urn:li:person:abc123",
      message: { text: "reply" },
      created: { time: Date.now() },
      object: "urn:li:share:12345",
    })),
    ...overrides,
  };
}

function makeAdapter(client: FakeApiClient = makeFakeApiClient()): {
  adapter: LinkedInAdapter;
  client: FakeApiClient;
} {
  const factory: LinkedInApiClientFactory = () => client as unknown as LinkedInApiClient;
  const adapter = new LinkedInAdapter({ apiClientFactory: factory });
  return { adapter, client };
}

function makeCanonicalPost(overrides?: Partial<CanonicalPost>): CanonicalPost {
  return {
    id: "post-001",
    projectId: "project-001",
    locale: "en",
    body: "Test LinkedIn post content",
    ...overrides,
  };
}

function makePublishInput(overrides?: Partial<PublishInput>): PublishInput {
  return {
    channelId: "channel-linkedin-001",
    post: {
      body: "LinkedIn post body",
      text: "LinkedIn post body",
    },
    dedupeKey: "dedupe-001",
    ...overrides,
  };
}

const VALID_CREDS: LinkedInCredentials = {
  accessToken: "valid-token",
  refreshToken: "valid-refresh",
  personUrn: "urn:li:person:abc123",
};

const VALID_CREDS_ORG: LinkedInCredentials = {
  ...VALID_CREDS,
  organizationUrn: "urn:li:organization:org456",
};

// ============================================================================
// 1. Metadata Tests
// ============================================================================

describe("LinkedInAdapter - Metadata", { concurrency: 1 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns correct provider ID", () => {
    const { adapter } = makeAdapter();
    assert.strictEqual(adapter.id, "linkedin");
  });

  it("returns correct metadata fields", () => {
    const { adapter } = makeAdapter();
    assert.strictEqual(adapter.metadata.id, "linkedin");
    assert.strictEqual(adapter.metadata.name, "linkedin");
    assert.strictEqual(adapter.metadata.displayName, "LinkedIn");
    assert.strictEqual(adapter.metadata.color, "#0A66C2");
    assert.strictEqual(adapter.metadata.authType, "oauth");
    assert.strictEqual(adapter.metadata.status, "active");
    assert.strictEqual(adapter.metadata.website, "https://linkedin.com");
  });

  it("returns correct limits", () => {
    const { adapter } = makeAdapter();
    assert.strictEqual(adapter.limits.maxChars, 3000);
    assert.strictEqual(adapter.limits.maxMediaPerPost, 9);
    assert.strictEqual(adapter.limits.threadingSupported, false);
    assert.deepStrictEqual(adapter.limits.allowedMedia, ["image", "video"]);
    assert.deepStrictEqual(adapter.limits.aspectRatios, ["1:1", "4:5", "16:9", "9:16"]);
  });

  it("returns correct capabilities", () => {
    const { adapter } = makeAdapter();
    assert.strictEqual(adapter.capabilities.publish, true);
    assert.strictEqual(adapter.capabilities.schedule, true);
    assert.strictEqual(adapter.capabilities.analytics, true);
    assert.strictEqual(adapter.capabilities.comments, true);
    assert.strictEqual(adapter.capabilities.replies, true);
    assert.strictEqual(adapter.capabilities.threading, false);
  });

  it("has correct required scopes", () => {
    const { adapter } = makeAdapter();
    assert.deepStrictEqual(adapter.metadata.requiredScopes, [
      "w_member_social",
      "w_organization_social",
      "openid",
      "profile",
    ]);
  });

  it("has empty constraints", () => {
    const { adapter } = makeAdapter();
    assert.deepStrictEqual(adapter.constraints, {});
  });

  it("exports a factory function", async () => {
    const { createLinkedInAdapter } = await import("../src/LinkedInAdapter.js");
    const adapter = createLinkedInAdapter();
    assert.ok(adapter instanceof LinkedInAdapter);
    assert.strictEqual(adapter.id, "linkedin");
  });
});

// ============================================================================
// 2. Render Tests
// ============================================================================

describe("LinkedInAdapter - Render", { concurrency: 1 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders text-only content correctly", () => {
    const { adapter } = makeAdapter();
    const post = makeCanonicalPost({ body: "Hello LinkedIn!" });
    const result = adapter.render(post);

    assert.ok(result.ok, "Render should succeed");
    if (result.ok) {
      assert.strictEqual(result.value.type, "single");
      const content = result.value.content as RenderedPost;
      assert.strictEqual(content.body, "Hello LinkedIn!");
      assert.strictEqual(content.meta?.platform, "linkedin");
    }
  });

  it("renders content with media correctly", () => {
    const { adapter } = makeAdapter();
    const post = makeCanonicalPost({
      body: "Post with image",
      media: [
        {
          id: "m1",
          type: "image",
          url: "https://example.com/photo.jpg",
          alt: "Photo description",
        },
      ],
    });

    const result = adapter.render(post);

    assert.ok(result.ok, "Render should succeed");
    if (result.ok) {
      const content = result.value.content as RenderedPost;
      assert.ok(content.media, "Media should be present");
      assert.strictEqual(content.media?.length, 1);
      assert.strictEqual(content.media?.[0]?.url, "https://example.com/photo.jpg");
      assert.strictEqual(content.media?.[0]?.type, "image");
      assert.strictEqual(content.media?.[0]?.alt, "Photo description");
    }
  });

  it("renders content with multiple media items", () => {
    const { adapter } = makeAdapter();
    const post = makeCanonicalPost({
      body: "Multi image post",
      media: [
        { id: "m1", type: "image", url: "https://example.com/img1.jpg" },
        { id: "m2", type: "image", url: "https://example.com/img2.jpg" },
        { id: "m3", type: "video", url: "https://example.com/video.mp4" },
      ],
    });

    const result = adapter.render(post);

    assert.ok(result.ok);
    if (result.ok) {
      const content = result.value.content as RenderedPost;
      assert.strictEqual(content.media?.length, 3);
    }
  });

  it("returns TEXT_TOO_LONG when body exceeds 3000 chars", () => {
    const { adapter } = makeAdapter();
    const longBody = "x".repeat(3001);
    const post = makeCanonicalPost({ body: longBody });

    const result = adapter.render(post);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "TEXT_TOO_LONG");
    }
  });

  it("returns VALIDATION_ERROR when too many media items", () => {
    const { adapter } = makeAdapter();
    const tooManyMedia = Array.from({ length: 10 }, (_, i) => ({
      id: `m${i}`,
      type: "image" as const,
      url: `https://example.com/img${i}.jpg`,
    }));
    const post = makeCanonicalPost({ body: "Too many images", media: tooManyMedia });

    const result = adapter.render(post);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "VALIDATION_ERROR");
    }
  });

  it("renders empty body as empty string", () => {
    const { adapter } = makeAdapter();
    const post = makeCanonicalPost({ body: "" });
    const result = adapter.render(post);

    assert.ok(result.ok);
    if (result.ok) {
      const content = result.value.content as RenderedPost;
      assert.strictEqual(content.body, "");
    }
  });

  it("does not include media in rendered content when no media provided", () => {
    const { adapter } = makeAdapter();
    const post = makeCanonicalPost({ body: "Text only", media: undefined });
    const result = adapter.render(post);

    assert.ok(result.ok);
    if (result.ok) {
      const content = result.value.content as RenderedPost;
      assert.strictEqual(content.media, undefined);
    }
  });

  it("omits alt from media when not provided", () => {
    const { adapter } = makeAdapter();
    const post = makeCanonicalPost({
      body: "No alt text",
      media: [{ id: "m1", type: "image", url: "https://example.com/img.jpg" }],
    });

    const result = adapter.render(post);

    assert.ok(result.ok);
    if (result.ok) {
      const content = result.value.content as RenderedPost;
      assert.strictEqual(content.media?.[0]?.alt, undefined);
    }
  });
});

// ============================================================================
// 3. Publish Tests
// ============================================================================

describe("LinkedInAdapter - Publish", { concurrency: 1 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("publishes text post successfully and returns receipt", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.publish(makePublishInput(), VALID_CREDS);

    assert.ok(result.ok, "Publish should succeed");
    if (result.ok) {
      assert.strictEqual(result.value.providerPostId, "urn:li:share:12345");
      assert.ok(result.value.url?.includes("linkedin.com/feed/update/"));
      assert.ok(result.value.publishedAt instanceof Date);
    }
  });

  it("calls createPost with correct author from personUrn", async () => {
    const { adapter, client } = makeAdapter();
    await adapter.publish(makePublishInput(), VALID_CREDS);

    assert.strictEqual(client.createPost.mock.calls.length, 1);
    const payload = client.createPost.mock.calls[0]?.[0] as Record<string, unknown>;
    assert.strictEqual(payload.author, "urn:li:person:abc123");
    assert.strictEqual(payload.visibility, "PUBLIC");
    assert.strictEqual(payload.lifecycleState, "PUBLISHED");
  });

  it("uses organizationUrn as author when available", async () => {
    const { adapter, client } = makeAdapter();
    await adapter.publish(makePublishInput(), VALID_CREDS_ORG);

    const payload = client.createPost.mock.calls[0]?.[0] as Record<string, unknown>;
    assert.strictEqual(payload.author, "urn:li:organization:org456");
  });

  it("constructs correct URL from share URN", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.publish(makePublishInput(), VALID_CREDS);

    assert.ok(result.ok);
    if (result.ok) {
      assert.strictEqual(
        result.value.url,
        "https://www.linkedin.com/feed/update/urn:li:activity:12345"
      );
    }
  });

  it("uses raw postId in URL when activity ID cannot be extracted", async () => {
    const client = makeFakeApiClient({
      createPost: vi.fn(async () => ({ id: "non-standard-id-format" })),
    });
    const { adapter } = makeAdapter(client);
    const result = await adapter.publish(makePublishInput(), VALID_CREDS);

    assert.ok(result.ok);
    if (result.ok) {
      assert.strictEqual(
        result.value.url,
        "https://www.linkedin.com/feed/update/non-standard-id-format"
      );
    }
  });

  it("returns AUTH error when credentials are missing", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.publish(makePublishInput(), undefined);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH");
    }
  });

  it("returns AUTH error when credentials lack accessToken", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.publish(makePublishInput(), {
      refreshToken: "x",
      personUrn: "y",
    });

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH");
    }
  });

  it("returns NETWORK error when circuit breaker is open", async () => {
    const client = makeFakeApiClient({
      createPost: vi.fn(async () => {
        throw new Error("Circuit breaker is OPEN for linkedin-api");
      }),
    });
    const { adapter } = makeAdapter(client);
    const result = await adapter.publish(makePublishInput(), VALID_CREDS);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "NETWORK");
    }
  });

  it("returns RATE_LIMIT error on 429 status", async () => {
    const rateLimitError = Object.assign(new Error("Rate limited"), { status: 429 });
    const client = makeFakeApiClient({
      createPost: vi.fn(async () => {
        throw rateLimitError;
      }),
    });
    const { adapter } = makeAdapter(client);
    const result = await adapter.publish(makePublishInput(), VALID_CREDS);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "RATE_LIMIT");
    }
  });

  it("returns AUTH error on 401 status", async () => {
    const authError = Object.assign(new Error("Unauthorized"), { status: 401 });
    const client = makeFakeApiClient({
      createPost: vi.fn(async () => {
        throw authError;
      }),
    });
    const { adapter } = makeAdapter(client);
    const result = await adapter.publish(makePublishInput(), VALID_CREDS);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH");
    }
  });

  it("returns NETWORK error on 500 status", async () => {
    const serverError = Object.assign(new Error("Server Error"), { status: 500 });
    const client = makeFakeApiClient({
      createPost: vi.fn(async () => {
        throw serverError;
      }),
    });
    const { adapter } = makeAdapter(client);
    const result = await adapter.publish(makePublishInput(), VALID_CREDS);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "NETWORK");
    }
  });

  it("sets commentary from post body", async () => {
    const { adapter, client } = makeAdapter();
    await adapter.publish(
      makePublishInput({
        post: { body: "My commentary text", text: "My commentary text" },
      }),
      VALID_CREDS
    );

    const payload = client.createPost.mock.calls[0]?.[0] as Record<string, unknown>;
    assert.strictEqual(payload.commentary, "My commentary text");
  });
});

// ============================================================================
// 4. ValidateCredentials Tests
// ============================================================================

describe("LinkedInAdapter - ValidateCredentials", { concurrency: 1 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok with valid credentials", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.validateCredentials(VALID_CREDS);
    assert.ok(result.ok, "Validation should succeed");
  });

  it("returns AUTH_INVALID when accessToken is missing", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.validateCredentials({ ...VALID_CREDS, accessToken: "" });

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH_INVALID");
    }
  });

  it("returns AUTH_INVALID when refreshToken is missing", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.validateCredentials({ ...VALID_CREDS, refreshToken: "" });

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH_INVALID");
    }
  });

  it("returns AUTH_INVALID when personUrn is missing", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.validateCredentials({ ...VALID_CREDS, personUrn: "" });

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH_INVALID");
    }
  });

  it("returns AUTH_INVALID when credentials object is null", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.validateCredentials(null);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH_INVALID");
    }
  });

  it("returns AUTH_EXPIRED when API returns 401", async () => {
    const authError = Object.assign(new Error("Unauthorized"), { status: 401 });
    const client = makeFakeApiClient({
      getProfile: vi.fn(async () => {
        throw authError;
      }),
    });
    const { adapter } = makeAdapter(client);
    const result = await adapter.validateCredentials(VALID_CREDS);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH_EXPIRED");
    }
  });

  it("returns AUTH_INVALID when API throws generic error", async () => {
    const client = makeFakeApiClient({
      getProfile: vi.fn(async () => {
        throw new Error("Connection refused");
      }),
    });
    const { adapter } = makeAdapter(client);
    const result = await adapter.validateCredentials(VALID_CREDS);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH_INVALID");
    }
  });
});

// ============================================================================
// 5. FetchAnalytics Tests
// ============================================================================

describe("LinkedInAdapter - FetchAnalytics", { concurrency: 1 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns analytics data with correct metrics mapping", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.fetchAnalytics(
      {
        channelId: "channel-001",
        since: new Date("2024-01-01"),
        until: new Date("2024-01-31"),
      },
      VALID_CREDS
    );

    assert.ok(result.ok, "FetchAnalytics should succeed");
    if (result.ok) {
      const data = result.value as Record<string, unknown>;
      assert.strictEqual(data.channelId, "channel-001");

      const metrics = data.metrics as Record<string, unknown>;
      assert.strictEqual(metrics.views, 1000);
      assert.strictEqual(metrics.likes, 50);
      assert.strictEqual(metrics.shares, 10);
      assert.strictEqual(metrics.comments, 5);
      assert.strictEqual(metrics.clicks, 25);
      assert.strictEqual(metrics.engagement, 0.09);
    }
  });

  it("passes authorUrn from personUrn to getPostAnalytics", async () => {
    const { adapter, client } = makeAdapter();
    await adapter.fetchAnalytics({ channelId: "channel-001" }, VALID_CREDS);

    assert.strictEqual(client.getPostAnalytics.mock.calls.length, 1);
    const authorUrn = client.getPostAnalytics.mock.calls[0]?.[0] as string;
    assert.strictEqual(authorUrn, "urn:li:person:abc123");
  });

  it("uses organizationUrn as authorUrn when available", async () => {
    const { adapter, client } = makeAdapter();
    await adapter.fetchAnalytics({ channelId: "channel-001" }, VALID_CREDS_ORG);

    const authorUrn = client.getPostAnalytics.mock.calls[0]?.[0] as string;
    assert.strictEqual(authorUrn, "urn:li:organization:org456");
  });

  it("returns AUTH error when credentials are missing", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.fetchAnalytics({ channelId: "channel-001" }, undefined);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH");
    }
  });

  it("returns NETWORK error when API call fails", async () => {
    const client = makeFakeApiClient({
      getPostAnalytics: vi.fn(async () => {
        throw new Error("API unavailable");
      }),
    });
    const { adapter } = makeAdapter(client);
    const result = await adapter.fetchAnalytics({ channelId: "channel-001" }, VALID_CREDS);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "NETWORK");
    }
  });

  it("includes since and until dates in response when provided", async () => {
    const { adapter } = makeAdapter();
    const since = new Date("2024-06-01");
    const until = new Date("2024-06-30");

    const result = await adapter.fetchAnalytics(
      { channelId: "channel-001", since, until },
      VALID_CREDS
    );

    assert.ok(result.ok);
    if (result.ok) {
      const data = result.value as Record<string, unknown>;
      assert.deepStrictEqual(data.since, since);
      assert.deepStrictEqual(data.until, until);
    }
  });
});

// ============================================================================
// 6. GetComments Tests
// ============================================================================

describe("LinkedInAdapter - GetComments", { concurrency: 1 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns comments list with correct mapping", async () => {
    const client = makeFakeApiClient({
      getComments: vi.fn(async () => ({
        elements: [
          {
            id: "comment-001",
            actor: "urn:li:person:user1",
            message: { text: "Great post!" },
            created: { time: 1717200000000 },
            object: "urn:li:share:12345",
          },
          {
            id: "comment-002",
            actor: "urn:li:person:user2",
            message: { text: "Thanks for sharing" },
            created: { time: 1717286400000 },
            parentComment: "comment-001",
            object: "urn:li:share:12345",
          },
        ],
        paging: { start: 0, count: 20, total: 2, links: [] },
      })),
    });
    const { adapter } = makeAdapter(client);

    const result = await adapter.getComments({
      channelCredentials: VALID_CREDS,
      postExternalId: "urn:li:share:12345",
    });

    assert.ok(result.ok, "getComments should succeed");
    if (result.ok) {
      assert.strictEqual(result.value.comments.length, 2);

      const firstComment = result.value.comments[0];
      assert.ok(firstComment);
      assert.strictEqual(firstComment.providerMessageId, "comment-001");
      assert.strictEqual(firstComment.body, "Great post!");
      assert.strictEqual(firstComment.authorName, "urn:li:person:user1");

      const secondComment = result.value.comments[1];
      assert.ok(secondComment);
      assert.strictEqual(secondComment.providerParentId, "comment-001");
    }
  });

  it("returns AUTH error when credentials are missing", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.getComments({
      channelCredentials: { accessToken: "", personUrn: "", refreshToken: "" },
    });

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH");
    }
  });

  it("returns AUTH error when accessToken is missing", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.getComments({
      channelCredentials: { accessToken: "", personUrn: "urn:li:person:abc123", refreshToken: "r" },
    });

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH");
    }
  });

  it("returns NETWORK error when API call fails", async () => {
    const client = makeFakeApiClient({
      getComments: vi.fn(async () => {
        throw new Error("API down");
      }),
    });
    const { adapter } = makeAdapter(client);
    const result = await adapter.getComments({
      channelCredentials: VALID_CREDS,
      postExternalId: "urn:li:share:1",
    });

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "NETWORK");
    }
  });
});

// ============================================================================
// 7. PostReply Tests
// ============================================================================

describe("LinkedInAdapter - PostReply", { concurrency: 1 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns AUTH error when credentials are missing", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.postReply({
      channelCredentials: { accessToken: "", personUrn: "", refreshToken: "" },
      inReplyToProviderMessageId: "urn:li:share:12345",
      body: "Reply text",
    });

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH");
    }
  });

  it("returns AUTH error when personUrn is missing", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.postReply({
      channelCredentials: { accessToken: "token", personUrn: "", refreshToken: "r" },
      inReplyToProviderMessageId: "urn:li:share:12345",
      body: "Reply text",
    });

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "AUTH");
    }
  });

  it("returns ok with reply receipt on success", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.postReply({
      channelCredentials: VALID_CREDS,
      inReplyToProviderMessageId: "urn:li:share:12345",
      body: "Reply text",
    });

    assert.ok(result.ok);
    if (result.ok) {
      assert.strictEqual(result.value.providerReplyId, "comment-001");
      assert.ok(result.value.createdAt instanceof Date);
    }
  });

  it("returns RATE_LIMIT error on 429 status", async () => {
    const rateLimitError = Object.assign(new Error("Rate limited"), { status: 429 });
    const client = makeFakeApiClient({
      postComment: vi.fn(async () => {
        throw rateLimitError;
      }),
    });
    const { adapter } = makeAdapter(client);
    const result = await adapter.postReply({
      channelCredentials: VALID_CREDS,
      inReplyToProviderMessageId: "urn:li:share:12345",
      body: "Reply text",
    });

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "RATE_LIMIT");
    }
  });

  it("returns NETWORK error for non-rate-limit errors", async () => {
    const client = makeFakeApiClient({
      postComment: vi.fn(async () => {
        throw new Error("Boom");
      }),
    });
    const { adapter } = makeAdapter(client);
    const result = await adapter.postReply({
      channelCredentials: VALID_CREDS,
      inReplyToProviderMessageId: "urn:li:share:12345",
      body: "Reply text",
    });

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "NETWORK");
    }
  });
});

// ============================================================================
// 8. Threading (Not Supported)
// ============================================================================

describe("LinkedInAdapter - Threading", { concurrency: 1 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("planThread returns THREAD_PLANNING_FAILED error", () => {
    const { adapter } = makeAdapter();
    const post = makeCanonicalPost();
    const result = adapter.planThread(post);

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "THREAD_PLANNING_FAILED");
    }
  });

  it("publishThread returns VALIDATION error", async () => {
    const { adapter } = makeAdapter();
    const result = await adapter.publishThread(
      {
        channelId: "channel-001",
        threadPlan: {
          strategy: "AUTO",
          tweets: [],
          totalChars: 0,
          estimatedReach: 0,
          needsThreading: false,
        },
        dedupeKey: "dedupe-001",
      },
      VALID_CREDS
    );

    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.strictEqual(result.error, "VALIDATION");
    }
  });
});
