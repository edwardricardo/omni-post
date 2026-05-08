/**
 * @file FetchTrendingTopicsUseCase.ts
 * @description Fetches trending topics from connected social platforms.
 *              Uses TikTok hashtagDiscovery as primary source (Option A).
 *              Caches results for 30 minutes.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import type { CachePort } from "@ports/core";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";

export interface TrendingTopic {
  topic: string;
  platform: string;
  volume: number | null;
  category: string | null;
  trend: "rising" | "stable" | "declining";
  fetchedAt: Date;
}

export interface FetchTrendingInput {
  accountId: string;
  platforms?: string[];
}

export interface FetchTrendingOutput {
  topics: TrendingTopic[];
  cachedUntil: Date;
}

export interface TrendingDataPort {
  fetchFromPlatform(platform: string, accountId: string): Promise<TrendingTopic[]>;
  getConnectedPlatformsWithTrending(accountId: string): Promise<string[]>;
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
      const cacheKey = `trends:${input.accountId}`;
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
    const platforms =
      input.platforms ?? (await this.port.getConnectedPlatformsWithTrending(input.accountId));
    if (platforms.length === 0) {
      return { topics: [], cachedUntil: new Date(Date.now() + CACHE_TTL_MS) };
    }

    const allTopics: TrendingTopic[] = [];
    for (const platform of platforms) {
      try {
        const topics = await this.port.fetchFromPlatform(platform, input.accountId);
        allTopics.push(...topics);
      } catch {
        // Skip failing platforms — don't block the whole fetch
      }
    }

    const seen = new Set<string>();
    const deduped = allTopics.filter((t) => {
      const key = t.topic.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return { topics: deduped, cachedUntil: new Date(Date.now() + CACHE_TTL_MS) };
  }
}
