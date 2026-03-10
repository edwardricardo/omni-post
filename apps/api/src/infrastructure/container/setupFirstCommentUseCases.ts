/**
 * @file setupFirstCommentUseCases.ts
 * @description Registers first comment use cases and query in the DI container.
 * @layer infrastructure
 */
import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import type { FirstCommentRepository } from "../../domain/repositories/FirstCommentRepository.js";
import { SetFirstCommentUseCase } from "../../application/first-comment/SetFirstCommentUseCase.js";
import { RemoveFirstCommentUseCase } from "../../application/first-comment/RemoveFirstCommentUseCase.js";
import { GetFirstCommentQuery } from "../../application/first-comment/GetFirstCommentQuery.js";
import { PublishFirstCommentUseCase } from "../../application/first-comment/PublishFirstCommentUseCase.js";

/**
 * @method setupFirstCommentUseCases
 * @description Registers all first comment use cases as singletons.
 */
export function setupFirstCommentUseCases(container: Container): void {
  const repo = () => container.resolve<FirstCommentRepository>(TOKENS.FirstCommentRepository);

  container.register(TOKENS.SetFirstCommentUseCase, () => new SetFirstCommentUseCase(repo()), true);

  container.register(
    TOKENS.RemoveFirstCommentUseCase,
    () => new RemoveFirstCommentUseCase(repo()),
    true
  );

  container.register(TOKENS.GetFirstCommentQuery, () => new GetFirstCommentQuery(repo()), true);

  container.register(
    TOKENS.PublishFirstCommentUseCase,
    () => new PublishFirstCommentUseCase(repo()),
    true
  );
}
