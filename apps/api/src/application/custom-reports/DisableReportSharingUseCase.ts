/**
 * @file DisableReportSharingUseCase.ts
 * @description Disables public sharing for a custom report.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type { CustomReportRepository } from "../../domain/repositories/CustomReportRepository.js";
import type { UnitOfWork } from "../../domain/repositories/Repository.js";

export interface DisableReportSharingInput {
  reportId: string;
  accountId: string;
}

export class DisableReportSharingUseCase implements UseCase<
  DisableReportSharingInput,
  void,
  UseCaseError
> {
  constructor(
    private readonly repository: CustomReportRepository,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  async execute(input: DisableReportSharingInput): Promise<Result<void, UseCaseError>> {
    const doWork = async (): Promise<Result<void, UseCaseError>> => {
      const findResult = await this.repository.findById(input.reportId);
      if (!findResult.ok) {
        return err(
          new UseCaseError(`Report not found: ${input.reportId}`, USE_CASE_ERRORS.NOT_FOUND)
        );
      }

      if (findResult.value.accountId !== input.accountId) {
        return err(new UseCaseError("Access denied", USE_CASE_ERRORS.FORBIDDEN));
      }

      await this.repository.update(input.reportId, {
        shareEnabled: false,
        shareToken: null,
        shareExpiresAt: null,
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
          "Failed to disable report sharing",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
