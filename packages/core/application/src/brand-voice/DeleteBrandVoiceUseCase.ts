/**
 * @file DeleteBrandVoiceUseCase.ts
 * @description Removes the brand voice configuration for an account.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { type BrandVoiceRepository } from "@core/domain/repositories/BrandVoiceRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

export interface DeleteBrandVoiceInput {
  accountId: string;
}

export class DeleteBrandVoiceUseCase implements UseCase<DeleteBrandVoiceInput, void, UseCaseError> {
  constructor(
    private readonly repository: BrandVoiceRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Deletes the brand voice for the given account. No-op if none exists.
   */
  async execute(input: DeleteBrandVoiceInput): Promise<Result<void, UseCaseError>> {
    if (!input.accountId) {
      return err(new UseCaseError("accountId is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    const doWork = async (): Promise<Result<void, UseCaseError>> => {
      await this.repository.deleteByAccountId(input.accountId);
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
          "Failed to delete brand voice",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
