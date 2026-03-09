/**
 * Container Setup - Use Case Registrations
 *
 * Registers all application use cases in the DI container.
 * Extracted from setup.ts to keep files under 800 lines.
 *
 * @module infrastructure/container/setupUseCases
 */
import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type {
  PostRepository,
  PostQueryRepository,
  EventDispatcher,
  ChannelRepository,
} from "../../domain/index.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import type { ApiKeyRepository } from "../../domain/repositories/ApiKeyRepository.js";
import {
  CreatePostUseCase,
  GetPostUseCase,
  UpdatePostUseCase,
  ListPostsUseCase,
  DeletePostUseCase,
  SchedulePostUseCase,
  GetPostWithThreadQuery,
  ListPostsGlobalQuery,
} from "../../application/posts/index.js";
import {
  CreateApiKeyUseCase,
  ValidateApiKeyUseCase,
  ListApiKeysUseCase,
  RotateApiKeyUseCase,
  DeactivateApiKeyUseCase,
} from "../../application/apiKeys/index.js";
import { OutboxRelay } from "../outbox/OutboxRelay.js";
import { OutboxCleaner } from "../outbox/OutboxCleaner.js";
import {
  GetCrossPlatformAnalyticsUseCase,
  ComparePerformanceUseCase,
  CalculateROIUseCase,
} from "../../application/analytics/index.js";
import { CrossPlatformAnalyticsAdapter } from "../adapters/CrossPlatformAnalyticsAdapter.js";
import { PerformanceComparatorAdapter } from "../adapters/PerformanceComparatorAdapter.js";
import { ROICalculatorAdapter } from "../adapters/ROICalculatorAdapter.js";
import { OptimizeContentUseCase, PredictOptimalTimingUseCase } from "../../application/ml/index.js";
import type { TrackedLinkRepository } from "../../domain/repositories/TrackedLinkRepository.js";
import {
  CreateTrackedLinkUseCase,
  GetTrackedLinkUseCase,
  RedirectAndTrackClickUseCase,
  GetLinkStatsUseCase,
  DeleteTrackedLinkUseCase,
} from "../../application/links/index.js";
import type { CrisisProjectRepository } from "../../application/crisis/types.js";
import {
  EnterCrisisModeUseCase,
  ExitCrisisModeUseCase,
  GetCrisisStatusUseCase,
} from "../../application/crisis/index.js";

/**
 * Register all use cases and their adapters in the container
 */
