/**
 * @file setupRecurringPostUseCases.ts
 * @description Registers recurring post use cases, queries, and the
 *              RecurrenceScheduler in the DI container.
 * @layer infrastructure
 */
import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type { RecurringPostRepository } from "../../domain/repositories/RecurringPostRepository.js";
import type { PostRepository, EventDispatcher } from "../../domain/index.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import type { BackgroundTaskScheduler } from "@observability/background-scheduler";
import type { Logger } from "pino";
import { CreateRecurringPostUseCase } from "@core/application/recurring/CreateRecurringPostUseCase.js";
import { UpdateRecurringPostUseCase } from "@core/application/recurring/UpdateRecurringPostUseCase.js";
import { DeactivateRecurringPostUseCase } from "@core/application/recurring/DeactivateRecurringPostUseCase.js";
import { ListRecurringPostsQuery } from "@core/application/recurring/ListRecurringPostsQuery.js";
import { GetRecurringPostQuery } from "@core/application/recurring/GetRecurringPostQuery.js";
import { ProcessRecurrenceUseCase } from "@core/application/recurring/ProcessRecurrenceUseCase.js";
import { CreatePostFromRecurrenceUseCase } from "@core/application/recurring/CreatePostFromRecurrenceUseCase.js";
import { SchedulePostUseCase } from "@core/application/posts/SchedulePostUseCase.js";
import { RecurrenceScheduler } from "../../recurring/RecurrenceScheduler.js";
import { createLogger } from "../../lib/logger.js";

/**
 * @method setupRecurringPostUseCases
 * @description Registers all recurring post use cases as singletons.
 */
export function setupRecurringPostUseCases(container: Container): void {
  const repo = () => container.resolve<RecurringPostRepository>(TOKENS.RecurringPostRepository);
  const uow = () => container.resolve<UnitOfWork>(TOKENS.UnitOfWork);

  container.register(
    TOKENS.CreateRecurringPostUseCase,
    () => new CreateRecurringPostUseCase(repo(), uow()),
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
        container.resolve<SchedulePostUseCase>(TOKENS.SchedulePostUseCase),
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
