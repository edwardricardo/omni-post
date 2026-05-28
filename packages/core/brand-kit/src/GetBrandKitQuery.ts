/**
 * @file GetBrandKitQuery.ts
 * @description Returns the brand kit configuration for an account, or null if not set.
 * @layer application
 */

import { type Result, ok, err } from "@shared/types";
import { type UseCase, UseCaseError, USE_CASE_ERRORS } from "@core/application/UseCase.js";
import {
  type BrandKitRepository,
  type BrandKitData,
} from "@core/domain/repositories/BrandKitRepository.js";

export interface GetBrandKitInput {
  accountId: string;
}

export type GetBrandKitOutput = BrandKitData | null;

export class GetBrandKitQuery implements UseCase<
  GetBrandKitInput,
  GetBrandKitOutput,
  UseCaseError
> {
  constructor(private readonly repository: BrandKitRepository) {}

  /**
   * @method execute
   * @description Retrieves the brand kit for an account. Returns null when none configured.
   */
  async execute(input: GetBrandKitInput): Promise<Result<GetBrandKitOutput, UseCaseError>> {
    if (!input.accountId) {
      return err(new UseCaseError("accountId is required", USE_CASE_ERRORS.VALIDATION_FAILED));
    }

    const brandKit = await this.repository.findByAccountId(input.accountId);
    return ok(brandKit);
  }
}
