/**
 * @file ListCustomReportsQuery.ts
 * @description Query that returns all custom reports for an account.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "../UseCase.js";
import type {
  CustomReportRepository,
  CustomReportDto,
} from "../../domain/repositories/CustomReportRepository.js";
import type { ListCustomReportsInput } from "./types.js";

/**
 * @class ListCustomReportsQuery
 * @description Returns all custom reports for an account as flat DTOs.
 */
export class ListCustomReportsQuery implements UseCase<
  ListCustomReportsInput,
  CustomReportDto[],
  UseCaseError
> {
  constructor(private readonly repository: CustomReportRepository) {}

  /**
   * @method execute
   * @description Lists all custom reports for the given account.
   * @param input - accountId
   * @returns Result with array of CustomReportDto
   */
  async execute(input: ListCustomReportsInput): Promise<Result<CustomReportDto[], UseCaseError>> {
    try {
      const reports = await this.repository.findByAccountId(input.accountId);
      return ok(reports);
    } catch (error: unknown) {
      return err(
        new UseCaseError(
          "Failed to list custom reports",
          USE_CASE_ERRORS.INTERNAL_ERROR,
          error instanceof Error ? error : undefined
        )
      );
    }
  }
}
