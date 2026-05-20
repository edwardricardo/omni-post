/**
 * @file FetchTrendingTopicsUseCase.ts
 * @description Fetches trending topics from one or more provenance-tagged data
 *              sources (web search, own analytics, inbox mentions). Caches the
 *              merged result for 30 minutes and dedupes by topic name. Each
 *              returned topic carries its source so downstream consumers can
 *              weigh by provenance.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import type { CachePort } from "@ports/core";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";

/**
 * Provenance of a trending-topic signal. Each adapter implementation tags its
 * output with its own source.
 *
 * - `perplexity-web`: real-time web search (Perplexity Sonar — premium tier).
 * - `account-analytics`: engagement spikes inferred from the account's own
 *   `AnalyticsDailySummary` rows crossed with the account's posted hashtags.
 * - `inbox-mentions`: hashtags and @-mentions extracted from inbound
 *   `SocialMessage` bodies.
 */
export type TrendSource = "perplexity-web" | "account-analytics" | "inbox-mentions";

export interface TrendingTopic {
  topic: string;
  source: TrendSource;
  sourceUrl: string | null;
  platform: string | null;
  volume: number | null;
  category: string | null;
  trend: "rising" | "stable" | "declining" | null;
  fetchedAt: Date;
}

export interface FetchTrendingInput {
  accountId: string;
  /**
   * Optional filter of sources to query. When omitted, the port queries every
   * source it has access to. Plan-tier gating (e.g. excluding `perplexity-web`
   * for non-plus accounts) is the caller's responsibility, not the port's.
   */
  sources?: TrendSource[];
}

export interface FetchTrendingOutput {
  topics: TrendingTopic[];
  cachedUntil: Date;
}

/**
 * Multi-source trending data port. A single implementation may compose several
 * per-source adapters and aggregate their results; consumers see only the
 * unified, provenance-tagged list.
 */
export interface TrendingDataPort {
  fetchTrends(input: FetchTrendingInput): Promise<TrendingTopic[]>;
}

const CACHE_TTL_SECONDS = 30 * 60;
const CACHE_TTL_MS = CACHE_TTL_SECONDS * 1000;

export class FetchTrendingTopicsUseCase implements UseCase<
  FetchTrendingInput,
  FetchTrendingOutput,
  UseCaseError
> {
  constructor(
    private readonly port: TrendingDataPort,
    private readonly cache: CachePort
  ) {}

  async execute(input: FetchTrendingInput): Promise<Result<FetchTrendingOutput, UseCaseError>> {
    try {
      const sourcesKey = input.sources?.length ? input.sources.slice().sort().join(",") : "all";
      const cacheKey = `trends:${input.accountId}:${sourcesKey}`;
      const result = await this.cache.getOrSet<FetchTrendingOutput>(
        cacheKey,
        () => this.fetchTopics(input),
        { ttlSeconds: CACHE_TTL_SECONDS }
      );
      return ok(result);
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to fetch trending topics",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }

  private async fetchTopics(input: FetchTrendingInput): Promise<FetchTrendingOutput> {
    const raw = await this.port.fetchTrends(input);
    const seen = new Set<string>();
    const deduped: TrendingTopic[] = [];
    for (const t of raw) {
      const key = t.topic.toLowerCase().trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      deduped.push(t);
    }
    return { topics: deduped, cachedUntil: new Date(Date.now() + CACHE_TTL_MS) };
  }
}
