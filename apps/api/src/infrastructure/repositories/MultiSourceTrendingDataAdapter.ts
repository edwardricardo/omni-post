/**
 * @file MultiSourceTrendingDataAdapter.ts
 * @description Composite `TrendingDataPort` that fans out to every configured
 *              per-source adapter (perplexity-web / account-analytics /
 *              inbox-mentions) in parallel, swallows individual adapter
 *              failures (`Promise.allSettled`), and returns the concatenated
 *              provenance-tagged result. Order is non-deterministic and
 *              irrelevant — the downstream use case dedupes by topic.
 * @layer infrastructure
 */

import { createLogger } from "../../lib/logger.js";
import type {
  TrendingDataPort,
  TrendingTopic,
  FetchTrendingInput,
} from "@core/application/trends/FetchTrendingTopicsUseCase.js";

const logger = createLogger("multi-source-trending");

export class MultiSourceTrendingDataAdapter implements TrendingDataPort {
  constructor(private readonly adapters: readonly TrendingDataPort[]) {}

  async fetchTrends(input: FetchTrendingInput): Promise<TrendingTopic[]> {
    const settled = await Promise.allSettled(
      this.adapters.map((adapter) => adapter.fetchTrends(input))
    );

    const topics: TrendingTopic[] = [];
    for (const [i, outcome] of settled.entries()) {
      if (outcome.status === "fulfilled") {
        topics.push(...outcome.value);
      } else {
        logger.warn(
          {
            adapterIndex: i,
            err: outcome.reason instanceof Error ? outcome.reason.message : outcome.reason,
          },
          "Trending data adapter failed; continuing with remaining sources"
        );
      }
    }
    return topics;
  }
}
