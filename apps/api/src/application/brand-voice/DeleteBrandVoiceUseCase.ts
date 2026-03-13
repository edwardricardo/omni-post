/**
 * @file DeleteBrandVoiceUseCase.ts
 * @description Removes the brand voice configuration for an account.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { type BrandVoiceRepository } from "../../domain/repositories/BrandVoiceRepository.js";

export interface DeleteBrandVoiceInput {
  accountId: string;
}

export class DeleteBrandVoiceUseCase implements UseCase<DeleteBrandVoiceInput, void, UseCaseError> {
  constructor(private readonly repository: BrandVoiceRepository) {}

  /**
   * @method execute
   * @description Deletes the brand voice for the given account. No-op if none exists.
   */
  async execute(input: DeleteBrandVoiceInput): Promise<Result<void, UseCaseError>> {
    if (!input.accountId) {
      return err(new UseCaseError("accountId is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    await this.repository.deleteByAccountId(input.accountId);
    return ok(undefined);
  }
}
