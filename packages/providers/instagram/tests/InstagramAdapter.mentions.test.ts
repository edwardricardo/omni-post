/**
 * @file InstagramAdapter.mentions.test.ts
 * @description Unit tests for Instagram fetchMentionById (brand-listening webhook
 *   fetch-before-process). The adapter takes credentials per-call; the suite
 *   injects a fake `InstagramApiClient` factory so tests do not hit the network.
 *   All tests are Tier 0.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { InstagramAdapter, type InstagramApiClientFactory } from "../src/InstagramAdapter.js";
import type { InstagramApiClient, InstagramCredentials } from "../src/apiClient.js";

function makeMockApiClient() {
  return {
    getMentionById: vi.fn(async () => ({
      id: "media-ig-001",
      caption: "Tagging @acme in my story",
      permalink: "https://instagram.com/p/media-ig-001",
      timestamp: "2026-05-10T10:00:00+0000",
      username: "fan_account",
      media_url: "https://cdn.instagram.com/media-ig-001.jpg",
      media_type: "IMAGE",
    })),
  };
}

type MockApiClient = ReturnType<typeof makeMockApiClient>;

function makeAdapter(client: MockApiClient = makeMockApiClient()) {
  const factory: InstagramApiClientFactory = () => client as unknown as InstagramApiClient;
  return { adapter: new InstagramAdapter({ apiClientFactory: factory }), client };
}

const TEST_CREDENTIALS: InstagramCredentials = {
  accessToken: "test-token",
  userId: "test-user-id",
};

describe("InstagramAdapter - fetchMentionById", { concurrent: false }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes a mentioned media object to ProviderMention", async () => {
    const { adapter, client } = makeAdapter();

    const result = await adapter.fetchMentionById({
      channelCredentials: TEST_CREDENTIALS,
      providerMentionId: "media-ig-001",
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.providerMentionId, "media-ig-001");
    assert.strictEqual(result.value.body, "Tagging @acme in my story");
    assert.strictEqual(result.value.authorName, "fan_account");
    assert.strictEqual(result.value.authorHandle, "fan_account");
    assert.strictEqual(result.value.url, "https://instagram.com/p/media-ig-001");
    assert.deepStrictEqual(result.value.mediaUrls, ["https://cdn.instagram.com/media-ig-001.jpg"]);
    assert.ok(result.value.createdAt instanceof Date);
    assert.strictEqual(client.getMentionById.mock.calls[0]?.[0], "media-ig-001");
  });

  it("returns AUTH when credentials are malformed", async () => {
    const { adapter } = makeAdapter();

    const result = await adapter.fetchMentionById({
      channelCredentials: { accessToken: "only-token" },
      providerMentionId: "media-ig-001",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "AUTH");
  });

  it("returns AUTH on a 401 API error", async () => {
    const client = makeMockApiClient();
    client.getMentionById = vi.fn(async () => {
      const e = new Error("Instagram API Error: 401 Unauthorized") as Error & { status?: number };
      e.status = 401;
      throw e;
    });
    const { adapter } = makeAdapter(client);

    const result = await adapter.fetchMentionById({
      channelCredentials: TEST_CREDENTIALS,
      providerMentionId: "media-ig-001",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "AUTH");
  });

  it("returns NOT_FOUND on a 404 API error", async () => {
    const client = makeMockApiClient();
    client.getMentionById = vi.fn(async () => {
      const e = new Error("Instagram API Error: 404 Not Found") as Error & { status?: number };
      e.status = 404;
      throw e;
    });
    const { adapter } = makeAdapter(client);

    const result = await adapter.fetchMentionById({
      channelCredentials: TEST_CREDENTIALS,
      providerMentionId: "missing-id",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "NOT_FOUND");
  });

  it("returns NETWORK on a generic failure", async () => {
    const client = makeMockApiClient();
    client.getMentionById = vi.fn(async () => {
      throw new Error("Connection timeout");
    });
    const { adapter } = makeAdapter(client);

    const result = await adapter.fetchMentionById({
      channelCredentials: TEST_CREDENTIALS,
      providerMentionId: "media-ig-001",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "NETWORK");
  });
});
