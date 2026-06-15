/**
 * @file setupAnalyticsUseCases.ts
 * @description Registers all analytics, ML, campaign, historical analytics, and UTM
 *              use cases in the DI container.
 *              Extracted from setupUseCases.ts for domain-based modularization.
 * @layer infrastructure
 */
import type { Redis } from "ioredis";
import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type { CachePort } from "@ports/core";
import type { CampaignRepository } from "@core/domain/repositories/CampaignRepository.js";
import type { CampaignQueryRepository } from "@core/domain/repositories/CampaignQueryRepository.js";
import type { AnalyticsReadRepositoryPort } from "@core/domain/repositories/AnalyticsReadRepository.js";
import type { ProjectQueryRepositoryPort } from "@core/domain/repositories/ProjectQueryRepository.js";
import type { ConversionRepositoryPort } from "@core/domain/repositories/ConversionRepository.js";
import type { TrackedLinkRepository } from "@core/domain/repositories/TrackedLinkRepository.js";
import {
  GetCrossPlatformAnalyticsUseCase,
  ComparePerformanceUseCase,
  CalculateROIUseCase,
} from "@core/analytics/index.js";
import { CrossPlatformAnalyticsAdapter } from "../adapters/CrossPlatformAnalyticsAdapter.js";
import { PerformanceComparatorAdapter } from "../adapters/PerformanceComparatorAdapter.js";
import { ROICalculatorAdapter } from "../adapters/ROICalculatorAdapter.js";
import { OptimizeContentUseCase, PredictOptimalTimingUseCase } from "@core/ml/index.js";
import {
  CreateCampaignUseCase,
  UpdateCampaignUseCase,
  ArchiveCampaignUseCase,
  TagPostWithCampaignUseCase,
  UntagPostFromCampaignUseCase,
  GetCampaignAnalyticsUseCase,
  ListCampaignsQuery,
  GetCampaignQuery,
} from "@core/campaigns/index.js";
import { GetHistoricalAnalyticsQuery } from "@core/analytics/GetHistoricalAnalyticsQuery.js";
import { GenerateUTMLinksUseCase } from "@core/utm/index.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type { AnalyticsWriteRepository } from "@core/domain/repositories/AnalyticsWriteRepository.js";
import type { ChannelQueryForIngestion } from "@core/domain/repositories/ChannelQueryForIngestion.js";
import { IngestChannelAnalyticsUseCase } from "@core/analytics/IngestChannelAnalyticsUseCase.js";
import { DispatchAnalyticsIngestionUseCase } from "@core/analytics/DispatchAnalyticsIngestionUseCase.js";
import { PrismaAnalyticsWriteRepository } from "../repositories/PrismaAnalyticsWriteRepository.js";
import { PrismaChannelQueryForIngestion } from "../repositories/PrismaChannelQueryForIngestion.js";
import { PrismaTopPerformersQuery } from "../repositories/PrismaTopPerformersQuery.js";
import {
  GetTopPerformersContextUseCase,
  type TopPerformersQueryPort,
} from "@core/ai/GetTopPerformersContextUseCase.js";
import type { PrismaClient } from "@infra/prisma";
import type { QueuePortRegistry } from "@ports/core";
import { QUEUE_NAMES } from "@adapters/queue-bullmq";

/**
 * Register all analytics, ML, campaign, historical analytics, and UTM use cases in the container
 */
