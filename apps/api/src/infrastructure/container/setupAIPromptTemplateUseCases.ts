/**
 * @file setupAIPromptTemplateUseCases.ts
 * @description Registers AI prompt template use cases in the DI container.
 * @layer infrastructure
 */

import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import { PrismaAIPromptTemplateRepository } from "../repositories/PrismaAIPromptTemplateRepository.js";
import type { AIPromptTemplateRepository } from "../../domain/repositories/AIPromptTemplateRepository.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import { ListAIPromptTemplatesQuery } from "@core/application/aiPromptTemplates/ListAIPromptTemplatesQuery.js";
import { CreateAIPromptTemplateUseCase } from "@core/application/aiPromptTemplates/CreateAIPromptTemplateUseCase.js";
import { UpdateAIPromptTemplateUseCase } from "@core/application/aiPromptTemplates/UpdateAIPromptTemplateUseCase.js";
import { DeleteAIPromptTemplateUseCase } from "@core/application/aiPromptTemplates/DeleteAIPromptTemplateUseCase.js";

/**
 * @method setupAIPromptTemplateUseCases
 * @description Registers the AI prompt template repository and all use cases as singletons.
 */
export function setupAIPromptTemplateUseCases(container: Container): void {
  // Repository (Prisma adapter)
  container.register<AIPromptTemplateRepository>(
    TOKENS.AIPromptTemplateRepository,
    () => new PrismaAIPromptTemplateRepository(container.resolve(TOKENS.PrismaClient)),
    true
  );

  const repo = () =>
    container.resolve<AIPromptTemplateRepository>(TOKENS.AIPromptTemplateRepository);
  const uow = () => container.resolve<UnitOfWork>(TOKENS.UnitOfWork);

  container.register(
    TOKENS.ListAIPromptTemplatesQuery,
    () => new ListAIPromptTemplatesQuery(repo()),
    true
  );

  container.register(
    TOKENS.CreateAIPromptTemplateUseCase,
    () => new CreateAIPromptTemplateUseCase(repo(), uow()),
    true
  );

  container.register(
    TOKENS.UpdateAIPromptTemplateUseCase,
    () => new UpdateAIPromptTemplateUseCase(repo(), uow()),
    true
  );

  container.register(
    TOKENS.DeleteAIPromptTemplateUseCase,
    () => new DeleteAIPromptTemplateUseCase(repo(), uow()),
    true
  );
}
