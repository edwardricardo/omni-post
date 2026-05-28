/**
 * @file GetCustomReportQuery.ts
 * @description Query that returns a single custom report by ID with ownership check.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import type {
  CustomReportRepository,
  CustomReportDto,
} from "@core/domain/repositories/CustomReportRepository.js";
import type { GetCustomReportInput } from "./types.js";

/**
 * @class GetCustomReportQuery
 * @description Returns a single custom report after ownership validation.
 */
export class GetCustomReportQuery implements UseCase<
  GetCustomReportInput,
  CustomReportDto,
  UseCaseError
> {
  constructor(private readonly repository: CustomReportRepository) {}

  /**
   * @method execute
   * @description Retrieves a custom report by ID, verifying account ownership.
   * @param input - reportId and accountId
   * @returns Result with CustomReportDto
   */
  async execute(input: GetCustomReportInput): Promise<Result<CustomReportDto, UseCaseError>> {
    try {
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

      const dto = findResult.value;

      if (dto.accountId !== input.accountId && !dto.isShared) {
        return err(
          new UseCaseError(
            "Access denied: report belongs to a different account",
            USE_CASE_ERRORS.FORBIDDEN
          )
        );
      }

      return ok(dto);
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to get custom report",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
