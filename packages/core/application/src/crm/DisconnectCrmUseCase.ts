/**
 * @file DisconnectCrmUseCase.ts
 * @description Deactivates a CRM connection for an account/platform.
 *              Uses UoW for transactional persistence.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { CrmConnectionRepository } from "@core/domain/repositories/CrmConnectionRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

export interface DisconnectCrmInput {
  accountId: string;
  platform: string;
}

export class DisconnectCrmUseCase implements UseCase<DisconnectCrmInput, void, UseCaseError> {
  constructor(
    private readonly repository: CrmConnectionRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Finds the active connection and deactivates it.
   */
  async execute(input: DisconnectCrmInput): Promise<Result<void, UseCaseError>> {
    if (!input.accountId) {
      return err(new UseCaseError("accountId is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }
    if (!input.platform) {
      return err(new UseCaseError("platform is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    const doWork = async (): Promise<Result<void, UseCaseError>> => {
      const existing = await this.repository.findByAccountAndPlatform(
        input.accountId,
        input.platform
      );
      if (!existing) {
        return err(new UseCaseError("CRM connection not found", USE_CASE_ERRORS.NOT_FOUND));
      }

      await this.repository.save({
        ...existing,
        isActive: false,
      });
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
          "Failed to disconnect CRM",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
