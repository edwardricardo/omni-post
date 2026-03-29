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

/**
 * Register all post use cases in the container
 */
export function setupPostUseCases(container: Container): void {
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
    () =>
      new DeletePostUseCase(
        container.resolve<PostRepository>(TOKENS.PostRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );

  // Register Post Use Cases (P2-ARCH-1 — postRoutes migration)
  container.register<SchedulePostUseCase>(
    TOKENS.SchedulePostUseCase,
    () =>
      new SchedulePostUseCase(
        container.resolve<PostRepository>(TOKENS.PostRepository),
        container.resolve<EventDispatcher>(TOKENS.EventDispatcher),
        container.resolve<ChannelRepository>(TOKENS.ChannelRepository),
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
}
