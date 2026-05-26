/**
 * @file DeleteGlossaryTermUseCase.ts
 * @description Removes a glossary entry by id. Translates the
 *              repository's `NOT_FOUND` outcome into a typed
 *              `UseCaseError` so callers can branch on a stable code.
 * @layer application
 */

import { ok, err, type Result } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { GlossaryRepository } from "@core/domain/repositories/GlossaryRepository.js";

export interface DeleteGlossaryTermInput {
  id: string;
}

export class DeleteGlossaryTermUseCase implements UseCase<
  DeleteGlossaryTermInput,
  void,
  UseCaseError
> {
  constructor(private readonly repository: GlossaryRepository) {}

  async execute(input: DeleteGlossaryTermInput): Promise<Result<void, UseCaseError>> {
    const result = await this.repository.delete(input.id);
    if (result.ok) return ok(undefined);
    if (result.error === "NOT_FOUND") {
      return err(new UseCaseError("Glossary term not found", USE_CASE_ERRORS.NOT_FOUND));
    }
    return err(new UseCaseError("Failed to delete glossary term", USE_CASE_ERRORS.INTERNAL_ERROR));
  }
}
