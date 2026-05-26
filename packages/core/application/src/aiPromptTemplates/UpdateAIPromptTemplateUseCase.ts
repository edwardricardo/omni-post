/**
 * @file UpdateAIPromptTemplateUseCase.ts
 * @description Updates an existing account-specific AI prompt template.
 *   System templates (isSystem=true) cannot be modified.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { AIPromptTemplateRepository } from "@core/domain/repositories/AIPromptTemplateRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import {
  type UpdateAIPromptTemplateInput,
  type AIPromptTemplateDto,
  type TemplateVariableDto,
} from "./types.js";

/**
 * @class UpdateAIPromptTemplateUseCase
 * @description Updates a user-defined template. Rejects updates to system templates.
 */
export class UpdateAIPromptTemplateUseCase implements UseCase<
  UpdateAIPromptTemplateInput,
  AIPromptTemplateDto,
  UseCaseError
> {
  constructor(
    private readonly repository: AIPromptTemplateRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Finds and partially updates the template.
   * @param input - Template id plus optional fields to update
   * @returns Result containing the updated AIPromptTemplateDto
   */
  async execute(
    input: UpdateAIPromptTemplateInput
  ): Promise<Result<AIPromptTemplateDto, UseCaseError>> {
    const existing = await this.repository.findById(input.templateId);

    if (!existing) {
      return err(new UseCaseError("Template not found", USE_CASE_ERRORS.NOT_FOUND));
    }
    if (existing.isSystem) {
      return err(
        new UseCaseError("System templates cannot be modified", USE_CASE_ERRORS.FORBIDDEN)
      );
    }

    const doWork = async (): Promise<Result<AIPromptTemplateDto, UseCaseError>> => {
      const updated = await this.repository.update(input.templateId, {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.category !== undefined && { category: input.category }),
        ...(input.platforms !== undefined && { platforms: input.platforms }),
        ...(input.prompt !== undefined && { prompt: input.prompt }),
        ...(input.variables !== undefined && { variables: input.variables }),
        ...(input.tone !== undefined && { tone: input.tone }),
      });

      return ok({
        id: updated.id,
        accountId: updated.accountId,
        name: updated.name,
        category: updated.category,
        platforms: updated.platforms,
        prompt: updated.prompt,
        variables: updated.variables as TemplateVariableDto[],
        tone: updated.tone,
        isSystem: updated.isSystem,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<AIPromptTemplateDto, UseCaseError> = err(
          new UseCaseError("Transaction not executed", USE_CASE_ERRORS.INTERNAL_ERROR)
        );
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to update AI prompt template",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
