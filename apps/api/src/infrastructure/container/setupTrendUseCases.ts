/**
 * @file setupTrendUseCases.ts
 * @description DI registrations for the trend-radar pipeline: per-source
 *              trending data adapters (Perplexity / account analytics / inbox
 *              mentions), the multi-source composite, scoring + fetching use
 *              cases, the persistence port, and the orchestrator + daily
 *              coordinator.
 * @layer infrastructure
 */

import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import { prisma } from "@infra/prisma";
import type { CachePort, QueuePortRegistry } from "@ports/core";
import { QUEUE_NAMES } from "@adapters/queue-bullmq";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type { AIServicePort } from "@core/domain/repositories/AIServicePort.js";
import { trendScoringSpec } from "../../ai/structuredSchemas.js";
import type { ChannelQueryForIngestion } from "@core/domain/repositories/ChannelQueryForIngestion.js";

import { PrismaScoreTrendContextAdapter } from "../repositories/PrismaScoreTrendContextAdapter.js";
import { PerplexityTrendingAdapter } from "../repositories/PerplexityTrendingAdapter.js";
import { AccountAnalyticsTrendingAdapter } from "../repositories/AccountAnalyticsTrendingAdapter.js";
import { InboxMentionsTrendingAdapter } from "../repositories/InboxMentionsTrendingAdapter.js";
import { MultiSourceTrendingDataAdapter } from "../repositories/MultiSourceTrendingDataAdapter.js";
import { PrismaTrendRadarResultAdapter } from "../repositories/PrismaTrendRadarResultAdapter.js";
import type { TrendRadarResultPort } from "@core/application/trends/TrendRadarResultPort.js";
import { PrismaTrendRadarQueryAdapter } from "../repositories/PrismaTrendRadarQueryAdapter.js";
import type { TrendRadarQueryRepository } from "@core/domain/repositories/TrendRadarQueryRepository.js";
import { GetTrendRadarQuery } from "@core/application/trends/GetTrendRadarQuery.js";

import {
  FetchTrendingTopicsUseCase,
  type TrendingDataPort,
} from "@core/application/trends/FetchTrendingTopicsUseCase.js";
import {
  ScoreTrendRelevanceUseCase,
  type ScoreTrendContextPort,
} from "@core/application/trends/ScoreTrendRelevanceUseCase.js";
import { DetectTrendsUseCase } from "@core/application/trends/DetectTrendsUseCase.js";
import { DispatchDetectTrendsUseCase } from "@core/application/trends/DispatchDetectTrendsUseCase.js";

/**
 * @method setupTrendUseCases
 * @description Registers trend-radar ports, adapters, and use cases.
 */
export function setupTrendUseCases(container: Container): void {
  container.registerInstance<ScoreTrendContextPort>(
    TOKENS.ScoreTrendContextPort,
    new PrismaScoreTrendContextAdapter(prisma)
  );

  container.register<TrendingDataPort>(
    TOKENS.TrendingDataPort,
    () => {
      const aiServicePort = container.resolve<AIServicePort>(TOKENS.AIServicePort);
      return new MultiSourceTrendingDataAdapter([
        new PerplexityTrendingAdapter(aiServicePort),
        new AccountAnalyticsTrendingAdapter(prisma),
        new InboxMentionsTrendingAdapter(prisma),
      ]);
    },
    true
  );

  container.registerInstance<TrendRadarResultPort>(
    TOKENS.TrendRadarResultPort,
    new PrismaTrendRadarResultAdapter(prisma)
  );

  container.register<FetchTrendingTopicsUseCase>(
    TOKENS.FetchTrendingTopicsUseCase,
    () =>
      new FetchTrendingTopicsUseCase(
        container.resolve<TrendingDataPort>(TOKENS.TrendingDataPort),
        container.resolve<CachePort>(TOKENS.CachePort)
      ),
    true
  );

  container.register<ScoreTrendRelevanceUseCase>(
    TOKENS.ScoreTrendRelevanceUseCase,
    () =>
      new ScoreTrendRelevanceUseCase(
        container.resolve<AIServicePort>(TOKENS.AIServicePort),
        trendScoringSpec,
        container.resolve<ScoreTrendContextPort>(TOKENS.ScoreTrendContextPort)
      ),
    true
  );

  container.register<DetectTrendsUseCase>(
    TOKENS.DetectTrendsUseCase,
    () =>
      new DetectTrendsUseCase(
        container.resolve<FetchTrendingTopicsUseCase>(TOKENS.FetchTrendingTopicsUseCase),
        container.resolve<ScoreTrendRelevanceUseCase>(TOKENS.ScoreTrendRelevanceUseCase),
        container.resolve<TrendRadarResultPort>(TOKENS.TrendRadarResultPort),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );

  container.register<DispatchDetectTrendsUseCase>(
    TOKENS.DispatchDetectTrendsUseCase,
    () =>
      new DispatchDetectTrendsUseCase(
        container.resolve<ChannelQueryForIngestion>(TOKENS.ChannelQueryForIngestion),
        container
          .resolve<QueuePortRegistry>(TOKENS.QueuePortRegistry)
          .forQueue(QUEUE_NAMES.TREND_RADAR),
        QUEUE_NAMES.TREND_RADAR,
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );

  container.registerInstance<TrendRadarQueryRepository>(
    TOKENS.TrendRadarQueryRepository,
    new PrismaTrendRadarQueryAdapter(prisma)
  );

  container.register<GetTrendRadarQuery>(
    TOKENS.GetTrendRadarQuery,
    () =>
      new GetTrendRadarQuery(
        container.resolve<TrendRadarQueryRepository>(TOKENS.TrendRadarQueryRepository)
      ),
    true
  );
}
