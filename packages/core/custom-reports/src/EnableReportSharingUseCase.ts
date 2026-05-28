/**
 * @file EnableReportSharingUseCase.ts
 * @description Generates a share token for a custom report, enabling public access.
 * @layer application
 */

import { randomBytes } from "node:crypto";
import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type { CustomReportRepository } from "@core/domain/repositories/CustomReportRepository.js";
import type { UnitOfWork } from "@core/domain/repositories/Repository.js";

export interface EnableReportSharingInput {
  reportId: string;
  accountId: string;
  expiresAt?: string;
}

export interface EnableReportSharingOutput {
  shareToken: string;
  shareUrl: string;
}

export class EnableReportSharingUseCase implements UseCase<
  EnableReportSharingInput,
  EnableReportSharingOutput,
  UseCaseError
> {
  constructor(
    private readonly repository: CustomReportRepository,
    private readonly clientUrl: string,
    private readonly unitOfWork?: UnitOfWork
  ) {}

  async execute(
    input: EnableReportSharingInput
  ): Promise<Result<EnableReportSharingOutput, UseCaseError>> {
    const doWork = async (): Promise<Result<EnableReportSharingOutput, UseCaseError>> => {
      const findResult = await this.repository.findById(input.reportId);
      if (!findResult.ok) {
        return err(
          new UseCaseError(`Report not found: ${input.reportId}`, USE_CASE_ERRORS.NOT_FOUND)
        );
      }

      if (findResult.value.accountId !== input.accountId) {
        return err(new UseCaseError("Access denied", USE_CASE_ERRORS.FORBIDDEN));
      }

      const shareToken = randomBytes(32).toString("hex");

      await this.repository.update(input.reportId, {
        shareToken,
        shareEnabled: true,
        ...(input.expiresAt ? { shareExpiresAt: new Date(input.expiresAt) } : {}),
      });

      return ok({
        shareToken,
        shareUrl: `${this.clientUrl}/reports/shared/${shareToken}`,
      });
    };

    try {
      if (this.unitOfWork) {
        let result: Result<EnableReportSharingOutput, UseCaseError> = ok({
          shareToken: "",
          shareUrl: "",
        });
        await this.unitOfWork.executeInTransaction(async () => {
          result = await doWork();
        });
        return result;
      }
      return await doWork();
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to enable report sharing",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
