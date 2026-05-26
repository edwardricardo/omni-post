/**
 * @file DeleteBrandKitUseCase.ts
 * @description Removes the brand kit configuration for an account.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import { type BrandKitRepository } from "@core/domain/repositories/BrandKitRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

export interface DeleteBrandKitInput {
  accountId: string;
}

export class DeleteBrandKitUseCase implements UseCase<DeleteBrandKitInput, void, UseCaseError> {
  constructor(
    private readonly repository: BrandKitRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Deletes the brand kit for the given account. No-op if none exists.
   */
  async execute(input: DeleteBrandKitInput): Promise<Result<void, UseCaseError>> {
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
          "Failed to delete brand kit",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
