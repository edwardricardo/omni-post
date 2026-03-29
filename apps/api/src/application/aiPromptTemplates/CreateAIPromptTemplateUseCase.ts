/**
 * @file CreateAIPromptTemplateUseCase.ts
 * @description Creates a new account-specific AI prompt template.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { AIPromptTemplateRepository } from "../../domain/repositories/AIPromptTemplateRepository.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";
import { type CreateAIPromptTemplateInput, type CreateAIPromptTemplateOutput } from "./types.js";

/**
 * @class CreateAIPromptTemplateUseCase
 * @description Persists a new user-defined prompt template for an account.
 */
export class CreateAIPromptTemplateUseCase implements UseCase<
  CreateAIPromptTemplateInput,
  CreateAIPromptTemplateOutput,
  UseCaseError
> {
  constructor(
    private readonly repository: AIPromptTemplateRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Validates input and creates the template record.
   * @param input - Template data including accountId, name, prompt, etc.
   * @returns Result containing the new template's id
   */
  async execute(
    input: CreateAIPromptTemplateInput
  ): Promise<Result<CreateAIPromptTemplateOutput, UseCaseError>> {
    if (!input.name || input.name.trim().length === 0) {
      return err(new UseCaseError("Template name is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }
    if (!input.prompt || input.prompt.trim().length === 0) {
      return err(new UseCaseError("Prompt text is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }
    if (!input.accountId || input.accountId.trim().length === 0) {
      return err(new UseCaseError("Account ID is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    const doWork = async (): Promise<Result<CreateAIPromptTemplateOutput, UseCaseError>> => {
      const template = await this.repository.create({
        accountId: input.accountId,
        name: input.name.trim(),
        category: input.category || "Custom",
        platforms: input.platforms,
        prompt: input.prompt.trim(),
        variables: input.variables,
        tone: input.tone,
        isSystem: false,
      });

      return ok({ id: template.id });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<CreateAIPromptTemplateOutput, UseCaseError> = ok({ id: "" });
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to create AI prompt template",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
