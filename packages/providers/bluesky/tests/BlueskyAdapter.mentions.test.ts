/**
 * @file BlueskyAdapter.mentions.test.ts
 * @description Unit tests for BlueskyAdapter searchMentions (brand-listening).
 *   The adapter takes credentials per-call; the suite injects a fake
 *   `BlueskyClient` factory (login + searchPosts) so tests do not hit the network.
 * @layer infrastructure
 */

import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { ok, err, type Result } from "@shared/types";
import { BlueskyAdapter, type BlueskyClientFactory } from "../src/BlueskyAdapter.js";
import type {
  BlueskyClient,
  BlueskyCredentials,
  BlueskySearchResult,
  BlueskySession,
} from "../src/BlueskyClient.js";

interface FakeClient {
  login: () => Promise<Result<BlueskySession, "AUTH">>;
  searchPosts: (
    query: string,
    limit?: number,
    since?: string,
    cursor?: string
  ) => Promise<Result<BlueskySearchResult, "NETWORK" | "RATE_LIMIT">>;
}

function makeFakeClient(overrides: Partial<FakeClient> = {}): FakeClient {
  return {
    login: vi.fn(async () =>
      ok({
        accessJwt: "jwt",
        refreshJwt: "ref",
        did: "did:plc:test",
        handle: "test.bsky.social",
      })
    ),
    searchPosts: vi.fn(async () => ok({ posts: [] })),
    ...overrides,
  };
}

function makeAdapter(client: FakeClient = makeFakeClient()) {
  const factory: BlueskyClientFactory = () => client as unknown as BlueskyClient;
  return { adapter: new BlueskyAdapter({ clientFactory: factory }), client };
}

const VALID_CREDS: BlueskyCredentials = {
  identifier: "test.bsky.social",
  appPassword: "xxxx-xxxx-xxxx-xxxx",
};

describe("BlueskyAdapter - searchMentions", { concurrent: false }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes posts to ProviderMention with author + url + cursor", async () => {
    const client = makeFakeClient({
      searchPosts: vi.fn(async () =>
        ok({
          posts: [
            {
              uri: "at://did:plc:abc/app.bsky.feed.post/xyz",
              cid: "bafy123",
              authorDid: "did:plc:abc",
              authorHandle: "fan.bsky.social",
              authorDisplayName: "Happy Fan",
              authorAvatar: "https://cdn.bsky.app/avatar.jpg",
              text: "Acme is great",
              lang: "en",
              createdAt: "2026-05-10T10:00:00Z",
            },
          ],
          cursor: "next-cursor",
        })
      ),
    });
    const { adapter } = makeAdapter(client);

    const result = await adapter.searchMentions({
      channelCredentials: VALID_CREDS,
      terms: ["Acme"],
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.mentions.length, 1);

    const m = result.value.mentions[0];
    assert.ok(m);
    assert.strictEqual(m.providerMentionId, "at://did:plc:abc/app.bsky.feed.post/xyz");
    assert.strictEqual(m.body, "Acme is great");
    assert.strictEqual(m.authorName, "Happy Fan");
    assert.strictEqual(m.authorHandle, "fan.bsky.social");
    assert.strictEqual(m.authorProviderId, "did:plc:abc");
    assert.strictEqual(m.authorAvatarUrl, "https://cdn.bsky.app/avatar.jpg");
    assert.strictEqual(m.lang, "en");
    assert.strictEqual(m.url, "https://bsky.app/profile/fan.bsky.social/post/xyz");
    assert.ok(m.createdAt instanceof Date);
    assert.strictEqual(result.value.nextCursor, "next-cursor");
  });

  it("falls back to handle as author name when no displayName", async () => {
    const client = makeFakeClient({
      searchPosts: vi.fn(async () =>
        ok({
          posts: [
            {
              uri: "at://did:plc:abc/app.bsky.feed.post/xyz",
              cid: "bafy123",
              authorDid: "did:plc:abc",
              authorHandle: "fan.bsky.social",
              text: "Acme mention",
              createdAt: "2026-05-10T10:00:00Z",
            },
          ],
        })
      ),
    });
    const { adapter } = makeAdapter(client);

    const result = await adapter.searchMentions({
      channelCredentials: VALID_CREDS,
      terms: ["Acme"],
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.mentions[0]?.authorName, "fan.bsky.social");
  });

  it("returns empty when no terms are given (no login/search)", async () => {
    const { adapter, client } = makeAdapter();

    const result = await adapter.searchMentions({
      channelCredentials: VALID_CREDS,
      terms: [],
    });

    assert.ok(result.ok);
    assert.strictEqual(result.value.mentions.length, 0);
    assert.strictEqual((client.login as ReturnType<typeof vi.fn>).mock.calls.length, 0);
  });

  it("builds an OR query from terms and passes pagination through", async () => {
    const { adapter, client } = makeAdapter();
    const since = new Date("2026-05-01T00:00:00Z");

    await adapter.searchMentions({
      channelCredentials: VALID_CREDS,
      terms: ["Acme", "Acme Corp"],
      limit: 50,
      since,
      cursor: "page-2",
    });

    const call = (client.searchPosts as ReturnType<typeof vi.fn>).mock.calls[0];
    assert.ok(call);
    assert.strictEqual(call[0], 'Acme OR "Acme Corp"');
    assert.strictEqual(call[1], 50);
    assert.strictEqual(call[2], since.toISOString());
    assert.strictEqual(call[3], "page-2");
  });

  it("returns AUTH when credentials are malformed", async () => {
    const { adapter } = makeAdapter();

    const result = await adapter.searchMentions({
      channelCredentials: { identifier: "only-handle" },
      terms: ["Acme"],
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "AUTH");
  });

  it("returns AUTH when login fails", async () => {
    const client = makeFakeClient({ login: vi.fn(async () => err("AUTH")) });
    const { adapter } = makeAdapter(client);

    const result = await adapter.searchMentions({
      channelCredentials: VALID_CREDS,
      terms: ["Acme"],
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "AUTH");
  });

  it("propagates RATE_LIMIT from searchPosts", async () => {
    const client = makeFakeClient({ searchPosts: vi.fn(async () => err("RATE_LIMIT")) });
    const { adapter } = makeAdapter(client);

    const result = await adapter.searchMentions({
      channelCredentials: VALID_CREDS,
      terms: ["Acme"],
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "RATE_LIMIT");
  });

  it("propagates NETWORK from searchPosts", async () => {
    const client = makeFakeClient({ searchPosts: vi.fn(async () => err("NETWORK")) });
    const { adapter } = makeAdapter(client);

    const result = await adapter.searchMentions({
      channelCredentials: VALID_CREDS,
      terms: ["Acme"],
    });

    assert.ok(!result.ok);
    assert.strictEqual(result.error, "NETWORK");
  });
});