export function setupUseCases(container: Container): void {
  // Register API Key Use Cases (FASE H10-B)
  container.register<CreateApiKeyUseCase>(
    TOKENS.CreateApiKeyUseCase,
    () => new CreateApiKeyUseCase(container.resolve<ApiKeyRepository>(TOKENS.ApiKeyRepository)),
    true
  );
  container.register<ValidateApiKeyUseCase>(
    TOKENS.ValidateApiKeyUseCase,
    () => new ValidateApiKeyUseCase(container.resolve<ApiKeyRepository>(TOKENS.ApiKeyRepository)),
    true
  );
  container.register<ListApiKeysUseCase>(
    TOKENS.ListApiKeysUseCase,
    () => new ListApiKeysUseCase(container.resolve<ApiKeyRepository>(TOKENS.ApiKeyRepository)),
    true
  );
  container.register<RotateApiKeyUseCase>(
    TOKENS.RotateApiKeyUseCase,
    () => new RotateApiKeyUseCase(container.resolve<ApiKeyRepository>(TOKENS.ApiKeyRepository)),
    true
  );
  container.register<DeactivateApiKeyUseCase>(
    TOKENS.DeactivateApiKeyUseCase,
    () => new DeactivateApiKeyUseCase(container.resolve<ApiKeyRepository>(TOKENS.ApiKeyRepository)),
    true
  );

  // Register Post Use Cases (FASE H5)
  container.register<CreatePostUseCase>(
    TOKENS.CreatePostUseCase,
    () =>
      new CreatePostUseCase(
        container.resolve<PostRepository>(TOKENS.PostRepository),
        container.resolve<EventDispatcher>(TOKENS.EventDispatcher),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<GetPostUseCase>(
    TOKENS.GetPostUseCase,
    () => new GetPostUseCase(container.resolve<PostQueryRepository>(TOKENS.PostQueryRepository)),
    true
  );
  container.register<UpdatePostUseCase>(
    TOKENS.UpdatePostUseCase,
    () =>
      new UpdatePostUseCase(
        container.resolve<PostRepository>(TOKENS.PostRepository),
        container.resolve<EventDispatcher>(TOKENS.EventDispatcher),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<ListPostsUseCase>(
    TOKENS.ListPostsUseCase,
    () => new ListPostsUseCase(container.resolve<PostQueryRepository>(TOKENS.PostQueryRepository)),
    true
  );
  container.register<DeletePostUseCase>(
    TOKENS.DeletePostUseCase,
    () => new DeletePostUseCase(container.resolve<PostRepository>(TOKENS.PostRepository)),
    true
  );

  // Register Post Use Cases (P2-ARCH-1 — postRoutes migration)
  container.register<SchedulePostUseCase>(
    TOKENS.SchedulePostUseCase,
    () =>
      new SchedulePostUseCase(
        container.resolve<PostRepository>(TOKENS.PostRepository),
        container.resolve<EventDispatcher>(TOKENS.EventDispatcher),
        container.resolve<ChannelRepository>(TOKENS.ChannelRepository)
      ),
    true
  );
  container.register<GetPostWithThreadQuery>(
    TOKENS.GetPostWithThreadQuery,
    () =>
      new GetPostWithThreadQuery(
        container.resolve<PostQueryRepository>(TOKENS.PostQueryRepository)
      ),
    true
  );
  container.register<ListPostsGlobalQuery>(
    TOKENS.ListPostsGlobalQuery,
    () =>
      new ListPostsGlobalQuery(container.resolve<PostQueryRepository>(TOKENS.PostQueryRepository)),
    true
  );

  // Register Outbox Relay + Cleaner (P2-1)
  container.register<OutboxRelay>(
    TOKENS.OutboxRelay,
    () =>
      new OutboxRelay({
        prisma: container.resolve(TOKENS.PrismaClient),
        eventDispatcher: container.resolve<EventDispatcher>(TOKENS.EventDispatcher),
      }),
    true
  );
  container.register<OutboxCleaner>(
    TOKENS.OutboxCleaner,
    () => new OutboxCleaner(container.resolve(TOKENS.PrismaClient)),
    true
  );

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
  // Register Tracked Link Use Cases (P1-DI-7)
  container.register<CreateTrackedLinkUseCase>(
    TOKENS.CreateTrackedLinkUseCase,
    () =>
      new CreateTrackedLinkUseCase(
        container.resolve<TrackedLinkRepository>(TOKENS.TrackedLinkRepository)
      ),
    true
  );
  container.register<GetTrackedLinkUseCase>(
    TOKENS.GetTrackedLinkUseCase,
    () =>
      new GetTrackedLinkUseCase(
        container.resolve<TrackedLinkRepository>(TOKENS.TrackedLinkRepository)
      ),
    true
  );
  container.register<GetLinkStatsUseCase>(
    TOKENS.GetLinkStatsUseCase,
    () =>
      new GetLinkStatsUseCase(
        container.resolve<TrackedLinkRepository>(TOKENS.TrackedLinkRepository)
      ),
    true
  );
  container.register<DeleteTrackedLinkUseCase>(
    TOKENS.DeleteTrackedLinkUseCase,
    () =>
      new DeleteTrackedLinkUseCase(
        container.resolve<TrackedLinkRepository>(TOKENS.TrackedLinkRepository)
      ),
    true
  );
  container.register<RedirectAndTrackClickUseCase>(
    TOKENS.RedirectAndTrackClickUseCase,
    () =>
      new RedirectAndTrackClickUseCase(
        container.resolve<TrackedLinkRepository>(TOKENS.TrackedLinkRepository)
      ),
    true
  );

  // Register Crisis Mode Use Cases (P1-DI-8)
  container.register<EnterCrisisModeUseCase>(
    TOKENS.EnterCrisisModeUseCase,
    () =>
      new EnterCrisisModeUseCase(
        container.resolve<CrisisProjectRepository>(TOKENS.CrisisProjectRepository),
        container.resolve<EventDispatcher>(TOKENS.EventDispatcher)
      ),
    true
  );
  container.register<ExitCrisisModeUseCase>(
    TOKENS.ExitCrisisModeUseCase,
    () =>
      new ExitCrisisModeUseCase(
        container.resolve<CrisisProjectRepository>(TOKENS.CrisisProjectRepository),
        container.resolve<EventDispatcher>(TOKENS.EventDispatcher)
      ),
    true
  );
  container.register<GetCrisisStatusUseCase>(
    TOKENS.GetCrisisStatusUseCase,
    () =>
      new GetCrisisStatusUseCase(
        container.resolve<CrisisProjectRepository>(TOKENS.CrisisProjectRepository)
      ),
    true
  );
}
