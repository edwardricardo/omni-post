/**
 * @file DetectTrendsUseCase.ts
 * @description Orchestrates the trend-radar pipeline for one account: fetch
 *              multi-source trending topics, score them for brand relevance,
 *              and persist the high-scoring trends via the result port
 *              (idempotent by day-bucketed `(accountId, topic, day)` key).
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import { FetchTrendingTopicsUseCase, type TrendSource } from "./FetchTrendingTopicsUseCase.js";
import { ScoreTrendRelevanceUseCase, type ScoredTrend } from "./ScoreTrendRelevanceUseCase.js";
import {
  type TrendRadarResultPort,
  type TrendRadarRow,
  type TrendRadarProvider,
  TREND_RADAR_PROVIDERS,
  TREND_SOURCE_TO_ENUM,
} from "./TrendRadarResultPort.js";

export interface DetectTrendsInput {
  accountId: string;
  sources?: TrendSource[];
  limit?: number;
}

export interface DetectTrendsOutput {
  fetched: number;
  scored: number;
  persisted: number;
  updated: number;
}

function normaliseProvider(value: string | null): TrendRadarProvider | null {
  if (!value) return null;
  const upper = value.trim().toUpperCase() as TrendRadarProvider;
  return TREND_RADAR_PROVIDERS.has(upper) ? upper : null;
}

function mapScoredToRow(scored: ScoredTrend): TrendRadarRow | null {
  const platform = normaliseProvider(scored.platform) ?? normaliseProvider(scored.bestPlatform);
  if (!platform) return null;
  return {
    topic: scored.topic,
    platform,
    source: TREND_SOURCE_TO_ENUM[scored.source],
    sourceUrl: scored.sourceUrl,
    relevanceScore: scored.relevanceScore,
    postIdea: scored.postIdea,
    bestPlatform: normaliseProvider(scored.bestPlatform),
    urgency: scored.urgency,
    volume: scored.volume,
  };
}

export class DetectTrendsUseCase implements UseCase<
  DetectTrendsInput,
  DetectTrendsOutput,
  UseCaseError
> {
  constructor(
    private readonly fetchUseCase: FetchTrendingTopicsUseCase,
    private readonly scoreUseCase: ScoreTrendRelevanceUseCase,
    private readonly resultPort: TrendRadarResultPort,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  async execute(input: DetectTrendsInput): Promise<Result<DetectTrendsOutput, UseCaseError>> {
    const doWork = async (): Promise<Result<DetectTrendsOutput, UseCaseError>> => {
      const fetchResult = await this.fetchUseCase.execute({
        accountId: input.accountId,
        ...(input.sources !== undefined && { sources: input.sources }),
      });
      if (!fetchResult.ok) return fetchResult;
      const topics = fetchResult.value.topics;

      if (topics.length === 0) {
        return ok({ fetched: 0, scored: 0, persisted: 0, updated: 0 });
      }

      const scoreResult = await this.scoreUseCase.execute({
        accountId: input.accountId,
        topics,
        ...(input.limit !== undefined && { limit: input.limit }),
      });
      if (!scoreResult.ok) return scoreResult;
      const scored = scoreResult.value.scored;

      if (scored.length === 0) {
        return ok({ fetched: topics.length, scored: 0, persisted: 0, updated: 0 });
      }

      const rows: TrendRadarRow[] = [];
      for (const s of scored) {
        const row = mapScoredToRow(s);
        if (row) rows.push(row);
      }

      const fetchedAt = new Date();
      const persistResult = await this.resultPort.upsert({
        accountId: input.accountId,
        fetchedAt,
        trends: rows,
      });

      return ok({
        fetched: topics.length,
        scored: scored.length,
        persisted: persistResult.persisted,
        updated: persistResult.updated,
      });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<DetectTrendsOutput, UseCaseError> = ok({
          fetched: 0,
          scored: 0,
          persisted: 0,
          updated: 0,
        });
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to detect trends",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
