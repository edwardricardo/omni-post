/**
 * @file setupAnalyticsUseCases.ts
 * @description Registers all analytics, ML, campaign, historical analytics, and UTM
 *              use cases in the DI container.
 *              Extracted from setupUseCases.ts for domain-based modularization.
 * @layer infrastructure
 */
import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type { CampaignRepository } from "../../domain/repositories/CampaignRepository.js";
import type { CampaignQueryRepository } from "../../domain/repositories/CampaignQueryRepository.js";
import type { AnalyticsReadRepositoryPort } from "../../domain/repositories/AnalyticsReadRepository.js";
import type { TrackedLinkRepository } from "../../domain/repositories/TrackedLinkRepository.js";
import {
  GetCrossPlatformAnalyticsUseCase,
  ComparePerformanceUseCase,
  CalculateROIUseCase,
} from "../../application/analytics/index.js";
import { CrossPlatformAnalyticsAdapter } from "../adapters/CrossPlatformAnalyticsAdapter.js";
import { PerformanceComparatorAdapter } from "../adapters/PerformanceComparatorAdapter.js";
import { ROICalculatorAdapter } from "../adapters/ROICalculatorAdapter.js";
import { OptimizeContentUseCase, PredictOptimalTimingUseCase } from "../../application/ml/index.js";
import {
  CreateCampaignUseCase,
  UpdateCampaignUseCase,
  ArchiveCampaignUseCase,
  TagPostWithCampaignUseCase,
  UntagPostFromCampaignUseCase,
  GetCampaignAnalyticsUseCase,
  ListCampaignsQuery,
  GetCampaignQuery,
} from "../../application/campaigns/index.js";
import { GetHistoricalAnalyticsQuery } from "../../application/analytics/GetHistoricalAnalyticsQuery.js";
import { GenerateUTMLinksUseCase } from "../../application/utm/index.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import type { AnalyticsWriteRepository } from "../../domain/repositories/AnalyticsWriteRepository.js";
import type { ChannelQueryForIngestion } from "../../application/analytics/DispatchAnalyticsIngestionUseCase.js";
import { IngestChannelAnalyticsUseCase } from "../../application/analytics/IngestChannelAnalyticsUseCase.js";
import { DispatchAnalyticsIngestionUseCase } from "../../application/analytics/DispatchAnalyticsIngestionUseCase.js";
import { PrismaAnalyticsWriteRepository } from "../repositories/PrismaAnalyticsWriteRepository.js";
import { PrismaChannelQueryForIngestion } from "../repositories/PrismaChannelQueryForIngestion.js";
import { PrismaTopPerformersQuery } from "../repositories/PrismaTopPerformersQuery.js";
import {
  GetTopPerformersContextUseCase,
  type TopPerformersQueryPort,
} from "../../application/ai/GetTopPerformersContextUseCase.js";
import type { PrismaClient } from "@infra/prisma";
import type { QueuePort } from "@ports/core";
import { QUEUE_NAMES } from "@adapters/queue-bullmq";

/**
 * Register all analytics, ML, campaign, historical analytics, and UTM use cases in the container
 */
export function setupAnalyticsUseCases(container: Container): void {
  // Register Analytics Port Adapters (F26)
  container.register<CrossPlatformAnalyticsAdapter>(
    TOKENS.CrossPlatformAnalyticsAdapter,
    () => new CrossPlatformAnalyticsAdapter(),
    true
  );
  container.register<PerformanceComparatorAdapter>(
    TOKENS.PerformanceComparatorAdapter,
    () => new PerformanceComparatorAdapter(),
    true
  );
  container.register<ROICalculatorAdapter>(
    TOKENS.ROICalculatorAdapter,
    () => new ROICalculatorAdapter(),
    true
  );

  // Register Analytics Use Cases (F26)
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

  // Register ML Use Cases (B0-2 — AI-powered with heuristic fallback)
  container.register<OptimizeContentUseCase>(
    TOKENS.OptimizeContentUseCase,
    () =>
      new OptimizeContentUseCase(
        container.resolve<import("../../ai/aiService.js").AIService>(TOKENS.AIService)
      ),
    true
  );
  container.register<PredictOptimalTimingUseCase>(
    TOKENS.PredictOptimalTimingUseCase,
    () =>
      new PredictOptimalTimingUseCase(
        container.resolve<import("../../ai/aiService.js").AIService>(TOKENS.AIService),
        container.resolve<
          import("../../domain/repositories/AnalyticsReadRepository.js").AnalyticsReadRepositoryPort
        >(TOKENS.AnalyticsReadRepository)
      ),
    true
  );

  // Campaign Use Cases (Phase 3)
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

  // Register Historical Analytics Query (Phase 3 Step 5)
  container.register<GetHistoricalAnalyticsQuery>(
    TOKENS.GetHistoricalAnalyticsQuery,
    () =>
      new GetHistoricalAnalyticsQuery(
        container.resolve<AnalyticsReadRepositoryPort>(TOKENS.AnalyticsReadRepository)
      ),
    true
  );

  // Register UTM Use Cases (Phase 3 Step 4: UTM/GA4 Integration)
  container.register<GenerateUTMLinksUseCase>(
    TOKENS.GenerateUTMLinksUseCase,
    () =>
      new GenerateUTMLinksUseCase(
        container.resolve<TrackedLinkRepository>(TOKENS.TrackedLinkRepository)
      ),
    true
  );

  // Analytics Ingestion (Sprint Gaps — Batch 1)
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
        container.resolve<QueuePort>(TOKENS.QueuePort),
        QUEUE_NAMES.ANALYTICS_AGGREGATION,
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );

  // AI Differentiation — Analytics→AI Bridge (Sprint 7)
  container.register<TopPerformersQueryPort>(
    TOKENS.TopPerformersQueryPort,
    () => new PrismaTopPerformersQuery(container.resolve<PrismaClient>(TOKENS.PrismaClient)),
    true
  );
  container.register<GetTopPerformersContextUseCase>(
    TOKENS.GetTopPerformersContextUseCase,
    () =>
      new GetTopPerformersContextUseCase(
        container.resolve<TopPerformersQueryPort>(TOKENS.TopPerformersQueryPort)
      ),
    true
  );
}
