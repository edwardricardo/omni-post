/**
 * @file setupPostUseCases.ts
 * @description Registers all post-related use cases in the DI container.
 *              Extracted from setupUseCases.ts for domain-based modularization.
 * @layer infrastructure
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
import type { BusinessMetricsPort } from "@core/domain/repositories/BusinessMetricsPort.js";
import type { QueuePortRegistry } from "@ports/core";
import { QUEUE_NAMES } from "@adapters/queue-bullmq";
import type { ProjectQueryRepositoryPort } from "../../domain/repositories/ProjectQueryRepository.js";
import type { BulkScheduleBatchRepository } from "../../domain/repositories/BulkScheduleBatchRepository.js";
import type { BulkScheduleQueryRepository } from "../../domain/repositories/BulkScheduleQueryRepository.js";
import {
  CreatePostUseCase,
  GetPostUseCase,
  UpdatePostUseCase,
  ListPostsUseCase,
  DeletePostUseCase,
  SchedulePostUseCase,
  GetPostWithThreadQuery,
  ListPostsGlobalQuery,
  ArchivePostsBatchUseCase,
  HardDeletePostsBatchUseCase,
  DuplicatePostsBatchUseCase,
} from "@core/application/posts/index.js";
import { ImportSchedulingCsvUseCase } from "@core/application/bulk-scheduling/ImportSchedulingCsvUseCase.js";
import { ProcessBulkScheduleRowUseCase } from "@core/application/bulk-scheduling/ProcessBulkScheduleRowUseCase.js";
import { FailBulkScheduleRowUseCase } from "@core/application/bulk-scheduling/FailBulkScheduleRowUseCase.js";
import { GetBulkScheduleBatchQuery } from "@core/application/bulk-scheduling/GetBulkScheduleBatchQuery.js";

/**
 * Register all post use cases in the container
 */
export function setupPostUseCases(container: Container): void {
  // Register Post Use Cases
  container.register<CreatePostUseCase>(
    TOKENS.CreatePostUseCase,
    () =>
      new CreatePostUseCase(
        container.resolve<PostRepository>(TOKENS.PostRepository),
        container.resolve<EventDispatcher>(TOKENS.EventDispatcher),
        container.resolve<BusinessMetricsPort>(TOKENS.BusinessMetricsPort),
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
    () =>
      new DeletePostUseCase(
        container.resolve<PostRepository>(TOKENS.PostRepository),
        container.resolve<BusinessMetricsPort>(TOKENS.BusinessMetricsPort),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<ArchivePostsBatchUseCase>(
    TOKENS.ArchivePostsBatchUseCase,
    () =>
      new ArchivePostsBatchUseCase(
        container.resolve<PostRepository>(TOKENS.PostRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<HardDeletePostsBatchUseCase>(
    TOKENS.HardDeletePostsBatchUseCase,
    () =>
      new HardDeletePostsBatchUseCase(
        container.resolve<PostRepository>(TOKENS.PostRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<DuplicatePostsBatchUseCase>(
    TOKENS.DuplicatePostsBatchUseCase,
    () =>
      new DuplicatePostsBatchUseCase(
        container.resolve<PostRepository>(TOKENS.PostRepository),
        container.resolve<EventDispatcher>(TOKENS.EventDispatcher),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );

  // Register Post Scheduling Use Cases
  container.register<SchedulePostUseCase>(
    TOKENS.SchedulePostUseCase,
    () =>
      new SchedulePostUseCase(
        container.resolve<PostRepository>(TOKENS.PostRepository),
        container.resolve<EventDispatcher>(TOKENS.EventDispatcher),
        container.resolve<ChannelRepository>(TOKENS.ChannelRepository),
        container.resolve<BusinessMetricsPort>(TOKENS.BusinessMetricsPort),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
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

  // Register Bulk CSV Scheduling Use Cases
  container.register<ImportSchedulingCsvUseCase>(
    TOKENS.ImportSchedulingCsvUseCase,
    () =>
      new ImportSchedulingCsvUseCase(
        container.resolve<ProjectQueryRepositoryPort>(TOKENS.ProjectQueryRepository),
        container.resolve<BulkScheduleBatchRepository>(TOKENS.BulkScheduleBatchRepository),
        container
          .resolve<QueuePortRegistry>(TOKENS.QueuePortRegistry)
          .forQueue(QUEUE_NAMES.BULK_SCHEDULE),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<ProcessBulkScheduleRowUseCase>(
    TOKENS.ProcessBulkScheduleRowUseCase,
    () =>
      new ProcessBulkScheduleRowUseCase(
        container.resolve<BulkScheduleBatchRepository>(TOKENS.BulkScheduleBatchRepository),
        container.resolve<ChannelRepository>(TOKENS.ChannelRepository),
        container.resolve<CreatePostUseCase>(TOKENS.CreatePostUseCase),
        container.resolve<SchedulePostUseCase>(TOKENS.SchedulePostUseCase),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<FailBulkScheduleRowUseCase>(
    TOKENS.FailBulkScheduleRowUseCase,
    () =>
      new FailBulkScheduleRowUseCase(
        container.resolve<BulkScheduleBatchRepository>(TOKENS.BulkScheduleBatchRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );
  container.register<GetBulkScheduleBatchQuery>(
    TOKENS.GetBulkScheduleBatchQuery,
    () =>
      new GetBulkScheduleBatchQuery(
        container.resolve<BulkScheduleQueryRepository>(TOKENS.BulkScheduleQueryRepository)
      ),
    true
  );
}
