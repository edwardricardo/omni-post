/**
 * @file ThreadsAdapter.test.ts
 * @description Test suite for the Threads (Meta) provider adapter — covers
 *   metadata, render (single + media), the two-step container publish flow
 *   (text / image / video / carousel), fetchAnalytics aggregation, getComments
 *   listing, postReply, and error / auth paths. Adapter is stateless w.r.t.
 *   credentials; tests pass `MOCK_CREDENTIALS` per call. Tier 0 (mocked fetch).
 * @layer infrastructure
 */

import { describe, it, beforeEach, afterEach, vi, expect } from "vitest";
import { ThreadsAdapter } from "../src/ThreadsAdapter.js";
import type { CanonicalPost } from "@shared/types";
import type { PublishInput } from "@ports/core";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_CREDENTIALS = {
  accessToken: "test-access-token",
  userId: "user-123",
};

function makeCanonical(overrides: Partial<CanonicalPost> = {}): CanonicalPost {
  return {
    id: "post-tr-001",
    projectId: "project-test",
    locale: "en",
    body: "Hello Threads",
    ...overrides,
  };
}

function makePublishInput(
  postOverrides: { body?: string; media?: Array<{ url: string }> } = {}
): PublishInput {
  return {
    channelId: "channel-tr-1",
    post: { body: "Hello Threads", ...postOverrides } as PublishInput["post"],
    dedupeKey: `dedupe-${Date.now()}`,
  };
}

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function makeJsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

let fetchSpy: ReturnType<typeof vi.fn>;
let fetchCalls: FetchCall[];

/**
 * Queue a one-shot mocked response. The wrapper records the call into
 * `fetchCalls` so assertions can inspect the URL + body, which a bare
 * `mockResolvedValueOnce` would skip (it replaces the function body wholesale
 * and bypasses the recording closure).
 */
function queueResponse(body: unknown, ok = true, status = 200) {
  fetchSpy.mockImplementationOnce(async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url, ...(init && { init }) });
    return makeJsonResponse(body, ok, status);
  });
}

beforeEach(() => {
  fetchCalls = [];
  fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url, ...(init && { init }) });
    return makeJsonResponse({ id: "container-1" });
  });
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// metadata + limits + capabilities (smoke)
// ---------------------------------------------------------------------------

