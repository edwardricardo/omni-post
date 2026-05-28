/**
 * @file setupFirstCommentUseCases.ts
 * @description Registers first comment use cases and query in the DI container.
 * @layer infrastructure
 */
import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type { FirstCommentRepository } from "@core/domain/repositories/FirstCommentRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { SetFirstCommentUseCase } from "@core/first-comment/SetFirstCommentUseCase.js";
import { RemoveFirstCommentUseCase } from "@core/first-comment/RemoveFirstCommentUseCase.js";
import { GetFirstCommentQuery } from "@core/first-comment/GetFirstCommentQuery.js";
import { PublishFirstCommentUseCase } from "@core/first-comment/PublishFirstCommentUseCase.js";

/**
 * @method setupFirstCommentUseCases
 * @description Registers all first comment use cases as singletons.
 */
export function setupFirstCommentUseCases(container: Container): void {
  const repo = () => container.resolve<FirstCommentRepository>(TOKENS.FirstCommentRepository);
  const uow = () => container.resolve<UnitOfWork>(TOKENS.UnitOfWork);

  container.register(
    TOKENS.SetFirstCommentUseCase,
    () => new SetFirstCommentUseCase(repo(), uow()),
    true
  );

  container.register(
    TOKENS.RemoveFirstCommentUseCase,
    () => new RemoveFirstCommentUseCase(repo(), uow()),
    true
  );

  container.register(TOKENS.GetFirstCommentQuery, () => new GetFirstCommentQuery(repo()), true);

  container.register(
    TOKENS.PublishFirstCommentUseCase,
    () => new PublishFirstCommentUseCase(repo(), uow()),
    true
  );
}
