/**
 * @file setupRecurringPostUseCases.ts
 * @description Registers recurring post use cases and queries in the DI container.
 * @layer infrastructure
 */
import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type { RecurringPostRepository } from "../../domain/repositories/RecurringPostRepository.js";
import { CreateRecurringPostUseCase } from "../../application/recurring/CreateRecurringPostUseCase.js";
import { UpdateRecurringPostUseCase } from "../../application/recurring/UpdateRecurringPostUseCase.js";
import { DeactivateRecurringPostUseCase } from "../../application/recurring/DeactivateRecurringPostUseCase.js";
import { ListRecurringPostsQuery } from "../../application/recurring/ListRecurringPostsQuery.js";
import { GetRecurringPostQuery } from "../../application/recurring/GetRecurringPostQuery.js";
import { ProcessRecurrenceUseCase } from "../../application/recurring/ProcessRecurrenceUseCase.js";

/**
 * @method setupRecurringPostUseCases
 * @description Registers all recurring post use cases as singletons.
 */
export function setupRecurringPostUseCases(container: Container): void {
  const repo = () => container.resolve<RecurringPostRepository>(TOKENS.RecurringPostRepository);

  container.register(
    TOKENS.CreateRecurringPostUseCase,
    () => new CreateRecurringPostUseCase(repo()),
    true
  );

  container.register(
    TOKENS.UpdateRecurringPostUseCase,
    () => new UpdateRecurringPostUseCase(repo()),
    true
  );

  container.register(
    TOKENS.DeactivateRecurringPostUseCase,
    () => new DeactivateRecurringPostUseCase(repo()),
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
    () => new ProcessRecurrenceUseCase(repo()),
    true
  );
}
