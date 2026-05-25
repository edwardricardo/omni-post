/**
 * @file InboxMentionsTrendingAdapter.ts
 * @description Trending-topic source derived from inbound `SocialMessage`
 *              bodies. Extracts `#hashtags` and `@mentions` from the last 30
 *              days of conversation text and ranks them by frequency. Surfaces
 *              what the audience is talking about in the account's own inbox.
 * @layer infrastructure
 */

import type { PrismaClient } from "@infra/prisma";
import type {
  TrendingDataPort,
  TrendingTopic,
  FetchTrendingInput,
} from "@core/application/trends/FetchTrendingTopicsUseCase.js";

const LOOKBACK_DAYS = 30;
const TOPIC_LIMIT = 20;
const HASHTAG_PATTERN = /#([\p{L}\p{N}_]{2,40})/gu;
const MENTION_PATTERN = /@([\p{L}\p{N}_.]{2,40})/gu;

export class InboxMentionsTrendingAdapter implements TrendingDataPort {
  constructor(private readonly prisma: PrismaClient) {}

  async fetchTrends(input: FetchTrendingInput): Promise<TrendingTopic[]> {
    if (input.sources && !input.sources.includes("inbox-mentions")) {
      return [];
    }

    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const fetchedAt = new Date();

    const messages = await this.prisma.socialMessage.findMany({
      where: {
        accountId: input.accountId,
        providerCreatedAt: { gte: since },
      },
      select: { body: true, provider: true },
      take: 1000,
    });

    const stats = new Map<string, { volume: number; platform: string | null }>();
    for (const m of messages) {
      const tokens = this.extractTokens(m.body);
      for (const token of tokens) {
        const prior = stats.get(token) ?? { volume: 0, platform: m.provider };
        stats.set(token, {
          volume: prior.volume + 1,
          platform: prior.platform ?? m.provider,
        });
      }
    }

    const ranked = Array.from(stats.entries())
      .map(([token, s]) => ({ token, ...s }))
      .filter((r) => r.volume >= 2)
      .sort((a, b) => b.volume - a.volume)
      .slice(0, TOPIC_LIMIT);

    return ranked.map((r) => ({
      topic: r.token,
      source: "inbox-mentions" as const,
      sourceUrl: null,
      platform: r.platform,
      volume: r.volume,
      category: null,
      trend: r.volume >= 5 ? "rising" : "stable",
      fetchedAt,
    }));
  }

  private extractTokens(body: string): string[] {
    const tokens = new Set<string>();
    for (const match of body.matchAll(HASHTAG_PATTERN)) {
      const tag = match[1];
      if (tag) tokens.add(`#${tag.toLowerCase()}`);
    }
    for (const match of body.matchAll(MENTION_PATTERN)) {
      const handle = match[1];
      if (handle) tokens.add(`@${handle.toLowerCase()}`);
    }
    return Array.from(tokens);
  }
}