describe("ThreadsAdapter — metadata", () => {
  it("exposes the provider id, OAuth scopes, and active status", () => {
    const adapter = new ThreadsAdapter();
    expect(adapter.id).toBe("threads");
    expect(adapter.metadata.authType).toBe("oauth");
    expect(adapter.metadata.requiredScopes).toContain("threads_content_publish");
    expect(adapter.metadata.status).toBe("active");
  });

  it("sets the documented Threads limits", () => {
    const adapter = new ThreadsAdapter();
    expect(adapter.limits.maxChars).toBe(500);
    expect(adapter.limits.maxMediaPerPost).toBe(10);
    expect(adapter.limits.threadingSupported).toBe(false);
    expect(adapter.limits.allowedMedia).toEqual(["image", "video"]);
  });

  it("declares publish + analytics + comments + replies capabilities", () => {
    const adapter = new ThreadsAdapter();
    expect(adapter.capabilities.publish).toBe(true);
    expect(adapter.capabilities.analytics).toBe(true);
    expect(adapter.capabilities.comments).toBe(true);
    expect(adapter.capabilities.replies).toBe(true);
    expect(adapter.capabilities.threading).toBe(false);
    expect(adapter.capabilities.schedule).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateCredentials
// ---------------------------------------------------------------------------

describe("ThreadsAdapter — validateCredentials", () => {
  it("returns ok when credentials carry the required fields", async () => {
    const adapter = new ThreadsAdapter();
    const result = await adapter.validateCredentials(MOCK_CREDENTIALS);
    expect(result.ok).toBe(true);
  });

  it("returns AUTH_INVALID when accessToken is missing", async () => {
    const adapter = new ThreadsAdapter();
    const result = await adapter.validateCredentials({ userId: "u" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("AUTH_INVALID");
  });

  it("returns AUTH_INVALID when credentials are null", async () => {
    const adapter = new ThreadsAdapter();
    const result = await adapter.validateCredentials(null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("AUTH_INVALID");
  });
});

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------

describe("ThreadsAdapter — render", () => {
  it("returns a single-content render with the body and media list", () => {
    const adapter = new ThreadsAdapter();
    const result = adapter.render(
      makeCanonical({
        body: "Body text",
        media: [{ url: "https://cdn/img.jpg", type: "image" }],
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe("single");
    expect(result.value.content.body).toBe("Body text");
    expect(result.value.content.media).toEqual([{ url: "https://cdn/img.jpg", type: "image" }]);
    expect(result.value.meta?.provider).toBe("threads");
  });

  it("truncates the body to the 500-character limit", () => {
    const adapter = new ThreadsAdapter();
    const longBody = "a".repeat(700);
    const result = adapter.render(makeCanonical({ body: longBody }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content.body.length).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// publish (two-step container flow)
// ---------------------------------------------------------------------------

describe("ThreadsAdapter — publish", () => {
  it("returns AUTH when credentials are missing required fields", async () => {
    const adapter = new ThreadsAdapter();
    const result = await adapter.publish(makePublishInput(), { accessToken: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("AUTH");
  });

  it("returns AUTH when credentials are null", async () => {
    const adapter = new ThreadsAdapter();
    const result = await adapter.publish(makePublishInput(), null);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("AUTH");
  });

  it("publishes a text-only post via the 2-step container flow", async () => {
    const adapter = new ThreadsAdapter();

    queueResponse({ id: "container-A" });
    queueResponse({ id: "post-A" });

    const result = await adapter.publish(makePublishInput({ body: "Hi" }), MOCK_CREDENTIALS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.providerPostId).toBe("post-A");
    expect(result.value.url).toBe("https://www.threads.net/post/post-A");
    expect(fetchCalls).toHaveLength(2);

    const createBody = JSON.parse(fetchCalls[0]!.init!.body as string);
    expect(createBody.media_type).toBe("TEXT");
    expect(createBody.text).toBe("Hi");
  });

  it("waits for the media container before publishing an image post", async () => {
    const adapter = new ThreadsAdapter();

    queueResponse({ id: "container-img" });
    queueResponse({ status: "FINISHED" });
    queueResponse({ id: "post-img" });

    const result = await adapter.publish(
      makePublishInput({
        body: "with image",
        media: [{ url: "https://cdn/photo.jpg" }],
      }),
      MOCK_CREDENTIALS
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.providerPostId).toBe("post-img");

    const createBody = JSON.parse(fetchCalls[0]!.init!.body as string);
    expect(createBody.media_type).toBe("IMAGE");
    expect(createBody.image_url).toBe("https://cdn/photo.jpg");
    expect(fetchCalls[1]!.url).toContain("/container-img?fields=status");
  });

  it("uses the VIDEO media type when the URL ends in .mp4", async () => {
    const adapter = new ThreadsAdapter();

    queueResponse({ id: "container-vid" });
    queueResponse({ status: "FINISHED" });
    queueResponse({ id: "post-vid" });

    const result = await adapter.publish(
      makePublishInput({ media: [{ url: "https://cdn/clip.mp4" }] }),
      MOCK_CREDENTIALS
    );

    expect(result.ok).toBe(true);
    const createBody = JSON.parse(fetchCalls[0]!.init!.body as string);
    expect(createBody.media_type).toBe("VIDEO");
    expect(createBody.video_url).toBe("https://cdn/clip.mp4");
  });

  it("creates carousel item containers + parent for multi-media posts", async () => {
    const adapter = new ThreadsAdapter();

    queueResponse({ id: "item-1" });
    queueResponse({ id: "item-2" });
    queueResponse({ id: "carousel-c" });
    queueResponse({ status: "FINISHED" });
    queueResponse({ id: "post-carousel" });

    const result = await adapter.publish(
      makePublishInput({
        media: [{ url: "https://cdn/a.jpg" }, { url: "https://cdn/b.mp4" }],
      }),
      MOCK_CREDENTIALS
    );

    expect(result.ok).toBe(true);

    const parentBody = JSON.parse(fetchCalls[2]!.init!.body as string);
    expect(parentBody.media_type).toBe("CAROUSEL");
    expect(parentBody.children).toBe("item-1,item-2");
  });

  it("returns NETWORK when the publish step rejects with !ok", async () => {
    const adapter = new ThreadsAdapter();

    queueResponse({ id: "container-x" });
    queueResponse({ error: { message: "Bad request" } }, false, 400);

    const result = await adapter.publish(makePublishInput(), MOCK_CREDENTIALS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("NETWORK");
  });
});

// ---------------------------------------------------------------------------
// fetchAnalytics
// ---------------------------------------------------------------------------

describe("ThreadsAdapter — fetchAnalytics", () => {
  it("aggregates per-post insights into a metrics array", async () => {
    const adapter = new ThreadsAdapter();

    queueResponse({ data: [{ id: "post-1", timestamp: "2026-04-01T00:00:00Z" }] });
    queueResponse({
      data: [
        { name: "views", values: [{ value: 100 }] },
        { name: "likes", values: [{ value: 30 }] },
        { name: "replies", values: [{ value: 5 }] },
        { name: "reposts", values: [{ value: 2 }] },
        { name: "quotes", values: [{ value: 1 }] },
      ],
    });

    const result = await adapter.fetchAnalytics({ channelId: "channel-tr-1" }, MOCK_CREDENTIALS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.value as { metrics: Array<{ postId: string; shares: number }> };
    expect(data.metrics).toHaveLength(1);
    expect(data.metrics[0]!.postId).toBe("post-1");
    expect(data.metrics[0]!.shares).toBe(3);
  });

  it("returns NETWORK when the posts list request fails", async () => {
    const adapter = new ThreadsAdapter();

    queueResponse({}, false, 500);

    const result = await adapter.fetchAnalytics({ channelId: "channel-tr-1" }, MOCK_CREDENTIALS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("NETWORK");
  });

  it("returns AUTH when credentials are missing required fields", async () => {
    const adapter = new ThreadsAdapter();

    const result = await adapter.fetchAnalytics({ channelId: "channel-tr-1" }, { accessToken: "" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("AUTH");
  });
});

// ---------------------------------------------------------------------------
// getComments
// ---------------------------------------------------------------------------

describe("ThreadsAdapter — getComments", () => {
  it("maps Threads replies into the canonical ProviderComment shape", async () => {
    const adapter = new ThreadsAdapter();

    queueResponse({
      data: [{ id: "r-1", text: "hello", username: "alice", timestamp: "2026-04-01T00:00:00Z" }],
      paging: { cursors: { after: "cursor-1" } },
    });

    const result = await adapter.getComments({ channelCredentials: MOCK_CREDENTIALS });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.comments).toHaveLength(1);
    expect(result.value.comments[0]!.providerMessageId).toBe("r-1");
    expect(result.value.comments[0]!.body).toBe("hello");
    expect(result.value.nextCursor).toBe("cursor-1");
  });

  it("returns AUTH when no access token is provided", async () => {
    const adapter = new ThreadsAdapter();
    const result = await adapter.getComments({
      channelCredentials: { accessToken: "", userId: "u" },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("AUTH");
  });
});

// ---------------------------------------------------------------------------
// postReply
// ---------------------------------------------------------------------------

describe("ThreadsAdapter — postReply", () => {
  it("creates a reply container and publishes it (2-step)", async () => {
    const adapter = new ThreadsAdapter();

    queueResponse({ id: "reply-c" });
    queueResponse({ id: "reply-p" });

    const result = await adapter.postReply({
      channelCredentials: MOCK_CREDENTIALS,
      inReplyToProviderMessageId: "thread-42",
      body: "thanks!",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.providerReplyId).toBe("reply-p");

    const containerBody = JSON.parse(fetchCalls[0]!.init!.body as string);
    expect(containerBody.media_type).toBe("TEXT");
    expect(containerBody.reply_to_id).toBe("thread-42");
    expect(containerBody.text).toBe("thanks!");
  });

  it("returns NETWORK when the publish step fails", async () => {
    const adapter = new ThreadsAdapter();

    queueResponse({ id: "reply-c" });
    queueResponse({}, false, 500);

    const result = await adapter.postReply({
      channelCredentials: MOCK_CREDENTIALS,
      inReplyToProviderMessageId: "thread-42",
      body: "thanks!",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("NETWORK");
  });

  it("returns AUTH when credentials are missing", async () => {
    const adapter = new ThreadsAdapter();
    const result = await adapter.postReply({
      channelCredentials: { accessToken: "", userId: "u" },
      inReplyToProviderMessageId: "thread-42",
      body: "x",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("AUTH");
  });
});
