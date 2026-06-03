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
} from "@core/domain/index.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type { BusinessMetricsPort } from "@core/domain/repositories/BusinessMetricsPort.js";
import type { QueuePortRegistry } from "@ports/core";
import { QUEUE_NAMES } from "@adapters/queue-bullmq";
import type { ProjectQueryRepositoryPort } from "@core/domain/repositories/ProjectQueryRepository.js";
import type { BulkScheduleBatchRepository } from "@core/domain/repositories/BulkScheduleBatchRepository.js";
import type { BulkScheduleQueryRepository } from "@core/domain/repositories/BulkScheduleQueryRepository.js";
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
} from "@core/posts/index.js";
import { ImportSchedulingCsvUseCase } from "@core/bulk-scheduling/ImportSchedulingCsvUseCase.js";
import { PostCreationAdapter } from "./adapters/PostCreationAdapter.js";
import { ProcessBulkScheduleRowUseCase } from "@core/bulk-scheduling/ProcessBulkScheduleRowUseCase.js";
import { FailBulkScheduleRowUseCase } from "@core/bulk-scheduling/FailBulkScheduleRowUseCase.js";
import { GetBulkScheduleBatchQuery } from "@core/bulk-scheduling/GetBulkScheduleBatchQuery.js";
import { BulkScheduleDispatchEventHandler } from "../../bulk-scheduling/BulkScheduleDispatchEventHandler.js";
import { BulkScheduleReconciliationService } from "../../bulk-scheduling/BulkScheduleReconciliationService.js";
import type { PrismaClient } from "@infra/prisma";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";

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
        new PostCreationAdapter(
          container.resolve<CreatePostUseCase>(TOKENS.CreatePostUseCase),
          container.resolve<SchedulePostUseCase>(TOKENS.SchedulePostUseCase)
        ),
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

  // PR1: Durability core — dispatch handler + reconciliation backstop

  // BulkScheduleDispatchEventHandler: subscribes to BulkScheduleRowConfirmed outbox
  // events and enqueues one BULK_SCHEDULE BullMQ job per row. Deduped by
  // dedupeKey = bulk-{batchId}-{itemId}. Mirrors TriageDispatchEventHandler.
  container.register<BulkScheduleDispatchEventHandler>(
    TOKENS.BulkScheduleDispatchEventHandler,
    () => {
      const queue = container
        .resolve<QueuePortRegistry>(TOKENS.QueuePortRegistry)
        .forQueue(QUEUE_NAMES.BULK_SCHEDULE);
      return new BulkScheduleDispatchEventHandler(queue);
    },
    true
  );

  // BulkScheduleReconciliationService: 60-second sweep that re-enqueues jobs for
  // rows whose outbox events were archived to the DLQ (stuck PENDING items).
  container.register<BulkScheduleReconciliationService>(
    TOKENS.BulkScheduleReconciliationService,
    () => {
      const queue = container
        .resolve<QueuePortRegistry>(TOKENS.QueuePortRegistry)
        .forQueue(QUEUE_NAMES.BULK_SCHEDULE);
      return new BulkScheduleReconciliationService(
        container.resolve<PrismaClient>(TOKENS.PrismaClient),
        container.resolve<BackgroundTaskScheduler>(TOKENS.BackgroundTaskScheduler),
        queue
      );
    },
    true
  );
}
