/**
 * @file setupRecurringPostUseCases.ts
 * @description Registers recurring post use cases, queries, and the
 *              RecurrenceScheduler in the DI container.
 * @layer infrastructure
 */
import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type { RecurringPostRepository } from "@core/domain/repositories/RecurringPostRepository.js";
import type { PostRepository, EventDispatcher } from "@core/domain/index.js";
import type { ProjectRepositoryPort } from "@core/domain/repositories/ProjectRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";
import type { Logger } from "pino";
import { CreateRecurringPostUseCase } from "@core/recurring/CreateRecurringPostUseCase.js";
import { UpdateRecurringPostUseCase } from "@core/recurring/UpdateRecurringPostUseCase.js";
import { DeactivateRecurringPostUseCase } from "@core/recurring/DeactivateRecurringPostUseCase.js";
import { ListRecurringPostsQuery } from "@core/recurring/ListRecurringPostsQuery.js";
import { GetRecurringPostQuery } from "@core/recurring/GetRecurringPostQuery.js";
import { ProcessRecurrenceUseCase } from "@core/recurring/ProcessRecurrenceUseCase.js";
import { CreatePostFromRecurrenceUseCase } from "@core/recurring/CreatePostFromRecurrenceUseCase.js";
import { CreatePostUseCase } from "@core/posts/CreatePostUseCase.js";
import { SchedulePostUseCase } from "@core/posts/SchedulePostUseCase.js";
import { PostCreationAdapter } from "./adapters/PostCreationAdapter.js";
import { RecurrenceScheduler } from "../../recurring/RecurrenceScheduler.js";
import { createLogger } from "../../lib/logger.js";

/**
 * @method setupRecurringPostUseCases
 * @description Registers all recurring post use cases as singletons.
 */
export function setupRecurringPostUseCases(container: Container): void {
  const repo = () => container.resolve<RecurringPostRepository>(TOKENS.RecurringPostRepository);
  const projectRepo = () => container.resolve<ProjectRepositoryPort>(TOKENS.ProjectRepository);
  const uow = () => container.resolve<UnitOfWork>(TOKENS.UnitOfWork);

  container.register(
    TOKENS.CreateRecurringPostUseCase,
    // ProjectRepository powers the create-in-foreign-project ownership gate
    // (CWE-639) — the scheduler fans out posts into projectId on each tick.
    () => new CreateRecurringPostUseCase(repo(), projectRepo(), uow()),
    true
  );

  container.register(
    TOKENS.UpdateRecurringPostUseCase,
    () => new UpdateRecurringPostUseCase(repo(), uow()),
    true
  );

  container.register(
    TOKENS.DeactivateRecurringPostUseCase,
    () => new DeactivateRecurringPostUseCase(repo(), uow()),
    true
  );

  container.register(
    TOKENS.ListRecurringPostsQuery_Recurring,
    () => new ListRecurringPostsQuery(repo()),
    true
  );

  container.register(TOKENS.GetRecurringPostQuery, () => new GetRecurringPostQuery(repo()), true);

  container.register(
    TOKENS.ProcessRecurrenceUseCase,
    () => new ProcessRecurrenceUseCase(repo(), uow()),
    true
  );

  container.register(
    TOKENS.CreatePostFromRecurrenceUseCase,
    () =>
      new CreatePostFromRecurrenceUseCase(
        container.resolve<PostRepository>(TOKENS.PostRepository),
        container.resolve<EventDispatcher>(TOKENS.EventDispatcher),
        new PostCreationAdapter(
          container.resolve<CreatePostUseCase>(TOKENS.CreatePostUseCase),
          container.resolve<SchedulePostUseCase>(TOKENS.SchedulePostUseCase)
        ),
        uow()
      ),
    true
  );

  container.register(
    TOKENS.RecurrenceScheduler,
    () =>
      new RecurrenceScheduler(
        container.resolve<BackgroundTaskScheduler>(TOKENS.BackgroundTaskScheduler),
        container.resolve<ProcessRecurrenceUseCase>(TOKENS.ProcessRecurrenceUseCase),
        container.resolve<CreatePostFromRecurrenceUseCase>(TOKENS.CreatePostFromRecurrenceUseCase),
        createLogger("recurrence-scheduler") as unknown as Logger
      ),
    true
  );
}
