/**
 * @file DeleteStyleGuideRuleUseCase.ts
 * @description Removes a style-guide rule by id. Maps the repository's
 *              `NOT_FOUND` outcome to a typed `UseCaseError`.
 * @layer application
 */

import { ok, err, type Result } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { StyleGuideRuleRepository } from "@core/domain/repositories/StyleGuideRuleRepository.js";

export interface DeleteStyleGuideRuleInput {
  id: string;
}

export class DeleteStyleGuideRuleUseCase implements UseCase<
  DeleteStyleGuideRuleInput,
  void,
  UseCaseError
> {
  constructor(private readonly repository: StyleGuideRuleRepository) {}

  async execute(input: DeleteStyleGuideRuleInput): Promise<Result<void, UseCaseError>> {
    const result = await this.repository.delete(input.id);
    if (result.ok) return ok(undefined);
    if (result.error === "NOT_FOUND") {
      return err(new UseCaseError("Style-guide rule not found", USE_CASE_ERRORS.NOT_FOUND));
    }
    return err(
      new UseCaseError("Failed to delete style-guide rule", USE_CASE_ERRORS.INTERNAL_ERROR)
    );
  }
}
