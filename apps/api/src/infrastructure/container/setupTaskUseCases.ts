/**
 * @file setupTaskUseCases.ts
 * @description Registers task use cases and queries in the DI container.
 * @layer infrastructure
 */
import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type { TaskRepository } from "../../domain/repositories/TaskRepository.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import type { NotifyMentionedUsersService } from "../../application/mentions/index.js";
import {
  CreateTaskUseCase,
  UpdateTaskUseCase,
  CompleteTaskUseCase,
  CancelTaskUseCase,
  ListTasksQuery,
  GetTaskQuery,
} from "../../application/tasks/index.js";

/**
 * Register task use cases and queries.
 */
export function setupTaskUseCases(container: Container): void {
  container.register<CreateTaskUseCase>(
    TOKENS.CreateTaskUseCase,
    () =>
      new CreateTaskUseCase(
        container.resolve<TaskRepository>(TOKENS.TaskRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork),
        container.tryResolve<NotifyMentionedUsersService>(TOKENS.NotifyMentionedUsersService)
      ),
    true
  );

  container.register<UpdateTaskUseCase>(
    TOKENS.UpdateTaskUseCase,
    () =>
      new UpdateTaskUseCase(
        container.resolve<TaskRepository>(TOKENS.TaskRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );

  container.register<CompleteTaskUseCase>(
    TOKENS.CompleteTaskUseCase,
    () =>
      new CompleteTaskUseCase(
        container.resolve<TaskRepository>(TOKENS.TaskRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );

  container.register<CancelTaskUseCase>(
    TOKENS.CancelTaskUseCase,
    () =>
      new CancelTaskUseCase(
        container.resolve<TaskRepository>(TOKENS.TaskRepository),
        container.resolve<UnitOfWork>(TOKENS.UnitOfWork)
      ),
    true
  );

  container.register<ListTasksQuery>(
    TOKENS.ListTasksQuery,
    () => new ListTasksQuery(container.resolve<TaskRepository>(TOKENS.TaskRepository)),
    true
  );

  container.register<GetTaskQuery>(
    TOKENS.GetTaskQuery,
    () => new GetTaskQuery(container.resolve<TaskRepository>(TOKENS.TaskRepository)),
    true
  );
}
