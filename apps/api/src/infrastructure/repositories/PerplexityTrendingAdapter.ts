/**
 * @file PerplexityTrendingAdapter.ts
 * @description Trending-topic source backed by Perplexity Sonar's
 *              real-time web access. Calls
 *              `AIServicePort.generateStructured` with
 *              `trendDiscoverySpec` and embeds requested source URLs
 *              inside the structured output.
 * @layer infrastructure
 */

import type { AIServicePort } from "../../domain/repositories/AIServicePort.js";
import type { AIMessage } from "../../ai/types.js";
import { trendDiscoverySpec } from "../../ai/structuredSchemas.js";
import type {
  TrendingDataPort,
  TrendingTopic,
  FetchTrendingInput,
} from "@core/application/trends/FetchTrendingTopicsUseCase.js";

export class PerplexityTrendingAdapter implements TrendingDataPort {
  constructor(private readonly aiServicePort: AIServicePort) {}

  async fetchTrends(input: FetchTrendingInput): Promise<TrendingTopic[]> {
    if (input.sources && !input.sources.includes("perplexity-web")) {
      return [];
    }

    const messages: AIMessage[] = [
      {
        role: "system",
        content: [
          "You discover trending topics from current real-time web search.",
          "Return up to 20 distinct topics with the platform where each is most active",
          "and a citation URL when you can identify a primary source. Use `null` for",
          "fields you cannot determine from the search. Do not invent volume numbers.",
        ].join(" "),
      },
      {
        role: "user",
        content: `Account id: ${input.accountId}. List currently trending topics relevant to social media marketing this account would benefit from acting on right now.`,
      },
    ];

    const result = await this.aiServicePort.generateStructured(
      messages,
      trendDiscoverySpec,
      { temperature: 0.4 },
      input.accountId
    );

    if (!result.ok) return [];

    const fetchedAt = new Date();
    return result.value.topics.map((t) => ({
      topic: t.topic,
      source: "perplexity-web" as const,
      sourceUrl: t.sourceUrl,
      platform: t.platform,
      volume: t.volume,
      category: null,
      trend: t.trend,
      fetchedAt,
    }));
  }
}
