/**
 * @file DeleteAIPromptTemplateUseCase.ts
 * @description Deletes an account-specific AI prompt template.
 *   System templates (isSystem=true) cannot be deleted.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { AIPromptTemplateRepository } from "@core/domain/repositories/AIPromptTemplateRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import { type DeleteAIPromptTemplateInput } from "./types.js";

/**
 * @class DeleteAIPromptTemplateUseCase
 * @description Removes a user-defined template. Rejects deletion of system templates.
 */
export class DeleteAIPromptTemplateUseCase implements UseCase<
  DeleteAIPromptTemplateInput,
  void,
  UseCaseError
> {
  constructor(
    private readonly repository: AIPromptTemplateRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Validates ownership and deletes the template.
   * @param input - Template id and accountId for ownership check
   * @returns Result<void> on success
   */
  async execute(input: DeleteAIPromptTemplateInput): Promise<Result<void, UseCaseError>> {
    const existing = await this.repository.findById(input.templateId);

    if (!existing) {
      return err(new UseCaseError("Template not found", USE_CASE_ERRORS.NOT_FOUND));
    }
    if (existing.isSystem) {
      return err(new UseCaseError("System templates cannot be deleted", USE_CASE_ERRORS.FORBIDDEN));
    }
    if (existing.accountId !== input.accountId) {
      return err(new UseCaseError("You do not own this template", USE_CASE_ERRORS.FORBIDDEN));
    }

    const doWork = async (): Promise<Result<void, UseCaseError>> => {
      await this.repository.delete(input.templateId);
      return ok(undefined);
    };

    try {
      if (this.unitOfWork) {
        let result: Result<void, UseCaseError> = ok(undefined);
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to delete AI prompt template",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
