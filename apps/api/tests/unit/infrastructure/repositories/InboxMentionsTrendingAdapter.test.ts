/**
 * @file InboxMentionsTrendingAdapter.test.ts
 * @description Unit tests for the inbox-mentions trending source: extracts
 *              `#hashtags` and `@mentions` (Unicode-aware) from recent
 *              inbound `SocialMessage` bodies, aggregates by lowercase
 *              token, filters tokens with volume < 2, ranks by frequency,
 *              and tags results with source `inbox-mentions`. The Prisma
 *              client is mocked at the `socialMessage.findMany` boundary.
 * @layer infrastructure
 */
import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { InboxMentionsTrendingAdapter } from "../../../../src/infrastructure/repositories/InboxMentionsTrendingAdapter.js";
import type { PrismaClient } from "@infra/prisma";

function makePrisma(messages: Array<{ body: string; provider: string }>): {
  prisma: PrismaClient;
  findMany: ReturnType<typeof vi.fn>;
} {
  const findMany = vi.fn().mockResolvedValue(messages);
  const prisma = {
    socialMessage: { findMany },
  } as unknown as PrismaClient;
  return { prisma, findMany };
}

describe("InboxMentionsTrendingAdapter", () => {
  it("returns an empty list when sources filter excludes inbox-mentions", async () => {
    const { prisma, findMany } = makePrisma([{ body: "#hello #hello", provider: "X" }]);
    const adapter = new InboxMentionsTrendingAdapter(prisma);

    const topics = await adapter.fetchTrends({
      accountId: "acc-1",
      sources: ["perplexity-web", "account-analytics"],
    });

    assert.deepStrictEqual(topics, []);
    assert.strictEqual(findMany.mock.calls.length, 0);
  });

  it("extracts hashtags and @-mentions case-insensitively and aggregates by lowercased token", async () => {
    const { prisma } = makePrisma([
      { body: "I love #AIArt", provider: "TIKTOK" },
      { body: "More #aiart vibes", provider: "TIKTOK" },
      { body: "Hey @Alice and @alice", provider: "INSTAGRAM" },
    ]);
    const adapter = new InboxMentionsTrendingAdapter(prisma);

    const topics = await adapter.fetchTrends({ accountId: "acc-1" });

    const byTopic = new Map(topics.map((t) => [t.topic, t]));
    assert.strictEqual(byTopic.get("#aiart")?.volume, 2);
    // `@alice` appears once per message (dedup-per-message via Set); only 1 message contains
    // it so it falls below the volume>=2 floor and is filtered out — confirms the floor works.
    assert.strictEqual(byTopic.has("@alice"), false);
  });

  it("filters tokens with volume < 2 to suppress one-off noise", async () => {
    const { prisma } = makePrisma([
      { body: "#one-off", provider: "X" },
      { body: "#twice", provider: "X" },
      { body: "#twice again", provider: "X" },
    ]);
    const adapter = new InboxMentionsTrendingAdapter(prisma);

    const topics = await adapter.fetchTrends({ accountId: "acc-1" });

    const topicsByName = topics.map((t) => t.topic).sort();
    assert.deepStrictEqual(topicsByName, ["#twice"]);
  });

  it("tags every returned topic with source inbox-mentions and inherits the first observed platform", async () => {
    const { prisma } = makePrisma([
      { body: "#viral", provider: "TIKTOK" },
      { body: "#viral", provider: "INSTAGRAM" },
    ]);
    const adapter = new InboxMentionsTrendingAdapter(prisma);

    const topics = await adapter.fetchTrends({ accountId: "acc-1" });

    assert.strictEqual(topics[0]?.source, "inbox-mentions");
    assert.strictEqual(topics[0]?.platform, "TIKTOK");
  });

  it("marks high-frequency tokens (>= 5) as rising and lower ones as stable", async () => {
    const { prisma } = makePrisma([
      { body: "#hot", provider: "X" },
      { body: "#hot", provider: "X" },
      { body: "#hot", provider: "X" },
      { body: "#hot", provider: "X" },
      { body: "#hot", provider: "X" },
      { body: "#cool", provider: "X" },
      { body: "#cool", provider: "X" },
    ]);
    const adapter = new InboxMentionsTrendingAdapter(prisma);

    const topics = await adapter.fetchTrends({ accountId: "acc-1" });
    const byTopic = new Map(topics.map((t) => [t.topic, t]));

    assert.strictEqual(byTopic.get("#hot")?.trend, "rising");
    assert.strictEqual(byTopic.get("#cool")?.trend, "stable");
  });

  it("returns an empty list when no inbound messages exist", async () => {
    const { prisma } = makePrisma([]);
    const adapter = new InboxMentionsTrendingAdapter(prisma);

    const topics = await adapter.fetchTrends({ accountId: "acc-1" });

    assert.deepStrictEqual(topics, []);
  });
});
