/**
 * @file FacebookAdapter.mentions.test.ts
 * @description Unit tests for Facebook fetchMentionById (brand-listening webhook
 *   fetch-before-process). The adapter takes credentials per-call; the suite
 *   injects a fake `FacebookApiClient` factory so tests do not hit the network.
 *   All tests are Tier 0.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { AppError } from "@shared/types";
import { FacebookAdapter, type FacebookApiClientFactory } from "../src/FacebookAdapter.js";
import type { FacebookApiClient, FacebookCredentials } from "../src/apiClient.js";

function makeMockApiClient() {
  return {
    getMentionById: vi.fn(async () => ({
      id: "post-fb-001",
      message: "Shoutout to Acme",
      from: { id: "user-001", name: "Alice" },
      created_time: "2026-05-10T10:00:00+0000",
      permalink_url: "https://facebook.com/post-fb-001",
    })),
  };
}

type MockApiClient = ReturnType<typeof makeMockApiClient>;

function makeAdapter(client: MockApiClient = makeMockApiClient()) {
  const factory: FacebookApiClientFactory = () => client as unknown as FacebookApiClient;
  return { adapter: new FacebookAdapter({ apiClientFactory: factory }), client };
}

const TEST_CREDENTIALS: FacebookCredentials = {
  accessToken: "test-token",
  pageId: "page-001",
  appId: "app-001",
  appSecret: "secret-001",
};

describe("FacebookAdapter - fetchMentionById", { concurrent: false }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes a mention object to ProviderMention", async () => {
    const { adapter, client } = makeAdapter();

    const result = await adapter.fetchMentionById({
      channelCredentials: TEST_CREDENTIALS,
      providerMentionId: "post-fb-001",
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.providerMentionId, "post-fb-001");
    assert.strictEqual(result.value.body, "Shoutout to Acme");
    assert.strictEqual(result.value.authorName, "Alice");
    assert.strictEqual(result.value.authorProviderId, "user-001");
    assert.strictEqual(result.value.url, "https://facebook.com/post-fb-001");
    assert.ok(result.value.createdAt instanceof Date);
    assert.strictEqual(client.getMentionById.mock.calls[0]?.[0], "post-fb-001");
  });

  it("falls back to story text when message is absent", async () => {
    const client = makeMockApiClient();
    client.getMentionById = vi.fn(async () => ({
      id: "post-fb-002",
      story: "Acme was tagged in a photo",
      from: { id: "user-002", name: "Bob" },
      created_time: "2026-05-10T11:00:00+0000",
      permalink_url: "https://facebook.com/post-fb-002",
    }));
    const { adapter } = makeAdapter(client);

    const result = await adapter.fetchMentionById({
      channelCredentials: TEST_CREDENTIALS,
      providerMentionId: "post-fb-002",
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.body, "Acme was tagged in a photo");
  });

  it("returns AUTH when credentials are malformed", async () => {
    const { adapter } = makeAdapter();

    const result = await adapter.fetchMentionById({
      channelCredentials: { accessToken: "only-token" },
      providerMentionId: "post-fb-001",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "AUTH");
  });

  it("returns AUTH on an unauthorized API error", async () => {
    const client = makeMockApiClient();
    client.getMentionById = vi.fn(async () => {
      throw AppError.unauthorized("Facebook Auth Error (Code: 190)");
    });
    const { adapter } = makeAdapter(client);

    const result = await adapter.fetchMentionById({
      channelCredentials: TEST_CREDENTIALS,
      providerMentionId: "post-fb-001",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "AUTH");
  });

  it("returns NOT_FOUND on a bad-request/invalid-object error", async () => {
    const client = makeMockApiClient();
    client.getMentionById = vi.fn(async () => {
      throw AppError.badRequest("Facebook Invalid Parameter Error (Code: 100)");
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
      providerMentionId: "post-fb-001",
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "NETWORK");
  });
});