export function setupAnalyticsUseCases(container: Container): void {
  // Register Analytics Port Adapters
  container.register<CrossPlatformAnalyticsAdapter>(
    TOKENS.CrossPlatformAnalyticsAdapter,
    () =>
      new CrossPlatformAnalyticsAdapter(
        container.resolve<CachePort>(TOKENS.CachePort),
        container.resolve<ProjectQueryRepositoryPort>(TOKENS.ProjectQueryRepository),
        container.resolve<AnalyticsReadRepositoryPort>(TOKENS.AnalyticsReadRepository)
      ),
    true
  );
  container.register<PerformanceComparatorAdapter>(
    TOKENS.PerformanceComparatorAdapter,
    () =>
      new PerformanceComparatorAdapter(
        container.resolve<CachePort>(TOKENS.CachePort),
        container.resolve<ProjectQueryRepositoryPort>(TOKENS.ProjectQueryRepository),
        container.resolve<AnalyticsReadRepositoryPort>(TOKENS.AnalyticsReadRepository)
      ),
    true
  );
  container.register<ROICalculatorAdapter>(
    TOKENS.ROICalculatorAdapter,
    () =>
      new ROICalculatorAdapter(
        container.resolve<CachePort>(TOKENS.CachePort),
        container.resolve<ProjectQueryRepositoryPort>(TOKENS.ProjectQueryRepository),
        container.resolve<AnalyticsReadRepositoryPort>(TOKENS.AnalyticsReadRepository),
        container.resolve<ConversionRepositoryPort>(TOKENS.ConversionRepository),
        container.resolve<Redis>(TOKENS.AnalyticsRedisConnection)
      ),
    true
  );

  // Register Analytics Use Cases
  container.register<GetCrossPlatformAnalyticsUseCase>(
    TOKENS.GetCrossPlatformAnalyticsUseCase,
    () =>
      new GetCrossPlatformAnalyticsUseCase(
        container.resolve<CrossPlatformAnalyticsAdapter>(TOKENS.CrossPlatformAnalyticsAdapter)
      ),
    true
  );
  container.register<ComparePerformanceUseCase>(
    TOKENS.ComparePerformanceUseCase,
    () =>
      new ComparePerformanceUseCase(
        container.resolve<PerformanceComparatorAdapter>(TOKENS.PerformanceComparatorAdapter)
      ),
    true
  );
  container.register<CalculateROIUseCase>(
    TOKENS.CalculateROIUseCase,
    () =>
      new CalculateROIUseCase(container.resolve<ROICalculatorAdapter>(TOKENS.ROICalculatorAdapter)),
    true
  );

  // Register ML Use Cases — AI-powered with heuristic fallback. Resolves
  // the AI port (not the concrete AIService) so application/ml depends on
  // the abstraction.
  container.register<OptimizeContentUseCase>(
    TOKENS.OptimizeContentUseCase,
    () =>
      new OptimizeContentUseCase(
        container.resolve<import("@core/domain/repositories/AIServicePort.js").AIServicePort>(
          TOKENS.AIServicePort
        )
      ),
    true
  );
  container.register<PredictOptimalTimingUseCase>(
    TOKENS.PredictOptimalTimingUseCase,
    () =>
      new PredictOptimalTimingUseCase(
        container.resolve<import("@core/domain/repositories/AIServicePort.js").AIServicePort>(
          TOKENS.AIServicePort
        ),
        container.resolve<
          import("@core/domain/repositories/AnalyticsReadRepository.js").AnalyticsReadRepositoryPort
        >(TOKENS.AnalyticsReadRepository)
      ),
    true
  );

  // Campaign Use Cases
  container.register<CreateCampaignUseCase>(
    TOKENS.CreateCampaignUseCase,
    () =>
      new CreateCampaignUseCase(
        container.resolve<CampaignRepository>(TOKENS.CampaignRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<UpdateCampaignUseCase>(
    TOKENS.UpdateCampaignUseCase,
    () =>
      new UpdateCampaignUseCase(
        container.resolve<CampaignRepository>(TOKENS.CampaignRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<ArchiveCampaignUseCase>(
    TOKENS.ArchiveCampaignUseCase,
    () =>
      new ArchiveCampaignUseCase(
        container.resolve<CampaignRepository>(TOKENS.CampaignRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<TagPostWithCampaignUseCase>(
    TOKENS.TagPostWithCampaignUseCase,
    () =>
      new TagPostWithCampaignUseCase(
        container.resolve<CampaignRepository>(TOKENS.CampaignRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<UntagPostFromCampaignUseCase>(
    TOKENS.UntagPostFromCampaignUseCase,
    () =>
      new UntagPostFromCampaignUseCase(
        container.resolve<CampaignRepository>(TOKENS.CampaignRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<GetCampaignAnalyticsUseCase>(
    TOKENS.GetCampaignAnalyticsUseCase,
    () =>
      new GetCampaignAnalyticsUseCase(
        container.resolve<CampaignQueryRepository>(TOKENS.CampaignQueryRepository),
        container.resolve<AnalyticsReadRepositoryPort>(TOKENS.AnalyticsReadRepository)
      ),
    true
  );
  container.register<ListCampaignsQuery>(
    TOKENS.ListCampaignsQuery,
    () =>
      new ListCampaignsQuery(
        container.resolve<CampaignQueryRepository>(TOKENS.CampaignQueryRepository)
      ),
    true
  );
  container.register<GetCampaignQuery>(
    TOKENS.GetCampaignQuery,
    () =>
      new GetCampaignQuery(
        container.resolve<CampaignQueryRepository>(TOKENS.CampaignQueryRepository)
      ),
    true
  );

  // Register Historical Analytics Query
  container.register<GetHistoricalAnalyticsQuery>(
    TOKENS.GetHistoricalAnalyticsQuery,
    () =>
      new GetHistoricalAnalyticsQuery(
        container.resolve<AnalyticsReadRepositoryPort>(TOKENS.AnalyticsReadRepository)
      ),
    true
  );

  // Register UTM Use Cases
  container.register<GenerateUTMLinksUseCase>(
    TOKENS.GenerateUTMLinksUseCase,
    () =>
      new GenerateUTMLinksUseCase(
        container.resolve<TrackedLinkRepository>(TOKENS.TrackedLinkRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );

  // Analytics Ingestion
  container.register<AnalyticsWriteRepository>(
    TOKENS.AnalyticsWriteRepository,
    () => new PrismaAnalyticsWriteRepository(container.resolve<PrismaClient>(TOKENS.PrismaClient)),
    true
  );
  container.register<ChannelQueryForIngestion>(
    TOKENS.ChannelQueryForIngestion,
    () => new PrismaChannelQueryForIngestion(container.resolve<PrismaClient>(TOKENS.PrismaClient)),
    true
  );
  container.register<IngestChannelAnalyticsUseCase>(
    TOKENS.IngestChannelAnalyticsUseCase,
    () => {
      const registry = container.resolve<{
        getAdapter(id: string): import("@ports/core").ProviderAdapter | undefined;
      }>(TOKENS.ProviderRegistry);
      return new IngestChannelAnalyticsUseCase(
        container.resolve(TOKENS.ChannelRepository),
        container.resolve<AnalyticsWriteRepository>(TOKENS.AnalyticsWriteRepository),
        (provider: string) => registry.getAdapter(provider),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      );
    },
    true
  );
  container.register<DispatchAnalyticsIngestionUseCase>(
    TOKENS.DispatchAnalyticsIngestionUseCase,
    () =>
      new DispatchAnalyticsIngestionUseCase(
        container.resolve<ChannelQueryForIngestion>(TOKENS.ChannelQueryForIngestion),
        container
          .resolve<QueuePortRegistry>(TOKENS.QueuePortRegistry)
          .forQueue(QUEUE_NAMES.ANALYTICS_AGGREGATION),
        QUEUE_NAMES.ANALYTICS_AGGREGATION,
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );

  // AI Differentiation — Analytics→AI Bridge
  container.register<TopPerformersQueryPort>(
    TOKENS.TopPerformersQueryPort,
    () => new PrismaTopPerformersQuery(container.resolve<PrismaClient>(TOKENS.PrismaClient)),
    true
  );
  container.register<GetTopPerformersContextUseCase>(
    TOKENS.GetTopPerformersContextUseCase,
    () =>
      new GetTopPerformersContextUseCase(
        container.resolve<TopPerformersQueryPort>(TOKENS.TopPerformersQueryPort),
        container.resolve<CachePort>(TOKENS.CachePort)
      ),
    true
  );
}
