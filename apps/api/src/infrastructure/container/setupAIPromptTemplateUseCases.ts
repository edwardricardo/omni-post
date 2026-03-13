/**
 * @file setupAIPromptTemplateUseCases.ts
 * @description Registers AI prompt template use cases in the DI container.
 * @layer infrastructure
 */

import type { Container } from "./Container.js";
import { TOKENS } from "./types.js";
import { PrismaAIPromptTemplateRepository } from "../repositories/PrismaAIPromptTemplateRepository.js";
import type { AIPromptTemplateRepository } from "../../domain/repositories/AIPromptTemplateRepository.js";
import { ListAIPromptTemplatesQuery } from "../../application/aiPromptTemplates/ListAIPromptTemplatesQuery.js";
import { CreateAIPromptTemplateUseCase } from "../../application/aiPromptTemplates/CreateAIPromptTemplateUseCase.js";
import { UpdateAIPromptTemplateUseCase } from "../../application/aiPromptTemplates/UpdateAIPromptTemplateUseCase.js";
import { DeleteAIPromptTemplateUseCase } from "../../application/aiPromptTemplates/DeleteAIPromptTemplateUseCase.js";

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

  container.register(
    TOKENS.ListAIPromptTemplatesQuery,
    () => new ListAIPromptTemplatesQuery(repo()),
    true
  );

  container.register(
    TOKENS.CreateAIPromptTemplateUseCase,
    () => new CreateAIPromptTemplateUseCase(repo()),
    true
  );

  container.register(
    TOKENS.UpdateAIPromptTemplateUseCase,
    () => new UpdateAIPromptTemplateUseCase(repo()),
    true
  );

  container.register(
    TOKENS.DeleteAIPromptTemplateUseCase,
    () => new DeleteAIPromptTemplateUseCase(repo()),
    true
  );
}
