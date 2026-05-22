/**
 * @file XAdapter.mentions.test.ts
 * @description Unit tests for X/Twitter searchMentions (brand-listening). The
 *   adapter is constructed with an injected fake apiClientFactory and credentials
 *   are passed through `channelCredentials`. Tier 0.
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

describe("XAdapter - searchMentions", { concurrent: false }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes search results to ProviderMention with author + url", async () => {
    const { adapter, client } = makeAdapter();
    client.searchMentions = vi.fn(async () => ({
      data: [
        {
          id: "tweet-001",
          text: "Loving Acme lately",
          author_id: "user-123",
          author_name: "Jane Doe",
          author_username: "janedoe",
          author_avatar_url: "https://x.com/avatar.jpg",
          created_at: "2026-05-10T10:00:00Z",
          lang: "en",
        },
      ],
      meta: { result_count: 1, next_token: "page-2" },
    }));

    const result = await adapter.searchMentions({
      channelCredentials: TEST_CREDENTIALS,
      terms: ["Acme"],
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.mentions.length, 1);

    const m = result.value.mentions[0];
    assert.ok(m);
    assert.strictEqual(m.providerMentionId, "tweet-001");
    assert.strictEqual(m.body, "Loving Acme lately");
    assert.strictEqual(m.authorName, "Jane Doe");
    assert.strictEqual(m.authorHandle, "janedoe");
    assert.strictEqual(m.authorProviderId, "user-123");
    assert.strictEqual(m.authorAvatarUrl, "https://x.com/avatar.jpg");
    assert.strictEqual(m.lang, "en");
    assert.strictEqual(m.url, "https://x.com/i/web/status/tweet-001");
    assert.ok(m.createdAt instanceof Date);
    assert.strictEqual(result.value.nextCursor, "page-2");
  });

  it("returns empty when no terms are given (no API call)", async () => {
    const { adapter, client } = makeAdapter();

    const result = await adapter.searchMentions({
      channelCredentials: TEST_CREDENTIALS,
      terms: [],
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.mentions.length, 0);
    assert.strictEqual(client.searchMentions.mock.calls.length, 0);
  });

  it("passes terms, limit, since and cursor through to the client", async () => {
    const { adapter, client } = makeAdapter();
    const since = new Date("2026-05-01T00:00:00Z");

    await adapter.searchMentions({
      channelCredentials: TEST_CREDENTIALS,
      terms: ["Acme", "Rival"],
      limit: 75,
      since,
      cursor: "page-token",
    });

    const call = client.searchMentions.mock.calls[0];
    assert.ok(call);
    assert.deepStrictEqual(call[0], ["Acme", "Rival"]);
    assert.strictEqual(call[1], 75);
    assert.strictEqual(call[2], since.toISOString());
    assert.strictEqual(call[3], "page-token");
  });

  it("returns RATE_LIMIT error on 429", async () => {
    const { adapter, client } = makeAdapter();
    client.searchMentions = vi.fn(async () => {
      throw new Error("Twitter API error: 429 Too Many Requests");
    });

    const result = await adapter.searchMentions({
      channelCredentials: TEST_CREDENTIALS,
      terms: ["Acme"],
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "RATE_LIMIT");
  });

  it("returns AUTH error on 401/403", async () => {
    const { adapter, client } = makeAdapter();
    client.searchMentions = vi.fn(async () => {
      throw new Error("Twitter API error: 403 Forbidden");
    });

    const result = await adapter.searchMentions({
      channelCredentials: TEST_CREDENTIALS,
      terms: ["Acme"],
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "AUTH");
  });

  it("returns NETWORK error on general failure", async () => {
    const { adapter, client } = makeAdapter();
    client.searchMentions = vi.fn(async () => {
      throw new Error("Connection timeout");
    });

    const result = await adapter.searchMentions({
      channelCredentials: TEST_CREDENTIALS,
      terms: ["Acme"],
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "NETWORK");
  });
});
