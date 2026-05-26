/**
 * @file DeleteCustomReportUseCase.ts
 * @description Deletes a custom report after verifying account ownership.
 *   Cascades to associated schedules via Prisma onDelete: Cascade.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { CustomReportRepository } from "@core/domain/repositories/CustomReportRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";
import type { DeleteCustomReportInput } from "./types.js";

/**
 * @class DeleteCustomReportUseCase
 * @description Deletes a custom report after ownership validation.
 */
export class DeleteCustomReportUseCase implements UseCase<
  DeleteCustomReportInput,
  void,
  UseCaseError
> {
  constructor(
    private readonly repository: CustomReportRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  /**
   * @method execute
   * @description Deletes a custom report owned by the given account.
   * @param input - Report ID and accountId
   * @returns Result<void> on success
   */
  async execute(input: DeleteCustomReportInput): Promise<Result<void, UseCaseError>> {
    const doWork = async (): Promise<Result<void, UseCaseError>> => {
      const findResult = await this.repository.findById(input.reportId);
      if (!findResult.ok) {
        return err(
          new UseCaseError(
            `Custom report not found: ${input.reportId}`,
            USE_CASE_ERRORS.NOT_FOUND,
            findResult.error
          )
        );
      }

      if (findResult.value.accountId !== input.accountId) {
        return err(
          new UseCaseError(
            "Access denied: report belongs to a different account",
            USE_CASE_ERRORS.FORBIDDEN
          )
        );
      }

      const deleteResult = await this.repository.delete(input.reportId);
      if (!deleteResult.ok) {
        return err(
          new UseCaseError(
            "Failed to delete custom report",
            USE_CASE_ERRORS.INTERNAL_ERROR,
            deleteResult.error
          )
        );
      }

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
          "Failed to delete custom report",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
